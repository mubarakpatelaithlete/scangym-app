/**
 * Payment Routes — Uber-Style Payment Flow
 *
 * Architecture (identical to Uber):
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ CARD SAVED ONCE → every future booking is 1-tap                    │
 * │                                                                    │
 * │ First time:  POST /setup-card  →  SetupIntent  →  card saved      │
 * │      — OR —  POST /create-intent  →  pay  →  card auto-saved      │
 * │                                                                    │
 * │ Every time after:                                                  │
 * │   GET /saved-cards  →  show "Visa ••4242" on booking screen        │
 * │   POST /quick-checkout  →  charge saved card  →  QR  →  done      │
 * │                                                                    │
 * │ Cash: POST /cash-booking  →  reserve  →  pay at gym               │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Endpoints:
 *   POST /setup-card         — Save card WITHOUT paying (Uber onboarding)
 *   POST /confirm-setup      — After SetupIntent confirmed on frontend
 *   GET  /saved-cards        — List saved payment methods
 *   DELETE /saved-cards/:id  — Remove a saved card
 *   POST /quick-checkout     — 1-tap checkout with saved card (THE main flow)
 *   POST /create-intent      — Fallback: Stripe Elements for first payment
 *   POST /confirm-intent     — After Elements payment → auto-save card
 *   POST /cash-booking       — Cash at gym (no card needed)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// ─── Global Pricing Engine (PPP + Surge) ────────────────────────────────────
const pricing = require('../lib/pricing-engine');
const { getAccessService, isAccessControlEnabled } = require('../lib/access-control');
const { creditWallet } = require('../lib/wallet-credit');
// v4.0: Surge pricing removed — flat £4.49 base everywhere

/**
 * C7 fix: Currency based on GYM's physical country, not visitor IP.
 * Looks up gym's country from the request body/query (set by frontend from gym data).
 * Supports 1.2M+ gyms across 99 countries.
 */
function getGymGeo(req) {
  const gymCountry = (req.body?.gymCountry || req.query?.gymCountry || 'GB').toUpperCase();
  return { country: gymCountry, city: '' };
}


const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
let stripe;
let stripeKeyValid = false;
try {
  if (!STRIPE_SECRET) {
    console.error('[Payment] CRITICAL: STRIPE_SECRET_KEY env var is NOT SET! All payments will fail.');
  } else if (!STRIPE_SECRET.startsWith('sk_')) {
    console.error('[Payment] CRITICAL: STRIPE_SECRET_KEY does not start with sk_ — likely invalid.');
  } else {
    console.log(`[Payment] Stripe key loaded: ${STRIPE_SECRET.substring(0, 7)}...${STRIPE_SECRET.slice(-4)} (${STRIPE_SECRET.length} chars)`);
    stripeKeyValid = true;
  }
  stripe = require('stripe')(STRIPE_SECRET);
} catch (err) {
  console.error('Stripe init error:', err.message);
}

/**
 * Resolve 'anytime' time strings into a consistent object.
 */
function resolveTime(time) {
  const isAnytime = !time || time === 'anytime';
  let effectiveTime = time;
  if (isAnytime) {
    const now = new Date();
    const nextHour = Math.min(Math.max(now.getUTCHours() + 1, 6), 20);
    effectiveTime = String(nextHour).padStart(2, '0') + ':00';
  }
  const hours = parseInt(effectiveTime.split(':')[0], 10);
  // C3 FIX: endTime = startTime + 1 hour (day pass is a 1-hour session window)
  const endHour = Math.min(hours + 1, 23);
  const endTime = String(endHour).padStart(2, '0') + ':' + effectiveTime.split(':')[1];
  return {
    isAnytime,
    hours,
    startTime: effectiveTime,
    endTime,
    displayTime: isAnytime ? 'Anytime today' : effectiveTime,
  };
}

let QRCode;
try {
  QRCode = require('qrcode');
} catch (err) {
  console.error('QRCode module not found, QR generation will be skipped');
}

/**
 * Generate a 2-scan QR code for a confirmed booking.
 * Creates a record in booking_qr_codes and returns a scannable URL QR.
 * Reuses existing active QR if one already exists for this booking.
 */
