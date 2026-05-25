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

    const { gymId, date, time } = req.body;
    if (!gymId || !date || !time) {
      return res.status(400).json({ error: 'gymId, date, and time are required' });
    }

    // Get gym info
    const gym = await pool.query('SELECT id, name, address FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const g = gym.rows[0];

    // Calculate end time (1 hour session)
    const [hours, mins] = time.split(':').map(Number);
    const endHour = (hours + 1) % 24;
    const endTime = `${String(endHour).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;

    // Pricing: before 10am = £3.75 (off-peak), otherwise £5.00
    const price = hours < 10 ? 3.75 : 5.00;

    const bookingCode = generateBookingCode();
    const qrCode = generateQRCode();

    // Create booking in existing table
    const result = await pool.query(
      `INSERT INTO public.bookings 
        (gym_id, user_id, booking_date, start_time, end_time, total_amount, 
         platform_fee_amount, booking_type, booking_code, qr_code, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'instant', $8, $9, 'pending', NOW(), NOW())
       RETURNING *`,
      [gymId, req.session.userId, date, time, endTime, price, price * 0.10, bookingCode, qrCode]
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
      qr: b.qr_code_url ? {
        token: b.qr_code,
        dataUrl: b.qr_code_url,
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

module.exports = router;
