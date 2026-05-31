/**
 * Payment Routes — Stripe Checkout + QR code generation
 * 
 * Flow:
 * 1. POST /api/payment/checkout → Creates Stripe Checkout Session, returns checkout URL
 * 2. Stripe redirects to /booking-success?session_id=...&booking_id=...
 * 3. GET /api/payment/verify → Verifies payment, generates QR, updates booking
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
let stripe;
try {
  stripe = require('stripe')(STRIPE_SECRET);
} catch (err) {
  console.error('Stripe init error:', err.message);
}

let QRCode;
try {
  QRCode = require('qrcode');
} catch (err) {
  console.error('QRCode module not found, QR generation will be skipped');
}

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch (err) {
  console.error('Nodemailer not found, email confirmations disabled');
}

/**
 * Send booking confirmation email with QR code
 * Uses SendGrid SMTP (already configured in env)
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
          <p style="color:#94a3b8;margin:4px 0;">🕐 ${time} — ${endTime}</p>
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

/**
 * POST /api/payment/checkout
 * Create a Stripe Checkout Session for a booking
 */
router.post('/checkout', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    // Get booking
    const result = await pool.query(
      `SELECT b.*, g.name as gym_name 
       FROM public.bookings b 
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    if (booking.status === 'confirmed') {
      return res.status(400).json({ error: 'Booking already paid' });
    }

    const amount = Math.round(parseFloat(booking.total_amount) * 100); // pence

    // Create Stripe Checkout Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `ScanGym Session — ${booking.gym_name || 'Gym'}`,
            description: `${booking.start_time} - ${booking.end_time} on ${new Date(booking.booking_date).toLocaleDateString('en-GB')}`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      success_url: `${process.env.BASE_URL || 'https://scangym.com'}/booking-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
      cancel_url: `${process.env.BASE_URL || 'https://scangym.com'}/gym/${booking.gym_id}`,
      metadata: {
        bookingId: booking.id.toString(),
        userId: req.session.userId,
        gymName: booking.gym_name,
      },
    });

    // Store checkout session ID
    await pool.query(
      'UPDATE public.bookings SET stripe_checkout_session_id = $1, updated_at = NOW() WHERE id = $2',
      [session.id, booking.id]
    );

    res.json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Checkout error:', err);
    res.status(500).json({ error: 'Failed to create payment session', detail: err.message });
  }
});

/**
 * GET /api/payment/verify
 * Verify Stripe payment and generate QR code
 */
router.get('/verify', async (req, res) => {
  try {
    const { session_id, booking_id } = req.query;
    if (!session_id || !booking_id) {
      return res.status(400).json({ error: 'session_id and booking_id are required' });
    }

    if (!stripe) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    // Verify Stripe session
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed', status: session.payment_status });
    }

    // Get booking
    const result = await pool.query('SELECT * FROM public.bookings WHERE id = $1', [booking_id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    // Generate QR code data URL
    let qrDataUrl = null;
    const qrToken = booking.qr_code || 'BOOK_' + require('crypto').randomBytes(8).toString('hex').toUpperCase();
    const qrPayload = JSON.stringify({
      type: 'scangym_entry',
      bookingId: booking.id,
      token: qrToken,
      gymId: booking.gym_id,
    });

    if (QRCode) {
      try {
        qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 400, margin: 2 });
      } catch (qrErr) {
        console.error('QR generation error:', qrErr);
      }
    }

    // Update booking: confirmed + QR + payment info
    await pool.query(
      `UPDATE public.bookings 
       SET status = 'confirmed', 
           qr_code = $1, 
           qr_code_url = $2, 
           stripe_payment_intent_id = $3,
           stripe_payment_status = 'paid',
           updated_at = NOW()
       WHERE id = $4`,
      [qrToken, qrDataUrl, session.payment_intent, booking.id]
    );

    // Get gym name
    const gym = await pool.query('SELECT name FROM public.gyms WHERE id = $1', [booking.gym_id]);
    const gymName = gym.rows[0]?.name || 'Gym';
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');

    // Send confirmation email (non-blocking)
    const recipientEmail = booking.user_email || session.customer_details?.email;
    if (recipientEmail) {
      sendConfirmationEmail({
        to: recipientEmail,
        gymName,
        date: bookingDate,
        time: booking.start_time,
        endTime: booking.end_time,
        price: parseFloat(booking.total_amount).toFixed(2),
        bookingCode: booking.booking_code,
        qrDataUrl,
      }).catch(err => console.error('[Email] Background send failed:', err.message));
    }

    res.json({
      success: true,
      booking: {
        id: booking.id,
        gymName,
        date: bookingDate,
        time: booking.start_time,
        endTime: booking.end_time,
        price: parseFloat(booking.total_amount),
        bookingCode: booking.booking_code,
        status: 'confirmed',
      },
      qr: {
        token: qrToken,
        dataUrl: qrDataUrl,
      },
    });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment', detail: err.message });
  }
});



