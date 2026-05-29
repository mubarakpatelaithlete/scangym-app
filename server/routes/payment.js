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

    res.json({
      success: true,
      booking: {
        id: booking.id,
        gymName: gym.rows[0]?.name || 'Gym',
        date: new Date(booking.booking_date).toLocaleDateString('en-GB'),
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

module.exports = router;
