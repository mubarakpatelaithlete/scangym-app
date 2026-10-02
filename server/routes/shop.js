/**
 * The digital-products Shop.
 *
 * ScanSquad creators list a file (the first one is a prompt PDF), customers buy
 * it with the card they already have saved for gym bookings, and the download
 * arrives by email and on screen. No physical goods, no shipping, no stock.
 *
 * Three decisions worth knowing before changing anything here:
 *
 *  1. The order row is written BEFORE the card is charged. If the customer's
 *     phone dies between the charge and the response, the Stripe webhook can
 *     still find the order by payment intent and finish the job.
 *  2. The file itself is never served from a guessable URL. Downloads go
 *     through a per-order token, which is checked against a paid order.
 *  3. Money is integer pence everywhere, split in one place (lib/shop-earnings).
 */
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { splitEarnings, validatePrice, formatPence, PLATFORM_FEE_PERCENT } = require('../lib/shop-earnings');

const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;

const SHOP_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data/shop'                                    // Railway persistent volume
  : path.join(__dirname, '..', 'uploads', 'shop');  // local dev

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/zip',
  'application/epub+zip',
  'image/png',
  'image/jpeg',
  'audio/mpeg',
  'video/mp4',
]);

const storage = multer.diskStorage({
  destination(req, file, cb) {
    if (!fs.existsSync(SHOP_DIR)) fs.mkdirSync(SHOP_DIR, { recursive: true });
    cb(null, SHOP_DIR);
  },
  filename(req, file, cb) {
    const safe = String(file.originalname || 'product').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    cb(null, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF, ZIP, EPUB, image, MP3 or MP4 files can be sold'));
  },
});

const CATEGORIES = ['Prompt packs', 'Workout plans', 'Meal guides', 'Video programs', 'Templates'];

function publicProduct(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    price: formatPence(row.price_pence, row.currency),
    pricePence: row.price_pence,
    currency: row.currency,
    coverImageUrl: row.cover_image_url,
    creatorHandle: row.creator_handle,
    fileName: row.file_name,
    fileSizeKb: row.file_size ? Math.round(row.file_size / 1024) : null,
    contentType: row.content_type,
    salesCount: row.sales_count,
    rating: row.rating_avg != null ? Math.round(Number(row.rating_avg) * 10) / 10 : null,
    ratingCount: Number(row.rating_n) || 0,
    createdAt: row.created_at,
  };
}

// Star average per product, joined into every listing (Task 108/119).
const RATING_JOIN = `LEFT JOIN (SELECT product_id, AVG(rating) AS rating_avg, COUNT(*) AS rating_n
                     FROM shop_reviews GROUP BY product_id) rv ON rv.product_id = shop_products.id`;

/** The creator handle of the signed-in user, or null. Handles are public, so
 *  one supplied by the client is never trusted. */
const EXT_TYPES = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.mp3': 'audio/mpeg' };

/**
 * One of this user's finished Create results → the same shape multer gives,
 * saved in SHOP_DIR. Our CDN files are read through the R2 API (the public
 * CDN is not reachable from Railway); anything else is fetched over https.
 */
async function fileFromCreation(userId, sourceUrl) {
  let u;
  try { u = new URL(sourceUrl); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const { rows } = await pool.query(
    `SELECT id FROM squad_video_jobs WHERE user_id = $1 AND video_url = $2 AND status = 'done' LIMIT 1`,
    [userId, sourceUrl]
  );
  if (!rows[0]) return null;
  const ext = (path.extname(u.pathname).toLowerCase() || '.mp4');
  const mimetype = EXT_TYPES[ext];
  if (!mimetype) return null;
  if (!fs.existsSync(SHOP_DIR)) fs.mkdirSync(SHOP_DIR, { recursive: true });
  const name = `scangym-creation${ext}`;
  const dest = path.join(SHOP_DIR, `${Date.now()}_${crypto.randomBytes(4).toString('hex')}_${name}`);
  if (u.hostname === 'cdn.scangym.com') {
    const { downloadFromR2 } = require('../lib/r2-download');
    await downloadFromR2(decodeURIComponent(u.pathname.slice(1)), dest);
  } else {
    const r = await fetch(sourceUrl);
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 50 * 1024 * 1024) return null;
    fs.writeFileSync(dest, buf);
  }
  const size = fs.statSync(dest).size;
  return { path: dest, originalname: name, size, mimetype };
}

async function ownHandle(userId) {
  const { rows } = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [userId]);
  return (rows[0] && rows[0].referral_handle) || null;
}