/**
 * GET /api/payment/resume
 * Resume an abandoned checkout — finds the most recent pending booking
 * and returns/recreates a Stripe checkout session.
 */
router.get('/resume', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { booking_id } = req.query;
    if (!booking_id) return res.status(400).json({ error: 'booking_id required' });

    // Find the pending booking
    const result = await pool.query(
      `SELECT b.*, g.name as gym_name
       FROM public.bookings b
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1 AND b.status = 'pending'`,
      [booking_id]
    );

    if (result.rows.length === 0) {
      return res.json({ error: 'No pending booking found', canResume: false });
    }

    const booking = result.rows[0];

    // Check if the existing Stripe session is still valid
    if (booking.stripe_checkout_session_id) {
      try {
        const existingSession = await stripe.checkout.sessions.retrieve(booking.stripe_checkout_session_id);
        if (existingSession.status === 'open' && existingSession.url) {
          return res.json({ success: true, canResume: true, checkoutUrl: existingSession.url, booking: { id: booking.id, gymName: booking.gym_name } });
        }
      } catch (e) { /* session expired, create new one */ }
    }

    // Create a new checkout session
    const amount = Math.round(parseFloat(booking.total_amount) * 100);
    const isGuest = booking.user_id === 'guest';
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const sessionConfig = {
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{ price_data: { currency: 'gbp', product_data: { name: `ScanGym Session — ${booking.gym_name || 'Gym'}`, description: `${booking.start_time} - ${booking.end_time} on ${new Date(booking.booking_date).toLocaleDateString('en-GB')}` }, unit_amount: amount }, quantity: 1 }],
      metadata: { bookingId: String(booking.id), guest: isGuest ? 'true' : 'false' },
      success_url: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
      cancel_url: `${baseUrl}/gym/${booking.gym_id}`,
    };
    if (booking.user_email) sessionConfig.customer_email = booking.user_email;

    const session = await stripe.checkout.sessions.create(sessionConfig);

    await pool.query(
      'UPDATE public.bookings SET stripe_checkout_session_id = $1, updated_at = NOW() WHERE id = $2',
      [session.id, booking.id]
    );

    res.json({ success: true, canResume: true, checkoutUrl: session.url, booking: { id: booking.id, gymName: booking.gym_name } });
  } catch (err) {
    console.error('Resume checkout error:', err);
    res.status(500).json({ error: 'Failed to resume checkout' });
  }
});

/**
 * POST /api/payment/guest-checkout
 * Create Stripe Checkout for a guest booking (no auth required, uses session guestBookingId)
 */
