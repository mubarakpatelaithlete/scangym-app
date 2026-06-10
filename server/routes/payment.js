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
try {
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
  return {
    isAnytime,
    hours,
    startTime: effectiveTime,
    endTime: effectiveTime,
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
      try { dataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 2, errorCorrectionLevel: 'H' }); } catch (e) {}
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
  let dataUrl = null;
  if (QRCode) {
    try { dataUrl = await QRCode.toDataURL(scanUrl, { width: 400, margin: 2, errorCorrectionLevel: 'H' }); } catch (e) {}
  }

  return {
    token: qrToken, scanUrl, dataUrl,
    maxScans: 2, scanCount: 0, scansRemaining: 2,
    status: 'active', expiresAt: expiresAt.toISOString(),
  };
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
async function sendConfirmationEmail({ to, gymName, date, time, endTime, price, bookingCode, qrDataUrl }) {
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
          <p style="color:#f97316;font-size:20px;font-weight:bold;margin:12px 0 0;">£${price}</p>
        </div>
        ${qrDataUrl ? `
        <div style="text-align:center;margin-bottom:24px;">
          <p style="color:white;font-weight:bold;margin-bottom:12px;">📱 Your QR Code</p>
          <div style="background:white;padding:16px;border-radius:12px;display:inline-block;">
            <img src="${qrDataUrl}" alt="QR Code" width="200" height="200">
          </div>
          <p style="color:#64748b;font-size:12px;margin-top:8px;">Booking: ${bookingCode}</p>
        </div>` : ''}
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
    console.log(`[Payment] Credited £1.25 commission to creator "${booking.referral_code}" for booking ${booking.id}`);
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

    let { gymId, date, time, cardId, savedCardId, placeId, passType, gymName: reqGymName, gymAddress: reqGymAddr } = req.body;
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

    // Get gym info
    const gym = await pool.query('SELECT id, name, address, country FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];

    // v4.0: Flat £4.49 base, PPP + currency by gym's physical country
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');
    const gymCurrency = dayPrice.currency;
    const resolved = resolveTime(time);
    const price = dayPrice.amount;
    const amount = dayPrice.stripeAmount;

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

    // Credit creator commission
    await creditCreatorCommission(booking);

    // Send confirmation email (non-blocking)
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');
    if (user.email) {
      sendConfirmationEmail({
        to: user.email, gymName: g.name, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: price.toFixed(2), bookingCode, qrDataUrl: qr.dataUrl,
      }).catch(err => console.error('[Email] Send failed:', err.message));
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
      message: '⚡ Booked instantly with your saved card!',
    });
  } catch (err) {
    console.error('Quick checkout error:', err);
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
    const intentConfig = {
      amount,
      currency: (booking.gym_currency || 'GBP').toLowerCase(), // C7 fix: Currency from gym's physical country
      metadata: { bookingId: String(booking.id), gymName: booking.gym_name || '' },
      receipt_email: email || booking.user_email || undefined,
      payment_method_types: ['card', 'amazon_pay', 'revolut_pay'],
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
    let { gymId, placeId, date, time, email, passType, gymName, gymAddress } = req.body;
    if (!date) return res.status(400).json({ error: 'date required' });
    // C2 fix: Resolve 'anytime' / empty time to a sensible default
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }
    if (!gymId && !placeId) return res.status(400).json({ error: 'gymId or placeId required' });

    // Sanitize email — prevent null/undefined from crashing INSERT
    const safeEmail = (email && typeof email === 'string' && email.includes('@')) ? email.trim() : '';

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

    const gym = await pool.query('SELECT id, name, country FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];

    // v4.0: Flat £4.49 base, PPP + currency by gym's country
    const passTypeClean = passType || 'day';
    const resolved = resolveTime(time);
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');
    const price = dayPrice.amount;

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
      const bookingResult = await pool.query(
        `INSERT INTO public.bookings
          (gym_id, user_id, booking_date, start_time, end_time, total_amount,
           platform_fee_amount, booking_type, booking_code, status,
           user_email, user_name, created_at, updated_at)
         VALUES ($1, 'guest', $2, $3, $4, $5, $6, $7, $8, 'reserved', $9, 'Guest', NOW(), NOW())
         RETURNING *`,
        [dbGymId, date, resolved.startTime, resolved.endTime, price, price * 0.10,
         passTypeClean + '_cash', bookingCode, safeEmail]
      );
      booking = bookingResult.rows[0];
    } catch (insertErr) {
      console.error('[Cash Booking] INSERT failed:', insertErr.message, '| code:', insertErr.code, '| detail:', insertErr.detail);
      // Retry without platform_fee_amount if column doesn't exist
      try {
        const bookingResult = await pool.query(
          `INSERT INTO public.bookings
            (gym_id, user_id, booking_date, start_time, end_time, total_amount,
             booking_type, booking_code, status,
             user_email, user_name, created_at, updated_at)
           VALUES ($1, 'guest', $2, $3, $4, $5, $6, $7, 'reserved', $8, 'Guest', NOW(), NOW())
           RETURNING *`,
          [dbGymId, date, resolved.startTime, resolved.endTime, price,
           passTypeClean + '_cash', bookingCode, safeEmail]
        );
        booking = bookingResult.rows[0];
        console.log('[Cash Booking] Retry without platform_fee_amount succeeded');
      } catch (retryErr) {
        console.error('[Cash Booking] Retry INSERT also failed:', retryErr.message, '| code:', retryErr.code, '| detail:', retryErr.detail);
        return res.status(500).json({ error: 'Failed to create reservation', detail: retryErr.message });
      }
    }

    // ── Step 5: Generate QR code (non-blocking — don't fail the booking) ──
    let qr = { token: bookingCode, scanUrl: '', dataUrl: '', maxScans: 2, scansRemaining: 2, expiresAt: null };
    try {
      qr = await generate2ScanQR(booking.id, 'guest', dbGymId);
      await pool.query(
        'UPDATE public.bookings SET qr_code = $1, qr_code_url = $2, updated_at = NOW() WHERE id = $3',
        [qr.token, qr.dataUrl, booking.id]
      );
    } catch (qrErr) {
      console.error('[Cash Booking] QR generation failed (non-fatal):', qrErr.message);
    }

    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');

    if (safeEmail) {
      sendConfirmationEmail({
        to: safeEmail, gymName: g.name, date: bookingDate,
        time: booking.start_time, endTime: booking.end_time,
        price: price.toFixed(2), bookingCode, qrDataUrl: qr.dataUrl,
      }).catch(err => console.error('[Cash email] Send failed:', err.message));
    }

    res.json({
      success: true,
      booking: {
        id: booking.id, gymName: g.name, date: bookingDate,
        time: booking.start_time, price, bookingCode,
        status: 'reserved', paymentMethod: 'cash',
      },
      qr: {
        token: qr.token, scanUrl: qr.scanUrl, dataUrl: qr.dataUrl,
        maxScans: qr.maxScans, scansRemaining: qr.scansRemaining,
        expiresAt: qr.expiresAt,
      },
    });

    console.log('[Cash Booking] Reserved:', bookingCode, 'at', g.name, '£' + price, passTypeClean);
  } catch (err) {
    console.error('[Cash Booking] Unhandled error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to create reservation', detail: err.message });
  }
});

module.exports = router;