/* ── Browse ─────────────────────────────────────────────────────────────── */

router.get('/categories', (req, res) => {
  res.json({ categories: CATEGORIES });
});

router.get('/products', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 80);
    const category = String(req.query.category || '').trim().slice(0, 60);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 40, 1), 60);

    const where = ["status = 'active'"];
    const params = [];
    if (category && category !== 'All') {
      params.push(category);
      where.push(`category = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(`(LOWER(title) LIKE $${params.length} OR LOWER(description) LIKE $${params.length} OR LOWER(creator_handle) LIKE $${params.length})`);
    }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT shop_products.*, rv.rating_avg, rv.rating_n FROM shop_products ${RATING_JOIN} WHERE ${where.join(' AND ')}
       ORDER BY sales_count DESC, created_at DESC LIMIT $${params.length}`,
      params
    );
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ products: rows.map(publicProduct), total: rows.length });
  } catch (err) {
    console.error('[Shop] list failed:', err.message);
    res.status(500).json({ error: 'Could not load the shop right now' });
  }
});

/* Task 15: "Customers also bought" — products bought by people who bought this
   one (Amazon item-to-item), topped up with bestsellers from the same category. */
router.get('/products/:id/also-bought', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10) || 0;
    const { rows } = await pool.query(
      `WITH buyers AS (SELECT buyer_user_id FROM shop_orders WHERE product_id = $1 AND status = 'paid'),
            co AS (SELECT o.product_id, COUNT(*) AS n FROM shop_orders o JOIN buyers b ON b.buyer_user_id = o.buyer_user_id
                    WHERE o.product_id <> $1 AND o.status = 'paid' GROUP BY o.product_id)
       SELECT p.*, COALESCE(co.n, 0) AS co_n FROM shop_products p LEFT JOIN co ON co.product_id = p.id
        WHERE p.status = 'active' AND p.id <> $1
          AND (co.n IS NOT NULL OR p.category = (SELECT category FROM shop_products WHERE id = $1))
        ORDER BY co_n DESC, p.sales_count DESC, p.created_at DESC LIMIT 8`, [id]
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ products: rows.map(publicProduct) });
  } catch (err) {
    console.error('[Shop] also-bought failed:', err.message);
    res.json({ products: [] });
  }
});

router.get('/products/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT shop_products.*, rv.rating_avg, rv.rating_n FROM shop_products ${RATING_JOIN} WHERE id = $1 AND status = 'active'`,
      [Number.parseInt(req.params.id, 10) || 0]
    );
    if (!rows.length) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: publicProduct(rows[0]) });
  } catch (err) {
    console.error('[Shop] read failed:', err.message);
    res.status(500).json({ error: 'Could not load that product' });
  }
});

/* Task 108/119: reviews. Anyone can read; only a paying buyer can write
   (one review per buyer, editable — Amazon "Verified Purchase"). */
router.get('/products/:id/reviews', async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10) || 0;
    const { rows } = await pool.query(
      `SELECT r.rating, r.body, r.created_at, u.first_name, u.last_name FROM shop_reviews r
         LEFT JOIN public.users u ON u.id::text = r.user_id
        WHERE r.product_id = $1 ORDER BY r.created_at DESC LIMIT 20`, [id]);
    const { rows: [agg] } = await pool.query(
      'SELECT AVG(rating) AS a, COUNT(*)::int AS n FROM shop_reviews WHERE product_id = $1', [id]);
    res.json({
      rating: agg && agg.n ? Math.round(Number(agg.a) * 10) / 10 : null, count: (agg && agg.n) || 0,
      reviews: rows.map((r) => ({
        name: [r.first_name, r.last_name ? String(r.last_name)[0] + '.' : ''].filter(Boolean).join(' ') || 'ScanGym customer',
        rating: r.rating, body: r.body || '', at: r.created_at, verified: true,
      })),
    });
  } catch (err) {
    console.error('[Shop] reviews failed:', err.message);
    res.json({ rating: null, count: 0, reviews: [] });
  }
});