async function generate2ScanQR(bookingId, userId, gymId) {
  const existing = await pool.query(
    'SELECT * FROM booking_qr_codes WHERE booking_id = $1 AND status = $2 AND expires_at > NOW()',
    [bookingId, 'active']
  );
  if (existing.rows.length > 0) {
    const qr = existing.rows[0];
    const scanUrl = 'https://scangym.com/scan/' + qr.qr_token;
    let dataUrl = null;
    if (QRCode) {
      try { dataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 2, errorCorrectionLevel: 'H' }); }
      catch (e) { console.error('[QR] toDataURL failed for existing QR:', e.message); }
    }
    return {
      token: qr.qr_token, scanUrl, dataUrl,
      maxScans: qr.max_scans, scanCount: qr.scan_count,
      scansRemaining: qr.max_scans - qr.scan_count,
      status: qr.status, expiresAt: qr.expires_at,
    };
  }

  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 6; i++) seg += chars.charAt(Math.floor(Math.random() * chars.length));
    segments.push(seg);
  }
  const qrToken = 'SG-' + segments.join('-');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO booking_qr_codes (booking_id, user_id, gym_id, qr_token, max_scans, expires_at)
     VALUES ($1, $2, $3, $4, 2, $5)
     ON CONFLICT DO NOTHING`,
    [bookingId, userId || 'guest', gymId, qrToken, expiresAt]
  );

  const scanUrl = 'https://scangym.com/scan/' + qrToken;
  // S5-C03 FIX: Ensure QR data URL is always generated. Log errors instead of swallowing.
  let dataUrl = null;
  if (QRCode) {
    try { dataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 2, errorCorrectionLevel: 'H' }); }
    catch (e) { console.error('[QR] toDataURL failed for new QR:', e.message); }
  } else {
    console.error('[QR] qrcode module not available — QR images will not be generated');
  }

  return {
    token: qrToken, scanUrl, dataUrl,
    maxScans: 2, scanCount: 0, scansRemaining: 2,
    status: 'active', expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Provision access control credentials for a booking (Tier 2: 24/7 gym integration)
 * Non-blocking — if access provisioning fails, the booking still succeeds with standard QR.
 */
async function provisionAccessControl(bookingId, gymId, userId, userEmail, userName) {
  try {
    if (!isAccessControlEnabled()) return null;

    // Check if gym has access control configured
    const gymResult = await pool.query(
      'SELECT access_system, access_system_id, access_group_id, access_type, access_api_key, access_verified, name FROM gyms WHERE id = $1',
      [gymId]
    );
    if (gymResult.rows.length === 0) return null;
    
    const gym = { id: gymId, ...gymResult.rows[0] };
    if (!gym.access_system || gym.access_system === 'manual' || !gym.access_verified) return null;

    const bookingResult = await pool.query(
      'SELECT booking_date, start_time, end_time FROM public.bookings WHERE id = $1',
      [bookingId]
    );
    if (bookingResult.rows.length === 0) return null;

    const booking = bookingResult.rows[0];
    const user = { email: userEmail, name: userName || userEmail };

    const service = getAccessService();
    const credential = await service.provisionAccess(gym, booking, user);

    if (!credential || credential.fallback === 'manual') return null;

    // Store in DB
    await pool.query(`
      INSERT INTO booking_access_credentials
        (booking_id, gym_id, user_id, credential_type, provider,
         access_link_id, seam_user_id, seam_credential_id,
         access_url, access_qr_url, pin, mobile_key, instructions,
         starts_at, ends_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active')
    `, [
      bookingId, gymId, userId,
      credential.type, credential.provider,
      credential.access_link_id || null, credential.seam_user_id || null,
      credential.seam_credential_id || null, credential.access_url || null,
      credential.access_qr_url || null, credential.pin || null,
      credential.mobile_key || false, credential.instructions || null,
      credential.starts_at, credential.ends_at,
    ]);

    console.log(`[Access] Provisioned ${credential.type} for booking ${bookingId} at gym ${gymId}`);
    return credential;
  } catch (err) {
    console.error(`[Access] Provisioning failed for booking ${bookingId} (non-fatal):`, err.message);
    return null; // Never block the booking
  }
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (err) {
  console.error('Nodemailer not found, email confirmations disabled');
}

/**
 * Send booking confirmation email with QR code
 */
async function sendConfirmationEmail({ to, gymName, date, time, endTime, price, bookingCode, qrDataUrl, currencySymbol }) {
  if (!nodemailer || !process.env.SENDGRID_API_KEY && !process.env.SMTP_HOST) {
    console.log('[Email] Skipped — no email transport configured');
    return;
  }

  try {
    const transporter = nodemailer.createTransport(
      process.env.SENDGRID_API_KEY
        ? { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } }
        : { host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'), auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } }
    );

    const html = `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
        <div style="text-align:center;margin-bottom:24px;">
          <h1 style="color:#f97316;font-size:28px;margin:0;">🎉 Booking Confirmed!</h1>
        </div>
        <div style="background:#1e293b;border-radius:12px;padding:24px;margin-bottom:24px;">
          <h2 style="color:white;margin:0 0 8px;">${gymName}</h2>
          <p style="color:#94a3b8;margin:4px 0;">📅 ${date}</p>
          <p style="color:#94a3b8;margin:4px 0;">🕐 ${time || 'Visit anytime today'}${endTime ? ' — ' + endTime : ''}</p>
          <p style="color:#f97316;font-size:20px;font-weight:bold;margin:12px 0 0;">${currencySymbol || '£'}${price}</p>
        </div>
        ${qrDataUrl ? `
        <div style="text-align:center;margin-bottom:24px;">
          <p style="color:white;font-weight:bold;margin-bottom:12px;">📱 Your QR Code</p>
          <div style="background:white;padding:16px;border-radius:12px;display:inline-block;">
            <img src="${qrDataUrl}" alt="QR Code" width="200" height="200">
          </div>
          <p style="color:#64748b;font-size:12px;margin-top:8px;">Booking: ${bookingCode}</p>
        </div>` : `
        <div style="text-align:center;margin-bottom:24px;">
          <p style="color:white;font-weight:bold;margin-bottom:12px;">📱 Your Booking Code</p>
          <div style="background:#1e293b;padding:20px;border-radius:12px;display:inline-block;border:2px solid #f97316;">
            <p style="color:#f97316;font-size:28px;font-weight:800;margin:0;letter-spacing:4px;">${bookingCode}</p>
          </div>
          <p style="color:#94a3b8;font-size:12px;margin-top:8px;">Show this code at the gym entrance</p>
        </div>`}
        <div style="background:#1e293b;border-radius:12px;padding:16px;font-size:14px;">
          <p style="color:white;font-weight:bold;margin:0 0 8px;">How it works:</p>
          <p style="color:#94a3b8;margin:4px 0;">📲 Show QR at the gym entrance</p>
          <p style="color:#94a3b8;margin:4px 0;">🏋️ Train for up to 24 hours</p>
          <p style="color:#94a3b8;margin:4px 0;">🚪 Scan again when you leave</p>
        </div>
        <p style="color:#475569;font-size:11px;text-align:center;margin-top:24px;">ScanGym — Book a Gym. Anywhere.</p>
      </div>`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'bookings@scangym.com',
      to,
      subject: `✅ Booking Confirmed — ${gymName} on ${date}`,
      html,
    });
    console.log(`[Email] Confirmation sent to ${to}`);
  } catch (err) {
    console.error('[Email] Failed to send confirmation:', err.message);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  STRIPE CUSTOMER — Like Uber, every user gets a Stripe Customer object
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get or create a Stripe Customer for a user.
 * Uber creates a Customer at signup — we create on first payment interaction.
 */
async function getOrCreateStripeCustomer(userId, email, phone) {
  if (!stripe) throw new Error('Stripe not configured');

  const user = await pool.query(
    'SELECT id, stripe_customer_id, email, phone_number FROM public.users WHERE id = $1',
    [userId]
  );
  if (user.rows.length === 0) throw new Error('User not found');

  const u = user.rows[0];

  if (u.stripe_customer_id) {
    return u.stripe_customer_id;
  }

  // Create Stripe Customer (like Uber does at signup)
  const customer = await stripe.customers.create({
    email: email || u.email || undefined,
    phone: phone || u.phone_number || undefined,
    metadata: { userId, source: 'scangym' },
  });

  await pool.query(
    'UPDATE public.users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
    [customer.id, userId]
  );

  console.log(`[Stripe] Created Customer ${customer.id} for user ${userId}`);
  return customer.id;
}

/**
 * Auto-save a payment method from a PaymentIntent to the Customer.
 * Called after first successful card payment — makes all future bookings 1-tap.
 * This is the KEY missing piece that Uber does automatically.
 */
async function autoSaveCardFromIntent(userId, paymentIntentId) {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (!intent.payment_method) return null;

    const customerId = await getOrCreateStripeCustomer(userId);

    // Check if this payment method is already attached
    const pm = await stripe.paymentMethods.retrieve(intent.payment_method);
    if (pm.customer === customerId) {
      // Already attached — just ensure it's the default
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: intent.payment_method },
      });
      return pm;
    }

    // Attach the payment method to the customer
    await stripe.paymentMethods.attach(intent.payment_method, { customer: customerId });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: intent.payment_method },
    });

    console.log(`[Stripe] Auto-saved card ${pm.card?.brand} ••${pm.card?.last4} for user ${userId}`);
    return pm;
  } catch (err) {
    // Non-blocking — booking still succeeds even if card save fails
    console.error('[Stripe] Auto-save card failed (non-blocking):', err.message);
    return null;
  }
}

/**
 * Resolve the user id behind a referral handle.
 * Checks creator_landing_pages.slug first (Creator program), then falls back
 * to public.users.referral_handle (every user gets one at signup). Without
 * the fallback, regular users sharing scangym.com/r/{handle} links earned
 * commissions on paper but never received the wallet credit.
 */
async function resolveReferralUserId(handle) {
  if (!handle) return null;
  try {
    const lp = await pool.query(
      'SELECT creator_user_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
      [handle]
    );
    if (lp.rows.length > 0 && lp.rows[0].creator_user_id) return lp.rows[0].creator_user_id;
  } catch (e) { /* fall through to users lookup */ }
  try {
    const u = await pool.query(
      'SELECT id FROM public.users WHERE LOWER(referral_handle) = LOWER($1) LIMIT 1',
      [handle]
    );
    if (u.rows.length > 0 && u.rows[0].id) return u.rows[0].id;
  } catch (e) { /* fall through to email lookup */ }
  // Fallback 3: email match via creator_referrals — handles stored in localStorage
  // that were never synced via /api/creators/sync-handle still have their email
  // recorded in creator_referrals when the referral was tracked.
  try {
    const emailMatch = await pool.query(
      `SELECT u.id FROM public.users u
       INNER JOIN creator_referrals cr ON LOWER(cr.creator_email) = LOWER(u.email)
       WHERE LOWER(cr.creator_handle) = LOWER($1) LIMIT 1`,
      [handle]
    );
    if (emailMatch.rows.length > 0 && emailMatch.rows[0].id) return emailMatch.rows[0].id;
  } catch (e) { /* no match */ }
  return null;
}

/**
 * Credit creator commission for referred bookings (shared helper)
 */
async function creditCreatorCommission(booking) {
  if (!booking.referral_code) return;
  try {
    const commissionPence = 125;
    await pool.query(
      `UPDATE creator_referrals
       SET status = 'converted', booking_id = $1, commission_pence = $2, converted_at = NOW()
       WHERE id = (
         SELECT id FROM creator_referrals
         WHERE creator_handle = $3 AND status = 'clicked'
         ORDER BY created_at DESC LIMIT 1
       )`,
      [booking.id, commissionPence, booking.referral_code]
    );
    const updated = await pool.query(
      `SELECT id FROM creator_referrals WHERE booking_id = $1 AND status = 'converted'`,
      [booking.id]
    );
    if (updated.rows.length === 0) {
      await pool.query(
        `INSERT INTO creator_referrals (creator_handle, booking_id, commission_pence, status, converted_at)
         VALUES ($1, $2, $3, 'converted', NOW())`,
        [booking.referral_code, booking.id, commissionPence]
      );
    }
    await pool.query(
      `UPDATE creator_memberships
       SET total_earnings_pence = total_earnings_pence + $1,
           total_conversions = total_conversions + 1
       WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $2 LIMIT 1)`,
      [commissionPence, booking.referral_code]
    );
    console.log(`[Payment] Credited £${(commissionPence / 100).toFixed(2)} commission to creator "${booking.referral_code}" for booking ${booking.id}`);

    // ── Auto-credit commission to creator's ScanGym Wallet ──
    // This is the zero-friction payout: creators earn into their wallet automatically.
    // They can spend on free gym sessions or cash out via Stripe Connect later.
    try {
      const creatorUserId = await resolveReferralUserId(booking.referral_code);
      if (creatorUserId) {
        // Constraint-free upsert (old ON CONFLICT version silently failed
        // when wallets.user_id lacks a UNIQUE constraint)
        const credited = await creditWallet(
          pool, creatorUserId, commissionPence,
          `🎉 Creator commission: £${(commissionPence / 100).toFixed(2)} from booking #${booking.id}`,
          'commission'
        );
        if (credited) {
          console.log(`[Payment] Wallet auto-credited: £${(commissionPence / 100).toFixed(2)} → creator "${booking.referral_code}" (balance: £${(credited.balanceAfterPence / 100).toFixed(2)})`);
        }
      } else {
        console.warn(`[Payment] Commission recorded but wallet NOT credited — no user found for referral handle "${booking.referral_code}"`);
      }
    } catch (walletErr) {
      // Non-blocking: commission is already recorded in creator_referrals
      console.error('[Payment] Wallet auto-credit failed (non-blocking):', walletErr.message);
    }

  } catch (commErr) {
    console.error('[Payment] Commission credit failed (non-blocking):', commErr.message);
  }
}


// ═══════════════════════════════════════════════════════════════════════════
//  1. SETUP CARD — Save card WITHOUT paying (Uber onboarding style)
//     User adds card in payment settings or before first booking.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payment/setup-card
 * Create a SetupIntent to save a card without making a payment.
 * Uber does this at signup — user adds card in Wallet before first ride.
 */
router.post('/setup-card', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });

    const customerId = await getOrCreateStripeCustomer(req.session.userId);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session', // Will be used for future off-session payments (like Uber)
    });

    res.json({
      success: true,
      clientSecret: setupIntent.client_secret,
    });
  } catch (err) {
    console.error('Setup card error:', err);
    res.status(500).json({ error: 'Failed to set up card saving' });
  }
});

/**
 * POST /api/payment/confirm-setup
 * Called after the frontend confirms a SetupIntent.
 * Ensures the card is attached and set as default.
 */
