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
      success_url: `https://scangym.com/booking-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}`,
      cancel_url: `https://scangym.com/gym/${booking.gym_id}`,
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

module.exports = router;
