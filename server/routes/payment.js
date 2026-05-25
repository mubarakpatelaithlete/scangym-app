/**
 * Payment Routes — Stripe Checkout
 * Flow: Create Checkout Session → Redirect to Stripe → Verify on return → Mark paid + Generate QR
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const QRCode = require('qrcode');

const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;

/**
 * Generate a unique QR token (same as qr.js)
 */
function generateQRToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 6; i++) {
      seg += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(seg);
  }
  return 'SG-' + segments.join('-');
}

/**
 * POST /api/payment/checkout
 * Create a Stripe Checkout Session for a booking
 */
router.post('/checkout', authenticateUser, async (req, res) => {
  try {
    if (!STRIPE_SECRET) {
      return res.status(500).json({ error: 'Payment service not configured' });
    }

    const userId = req.user.id;
    const { bookingId } = req.body;

    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    // Get booking
    const booking = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [parseInt(bookingId), userId]
    );
    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const b = booking.rows[0];
    if (b.status !== 'pending_payment') {
      return res.status(400).json({ error: `Booking is already ${b.status}` });
    }

    // Create Stripe Checkout Session via API
    const params = new URLSearchParams();
    params.append('mode', 'payment');
    params.append('success_url', `https://scangym.com/booking-success?session_id={CHECKOUT_SESSION_ID}&booking_id=${b.id}`);
    params.append('cancel_url', `https://scangym.com/gym/${b.gym_id}`);
    params.append('line_items[0][price_data][currency]', 'gbp');
    params.append('line_items[0][price_data][product_data][name]', `ScanGym Day Pass — ${b.gym_name}`);
    params.append('line_items[0][price_data][product_data][description]', `24-hour gym access on ${b.booking_date} at ${b.booking_time}`);
    params.append('line_items[0][price_data][unit_amount]', Math.round(parseFloat(b.price) * 100));
    params.append('line_items[0][quantity]', '1');
    params.append('metadata[booking_id]', String(b.id));
    params.append('metadata[user_id]', String(userId));
    params.append('metadata[gym_id]', String(b.gym_id));
    params.append('payment_intent_data[metadata][booking_id]', String(b.id));

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${STRIPE_SECRET}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      console.error('Stripe checkout error:', session);
      return res.status(400).json({ error: 'Failed to create checkout session', detail: session.error?.message });
    }

    // Store Stripe session ID on booking
    await pool.query(
      'UPDATE bookings SET stripe_session_id = $1 WHERE id = $2',
      [session.id, b.id]
    );

    res.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (err) {
    console.error('Payment checkout error:', err);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

/**
 * GET /api/payment/verify
 * Verify payment after Stripe redirect, mark booking paid, generate QR
 */
router.get('/verify', authenticateUser, async (req, res) => {
  try {
    if (!STRIPE_SECRET) {
      return res.status(500).json({ error: 'Payment service not configured' });
    }

    const { session_id, booking_id } = req.query;
    const userId = req.user.id;

    if (!session_id || !booking_id) {
      return res.status(400).json({ error: 'session_id and booking_id are required' });
    }

    // Get booking
    const booking = await pool.query(
      'SELECT * FROM bookings WHERE id = $1 AND user_id = $2',
      [parseInt(booking_id), userId]
    );
    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const b = booking.rows[0];

    // If already confirmed, return existing data
    if (b.status === 'confirmed') {
      const existingQR = await pool.query(
        'SELECT * FROM booking_qr_codes WHERE booking_id = $1',
        [b.id]
      );
      if (existingQR.rows.length > 0) {
        const q = existingQR.rows[0];
        const qrDataUrl = await QRCode.toDataURL(`https://scangym.com/scan/${q.qr_token}`, {
          width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' }, errorCorrectionLevel: 'H',
        });
        return res.json({
          success: true,
          booking: { id: b.id, gymName: b.gym_name, date: b.booking_date, time: b.booking_time, price: parseFloat(b.price), status: 'confirmed' },
          qr: { token: q.qr_token, scanUrl: `https://scangym.com/scan/${q.qr_token}`, dataUrl: qrDataUrl, maxScans: 2, scanCount: q.scan_count, expiresAt: q.expires_at },
        });
      }
    }

    // Verify with Stripe
    const stripeResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
      headers: { 'Authorization': `Bearer ${STRIPE_SECRET}` },
    });
    const session = await stripeResponse.json();

    if (!stripeResponse.ok) {
      return res.status(400).json({ error: 'Failed to verify payment session' });
    }

    if (session.payment_status !== 'paid') {
      return res.status(400).json({
        error: 'Payment not completed',
        paymentStatus: session.payment_status,
      });
    }

    // Mark booking as confirmed
    await pool.query(
      `UPDATE bookings SET status = 'confirmed', paid_at = NOW(), stripe_payment_intent = $1 WHERE id = $2`,
      [session.payment_intent, b.id]
    );

    // Generate QR code
    const qrToken = generateQRToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const qrResult = await pool.query(`
      INSERT INTO booking_qr_codes (booking_id, user_id, gym_id, qr_token, max_scans, expires_at)
      VALUES ($1, $2, $3, $4, 2, $5)
      RETURNING *
    `, [b.id, userId, b.gym_id, qrToken, expiresAt]);

    const qr = qrResult.rows[0];

    // Generate QR code image
    const scanUrl = `https://scangym.com/scan/${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' }, errorCorrectionLevel: 'H',
    });

    res.json({
      success: true,
      message: 'Payment confirmed! Here is your QR code.',
      booking: {
        id: b.id,
        gymName: b.gym_name,
        date: b.booking_date,
        time: b.booking_time,
        price: parseFloat(b.price),
        status: 'confirmed',
      },
      qr: {
        token: qrToken,
        scanUrl,
        dataUrl: qrDataUrl,
        maxScans: 2,
        scanCount: 0,
        scansRemaining: 2,
        expiresAt: expiresAt.toISOString(),
        policy: 'Scan 1: Entry (check-in) → Scan 2: Exit (check-out) → QR expires',
      },
    });
  } catch (err) {
    console.error('Payment verify error:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

module.exports = router;