router.post('/confirm-setup', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });

    const { setupIntentId, nickname } = req.body;
    if (!setupIntentId) return res.status(400).json({ error: 'setupIntentId required' });

    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
    if (setupIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Setup not completed', status: setupIntent.status });
    }

    const pmId = setupIntent.payment_method;
    const customerId = await getOrCreateStripeCustomer(req.session.userId);

    // Set as default
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pmId },
    });

    const pm = await stripe.paymentMethods.retrieve(pmId);

    res.json({
      success: true,
      card: {
        id: pm.id,
        brand: pm.card?.brand || 'card',
        last4: pm.card?.last4 || '****',
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
        nickname: nickname || '',
      },
      message: '💳 Card saved! Future bookings will be 1-tap.',
    });
  } catch (err) {
    console.error('Confirm setup error:', err);
    res.status(500).json({ error: 'Failed to confirm card setup' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  2. SAVED CARDS — List / Remove (Uber Wallet screen)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/payment/saved-cards
 * List saved payment methods for the logged-in user.
 * Uber shows this as "Payment" with card icons on the ride screen.
 */
// V7: Payment health check — diagnose configuration issues
router.get('/health', async (req, res) => {
  const checks = {
    stripeKeySet: !!STRIPE_SECRET,
    stripeKeyFormat: STRIPE_SECRET ? STRIPE_SECRET.startsWith('sk_') : false,
    stripeKeyMode: STRIPE_SECRET ? (STRIPE_SECRET.startsWith('sk_live') ? 'live' : STRIPE_SECRET.startsWith('sk_test') ? 'test' : 'unknown') : 'missing',
    stripeObjectCreated: !!stripe,
    stripeKeyValid: false,
    dbConnected: false,
    bookingsTableExists: false,
    qrTableExists: false,
  };
  // Test Stripe key by making a lightweight API call
  if (stripe) {
    try {
      await stripe.balance.retrieve();
      checks.stripeKeyValid = true;
    } catch (e) {
      checks.stripeError = e.message;
    }
  }
  // Test DB connection
  try {
    const r = await pool.query('SELECT 1 as ok');
    checks.dbConnected = r.rows[0]?.ok === 1;
  } catch (e) {
    checks.dbError = e.message;
  }
  // Check tables exist
  try {
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('bookings','booking_qr_codes','users')`
    );
    const tNames = tables.rows.map(r => r.table_name);
    checks.bookingsTableExists = tNames.includes('bookings');
    checks.qrTableExists = tNames.includes('booking_qr_codes');
    checks.usersTableExists = tNames.includes('users');
  } catch (e) {
    checks.tableCheckError = e.message;
  }
  // Count stuck pending bookings
  try {
    const stale = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.bookings WHERE status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes'`
    );
    checks.stalePendingBookings = parseInt(stale.rows[0]?.cnt || '0');
  } catch (e) {}

  const allGood = checks.stripeKeyValid && checks.dbConnected && checks.bookingsTableExists && checks.qrTableExists;
  res.json({ status: allGood ? 'healthy' : 'unhealthy', checks });
});

router.get('/saved-cards', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.json({ cards: [], message: 'Login to see saved cards' });

    const user = await pool.query(
      'SELECT stripe_customer_id FROM public.users WHERE id = $1',
      [req.session.userId]
    );
    if (user.rows.length === 0 || !user.rows[0].stripe_customer_id) {
      return res.json({ cards: [] });
    }

    const customerId = user.rows[0].stripe_customer_id;
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });

    // Get default payment method
    const customer = await stripe.customers.retrieve(customerId);
    const defaultPM = customer.invoice_settings?.default_payment_method;

    const cards = methods.data.map(pm => ({
      id: pm.id,
      brand: pm.card?.brand || 'card',
      last4: pm.card?.last4 || '****',
      expMonth: pm.card?.exp_month,
      expYear: pm.card?.exp_year,
      isDefault: pm.id === defaultPM,
    }));

    res.json({ cards });
  } catch (err) {
    console.error('List cards error:', err);
    res.json({ cards: [] });
  }
});

/**
 * DELETE /api/payment/saved-cards/:id
 * Remove a saved card. Uber lets you delete cards from Wallet.
 */
router.delete('/saved-cards/:id', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });

    await stripe.paymentMethods.detach(req.params.id);
    res.json({ success: true, message: 'Card removed' });
  } catch (err) {
    console.error('Remove card error:', err);
    res.status(400).json({ error: 'Failed to remove card' });
  }
});

/**
 * POST /api/payment/set-default-card
 * Set a saved card as the default payment method.
 */
