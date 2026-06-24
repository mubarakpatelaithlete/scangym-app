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

// ─── Global Pricing Engine (PPP + Surge) ────────────────────────────────────
const pricing = require('../lib/pricing-engine');
const { getAccessService, isAccessControlEnabled } = require('../lib/access-control');
const { applyReferralDiscount } = require('../lib/referral-discount');
const { resolveTime } = require('../lib/time-utils');
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

/**
 * RESILIENT BOOKING INSERT — Fix #8
 * Ensures bookings table has all required columns before INSERT.
 * Auto-creates missing columns on first call.
 */
let _bookingColumnsVerified = false;
async function ensureBookingColumns() {
  if (_bookingColumnsVerified) return;
  try {
    const colResult = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bookings'`
    );
    const existingCols = new Set(colResult.rows.map(r => r.column_name));

    const requiredCols = [
      { name: 'platform_fee_amount', type: 'NUMERIC DEFAULT 0' },
      { name: 'booking_type', type: "TEXT DEFAULT 'instant'" },
      { name: 'booking_code', type: 'VARCHAR(50)' },
      { name: 'qr_code', type: 'VARCHAR(100)' },
      { name: 'qr_code_url', type: 'TEXT' },
      { name: 'user_email', type: 'VARCHAR(255)' },
      { name: 'user_name', type: "VARCHAR(255) DEFAULT 'Guest'" },
    ];

    for (const col of requiredCols) {
      if (!existingCols.has(col.name)) {
        console.log(`[Schema Fix] Adding missing column: bookings.${col.name}`);
        await pool.query(`ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      }
    }
    _bookingColumnsVerified = true;
    console.log('[Schema Fix] Booking columns verified ✓');
  } catch (err) {
    console.error('[Schema Fix] Column check failed:', err.message);
  }
}

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
let stripe;
try {
  stripe = require('stripe')(STRIPE_SECRET);
} catch (err) {
  console.error('Stripe init error:', err.message);
}

// resolveTime is now imported from ../lib/time-utils

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
      const creatorUser = await pool.query(
        'SELECT creator_user_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
        [booking.referral_code]
      );
      if (creatorUser.rows.length > 0 && creatorUser.rows[0].creator_user_id) {
        const creatorUserId = creatorUser.rows[0].creator_user_id;

        // Upsert wallet: create if doesn't exist, add commission if it does
        const walletUpsert = await pool.query(`
          INSERT INTO wallets (user_id, balance_pence, total_loaded_pence, total_spent_pence, currency, is_active, created_at, updated_at)
          VALUES ($1, $2, $2, 0, 'GBP', true, NOW(), NOW())
          ON CONFLICT (user_id) DO UPDATE
          SET balance_pence = wallets.balance_pence + $2,
              total_loaded_pence = wallets.total_loaded_pence + $2,
              updated_at = NOW()
          RETURNING id, balance_pence
        `, [creatorUserId, commissionPence]);

        // Record the wallet transaction
        if (walletUpsert.rows.length > 0) {
          await pool.query(`
            INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
            VALUES ($1, $2, 'reward', $3, $4, $5, 'commission', NOW())
          `, [
            walletUpsert.rows[0].id,
            creatorUserId,
            commissionPence,
            walletUpsert.rows[0].balance_pence,
            `🎉 Creator commission: £${(commissionPence / 100).toFixed(2)} from booking #${booking.id}`
          ]);
        }

        console.log(`[Payment] Wallet auto-credited: £${(commissionPence / 100).toFixed(2)} → creator "${booking.referral_code}" (balance: £${(walletUpsert.rows[0].balance_pence / 100).toFixed(2)})`);
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

    const { setupIntentId } = req.body;
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
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required for 1-tap booking' });

    let { gymId, date, time, cardId, savedCardId, placeId, passType, gymName: reqGymName, gymAddress: reqGymAddr, referral_code } = req.body;
    const effectiveCardId = cardId || savedCardId; // Frontend sends savedCardId
    if (!date) return res.status(400).json({ error: 'date required' });

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
    let amount = dayPrice.stripeAmount;
    const { price, appliedDiscount } = applyReferralDiscount(dayPrice.amount, referral_code, { context: 'Payment', currencySymbol: dayPrice.symbol });
    if (appliedDiscount) {
      amount = pricing.toStripeAmount(price, gymCurrency);
    }

    // C8 FIX: Prevent duplicate bookings (same user + gym + date + time)
    const existingBooking = await pool.query(
      `SELECT id, status FROM public.bookings
       WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
       AND status NOT IN ('cancelled', 'failed')
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
    await ensureBookingColumns();
    const bookingResult = await pool.query(
      `INSERT INTO public.bookings
        (gym_id, user_id, booking_date, start_time, end_time, total_amount,
         platform_fee_amount, booking_type, booking_code, status,
         user_email, user_name, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'quick', $8, 'pending', $9, 'User', NOW(), NOW())
       RETURNING *`,
      [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime,
       price, price * 0.10, bookingCode, user.email || '']
    );
    const booking = bookingResult.rows[0];

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
    } catch (e) {}

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
    console.error('Quick checkout error:', err);

    // Fix: Update booking status to 'failed' when payment fails
    // Without this, failed bookings stay 'pending' forever and block duplicate checks
    if (typeof booking !== 'undefined' && booking && booking.id) {
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

    // Handle card authentication required (SCA)
    if (err.code === 'authentication_required') {
      return res.status(402).json({
        error: 'Card requires authentication',
        requiresAuth: true,
        clientSecret: err.raw?.payment_intent?.client_secret,
      });
    }
    res.status(500).json({ error: 'Quick checkout failed', detail: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
//  4. FIRST-TIME CARD PAYMENT — Stripe Elements (fallback for new users)
//     After this payment, card is AUTO-SAVED for future 1-tap bookings.
// ═══════════════════════════════════════════════════════════════════════════

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
      try { await stripe.paymentIntents.update(paymentIntentId, { receipt_email: email }); } catch(e) {}
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

    // Credit creator commission
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
      sendConfirmationEmail({
        to: recipientEmail, gymName, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: parseFloat(booking.total_amount).toFixed(2),
        bookingCode: booking.booking_code, qrDataUrl: qr.dataUrl,
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
             VALUES ($1, $2, $3, 4.49, 'system', $4, true, NOW(), NOW()) RETURNING id`,
            [gn, gymAddress || '', placeId, gn.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 100)]
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
    const { price, appliedDiscount } = applyReferralDiscount(dayPrice.amount, referral_code, { context: 'Payment', currencySymbol: dayPrice.symbol });

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
      await ensureBookingColumns();
      const bookingResult = await pool.query(
        `INSERT INTO public.bookings
          (gym_id, user_id, booking_date, start_time, end_time, total_amount,
           platform_fee_amount, booking_type, booking_code, status,
           user_email, user_name, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'reserved', $10, $11, NOW(), NOW())
         RETURNING *`,
        [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime, price, price * 0.10,
         passTypeClean + '_cash', bookingCode, safeEmail, safeName]
      );
      booking = bookingResult.rows[0];
    } catch (insertErr) {
      console.error('[Cash Booking] INSERT failed:', insertErr.message, '| code:', insertErr.code, '| detail:', insertErr.detail);
      // Retry without platform_fee_amount if column doesn't exist
      try {
        // S4-C05 FIX: Use authenticated userId in retry path too
        await ensureBookingColumns();
        const bookingResult = await pool.query(
          `INSERT INTO public.bookings
            (gym_id, user_id, booking_date, start_time, end_time, total_amount,
             booking_type, booking_code, status,
             user_email, user_name, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, $10, NOW(), NOW())
           RETURNING *`,
          [dbGymId, req.session.userId, date, resolved.startTime, resolved.endTime, price,
           passTypeClean + '_cash', bookingCode, safeEmail, safeName]
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
    await ensureBookingColumns();
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

// ─── Route Aliases ──────────────────────────────────────────────────────────
// The frontend pay-sheet (app.js _paySheetSaveCard) calls:
//   POST /api/payment/setup-intent   → needs to reach /setup-card
//   POST /api/payment/confirm-card   → needs to reach /confirm-setup
// Without these aliases the server's SPA catch-all returns index.html,
// which the frontend tries to JSON.parse → "Unexpected token '<'" error.
// ────────────────────────────────────────────────────────────────────────────

router.post('/setup-intent', async (req, res) => {
  // Alias for /setup-card — create a SetupIntent to save a card
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });
    if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });

    const customerId = await getOrCreateStripeCustomer(req.session.userId);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    res.json({
      success: true,
      clientSecret: setupIntent.client_secret,
    });
  } catch (err) {
    console.error('Setup intent (alias) error:', err);
    res.status(500).json({ error: 'Failed to set up card saving' });
  }
});

router.post('/confirm-card', async (req, res) => {
  // Alias for /confirm-setup — confirm a SetupIntent and save the card
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
    console.error('Confirm card (alias) error:', err);
    res.status(500).json({ error: 'Failed to confirm card setup' });
  }
});

module.exports = router;
