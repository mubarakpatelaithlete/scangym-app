/**
 * Booking Routes — Create and manage gym bookings
 * 
 * Uses existing public.bookings table:
 *   - id: SERIAL
 *   - gym_id: INTEGER
 *   - user_id: VARCHAR (UUID string from users.id)
 *   - booking_date: TIMESTAMP
 *   - start_time, end_time: TEXT
 *   - total_amount: NUMERIC
 *   - booking_code: VARCHAR (human-readable like 5WCB-8VDY)
 *   - qr_code: VARCHAR (machine code like BOOK_xxx)
 *   - qr_code_url: TEXT (data URL with QR image)
 *   - status: TEXT (pending, confirmed, confirmed_unpaid, etc.)
 *   - stripe_checkout_session_id, stripe_payment_intent_id: TEXT
 *   - booking_type: TEXT (default 'instant')
 *   - user_email, user_name: VARCHAR
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const crypto = require('crypto');
const pricing = require('../lib/pricing-engine');

// Generate human-readable booking code (e.g., 5WCB-8VDY)
function generateBookingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
    if (i === 3) code += '-';
  }
  return code;
}

// Generate machine booking code
function generateQRCode() {
  return 'BOOK_' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * POST /api/bookings/create
 * Create a new booking (requires auth)
 */
router.post('/create', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }

    let { gymId, date, time, referral_code } = req.body;
    if (!gymId || !date) {
      return res.status(400).json({ error: 'gymId and date are required' });
    }

    // C2 fix: Resolve 'anytime' / empty time to a sensible default
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }

    // Get gym info
    const gym = await pool.query('SELECT id, name, address, country FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const g = gym.rows[0];

    // C3 FIX: endTime = startTime + 1 hour (not same as startTime)
    const [hours, mins] = time.split(':').map(Number);
    const endHour = Math.min(hours + 1, 23);
    const endTime = String(endHour).padStart(2, '0') + ':' + String(mins).padStart(2, '0');

    // v4.0: Flat £4.49 base, PPP + currency by gym's country
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');
    let price = dayPrice.amount;

    // G4 FIX: Apply 15% referral discount (matches frontend display)
    if (referral_code) {
      const discount = Math.round(price * 0.15 * 100) / 100;
      price = Math.max(price - discount, 0.50); // minimum £0.50
      console.log(`[Booking] Referral discount applied: -£${discount.toFixed(2)} for creator "${referral_code}"`);
    }

    // C8 FIX: Prevent duplicate bookings (same user + gym + date + time)
    const existingBooking = await pool.query(
      `SELECT id FROM public.bookings
       WHERE gym_id = $1 AND user_id = $2 AND booking_date = $3 AND start_time = $4
       AND status NOT IN ('cancelled')
       LIMIT 1`,
      [gymId, req.session.userId, date, time]
    );
    if (existingBooking.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate booking',
        message: 'You already have a booking at this gym for this date and time.',
        existingBookingId: existingBooking.rows[0].id,
      });
    }

    const bookingCode = generateBookingCode();
    const qrCode = generateQRCode();

    // G4 FIX: Include referral_code so creator commission pipeline works end-to-end
    const result = await pool.query(
      `INSERT INTO public.bookings 
        (gym_id, user_id, booking_date, start_time, end_time, total_amount, 
         platform_fee_amount, booking_type, booking_code, qr_code, status, referral_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'instant', $8, $9, 'pending', $10, NOW(), NOW())
       RETURNING *`,
      [gymId, req.session.userId, date, time, endTime, price, price * 0.10, bookingCode, qrCode, referral_code || null]
    );

    const booking = result.rows[0];

    res.json({
      success: true,
      booking: {
        id: booking.id,
        gymId: booking.gym_id,
        gymName: g.name,
        date: booking.booking_date,
        time: booking.start_time,
        endTime: booking.end_time,
        price: parseFloat(booking.total_amount),
        bookingCode: booking.booking_code,
        status: booking.status,
      },
    });
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Failed to create booking', detail: err.message });
  }
});

/**
 * GET /api/bookings
 * List user's bookings
 */
router.get('/', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }

    const result = await pool.query(
      `SELECT b.*, g.name as gym_name 
       FROM public.bookings b 
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.user_id = $1 
       ORDER BY b.created_at DESC`,
      [req.session.userId]
    );

    const bookings = result.rows.map(b => ({
      id: b.id,
      gymName: b.gym_name || 'Gym',
      date: b.booking_date,
      time: b.start_time,
      endTime: b.end_time,
      price: parseFloat(b.total_amount || 0),
      bookingCode: b.booking_code,
      status: b.status,
      qr: (b.qr_code && b.status === 'confirmed') ? {
        token: b.qr_code,
        dataUrl: b.qr_code_url || null,
        scanCount: b.checked_in_at ? 1 : 0,
        status: b.checked_in_at ? 'used' : 'active',
      } : null,
    }));

    res.json({ success: true, bookings });
  } catch (err) {
    console.error('List bookings error:', err);
    res.status(500).json({ error: 'Failed to list bookings' });
  }
});