router.post('/set-default-card', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });

    const { cardId } = req.body;
    if (!cardId) return res.status(400).json({ error: 'cardId required' });

    const customerId = await getOrCreateStripeCustomer(req.session.userId);
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: cardId },
    });

    res.json({ success: true, message: 'Default card updated' });
  } catch (err) {
    console.error('Set default card error:', err);
    res.status(400).json({ error: 'Failed to set default card' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  3. QUICK CHECKOUT — 1-tap booking with saved card (THE UBER FLOW)
//     This is the primary payment path. Saved card → instant charge → QR.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payment/quick-checkout
 * UBER-STYLE 1-TAP CHECKOUT — Uses saved card, no payment form needed.
 * Creates booking + charges saved card + generates QR in ONE call.
 *
 * This is the magic: user taps "Book Now" → booking confirmed instantly.
 */
router.post('/quick-checkout', async (req, res) => {
  // BUG FIX: Declare booking OUTSIDE try so catch block can access it
  // Previously `const booking` was inside try {} → block-scoped → catch couldn't
  // mark it as 'failed' → stuck 'pending' bookings blocked all future attempts.
  let booking = null;
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!stripeKeyValid) return res.status(500).json({ error: 'Payment not configured. Contact support.' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required for 1-tap booking' });

    let { gymId, date, time, cardId, savedCardId, placeId, passType, gymName: reqGymName, gymAddress: reqGymAddr, referral_code } = req.body;
    const effectiveCardId = cardId || savedCardId; // Frontend sends savedCardId
    if (!date) return res.status(400).json({ error: 'date required' });
    // C2 fix: Resolve 'anytime' / empty time to a sensible default
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }

    // Get user + Stripe customer
    const userResult = await pool.query(
      'SELECT id, stripe_customer_id, email, phone_number FROM public.users WHERE id = $1',
      [req.session.userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'No saved payment method. Please add a card first.' });
    }

    // Get default card or specified card
    let paymentMethodId = effectiveCardId;
    if (!paymentMethodId) {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      paymentMethodId = customer.invoice_settings?.default_payment_method;
      if (!paymentMethodId) {
        const methods = await stripe.paymentMethods.list({
          customer: user.stripe_customer_id, type: 'card', limit: 1,
        });
        paymentMethodId = methods.data[0]?.id;
      }
    }

    if (!paymentMethodId) {
      return res.status(400).json({ error: 'No saved card found. Please add a payment method first.' });
    }

    // Resolve gym
    let dbGymId = gymId;
    if (placeId && isNaN(parseInt(gymId))) {
      const ensureResult = await pool.query('SELECT id FROM public.gyms WHERE place_id = $1', [placeId]);
      if (ensureResult.rows.length > 0) {
        dbGymId = ensureResult.rows[0].id;
      } else {
        return res.status(404).json({ error: 'Gym not found' });
      }
    }

    // Get gym info (C6 fix: include day_pass_price for owner-set pricing)
    const gym = await pool.query('SELECT id, name, address, country, day_pass_price FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];

    // C6 fix: Use owner-set price if available, otherwise PPP default
    const dayPrice = pricing.calculateGymPrice({
      gymDayPassPrice: g.day_pass_price,
      countryCode: g.country || 'GB',
      passType: 'day',
    });
    const gymCurrency = dayPrice.currency;
    const resolved = resolveTime(time);

    // S4-C11 FIX: Apply 15% referral discount when referral code is present
    let price = dayPrice.amount;
    let amount = dayPrice.stripeAmount;
    let appliedDiscount = null;
    if (referral_code) {
      const REFERRAL_DISCOUNT_PERCENT = 15;
      const discountAmount = parseFloat((price * REFERRAL_DISCOUNT_PERCENT / 100).toFixed(2));
      price = parseFloat((price - discountAmount).toFixed(2));
      amount = pricing.toStripeAmount(price, gymCurrency);
      appliedDiscount = { percent: REFERRAL_DISCOUNT_PERCENT, saved: discountAmount, code: referral_code };
      console.log(`[Payment] Referral discount: ${REFERRAL_DISCOUNT_PERCENT}% off → ${dayPrice.symbol}${price} (saved ${dayPrice.symbol}${discountAmount}) via "${referral_code}"`);
    }

    // V7-FIX: Clean up stale 'pending' bookings (>5 min old) for this user
    // These get stuck when Stripe charge fails but catch block can't update status
    try {
      const cleaned = await pool.query(
        `UPDATE public.bookings SET status = 'failed', updated_at = NOW()
         WHERE user_id = $1 AND status = 'pending'
         AND created_at < NOW() - INTERVAL '5 minutes'
         RETURNING id`,
        [req.session.userId]
      );
      if (cleaned.rows.length > 0) {
        console.log(`[Payment] Cleaned ${cleaned.rows.length} stale pending bookings for user ${req.session.userId}: ${cleaned.rows.map(r => r.id).join(', ')}`);
      }
    } catch (cleanupErr) {
      console.warn('[Payment] Stale booking cleanup failed (non-fatal):', cleanupErr.message);
    }

    // C8 FIX: Prevent duplicate bookings (same user + gym + date + time)
    // V7-FIX: Only block on 'confirmed'/'reserved' bookings, not stale 'pending'
    const existingBooking = await pool.query(
      `SELECT id, status FROM public.bookings
       WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
       AND status IN ('confirmed', 'reserved')
       LIMIT 1`,
      [dbGymId, req.session.userId, date, resolved.startTime]
    );
    if (existingBooking.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate booking',
        message: 'You already have a booking at this gym for this date and time.',
        existingBookingId: existingBooking.rows[0].id,
      });
    }

    // Generate booking codes
    const crypto = require('crypto');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingCode = '';
    for (let i = 0; i < 8; i++) {
      bookingCode += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3) bookingCode += '-';
    }

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO public.bookings
        (gym_id, user_id, booking_date, start_time, end_time, total_amount,
         platform_fee_amount, booking_type, booking_code, status,
         user_email, user_name, referral_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'quick', $8, 'pending', $9, 'User', $10, NOW(), NOW())
       RETURNING *`,
      [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime,
       price, price * 0.10, bookingCode, user.email || '', referral_code || null]
    );
    booking = bookingResult.rows[0];

    // Charge the saved card — instant, no user interaction! (Like Uber)
    // v4.0: Surge pricing removed
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: gymCurrency, // C7 fix: Currency from gym's physical country
      customer: user.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true, // ← Charge immediately!
      metadata: {
        bookingId: String(booking.id),
        gymName: g.name,
        quickCheckout: 'true',
        country: g.country || 'GB',
        ...(referral_code ? { referral_code } : {}),
      },
      receipt_email: user.email || undefined,
    });

    if (intent.status !== 'succeeded') {
      await pool.query(
        'UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2',
        ['failed', booking.id]
      );
      return res.status(400).json({
        error: 'Payment failed. Your card may have been declined.',
        status: intent.status,
      });
    }

    // Generate 2-scan QR code
    const qr = await generate2ScanQR(booking.id, req.session.userId, dbGymId);

    // Confirm booking
    await pool.query(
      `UPDATE public.bookings SET status = 'confirmed', qr_code = $1, qr_code_url = $2,
       stripe_payment_intent_id = $3, stripe_payment_status = 'paid', updated_at = NOW()
       WHERE id = $4`,
      [qr.token, qr.dataUrl, intent.id, booking.id]
    );

    // S4-C12 FIX: Credit creator commission (attach referral_code from request)
    if (referral_code) {
      booking.referral_code = referral_code;
    }
    await creditCreatorCommission(booking);

    // Tier 2: Provision access control (non-blocking — Kisi/Seam door unlock)
    const accessCredential = await provisionAccessControl(
      booking.id, dbGymId, req.session.userId, user.email, user.name
    );

    // Send confirmation email (non-blocking)
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');
    if (user.email) {
      sendConfirmationEmail({
        to: user.email, gymName: g.name, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: price.toFixed(2), bookingCode, qrDataUrl: qr.dataUrl,
        currencySymbol: dayPrice.symbol,
      }).catch(err => console.error('[Email] Send failed:', err.message));
    }

    // ChatGPT Playbook #5/#7: Include referral link in every booking response
    let referralHandle = null;
    try {
      const refQ = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [req.session.userId]);
      referralHandle = refQ.rows[0]?.referral_handle || null;
    } catch (e) {
      console.warn('[Payment] Failed to fetch referral handle:', e.message);
    }

    res.json({
      success: true,
      quickCheckout: true,
      booking: {
        id: booking.id, gymName: g.name, date: bookingDate,
        time: booking.start_time, price, bookingCode, status: 'confirmed',
      },
      qr: {
        token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
        maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
        expiresAt: qr.expiresAt,
      },
      // Tier 2: Access control credentials (Kisi QR unlock, Seam PIN, etc.)
      access: accessCredential ? {
        type: accessCredential.type,
        provider: accessCredential.provider,
        access_url: accessCredential.access_url,
        access_qr_url: accessCredential.access_qr_url,
        pin: accessCredential.pin,
        instructions: accessCredential.instructions,
        starts_at: accessCredential.starts_at,
        ends_at: accessCredential.ends_at,
      } : null,
      // ChatGPT Playbook: Auto-embed referral link in share
      referralHandle,
      referralLink: referralHandle ? `https://scangym.com/r/${referralHandle}` : null,
      shareText: `Just booked a gym session at ${g.name} for ${dayPrice.symbol}${price.toFixed(2)} with @ScanGym! No membership needed 🏋️ ${referralHandle ? 'scangym.com/r/' + referralHandle : 'scangym.com'}`,
      message: accessCredential
        ? '⚡ Booked! Door access provisioned — ' + accessCredential.instructions
        : '⚡ Booked instantly with your saved card!',
    });
  } catch (err) {
    console.error('[Payment] Quick checkout error:', err.type, err.code, err.message);

    // V7-FIX: Handle SCA / 3D Secure BEFORE marking as failed
    // When card requires authentication, the booking should stay 'pending' — not 'failed'
    // The frontend will complete 3DS auth and then call /confirm-intent
    if (err.code === 'authentication_required' || err.code === 'payment_intent_authentication_failure') {
      // Keep booking as 'pending' — will be confirmed after 3DS or cleaned up by stale check
      console.log(`[Payment] SCA required for booking ${booking?.id}, keeping as pending for 3DS flow`);
      const pi = err.raw?.payment_intent;
      return res.status(402).json({
        error: 'Card requires authentication',
        requiresAuth: true,
        clientSecret: pi?.client_secret || null,
        paymentIntentId: pi?.id || null,
        bookingId: booking ? booking.id : null,
      });
    }

    // For genuine failures, mark booking as 'failed'
    if (booking && booking.id) {
      try {
        await pool.query(
          'UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2',
          ['failed', booking.id]
        );
        console.log(`[Payment] Marked booking ${booking.id} as failed after payment error`);
      } catch (updateErr) {
        console.error('[Payment] Failed to update booking status:', updateErr.message);
      }
    }

    // Provide specific error messages for common Stripe errors
    let userMessage = 'Payment failed. Please try again.';
    if (err.type === 'StripeCardError') {
      userMessage = err.message || 'Your card was declined.';
    } else if (err.type === 'StripeInvalidRequestError') {
      userMessage = 'Payment configuration error. Please contact support.';
      console.error('[Payment] Stripe config error — check STRIPE_SECRET_KEY env var:', err.message);
    } else if (err.type === 'StripeAuthenticationError') {
      userMessage = 'Payment system error. Please try again later.';
      console.error('[Payment] CRITICAL: Stripe API key is invalid! Check STRIPE_SECRET_KEY env var.');
    } else if (err.type === 'StripeConnectionError') {
      userMessage = 'Could not connect to payment processor. Please try again.';
    }

    res.status(500).json({ error: userMessage, detail: err.message, code: err.code || 'unknown' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  3B. CONFIRM SCA — After 3D Secure authentication completes on frontend
//      Creates booking + generates QR code for authenticated payment
// ═══════════════════════════════════════════════════════════════════════════

router.post('/confirm-sca', authenticateUser, express.json(), async (req, res) => {
  try {
    // FIX: Accept referral_code from request body (was missing — commissions lost on 3DS payments)
    const { paymentIntentId, gymId, placeId, date, time, email, gymName, gymAddress, passType, referral_code } = req.body;
    if (!paymentIntentId) return res.status(400).json({ error: 'paymentIntentId required' });

    // Verify payment intent succeeded
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed', status: pi.status });
    }

    // FIX: Recover referral_code from PaymentIntent metadata if not in body
    const effectiveReferral = referral_code || pi.metadata?.referral_code || null;

    // Create booking (FIX: include referral_code in INSERT)
    const bookingResult = await pool.query(
      `INSERT INTO bookings (user_id, gym_id, place_id, date, time, status, payment_intent_id, amount_pence, currency, pass_type, customer_email, gym_name, gym_address, referral_code, created_at)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       RETURNING *`,
      [req.user.id, gymId || null, placeId || null, date, time || '00:00', paymentIntentId, pi.amount, (pi.currency || 'gbp').toLowerCase(), passType || 'day', email, gymName, gymAddress, effectiveReferral]
    ).catch(async () => {
      // Fallback if columns missing
      const r = await pool.query(
        `INSERT INTO bookings (user_id, gym_id, date, status, payment_intent_id, created_at) VALUES ($1, $2, $3, 'confirmed', $4, NOW()) RETURNING *`,
        [req.user.id, gymId, date, paymentIntentId]
      );
      // Attach referral_code on the JS object for commission crediting
      if (r.rows[0] && referral_code) r.rows[0].referral_code = referral_code;
      return r;
    });

    const booking = bookingResult.rows[0];

    // FIX: Credit creator commission for SCA-confirmed bookings
    if (referral_code) booking.referral_code = referral_code;
    await creditCreatorCommission(booking);

    // Generate QR code
    let qr = { dataUrl: null, code: null };
    try {
      const qrCode = 'SG-' + booking.id + '-' + Date.now().toString(36).toUpperCase();
      const QRCode = require('qrcode');
      const qrDataUrl = await QRCode.toDataURL(JSON.stringify({ bookingId: booking.id, code: qrCode, gym: gymName, date, time }), { width: 300, margin: 2 });
      qr = { dataUrl: qrDataUrl, code: qrCode };

      // Store QR in DB
      await pool.query(
        'UPDATE bookings SET qr_code = $1, qr_data_url = $2 WHERE id = $3',
        [qrCode, qrDataUrl, booking.id]
      ).catch(() => {});
    } catch (qrErr) {
      console.error('[SCA] QR generation error:', qrErr.message);
    }

    // FIX: Credit creator commission for 3DS-authenticated bookings (was completely missing!)
    if (effectiveReferral) {
      booking.referral_code = effectiveReferral;
    }
    await creditCreatorCommission(booking);

    console.log(`[SCA] Booking ${booking.id} confirmed after 3DS auth — PI ${paymentIntentId}${effectiveReferral ? ` (referral: ${effectiveReferral})` : ''}`);

    res.json({
      success: true,
      booking: { id: booking.id, status: 'confirmed', date, time, passType, gymName },
      qr,
      access: null
    });
  } catch (err) {
    console.error('[SCA] Confirm error:', err.message);
    res.status(500).json({ error: 'Failed to confirm booking after authentication', detail: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  4. FIRST-TIME CARD PAYMENT — Stripe Elements (fallback for new users)
//     After this payment, card is AUTO-SAVED for future 1-tap bookings.
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
//  BOT-CHECKOUT — Server-to-server 1-tap booking for Telegram/WhatsApp
//  Like quick-checkout but authenticated by internal bot secret, not session.
//  Looks up user by ID, charges saved card, returns QR data URL.
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/payment/bot-checkout
 * Internal endpoint for chatbot adapters (Telegram, WhatsApp, etc.)
 * Body: { userId, gymId, placeId, date, time, cardId?, referral_code?, botSecret }
 * Returns: { success, booking, qr } — same shape as quick-checkout
 */
router.post('/bot-checkout', express.json(), async (req, res) => {
  let booking = null;
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    // Auth: must be called by internal bot with shared secret
    const botSecret = req.body.botSecret || req.headers['x-bot-secret'];
    if (!botSecret || botSecret !== (process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { userId, gymId, placeId, date, cardId, referral_code } = req.body;
    let { time } = req.body;
    if (!userId || !date) return res.status(400).json({ error: 'userId and date required' });
    if (!gymId && !placeId) return res.status(400).json({ error: 'gymId or placeId required' });

    // Resolve time
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }

    // Get user + Stripe customer
    const userResult = await pool.query(
      'SELECT id, stripe_customer_id, email, phone_number, first_name FROM public.users WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userResult.rows[0];

    if (!user.stripe_customer_id) {
      return res.status(400).json({ error: 'no_saved_card', message: 'No payment method on file. Please add a card at scangym.com first.' });
    }

    // Get default card or specified card
    let paymentMethodId = cardId;
    if (!paymentMethodId) {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      paymentMethodId = customer.invoice_settings?.default_payment_method;
      if (!paymentMethodId) {
        const methods = await stripe.paymentMethods.list({
          customer: user.stripe_customer_id, type: 'card', limit: 1,
        });
        paymentMethodId = methods.data[0]?.id;
      }
    }
    if (!paymentMethodId) {
      return res.status(400).json({ error: 'no_saved_card', message: 'No saved card found. Please add a card at scangym.com.' });
    }

    // Get card details for display
    let cardLabel = 'Saved card';
    try {
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (pm.card) cardLabel = `${pm.card.brand?.toUpperCase()} ••${pm.card.last4}`;
    } catch (e) { /* non-fatal */ }

    // Resolve gym
    let dbGymId = gymId;
    if (placeId && (!gymId || isNaN(parseInt(gymId)))) {
      const ensureResult = await pool.query('SELECT id FROM public.gyms WHERE place_id = $1', [placeId]);
      if (ensureResult.rows.length > 0) dbGymId = ensureResult.rows[0].id;
      else return res.status(404).json({ error: 'Gym not found' });
    }

    const gymResult = await pool.query('SELECT id, name, address, country FROM public.gyms WHERE id = $1', [dbGymId]);
    if (gymResult.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gymResult.rows[0];

    // Resolve times
    const [hours, mins] = time.split(':').map(Number);
    const endHour = Math.min(hours + 1, 23);
    const startTime = time;
    const endTime = String(endHour).padStart(2, '0') + ':' + String(mins || 0).padStart(2, '0');

    // Price
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');
    let price = dayPrice.amount;
    const gymCurrency = dayPrice.currency;
    let amount = pricing.toStripeAmount(price, gymCurrency);

    // Referral discount
    if (referral_code) {
      const discountAmount = parseFloat((price * 0.15).toFixed(2));
      price = parseFloat((price - discountAmount).toFixed(2));
      amount = pricing.toStripeAmount(price, gymCurrency);
    }

    // Clean up stale pending bookings
    try {
      await pool.query(
        `UPDATE public.bookings SET status = 'failed', updated_at = NOW()
         WHERE user_id = $1 AND status = 'pending' AND created_at < NOW() - INTERVAL '5 minutes'`,
        [userId]
      );
    } catch (e) { /* non-fatal */ }

    // Prevent duplicates
    const existing = await pool.query(
      `SELECT id FROM public.bookings
       WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
       AND status IN ('confirmed', 'reserved') LIMIT 1`,
      [dbGymId, userId, date, startTime]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'duplicate', message: 'You already have a booking at this gym for this date/time.' });
    }

    // Generate booking code
    const crypto = require('crypto');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingCode = '';
    for (let i = 0; i < 8; i++) {
      bookingCode += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3) bookingCode += '-';
    }

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO public.bookings
        (gym_id, user_id, booking_date, start_time, end_time, total_amount,
         platform_fee_amount, booking_type, booking_code, status,
         user_email, user_name, referral_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'bot', $8, 'pending', $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [dbGymId, userId, date, startTime, endTime, price, price * 0.10,
       bookingCode, user.email || '', user.first_name || 'Bot User', referral_code || null]
    );
    booking = bookingResult.rows[0];

    // Charge saved card
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: gymCurrency,
      customer: user.stripe_customer_id,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        bookingId: String(booking.id),
        gymName: g.name,
        botCheckout: 'true',
        country: g.country || 'GB',
      },
      receipt_email: user.email || undefined,
    });

    if (intent.status !== 'succeeded') {
      await pool.query('UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', booking.id]);
      return res.status(400).json({ error: 'Payment failed. Card may have been declined.' });
    }

    // Generate QR
    const qr = await generate2ScanQR(booking.id, userId, dbGymId);

    // Confirm booking
    await pool.query(
      `UPDATE public.bookings SET status = 'confirmed', qr_code = $1, qr_code_url = $2,
       stripe_payment_intent_id = $3, stripe_payment_status = 'paid', updated_at = NOW()
       WHERE id = $4`,
      [qr.token, qr.dataUrl, intent.id, booking.id]
    );

    // Credit creator commission
    if (referral_code) booking.referral_code = referral_code;
    await creditCreatorCommission(booking);

    // Send confirmation email
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');
    if (user.email) {
      sendConfirmationEmail({
        to: user.email, gymName: g.name, date: bookingDate,
        time: startTime, endTime, price: price.toFixed(2),
        bookingCode, qrDataUrl: qr.dataUrl, currencySymbol: dayPrice.symbol,
      }).catch(err => console.error('[Email] Bot checkout email failed:', err.message));
    }

    console.log(`[Payment] Bot checkout success: booking ${booking.id} at ${g.name} for user ${userId}, charged ${dayPrice.symbol}${price} on ${cardLabel}`);

    res.json({
      success: true,
      botCheckout: true,
      booking: {
        id: booking.id, gymName: g.name, date: bookingDate,
        time: startTime, price, bookingCode, status: 'confirmed',
        currencySymbol: dayPrice.symbol,
      },
      qr: {
        token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
        maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
        expiresAt: qr.expiresAt,
      },
      cardUsed: cardLabel,
      message: `⚡ Booked at ${g.name}! Charged ${dayPrice.symbol}${price.toFixed(2)} to ${cardLabel}.`,
    });
  } catch (err) {
    console.error('[Payment] Bot checkout error:', err.message);
    if (booking) {
      try { await pool.query('UPDATE public.bookings SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', booking.id]); } catch (e) {}
    }

    if (err.code === 'authentication_required') {
      return res.status(402).json({
        error: 'sca_required',
        message: 'Your card requires 3D Secure authentication. Please complete this booking at scangym.com.',
      });
    }

    res.status(500).json({ error: err.message || 'Payment failed' });
  }
});

/**
 * GET /api/payment/bot-cards
 * Returns saved cards for a user (used by chatbot to show "Pay with Visa ••4242")
 * Query: ?userId=xxx&botSecret=xxx
 */
router.get('/bot-cards', async (req, res) => {
  try {
    const botSecret = req.query.botSecret || req.headers['x-bot-secret'];
    if (!botSecret || botSecret !== (process.env.BOT_CHECKOUT_SECRET || process.env.ADMIN_IMPORT_SECRET)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM public.users WHERE id = $1', [userId]
    );
    if (!userResult.rows.length || !userResult.rows[0].stripe_customer_id) {
      return res.json({ cards: [], message: 'No payment methods on file' });
    }

    const methods = await stripe.paymentMethods.list({
      customer: userResult.rows[0].stripe_customer_id,
      type: 'card',
    });

    const cards = methods.data.map(pm => ({
      id: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
      expMonth: pm.card.exp_month,
      expYear: pm.card.exp_year,
      label: `${pm.card.brand?.toUpperCase()} ••${pm.card.last4}`,
    }));

    res.json({ cards });
  } catch (err) {
    console.error('[Payment] Bot cards error:', err.message);
    res.status(500).json({ error: 'Failed to fetch cards' });
  }
});

/**
 * POST /api/payment/create-intent
 * Create a Stripe PaymentIntent with a Customer attached.
 * The Customer attachment is critical — it allows auto-saving the card after payment.
 */
router.post('/create-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { bookingId, email } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    const result = await pool.query(
      `SELECT b.*, g.name as gym_name, g.currency as gym_currency, g.country as gym_country
       FROM public.bookings b
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Already paid' });

    const amount = Math.round(parseFloat(booking.total_amount) * 100);

    // Uber-style: attach Customer to PaymentIntent so we can save the card after
    const currency = (booking.gym_currency || 'GBP').toLowerCase();
    // revolut_pay only supports GBP; amazon_pay only supports GBP/EUR/USD
    const pmTypes = ['card'];
    if (['gbp', 'eur', 'usd'].includes(currency)) pmTypes.push('amazon_pay');
    if (currency === 'gbp') pmTypes.push('revolut_pay');

    const intentConfig = {
      amount,
      currency,
      metadata: { bookingId: String(booking.id), gymName: booking.gym_name || '' },
      receipt_email: email || booking.user_email || undefined,
      payment_method_types: pmTypes,
    };

    // If logged in, attach Stripe Customer → enables auto-save after payment
    if (req.session?.userId) {
      try {
        const customerId = await getOrCreateStripeCustomer(
          req.session.userId,
          email || booking.user_email
        );
        intentConfig.customer = customerId;
        // setup_future_usage tells Stripe to prepare this card for future charges
        intentConfig.setup_future_usage = 'off_session';
      } catch (e) {
        console.log('[Payment] Could not attach customer (non-blocking):', e.message);
      }
    }

    const intent = await stripe.paymentIntents.create(intentConfig);

    await pool.query(
      'UPDATE public.bookings SET stripe_payment_intent_id = $1, updated_at = NOW() WHERE id = $2',
      [intent.id, booking.id]
    );

    res.json({
      success: true,
      clientSecret: intent.client_secret,
      amount: parseFloat(booking.total_amount),
      gymName: booking.gym_name,
    });
  } catch (err) {
    console.error('Create intent error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

/**
 * POST /api/payment/confirm-intent
 * Called after Stripe Elements confirms payment on frontend.
 * AUTO-SAVES the card for future 1-tap bookings (the Uber magic).
 * Generates QR, confirms booking, sends email.
 */
router.post('/confirm-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { bookingId, paymentIntentId, email } = req.body;
    if (!bookingId || !paymentIntentId) {
      return res.status(400).json({ error: 'bookingId and paymentIntentId required' });
    }

    // Verify the payment intent is actually paid
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed', status: intent.status });
    }

    // Get booking
    const result = await pool.query('SELECT * FROM public.bookings WHERE id = $1', [bookingId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    // Update email if provided
    if (email && email.includes('@')) {
      await pool.query(
        'UPDATE public.bookings SET user_email = $1, updated_at = NOW() WHERE id = $2',
        [email, bookingId]
      );
      booking.user_email = email;
      try { await stripe.paymentIntents.update(paymentIntentId, { receipt_email: email }); } catch(e) {
        console.warn('[Payment] Failed to update receipt email on payment intent:', e.message);
      }
    }

    // ═══ UBER-STYLE AUTO-SAVE: Save the card for future 1-tap bookings ═══
    let savedCard = null;
    if (req.session?.userId) {
      savedCard = await autoSaveCardFromIntent(req.session.userId, paymentIntentId);
    }

    // Generate 2-scan QR code
    const qr = await generate2ScanQR(booking.id, booking.user_id, booking.gym_id);

    // Update booking
    await pool.query(
      `UPDATE public.bookings SET status = 'confirmed', qr_code = $1, qr_code_url = $2,
       stripe_payment_intent_id = $3, stripe_payment_status = 'paid', updated_at = NOW()
       WHERE id = $4`,
      [qr.token, qr.dataUrl, paymentIntentId, booking.id]
    );

    // FIX: Recover referral_code from PaymentIntent metadata if booking has none
    // (Stripe Elements path stores referral in metadata but booking.referral_code may be null)
    if (!booking.referral_code && intent.metadata?.referral_code) {
      booking.referral_code = intent.metadata.referral_code;
      // Persist to DB so future queries see it
      await pool.query(
        'UPDATE public.bookings SET referral_code = $1 WHERE id = $2',
        [booking.referral_code, booking.id]
      ).catch(() => {});
    }
    // Credit creator commission
    // FIX: confirm-intent loads booking from DB — referral_code may be NULL
    // for bookings created before the INSERT fix. Fall back to matching
    // creator_referrals by booking_id, or the most recent unconverted click
    // for the booking's user session.
    if (!booking.referral_code) {
      try {
        const ref = await pool.query(
          `SELECT creator_handle FROM creator_referrals
           WHERE booking_id = $1 AND status = 'converted' LIMIT 1`,
          [booking.id]
        );
        if (ref.rows.length > 0) {
          booking.referral_code = ref.rows[0].creator_handle;
        } else {
          // Check for an unconverted click that belongs to this user's session
          const click = await pool.query(
            `SELECT creator_handle FROM creator_referrals
             WHERE status = 'clicked' AND created_at > NOW() - INTERVAL '24 hours'
             ORDER BY created_at DESC LIMIT 1`
          );
          if (click.rows.length > 0) {
            booking.referral_code = click.rows[0].creator_handle;
          }
        }
      } catch (e) {
        console.warn('[Payment] Referral fallback lookup failed (non-blocking):', e.message);
      }
    }
    await creditCreatorCommission(booking);

    // Tier 2: Provision access control (non-blocking)
    const accessCredential = await provisionAccessControl(
      booking.id, booking.gym_id, booking.user_id,
      booking.user_email || intent.receipt_email, booking.user_name
    );

    const gym = await pool.query('SELECT name FROM public.gyms WHERE id = $1', [booking.gym_id]);
    const gymName = gym.rows[0]?.name || 'Gym';
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');

    // Send email
    const recipientEmail = booking.user_email || intent.receipt_email;
    if (recipientEmail) {
      const emailCurrency = pricing.getCurrencyForCountry(booking.gym_country || 'GB');
      sendConfirmationEmail({
        to: recipientEmail, gymName, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: parseFloat(booking.total_amount).toFixed(2),
        bookingCode: booking.booking_code, qrDataUrl: qr.dataUrl,
        currencySymbol: emailCurrency.symbol,
      }).catch(err => console.error('[Email] Send failed:', err.message));
    }

    res.json({
      success: true,
      booking: {
        id: booking.id, gymName, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: parseFloat(booking.total_amount),
        bookingCode: booking.booking_code, status: 'confirmed',
      },
      qr: {
        token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
        maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
        expiresAt: qr.expiresAt,
      },
      // Tier 2: Access control credentials
      access: accessCredential ? {
        type: accessCredential.type,
        provider: accessCredential.provider,
        access_url: accessCredential.access_url,
        access_qr_url: accessCredential.access_qr_url,
        pin: accessCredential.pin,
        instructions: accessCredential.instructions,
      } : null,
      // Tell frontend the card was saved — show "Visa ••4242" next time
      cardSaved: savedCard ? {
        brand: savedCard.card?.brand || 'card',
        last4: savedCard.card?.last4 || '****',
      } : null,
    });
  } catch (err) {
    console.error('Confirm intent error:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  5. CASH BOOKING — Reserve spot, pay at reception
// ═══════════════════════════════════════════════════════════════════════════

router.post('/cash-booking', async (req, res) => {
  try {
    // S4-C05 FIX: Require authenticated session for cash bookings.
    // Without this, anyone with the API URL can create unlimited fake reservations.
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Please log in to book. Create a free account at scangym.com' });
    }

    let { gymId, placeId, date, time, email, passType, gymName, gymAddress, referral_code } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    // C2 fix: Resolve 'anytime' / empty time to a sensible default
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }
    if (!gymId && !placeId) return res.status(400).json({ error: 'gymId or placeId required' });

    // Sanitize email — prevent null/undefined from crashing INSERT
    const safeEmail = (email && typeof email === 'string' && email.includes('@')) ? email.trim() : '';
    // S4-C05 FIX: Define safeName — was previously undefined, crashing provisionAccessControl()
    const safeName = (req.body.name && typeof req.body.name === 'string') ? req.body.name.trim() : 'Guest';

    // ── Step 1: Resolve gym ID ──
    let dbGymId = gymId;
    if (placeId && isNaN(parseInt(gymId))) {
      const ensureResult = await pool.query('SELECT id FROM public.gyms WHERE place_id = $1', [placeId]);
      if (ensureResult.rows.length > 0) {
        dbGymId = ensureResult.rows[0].id;
      } else {
        try {
          const gn = gymName || 'Gym';
          const insertResult = await pool.query(
            `INSERT INTO public.gyms (name, address, place_id, day_pass_price, owner_id, slug, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, $5, 'system', $4, true, NOW(), NOW()) RETURNING id`,
            [gn, gymAddress || '', placeId, gn.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100), pricing.BASE_PRICE_GBP]
          );
          dbGymId = insertResult.rows[0].id;
        } catch (e) {
          console.error('[Cash Booking] Gym insert error:', e.message);
          return res.status(400).json({ error: 'Gym not found' });
        }
      }
    }

    // C6 fix: include day_pass_price for owner-set pricing
    const gym = await pool.query('SELECT id, name, country, day_pass_price FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];

    // C6 fix: Use owner-set price if available, otherwise PPP default
    const passTypeClean = passType || 'day';
    const resolved = resolveTime(time);
    const dayPrice = pricing.calculateGymPrice({
      gymDayPassPrice: g.day_pass_price,
      countryCode: g.country || 'GB',
      passType: 'day',
    });

    // S4-C11 FIX: Apply 15% referral discount when referral code is present
    let price = dayPrice.amount;
    let appliedDiscount = null;
    if (referral_code) {
      const REFERRAL_DISCOUNT_PERCENT = 15;
      const discountAmount = parseFloat((price * REFERRAL_DISCOUNT_PERCENT / 100).toFixed(2));
      price = parseFloat((price - discountAmount).toFixed(2));
      appliedDiscount = { percent: REFERRAL_DISCOUNT_PERCENT, saved: discountAmount, code: referral_code };
      console.log(`[Payment] Cash referral discount: ${REFERRAL_DISCOUNT_PERCENT}% off → ${dayPrice.symbol}${price} via "${referral_code}"`);
    }

    // S4-C09 FIX: Prevent duplicate cash bookings using userId (always available after C-05 auth fix)
    const existingCash = await pool.query(
      `SELECT id, status FROM public.bookings
       WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
       AND status NOT IN ('cancelled', 'failed')
       LIMIT 1`,
      [dbGymId, req.session.userId, date, resolved.startTime]
    );
    if (existingCash.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate booking',
        message: 'You already have a booking at this gym for this date and time.',
        existingBookingId: existingCash.rows[0].id,
      });
    }

    // ── Step 3: Generate booking code (same XXXX-XXXX format as Stripe path, fits VARCHAR(9)) ──
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingCode = '';
    for (let i = 0; i < 8; i++) {
      bookingCode += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3) bookingCode += '-';
    }

    // ── Step 4: Insert booking (no qr_code — added via UPDATE after generate2ScanQR) ──
    let booking;
    try {
      // S4-C05 FIX: Use authenticated userId instead of hardcoded 'guest'
      const bookingResult = await pool.query(
        `INSERT INTO public.bookings
          (gym_id, user_id, booking_date, start_time, end_time, total_amount,
           platform_fee_amount, booking_type, booking_code, status,
           user_email, user_name, referral_code, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $11, $12, NOW(), NOW())
         RETURNING *`,
        [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime, price, price * 0.10,
         passTypeClean + '_cash', bookingCode, safeEmail, safeName, referral_code || null]
      );
      booking = bookingResult.rows[0];
    } catch (insertErr) {
      console.error('[Cash Booking] INSERT failed:', insertErr.message, '| code:', insertErr.code, '| detail:', insertErr.detail);
      // Retry without platform_fee_amount if column doesn't exist
      try {
        // S4-C05 FIX: Use authenticated userId in retry path too
        const bookingResult = await pool.query(
          `INSERT INTO public.bookings
            (gym_id, user_id, booking_date, start_time, end_time, total_amount,
             booking_type, booking_code, status,
             user_email, user_name, referral_code, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, $11, NOW(), NOW())
           RETURNING *`,
          [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime, price,
           passTypeClean + '_cash', bookingCode, safeEmail, safeName, referral_code || null]
        );
        booking = bookingResult.rows[0];
        console.log('[Cash Booking] Retry without platform_fee_amount succeeded');
      } catch (retryErr) {
        console.error('[Cash Booking] Retry INSERT also failed:', retryErr.message, '| code:', retryErr.code, '| detail:', retryErr.detail);
        return res.status(500).json({ error: 'Failed to create reservation', detail: retryErr.message });
      }
    }

    // H12 FIX: Credit creator commission for cash bookings too
    if (referral_code) {
      booking.referral_code = referral_code;
      await creditCreatorCommission(booking);
    }

    // ── Step 5: Generate QR code (non-blocking — don't fail the booking) ──
    let qr = { token: bookingCode, scanUrl: '', dataUrl: '', maxScans: 2, scansRemaining: 2, expiresAt: null };
    try {
      qr = await generate2ScanQR(booking.id, req.session.userId, dbGymId);
      await pool.query(
        'UPDATE public.bookings SET qr_code = $1, qr_code_url = $2, updated_at = NOW() WHERE id = $3',
        [qr.token, qr.dataUrl, booking.id]
      );
    } catch (qrErr) {
      console.error('[Cash Booking] QR generation failed (non-fatal):', qrErr.message);
    }

    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');

    // Tier 2: Provision access control for cash bookings too (non-blocking)
    const accessCredential = await provisionAccessControl(
      booking.id, dbGymId, booking.user_id || 'guest', safeEmail, safeName
    );

    if (safeEmail) {
      sendConfirmationEmail({
        to: safeEmail, gymName: g.name, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: price.toFixed(2), bookingCode, qrDataUrl: qr.dataUrl,
        currencySymbol: dayPrice.symbol,
      }).catch(err => console.error('[Cash email] Send failed:', err.message));
    }

    res.json({
      success: true,
      booking: {
        id: booking.id, gymName: g.name, date: bookingDate,
        time: booking.start_time, price, bookingCode,
        currencySymbol: dayPrice.symbol, currency: dayPrice.currency,
        status: 'reserved', paymentMethod: 'cash',
      },
      qr: {
        token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
        maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
        expiresAt: qr.expiresAt,
      },
      // Tier 2: Access control
      access: accessCredential ? {
        type: accessCredential.type,
        provider: accessCredential.provider,
        access_url: accessCredential.access_url,
        pin: accessCredential.pin,
        instructions: accessCredential.instructions,
      } : null,
    });

    console.log('[Cash Booking] Reserved:', bookingCode, 'at', g.name, '£' + price, passTypeClean);
  } catch (err) {
    console.error('[Cash Booking] Unhandled error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to create reservation', detail: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  S5-C01 FIX: GET /verify — Verify payment after Stripe redirect
//  Frontend calls this on the BookingSuccessPage to confirm payment went through
//  and get the QR code + booking details.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/verify', async (req, res) => {
  try {
    const { session_id, booking_id } = req.query;
    if (!booking_id) {
      return res.status(400).json({ error: 'booking_id is required' });
    }

    // Get booking
    const result = await pool.query(
      'SELECT b.*, g.name as gym_name, g.country FROM public.bookings b LEFT JOIN public.gyms g ON b.gym_id = g.id WHERE b.id = $1',
      [booking_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // For cash/quick checkout, the booking is already confirmed — just return details
    if (session_id === 'cash' || session_id === 'quick') {
      const qr = await generate2ScanQR(booking.id, booking.user_id, booking.gym_id);
      const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');
      const dayPrice = pricing.getDayPassPrice(booking.country || 'GB');

      // Provision access control (non-blocking)
      const accessCredential = await provisionAccessControl(
        booking.id, booking.gym_id, booking.user_id,
        booking.user_email, booking.user_name
      );

      return res.json({
        success: true,
        booking: {
          id: booking.id, gymId: booking.gym_id,
          gymName: booking.gym_name || 'Gym', date: bookingDate,
          time: booking.start_time, endTime: booking.end_time,
          price: parseFloat(booking.total_amount),
          currency: dayPrice.currency || 'GBP',
          bookingCode: booking.booking_code, status: booking.status,
          paymentMethod: session_id === 'cash' ? 'cash' : 'card',
        },
        qr: {
          token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
          maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
          expiresAt: qr.expiresAt,
        },
        access: accessCredential ? {
          type: accessCredential.type, provider: accessCredential.provider,
          access_url: accessCredential.access_url, pin: accessCredential.pin,
          instructions: accessCredential.instructions,
        } : null,
      });
    }

    // For Stripe intent payments, verify the payment went through
    if (session_id === 'intent' && booking.stripe_payment_intent_id) {
      if (!stripe) return res.status(500).json({ success: false, error: 'Payment system not configured' });

      const intent = await stripe.paymentIntents.retrieve(booking.stripe_payment_intent_id);
      if (intent.status !== 'succeeded') {
        return res.json({ success: false, error: 'Payment not yet completed', status: intent.status });
      }
    }

    // If booking is already confirmed, generate/fetch QR and return
    if (['confirmed', 'completed', 'active', 'reserved'].includes(booking.status)) {
      const qr = await generate2ScanQR(booking.id, booking.user_id, booking.gym_id);
      const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');
      const dayPrice = pricing.getDayPassPrice(booking.country || 'GB');

      const accessCredential = await provisionAccessControl(
        booking.id, booking.gym_id, booking.user_id,
        booking.user_email, booking.user_name
      );

      return res.json({
        success: true,
        booking: {
          id: booking.id, gymId: booking.gym_id,
          gymName: booking.gym_name || 'Gym', date: bookingDate,
          time: booking.start_time, endTime: booking.end_time,
          price: parseFloat(booking.total_amount),
          currency: dayPrice.currency || 'GBP',
          bookingCode: booking.booking_code, status: booking.status,
        },
        qr: {
          token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
          maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
          expiresAt: qr.expiresAt,
        },
        access: accessCredential ? {
          type: accessCredential.type, provider: accessCredential.provider,
          access_url: accessCredential.access_url, pin: accessCredential.pin,
          instructions: accessCredential.instructions,
        } : null,
      });
    }

    // Booking exists but not confirmed yet
    return res.json({ success: false, error: 'Booking not yet confirmed', status: booking.status });

  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ success: false, error: 'Payment verification failed' });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  S5-C02 FIX: GET /resume — Check if an abandoned booking can be resumed
//  Frontend calls this on page load to show a "resume booking" banner.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/resume', async (req, res) => {
  try {
    const { booking_id } = req.query;
    if (!booking_id) {
      return res.json({ canResume: false });
    }

    // Find the booking
    const result = await pool.query(
      `SELECT b.id, b.gym_id, b.status, b.total_amount, b.booking_date, b.start_time,
              b.stripe_checkout_session_id, b.stripe_payment_intent_id,
              g.name as gym_name
       FROM public.bookings b
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1`,
      [booking_id]
    );

    if (result.rows.length === 0) {
      return res.json({ canResume: false });
    }

    const booking = result.rows[0];

    // Only pending bookings can be resumed
    if (booking.status !== 'pending') {
      return res.json({ canResume: false });
    }

    // Check if booking date hasn't passed
    const bookingDate = new Date(booking.booking_date);
    const now = new Date();
    if (bookingDate < new Date(now.toISOString().split('T')[0])) {
      // Booking date has passed — auto-cancel
      await pool.query(
        "UPDATE public.bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1",
        [booking.id]
      );
      return res.json({ canResume: false });
    }

    // If there's a Stripe checkout session, try to get the URL
    let checkoutUrl = null;
    if (booking.stripe_checkout_session_id && stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
        if (session.status === 'open') {
          checkoutUrl = session.url;
        }
      } catch (e) {
        // Session expired — user needs to start new payment
      }
    }

    // Fallback: link to gym page to rebook
    if (!checkoutUrl) {
      checkoutUrl = `/gym/${booking.gym_id}`;
    }

    res.json({
      canResume: true,
      booking: {
        id: booking.id,
        gymName: booking.gym_name || 'Gym',
        date: booking.booking_date,
        time: booking.start_time,
        price: parseFloat(booking.total_amount || 0),
      },
      checkoutUrl,
    });

  } catch (err) {
    console.error('Payment resume error:', err);
    res.json({ canResume: false });
  }
});


// ═══════════════════════════════════════════════════════════════════
//  ChatGPT PLAYBOOK #3: FIRST SESSION FREE
//  "Make the first scan so magical they can't shut up about it"
//  
//  First-ever booking for any user is completely free — £0, no card needed.
//  Creates a confirmed booking with QR code instantly. Zero friction.
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/payment/check-first-free
 * Check if the current user qualifies for a free first session.
 */
router.get('/check-first-free', async (req, res) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      // Guests: check by email if provided
      const email = req.query.email;
      if (email) {
        const guestBookings = await pool.query(
          `SELECT COUNT(*) as cnt FROM public.bookings 
           WHERE user_email = $1 AND status NOT IN ('cancelled')`,
          [email]
        );
        return res.json({
          eligible: parseInt(guestBookings.rows[0].cnt) === 0,
          reason: parseInt(guestBookings.rows[0].cnt) === 0 ? 'first_booking' : 'has_previous_bookings',
        });
      }
      return res.json({ eligible: true, reason: 'not_logged_in_assumed_new' });
    }

    // Check for any previous non-cancelled bookings
    const prevBookings = await pool.query(
      `SELECT COUNT(*) as cnt FROM public.bookings 
       WHERE user_id = $1 AND status NOT IN ('cancelled')`,
      [userId]
    );

    const count = parseInt(prevBookings.rows[0].cnt);
    res.json({
      eligible: count === 0,
      reason: count === 0 ? 'first_booking' : 'has_previous_bookings',
      previousBookings: count,
    });
  } catch (err) {
    console.error('[FirstFree] Check error:', err.message);
    res.json({ eligible: false, reason: 'error' });
  }
});

/**
 * POST /api/payment/first-free
 * Book a free first session — no card, no Stripe, instant QR.
 * 
 * Requires: gymId, date. Optional: time, placeId, gymName, gymAddress.
 * Works for both logged-in users and guests (email required for guests).
 */
router.post('/first-free', async (req, res) => {
  try {
    let { gymId, placeId, date, time, email, gymName: reqGymName, gymAddress: reqGymAddr } = req.body;
    if (!date) return res.status(400).json({ error: 'date is required' });

    const userId = req.session?.userId;

    // Must be logged in OR provide email for guest
    if (!userId && !email) {
      return res.status(400).json({ error: 'Login or provide email for your free session' });
    }

    // Verify eligibility
    if (userId) {
      const prev = await pool.query(
        `SELECT COUNT(*) as cnt FROM public.bookings WHERE user_id = $1 AND status NOT IN ('cancelled')`,
        [userId]
      );
      if (parseInt(prev.rows[0].cnt) > 0) {
        return res.status(400).json({ error: 'Free first session already used. You\'ve already booked before!' });
      }
    } else if (email) {
      const prev = await pool.query(
        `SELECT COUNT(*) as cnt FROM public.bookings WHERE user_email = $1 AND status NOT IN ('cancelled')`,
        [email]
      );
      if (parseInt(prev.rows[0].cnt) > 0) {
        return res.status(400).json({ error: 'Free first session already used for this email.' });
      }
    }

    // Resolve time
    const resolved = resolveTime(time);

    // Resolve gym
    let dbGymId = gymId;
    if (placeId && isNaN(parseInt(gymId))) {
      const ensureResult = await pool.query('SELECT id FROM public.gyms WHERE place_id = $1', [placeId]);
      if (ensureResult.rows.length > 0) {
        dbGymId = ensureResult.rows[0].id;
      } else if (reqGymName) {
        // Auto-create gym record for Google Places gym
        const newGym = await pool.query(
          `INSERT INTO public.gyms (name, address, place_id, country, created_at) 
           VALUES ($1, $2, $3, 'GB', NOW()) RETURNING id`,
          [reqGymName, reqGymAddr || '', placeId]
        );
        dbGymId = newGym.rows[0].id;
      } else {
        return res.status(404).json({ error: 'Gym not found' });
      }
    }

    // Get gym info
    const gym = await pool.query('SELECT id, name, address, country FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];

    // Duplicate check
    const dupCheck = userId
      ? await pool.query(
          `SELECT id FROM public.bookings WHERE gym_id=$1 AND user_id=$2 AND booking_date=$3 AND start_time=$4 AND status!='cancelled' LIMIT 1`,
          [dbGymId, userId, date, resolved.startTime]
        )
      : await pool.query(
          `SELECT id FROM public.bookings WHERE gym_id=$1 AND user_email=$2 AND booking_date=$3 AND start_time=$4 AND status!='cancelled' LIMIT 1`,
          [dbGymId, email, date, resolved.startTime]
        );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a booking at this gym for this date and time.' });
    }

    // Generate codes
    const crypto = require('crypto');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingCode = '';
    for (let i = 0; i < 8; i++) {
      bookingCode += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3) bookingCode += '-';
    }

    // Get normal price for display (shows what they're saving)
    const dayPrice = pricing.calculateGymPrice({ countryCode: g.country || 'GB', passType: 'day' });

    // Create booking at £0 — confirmed immediately!
    const bookingResult = await pool.query(
      `INSERT INTO public.bookings
        (gym_id, user_id, booking_date, start_time, end_time, total_amount,
         platform_fee_amount, booking_type, booking_code, status,
         user_email, user_name, stripe_payment_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 0, 0, 'first_free', $6, 'confirmed', $7, $8, 'free', NOW(), NOW())
       RETURNING *`,
      [dbGymId, userId || 'guest', date, resolved.startTime, resolved.endTime,
       bookingCode, email || '', userId ? 'User' : 'Guest']
    );
    const booking = bookingResult.rows[0];

    // Generate QR code
    const qr = await generate2ScanQR(booking.id, userId || 'guest-' + email, dbGymId);

    // Update booking with QR
    await pool.query(
      `UPDATE public.bookings SET qr_code = $1, qr_code_url = $2 WHERE id = $3`,
      [qr.token, qr.dataUrl, booking.id]
    );

    // Get user's referral handle for the share card
    let referralHandle = null;
    if (userId) {
      const userRef = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [userId]);
      referralHandle = userRef.rows[0]?.referral_handle || null;
    }

    console.log(`🆓 [FirstFree] Free session booked! User: ${userId || email}, Gym: ${g.name}, Saved: ${dayPrice.display}`);

    res.json({
      success: true,
      firstFree: true,
      savedAmount: dayPrice.display,
      savedPence: dayPrice.stripeAmount,
      booking: {
        id: booking.id,
        gymId: dbGymId,
        gymName: g.name,
        gymAddress: g.address,
        date: booking.booking_date,
        time: resolved.startTime,
        endTime: resolved.endTime,
        price: 0,
        originalPrice: dayPrice.amount,
        originalPriceDisplay: dayPrice.display,
        bookingCode: booking.booking_code,
        status: 'confirmed',
      },
      qr: {
        token: qr.token,
        dataUrl: qr.dataUrl,
        scanUrl: qr.scanUrl,
        maxScans: qr.maxScans,
      },
      referralHandle,
      referralLink: referralHandle ? `https://scangym.com/r/${referralHandle}` : null,
      shareText: `🆓 Just booked my FIRST free gym session at ${g.name} with @ScanGym! No membership needed. Try it: ${referralHandle ? 'scangym.com/r/' + referralHandle : 'scangym.com'} 💪`,
    });
  } catch (err) {
    console.error('[FirstFree] Booking error:', err);
    res.status(500).json({ error: 'Failed to create free booking', detail: err.message });
  }
});

/* Deleted here (one payment path):
   - POST /setup-intent  and  POST /confirm-card  were copy-paste aliases of
     /setup-card and /confirm-setup. The one frontend caller now uses the
     canonical pair, and /confirm-setup accepts `nickname`.
   - POST /admin-add-card took a raw card number + CVC through our server
     (marked "TEMPORARY — remove after testing", no caller anywhere). Gone:
     card details must only ever reach Stripe.js in the browser. */

module.exports = router;

// Shared with lib/checkout-actions.js so a spoken booking issues exactly the same
// 2-scan QR as the Book button. Attached to the router rather than re-exported to
// keep `app.use('/api/payment', require('./routes/payment'))` working unchanged.
module.exports.generate2ScanQR = generate2ScanQR;