router.post('/products/:id/reviews', authenticateUser, express.json(), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10) || 0;
    const rating = Number.parseInt((req.body || {}).rating, 10);
    if (!(rating >= 1 && rating <= 5)) return res.status(400).json({ error: 'Pick 1 to 5 stars' });
    const body = String((req.body || {}).body || '').trim().slice(0, 1000);
    const { rows: bought } = await pool.query(
      "SELECT 1 FROM shop_orders WHERE product_id = $1 AND buyer_user_id = $2 AND status = 'paid' LIMIT 1",
      [id, String(req.user.id)]);
    if (!bought.length) return res.status(403).json({ error: 'Only buyers can review this product' });
    await pool.query(
      `INSERT INTO shop_reviews (product_id, user_id, rating, body) VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id, user_id) DO UPDATE SET rating = EXCLUDED.rating, body = EXCLUDED.body, updated_at = NOW()`,
      [id, String(req.user.id), rating, body]);
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('[Shop] review save failed:', err.message);
    res.status(500).json({ error: 'Could not save your review' });
  }
});

/* ── Selling ────────────────────────────────────────────────────────────── */

router.post('/products', authenticateUser, upload.single('file'), async (req, res) => {
  try {
    const handle = await ownHandle(req.user.id);
    if (!handle) {
      return res.status(403).json({ error: 'You need a ScanSquad creator handle before you can sell', code: 'no_creator_handle' });
    }
    // Task 101: "Sell" under a Create result lists that creation directly —
    // no download-then-upload. Only a finished job of this user's own.
    if (!req.file && (req.body || {}).sourceUrl) {
      req.file = await fileFromCreation(req.user.id, String(req.body.sourceUrl));
      if (!req.file) return res.status(400).json({ error: 'That creation could not be found on your account' });
    }
    if (!req.file) return res.status(400).json({ error: 'Attach the file customers will download' });

    const title = String((req.body || {}).title || '').trim().slice(0, 120);
    const description = String((req.body || {}).description || '').trim().slice(0, 2000);
    const category = CATEGORIES.includes((req.body || {}).category) ? req.body.category : 'Prompt packs';
    const pricePence = Math.round(Number.parseFloat((req.body || {}).price || '0') * 100);
    const coverImageUrl = String((req.body || {}).coverImageUrl || '').trim().slice(0, 500) || null;

    const priceError = validatePrice(pricePence);
    if (!title) return res.status(400).json({ error: 'Give your product a title' });
    if (priceError) return res.status(400).json({ error: priceError });

    const { rows } = await pool.query(
      `INSERT INTO shop_products
         (creator_handle, creator_user_id, title, description, category, price_pence,
          cover_image_url, file_path, file_name, file_size, content_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [handle, req.user.id, title, description, category, pricePence, coverImageUrl,
       req.file.path, req.file.originalname, req.file.size, req.file.mimetype]
    );
    res.json({ success: true, product: publicProduct(rows[0]) });
  } catch (err) {
    console.error('[Shop] create failed:', err.message);
    res.status(500).json({ error: err.message || 'Could not list that product' });
  }
});

router.get('/my-products', authenticateUser, async (req, res) => {
  try {
    const handle = await ownHandle(req.user.id);
    if (!handle) return res.json({ products: [], earnings: { grossPence: 0, earningsPence: 0, sales: 0 } });

    const products = await pool.query(
      'SELECT * FROM shop_products WHERE creator_handle = $1 ORDER BY created_at DESC', [handle]
    );
    const earnings = await pool.query(
      `SELECT COALESCE(SUM(amount_pence),0) AS gross,
              COALESCE(SUM(creator_earnings_pence),0) AS earned,
              COUNT(*) AS sales
         FROM shop_orders WHERE creator_handle = $1 AND status = 'paid'`, [handle]
    );
    const e = earnings.rows[0];
    res.json({
      products: products.rows.map(publicProduct),
      earnings: {
        grossPence: Number(e.gross),
        earningsPence: Number(e.earned),
        earnings: formatPence(e.earned),
        sales: Number(e.sales),
        platformFeePercent: PLATFORM_FEE_PERCENT,
      },
    });
  } catch (err) {
    console.error('[Shop] my-products failed:', err.message);
    res.status(500).json({ error: 'Could not load your products' });
  }
});

router.patch('/products/:id', authenticateUser, express.json(), async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10) || 0;
    const handle = await ownHandle(req.user.id);
    const { rows } = await pool.query('SELECT * FROM shop_products WHERE id = $1', [id]);
    if (!rows.length || rows[0].creator_handle !== handle) {
      return res.status(404).json({ error: 'Product not found' });
    }
    const body = req.body || {};
    const status = body.status === 'hidden' ? 'hidden' : body.status === 'active' ? 'active' : rows[0].status;
    let pricePence = rows[0].price_pence;
    if (body.price != null) {
      pricePence = Math.round(Number.parseFloat(body.price) * 100);
      const priceError = validatePrice(pricePence);
      if (priceError) return res.status(400).json({ error: priceError });
    }
    const updated = await pool.query(
      `UPDATE shop_products
          SET status = $1, price_pence = $2,
              title = COALESCE(NULLIF($3,''), title),
              description = COALESCE(NULLIF($4,''), description),
              updated_at = NOW()
        WHERE id = $5 RETURNING *`,
      [status, pricePence, String(body.title || '').trim().slice(0, 120),
       String(body.description || '').trim().slice(0, 2000), id]
    );
    res.json({ success: true, product: publicProduct(updated.rows[0]) });
  } catch (err) {
    console.error('[Shop] update failed:', err.message);
    res.status(500).json({ error: 'Could not update that product' });
  }
});

/* ── Buying ─────────────────────────────────────────────────────────────── */

function downloadToken() {
  return crypto.randomBytes(24).toString('base64url');
}

async function emailDownloadLink({ to, product, order, baseUrl }) {
  if (!to) return { ok: false, reason: 'no-recipient' };
  const { sendMail } = require('../lib/mail-send');
  const link = `${baseUrl}/api/shop/download/${order.download_token}`;
  return sendMail({
    to,
    subject: `Your download: ${product.title}`,
    text: `Thanks for buying "${product.title}" from ${product.creator_handle} on ScanGym.\n\n`
      + `Download it here: ${link}\n\nThe link works for 30 days.`,
    html: `<p>Thanks for buying <strong>${product.title}</strong> from @${product.creator_handle} on ScanGym.</p>`
      + `<p><a href="${link}">Download your file</a></p><p style="color:#666">The link works for 30 days.</p>`,
  });
}

/**
 * POST /api/shop/checkout  { productId, cardId? }
 *
 * Charges the saved card. A customer with no card gets 402 + needs_card so the
 * app can open the card sheet and come straight back — the alternative,
 * inventing a second card-entry flow just for the Shop, is how the booking and
 * shop payment paths would drift apart.
 */
router.post('/checkout', authenticateUser, express.json(), async (req, res) => {
  let order = null;
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment is not configured' });
    const productId = Number.parseInt((req.body || {}).productId, 10) || 0;

    const products = await pool.query("SELECT * FROM shop_products WHERE id = $1 AND status = 'active'", [productId]);
    if (!products.rows.length) return res.status(404).json({ error: 'Product not found' });
    const product = products.rows[0];

    const users = await pool.query(
      'SELECT id, email, phone_number, stripe_customer_id FROM public.users WHERE id = $1', [req.user.id]
    );
    const user = users.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Already bought it? Hand back the same download instead of charging twice.
    const existing = await pool.query(
      "SELECT * FROM shop_orders WHERE product_id = $1 AND buyer_user_id = $2 AND status = 'paid' LIMIT 1",
      [product.id, user.id]
    );
    if (existing.rows.length) {
      return res.json({
        success: true, alreadyOwned: true,
        downloadUrl: `/api/shop/download/${existing.rows[0].download_token}`,
      });
    }

    if (!user.stripe_customer_id) {
      return res.status(402).json({ error: 'Add a card to buy this', code: 'needs_card' });
    }
    let paymentMethodId = (req.body || {}).cardId;
    if (!paymentMethodId) {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      paymentMethodId = customer.invoice_settings && customer.invoice_settings.default_payment_method;
      if (!paymentMethodId) {
        const methods = await stripe.paymentMethods.list({ customer: user.stripe_customer_id, type: 'card', limit: 1 });
        paymentMethodId = methods.data[0] && methods.data[0].id;
      }
    }
    if (!paymentMethodId) return res.status(402).json({ error: 'Add a card to buy this', code: 'needs_card' });

    const { platformFeePence, creatorEarningsPence } = splitEarnings(product.price_pence);
    const created = await pool.query(
      `INSERT INTO shop_orders
         (product_id, buyer_user_id, buyer_email, amount_pence, currency,
          platform_fee_pence, creator_earnings_pence, creator_handle, download_token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [product.id, user.id, user.email, product.price_pence, product.currency || 'GBP',
       platformFeePence, creatorEarningsPence, product.creator_handle, downloadToken()]
    );
    order = created.rows[0];

    const intent = await stripe.paymentIntents.create({
      amount: product.price_pence,
      currency: (product.currency || 'GBP').toLowerCase(),
      customer: user.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      description: `ScanGym Shop — ${product.title}`,
      metadata: { shopOrderId: String(order.id), productId: String(product.id), creatorHandle: product.creator_handle },
    });

    if (intent.status !== 'succeeded') {
      await pool.query("UPDATE shop_orders SET status = 'failed', stripe_payment_intent_id = $1 WHERE id = $2",
        [intent.id, order.id]);
      return res.status(402).json({ error: 'Your card was declined', code: 'declined' });
    }

    await markOrderPaid(order.id, intent.id);

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const mailed = await emailDownloadLink({ to: user.email, product, order, baseUrl });

    res.json({
      success: true,
      paid: true,
      emailed: !!mailed.ok,
      downloadUrl: `/api/shop/download/${order.download_token}`,
      amount: formatPence(product.price_pence, product.currency),
    });
  } catch (err) {
    console.error('[Shop] checkout failed:', err.message);
    if (order) {
      await pool.query("UPDATE shop_orders SET status = 'failed' WHERE id = $1 AND status = 'pending'", [order.id])
        .catch(() => {});
    }
    if (err && err.type === 'StripeCardError') {
      return res.status(402).json({ error: err.message || 'Your card was declined', code: 'declined' });
    }
    res.status(500).json({ error: 'Payment failed — nothing was charged twice, try again' });
  }
});

/** Shared by the checkout response and the Stripe webhook, so a payment that
 *  arrives either way is recorded exactly once. */
async function markOrderPaid(orderId, paymentIntentId) {
  const { rows } = await pool.query(
    `UPDATE shop_orders
        SET status = 'paid', stripe_payment_intent_id = $1, paid_at = NOW()
      WHERE id = $2 AND status <> 'paid' RETURNING *`,
    [paymentIntentId, orderId]
  );
  if (!rows.length) return null;   // already paid — do not double-count the sale
  await pool.query('UPDATE shop_products SET sales_count = sales_count + 1 WHERE id = $1', [rows[0].product_id]);
  return rows[0];
}

/* ── Downloading ────────────────────────────────────────────────────────── */

const DOWNLOAD_DAYS = 30;
const MAX_DOWNLOADS = 20;

router.get('/download/:token', optionalAuth, async (req, res) => {
  try {
    const token = String(req.params.token || '').slice(0, 64);
    const { rows } = await pool.query(
      `SELECT o.*, p.file_path, p.file_name, p.content_type, p.title
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
        WHERE o.download_token = $1`, [token]
    );
    const order = rows[0];
    if (!order || order.status !== 'paid') return res.status(404).send('Download not found');

    const ageDays = (Date.now() - new Date(order.paid_at || order.created_at).getTime()) / 86400000;
    /* Task 158 B4 (54): the signed-in buyer can always re-download from My orders;
       the 30-day / 20-download limits only guard a forwarded email link. */
    const isBuyer = !!(req.user && String(req.user.id) === String(order.buyer_user_id));
    if (!isBuyer && ageDays > DOWNLOAD_DAYS) return res.status(410).send('This download link has expired — contact support');
    if (!isBuyer && order.download_count >= MAX_DOWNLOADS) return res.status(429).send('This link has been used too many times');
    if (!order.file_path || !fs.existsSync(order.file_path)) {
      console.error('[Shop] missing file for order', order.id, order.file_path);
      return res.status(410).send('The file is no longer available — contact support');
    }

    await pool.query('UPDATE shop_orders SET download_count = download_count + 1 WHERE id = $1', [order.id]);
    res.setHeader('Content-Type', order.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(order.file_name || 'download').replace(/"/g, '')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(order.file_path).pipe(res);
  } catch (err) {
    console.error('[Shop] download failed:', err.message);
    res.status(500).send('Download failed');
  }
});

/** What the signed-in customer has bought, so the Shop can show "Owned". */
router.get('/my-orders', authenticateUser, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.id, o.product_id, o.amount_pence, o.download_token, o.paid_at, p.title, p.creator_handle
         FROM shop_orders o JOIN shop_products p ON p.id = o.product_id
        WHERE o.buyer_user_id = $1 AND o.status = 'paid' ORDER BY o.paid_at DESC`, [req.user.id]
    );
    res.json({
      orders: rows.map((o) => ({
        id: o.id, productId: o.product_id, title: o.title, creatorHandle: o.creator_handle,
        price: formatPence(o.amount_pence), paidAt: o.paid_at,
        downloadUrl: `/api/shop/download/${o.download_token}`,
      })),
    });
  } catch (err) {
    console.error('[Shop] my-orders failed:', err.message);
    res.status(500).json({ error: 'Could not load your purchases' });
  }
});

module.exports = router;
module.exports.markOrderPaid = markOrderPaid;