/**
 * GET /api/bookings/:id
 * Get single booking
 */
router.get('/:id', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }

    const result = await pool.query(
      `SELECT b.*, g.name as gym_name 
       FROM public.bookings b 
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE b.id = $1 AND b.user_id = $2`,
      [req.params.id, req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const b = result.rows[0];
    res.json({
      id: b.id,
      gymName: b.gym_name || 'Gym',
      date: b.booking_date,
      time: b.start_time,
      endTime: b.end_time,
      price: parseFloat(b.total_amount || 0),
      bookingCode: b.booking_code,
      status: b.status,
      qr: b.qr_code_url ? {
        token: b.qr_code,
        dataUrl: b.qr_code_url,
      } : null,
    });
  } catch (err) {
    console.error('Get booking error:', err);
    res.status(500).json({ error: 'Failed to get booking' });
  }
});



/**
 * POST /api/bookings/guest-create
 * Create a booking as a guest (no login required - just email)
 */
router.post('/guest-create', async (req, res) => {
  try {
    let { gymId, date, time, email, name, referral_code } = req.body;
    if (!gymId || !date || !email) {
      return res.status(400).json({ error: 'gymId, date, and email are required' });
    }

    // C2 fix: Resolve 'anytime' / empty time to a sensible default
    if (!time || time === 'anytime') {
      const nextH = Math.min(new Date().getHours() + 1, 22);
      time = String(nextH).padStart(2, '0') + ':00';
    }

    // Validate email
    if (!email.includes('@') || !email.includes('.')) {
      return res.status(400).json({ error: 'Please enter a valid email address' });
    }

    // Get gym info
    const gym = await pool.query('SELECT id, name, address, country FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const g = gym.rows[0];

    // C3 FIX: endTime = startTime + 1 hour (not same as startTime)
    const [hours, mins] = time.split(':').map(Number);
    const endHour = Math.min(hours + 1, 23);
    const endTime = String(endHour).padStart(2, '0') + ':' + String(mins).padStart(2, '0');

    // v4.0: Flat £4.49 base, PPP + currency by gym's country
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');
    let price = dayPrice.amount;

    // G4 FIX: Apply 15% referral discount for guests too
    if (referral_code) {
      const discount = Math.round(price * 0.15 * 100) / 100;
      price = Math.max(price - discount, 0.50);
      console.log(`[Booking] Guest referral discount: -£${discount.toFixed(2)} for creator "${referral_code}"`);
    }

    // C8 FIX: Prevent duplicate guest bookings (same email + gym + date + time)
    const existingGuest = await pool.query(
      `SELECT id FROM public.bookings
       WHERE gym_id = $1 AND user_email = $2 AND booking_date = $3 AND start_time = $4
       AND status NOT IN ('cancelled')
       LIMIT 1`,
      [gymId, email, date, time]
    );
    if (existingGuest.rows.length > 0) {
      return res.status(409).json({
        error: 'Duplicate booking',
        message: 'A booking already exists at this gym for this date and time.',
        existingBookingId: existingGuest.rows[0].id,
      });
    }

    const bookingCode = generateBookingCode();
    const qrCode = generateQRCode();

    // Create guest booking with email (user_id = 'guest')
    // G4 FIX: Include referral_code so creator commission pipeline works for guests too
    const result = await pool.query(
      `INSERT INTO public.bookings 
        (gym_id, user_id, booking_date, start_time, end_time, total_amount, 
         platform_fee_amount, booking_type, booking_code, qr_code, status,
         user_email, user_name, referral_code, created_at, updated_at)
       VALUES ($1, 'guest', $2, $3, $4, $5, $6, 'instant', $7, $8, 'pending', $9, $10, $11, NOW(), NOW())
       RETURNING *`,
      [gymId, date, time, endTime, price, price * 0.10, bookingCode, qrCode, email, name || 'Guest', referral_code || null]
    );

    const booking = result.rows[0];

    // Store guest booking in session for payment
    if (req.session) {
      req.session.guestBookingId = booking.id;
      req.session.guestEmail = email;
    }

    res.json({
      success: true,
      booking: {
        id: booking.id,
        gymId: booking.gym_id,
        gymName: g.name,
        date: booking.booking_date,
        time: booking.start_time,
        endTime: booking.end_time,
        price: parseFloat(booking.total_amount),
        bookingCode: booking.booking_code,
        status: booking.status,
      },
    });
  } catch (err) {
    console.error('Guest booking error:', err);
    res.status(500).json({ error: 'Failed to create booking', detail: err.message });
  }
});

/**
 * POST /api/bookings/cancel
 * Cancel a booking and issue a Stripe refund.
 * "Free cancellation up to 2hrs before" — enforced here.
 */
router.post('/cancel', async (req, res) => {
  try {
    const { bookingId, email } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    // Find booking — support both auth and guest (by email)
    let result;
    if (req.session?.userId) {
      result = await pool.query(
        `SELECT b.*, g.name as gym_name FROM public.bookings b
         LEFT JOIN public.gyms g ON b.gym_id = g.id
         WHERE b.id = $1 AND b.user_id = $2`,
        [bookingId, req.session.userId]
      );
    } else if (email) {
      result = await pool.query(
        `SELECT b.*, g.name as gym_name FROM public.bookings b
         LEFT JOIN public.gyms g ON b.gym_id = g.id
         WHERE b.id = $1 AND b.user_email = $2`,
        [bookingId, email]
      );
    } else {
      return res.status(401).json({ error: 'Please provide your email to cancel' });
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = result.rows[0];

    if (booking.status === 'cancelled') {
      return res.status(400).json({ error: 'Booking is already cancelled' });
    }

    if (booking.status === 'pending') {
      // Pending bookings can be cancelled immediately (no payment to refund)
      await pool.query(
        `UPDATE public.bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [bookingId]
      );
      return res.json({ success: true, refunded: false, message: 'Booking cancelled (no payment was made)' });
    }

    // Check 2-hour cancellation policy
    const bookingStart = new Date(`${booking.booking_date.toISOString().split('T')[0]}T${booking.start_time}:00`);
    const hoursUntilStart = (bookingStart - new Date()) / (1000 * 60 * 60);

    if (hoursUntilStart < 2) {
      return res.status(400).json({
        error: 'Cancellation window has passed',
        message: 'Free cancellation is available up to 2 hours before your session',
      });
    }

    // Issue Stripe refund
    let refunded = false;
    if (booking.stripe_payment_intent_id) {
      try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        await stripe.refunds.create({ payment_intent: booking.stripe_payment_intent_id });
        refunded = true;
        console.log(`✅ Refund issued for booking #${bookingId} (${booking.stripe_payment_intent_id})`);
      } catch (stripeErr) {
        console.error('Stripe refund error:', stripeErr.message);
        // If refund fails (already refunded, etc.), still cancel the booking
        if (stripeErr.code === 'charge_already_refunded') {
          refunded = true;
        } else {
          return res.status(500).json({ error: 'Refund failed. Please contact support.', detail: stripeErr.message });
        }
      }
    }

    // Update booking status
    await pool.query(
      `UPDATE public.bookings SET status = 'cancelled', stripe_payment_status = $1, updated_at = NOW() WHERE id = $2`,
      [refunded ? 'refunded' : 'cancelled', bookingId]
    );

    res.json({
      success: true,
      refunded,
      message: refunded
        ? `Booking cancelled. ${parseFloat(booking.total_amount).toFixed(2)} refund issued to your card (3-5 business days).`
        : 'Booking cancelled successfully.',
    });
  } catch (err) {
    console.error('Cancel booking error:', err);
    res.status(500).json({ error: 'Failed to cancel booking' });
  }
});

// ═══ PHASE 4: Post-booking feedback ═══
router.post('/feedback', async (req, res) => {
  try {
    const { bookingId, type, detail } = req.body;
    if (!bookingId || !type) return res.status(400).json({ error: 'bookingId and type required' });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_feedback (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        feedback_type VARCHAR(20) NOT NULL,
        detail TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(
      'INSERT INTO booking_feedback (booking_id, feedback_type, detail) VALUES ($1, $2, $3)',
      [bookingId, type, detail || null]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});


/**
 * GET /api/bookings/recent
 * Recent bookings for CEO dashboard
 */
router.get('/recent', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const result = await pool.query(
      `SELECT b.*, g.name as gym_name 
       FROM public.bookings b 
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       ORDER BY b.created_at DESC
       LIMIT $1`,
      [limit]
    );
    const bookings = result.rows.map(b => ({
      id: b.id,
      gymName: b.gym_name || 'Gym',
      date: b.booking_date,
      time: b.start_time,
      price: parseFloat(b.total_amount || 0),
      status: b.status,
      createdAt: b.created_at,
    }));
    res.json({ success: true, bookings });
  } catch (err) {
    console.error('Recent bookings error:', err);
    res.json({ success: true, bookings: [] });
  }
});

module.exports = router;