router.post('/guest-checkout', async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).json({ error: 'Payment system not configured' });
    }

    const { bookingId, email } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    // Get booking (guest bookings have user_id = 'guest')
    const result = await pool.query(
      `SELECT b.*, g.name as gym_name 
       FROM public.bookings b 
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1 AND b.user_id = 'guest'`,
      [bookingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];
    if (booking.status === 'confirmed') {
      return res.status(400).json({ error: 'Booking already paid' });
    }

    const amount = Math.round(parseFloat(booking.total_amount) * 100);
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: email || booking.user_email,
      line_items: [{
        price_data: {
          currency: 'gbp',
          product_data: {
            name: `ScanGym Session — ${booking.gym_name || 'Gym'}`,
            description: `${booking.start_time} - ${booking.end_time} on ${new Date(booking.booking_date).toLocaleDateString('en-GB')}`,
          },
          unit_amount: amount,
        },
        quantity: 1,
      }],
      metadata: { bookingId: String(booking.id), guest: 'true' },
      success_url: `${baseUrl}/booking-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
      cancel_url: `${baseUrl}/gym/${booking.gym_id}`,
    });

    res.json({ success: true, checkoutUrl: session.url });
  } catch (err) {
    console.error('Guest checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout', detail: err.message });
  }
});

/**
 * POST /api/payment/create-intent
 * Create a Stripe Payment Intent for embedded checkout (Stripe Elements).
 * Returns clientSecret for the frontend to render inline payment form.
 */
router.post('/create-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { bookingId, email } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    // Get booking (works for both auth + guest)
    const result = await pool.query(
      `SELECT b.*, g.name as gym_name
       FROM public.bookings b
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1`,
      [bookingId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];
    if (booking.status === 'confirmed') return res.status(400).json({ error: 'Already paid' });

    const amount = Math.round(parseFloat(booking.total_amount) * 100);

    // Uber-style: explicit payment methods, no Stripe Link (which adds confusing
    // "Save my info" email+phone fields that look required but aren't)
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      metadata: { bookingId: String(booking.id), gymName: booking.gym_name || '' },
      receipt_email: email || booking.user_email || undefined,
      payment_method_types: ['card', 'amazon_pay', 'revolut_pay'],
    });

    // Store payment intent ID on booking
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
 * Generates QR, confirms booking, sends email.
 */
router.post('/confirm-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { bookingId, paymentIntentId } = req.body;
    if (!bookingId || !paymentIntentId) return res.status(400).json({ error: 'bookingId and paymentIntentId required' });

    // Verify the payment intent is actually paid
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not completed', status: intent.status });
    }

    // Get booking
    const result = await pool.query('SELECT * FROM public.bookings WHERE id = $1', [bookingId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Booking not found' });
    const booking = result.rows[0];

    // Generate QR
    const qrToken = booking.qr_code || 'BOOK_' + require('crypto').randomBytes(8).toString('hex').toUpperCase();
    const qrPayload = JSON.stringify({ type: 'scangym_entry', bookingId: booking.id, token: qrToken, gymId: booking.gym_id });
    let qrDataUrl = null;
    if (QRCode) {
      try { qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 400, margin: 2 }); } catch (e) {}
    }

    // Update booking
    await pool.query(
      `UPDATE public.bookings SET status = 'confirmed', qr_code = $1, qr_code_url = $2,
       stripe_payment_intent_id = $3, stripe_payment_status = 'paid', updated_at = NOW()
       WHERE id = $4`,
      [qrToken, qrDataUrl, paymentIntentId, booking.id]
    );

    const gym = await pool.query('SELECT name FROM public.gyms WHERE id = $1', [booking.gym_id]);
    const gymName = gym.rows[0]?.name || 'Gym';
    const bookingDate = new Date(booking.booking_date).toLocaleDateString('en-GB');

    // Send email
    const recipientEmail = booking.user_email || intent.receipt_email;
    if (recipientEmail) {
      sendConfirmationEmail({
        to: recipientEmail,
        gymName,
        date: bookingDate,
        time: booking.start_time,
        endTime: booking.end_time,
        price: parseFloat(booking.total_amount).toFixed(2),
        bookingCode: booking.booking_code,
        qrDataUrl,
      }).catch(err => console.error('[Email] Send failed:', err.message));
    }

    res.json({
      success: true,
      booking: { id: booking.id, gymName, date: bookingDate, time: booking.start_time, endTime: booking.end_time, price: parseFloat(booking.total_amount), bookingCode: booking.booking_code, status: 'confirmed' },
      qr: { token: qrToken, dataUrl: qrDataUrl },
    });
  } catch (err) {
    console.error('Confirm intent error:', err);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

/**
 * POST /api/payment/instant-checkout
 * Uber-level: Creates booking + payment intent in ONE call.
 * Frontend shows single checkout sheet with Stripe Elements immediately.
 */
router.post('/instant-checkout', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { gymId, date, time, email, placeId } = req.body;
    if (!date || !time || !email) {
      return res.status(400).json({ error: 'date, time, and email are required' });
    }
    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Resolve gym ID (Google Place ID → DB ID)
    let dbGymId = gymId;
    if (placeId && isNaN(parseInt(gymId))) {
      // Ensure gym exists in DB — auto-create if not found (upsert pattern)
      const ensureResult = await pool.query('SELECT id FROM public.gyms WHERE google_place_id = $1', [placeId]);
      if (ensureResult.rows.length > 0) {
        dbGymId = ensureResult.rows[0].id;
      } else {
        // Fix: Auto-create gym record instead of failing — user found it via Google Places
        try {
          const gymName = req.body.gymName || 'Gym';
          const gymAddress = req.body.gymAddress || '';
          const insertResult = await pool.query(
            `INSERT INTO public.gyms (name, address, google_place_id, day_pass_price, created_at, updated_at)
             VALUES ($1, $2, $3, 5.00, NOW(), NOW()) RETURNING id`,
            [gymName, gymAddress, placeId]
          );
          dbGymId = insertResult.rows[0].id;
          console.log(`[Payment] Auto-created gym "${gymName}" (DB id: ${dbGymId}) from Place ID: ${placeId}`);
        } catch (insertErr) {
          console.error('[Payment] Failed to auto-create gym:', insertErr.message);
          return res.status(400).json({ error: 'Gym not found. Please search again.' });
        }
      }
    }

    // Get gym info
    const gym = await pool.query('SELECT id, name, address FROM gyms WHERE id = $1', [dbGymId]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }
    const g = gym.rows[0];

    // Pricing: before 10am = £3.75 (off-peak), otherwise £5.00
    const [hours] = time.split(':').map(Number);
    const price = hours < 10 ? 3.75 : 5.00;
    const amount = Math.round(price * 100);

    // Generate booking codes
    const crypto = require('crypto');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let bookingCode = '';
    for (let i = 0; i < 8; i++) {
      bookingCode += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3) bookingCode += '-';
    }
    const qrCode = 'BOOK_' + crypto.randomBytes(8).toString('hex').toUpperCase();

    // Create booking
    const bookingResult = await pool.query(
      `INSERT INTO public.bookings 
        (gym_id, user_id, booking_date, start_time, end_time, total_amount, 
         platform_fee_amount, booking_type, booking_code, qr_code, status,
         user_email, user_name, created_at, updated_at)
       VALUES ($1, 'guest', $2, $3, $4, $5, $6, 'instant', $7, $8, 'pending', $9, 'Guest', NOW(), NOW())
       RETURNING *`,
      [dbGymId, date, time, time, price, price * 0.10, bookingCode, qrCode, email]
    );
    const booking = bookingResult.rows[0];

    // Create PaymentIntent with automatic payment methods (enables Apple Pay, Google Pay, cards, etc.)
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'gbp',
      automatic_payment_methods: { enabled: true },
      metadata: { bookingId: String(booking.id), gymName: g.name },
      receipt_email: email,
    });

    // Link intent to booking
    await pool.query(
      'UPDATE public.bookings SET stripe_payment_intent_id = $1, updated_at = NOW() WHERE id = $2',
      [intent.id, booking.id]
    );

    // Store in session
    if (req.session) {
      req.session.guestBookingId = booking.id;
      req.session.guestEmail = email;
    }

    res.json({
      success: true,
      bookingId: booking.id,
      intentId: intent.id,
      clientSecret: intent.client_secret,
      amount: price,
      gymName: g.name,
      bookingCode,
    });
  } catch (err) {
    console.error('Instant checkout error:', err);
    res.status(500).json({ error: 'Failed to create checkout', detail: err.message });
  }
});

/**
 * POST /api/payment/update-intent-amount
 * Updates a PaymentIntent amount when user changes time (off-peak vs standard)
 */
router.post('/update-intent-amount', async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: 'Payment not configured' });

    const { paymentIntentId, amount, time, bookingId } = req.body;
    if (!paymentIntentId || !amount) return res.status(400).json({ error: 'paymentIntentId and amount required' });

    // Update Stripe PaymentIntent
    await stripe.paymentIntents.update(paymentIntentId, {
      amount: Math.round(amount * 100),
    });

    // Update booking amount + time if provided
    if (bookingId && time) {
      const [hours] = time.split(':').map(Number);
      const price = hours < 10 ? 3.75 : 5.00;
      await pool.query(
        'UPDATE public.bookings SET total_amount = $1, start_time = $2, end_time = $3, platform_fee_amount = $4, updated_at = NOW() WHERE id = $5',
        [price, time, time, price * 0.10, bookingId]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Update intent error:', err);
    res.status(500).json({ error: 'Failed to update payment' });
  }
});

module.exports = router;
