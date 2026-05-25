/**
 * Booking Routes — Create and manage gym bookings
 * Flow: Select gym + date/time → Create booking → Pay → Get QR
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// Auto-create bookings table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        gym_id INTEGER NOT NULL,
        gym_name VARCHAR(255),
        booking_date DATE NOT NULL,
        booking_time VARCHAR(10) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 5.00,
        status VARCHAR(30) DEFAULT 'pending_payment',
        stripe_session_id VARCHAR(255),
        stripe_payment_intent VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        paid_at TIMESTAMP,
        cancelled_at TIMESTAMP
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_gym ON bookings(gym_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status)`);
    console.log('Bookings table ready');
  } catch (err) {
    console.error('Bookings table error:', err.message);
  }
})();

/**
 * POST /api/bookings/create
 * Create a new booking (auth required)
 */
router.post('/create', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { gymId, date, time } = req.body;

    if (!gymId || !date || !time) {
      return res.status(400).json({ error: 'gymId, date, and time are required' });
    }

    // Get gym details
    const gym = await pool.query('SELECT id, name, day_pass_price FROM gyms WHERE id = $1', [parseInt(gymId)]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const g = gym.rows[0];

    // Determine price — off-peak before 10am is £3.75, otherwise £5.00
    const hour = parseInt(time.split(':')[0]);
    const price = hour < 10 ? 3.75 : (parseFloat(g.day_pass_price) || 5.00);

    // Check for duplicate booking
    const existing = await pool.query(
      `SELECT id FROM bookings WHERE user_id = $1 AND gym_id = $2 AND booking_date = $3 AND booking_time = $4 AND status != 'cancelled'`,
      [userId, parseInt(gymId), date, time]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a booking for this gym at this time' });
    }

    // Create booking
    const result = await pool.query(`
      INSERT INTO bookings (user_id, gym_id, gym_name, booking_date, booking_time, price, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'pending_payment')
      RETURNING *
    `, [userId, parseInt(gymId), g.name, date, time, price]);

    const booking = result.rows[0];

    res.status(201).json({
      booking: {
        id: booking.id,
        gymId: booking.gym_id,
        gymName: booking.gym_name,
        date: booking.booking_date,
        time: booking.booking_time,
        price: parseFloat(booking.price),
        status: booking.status,
      },
      message: 'Booking created — proceed to payment',
    });
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

/**
 * GET /api/bookings
 * List user's bookings (auth required)
 */
router.get('/', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT b.*, q.qr_token, q.scan_count, q.status as qr_status, q.expires_at as qr_expires
       FROM bookings b
       LEFT JOIN booking_qr_codes q ON b.id = q.booking_id
       WHERE b.user_id = $1
       ORDER BY b.created_at DESC
       LIMIT 20`,
      [userId]
    );

    res.json({
      bookings: result.rows.map(b => ({
        id: b.id,
        gymId: b.gym_id,
        gymName: b.gym_name,
        date: b.booking_date,
        time: b.booking_time,
        price: parseFloat(b.price),
        status: b.status,
        createdAt: b.created_at,
        paidAt: b.paid_at,
        qr: b.qr_token ? {
          token: b.qr_token,
          scanCount: b.scan_count,
          status: b.qr_status,
          expiresAt: b.qr_expires,
        } : null,
      })),
    });
  } catch (err) {
    console.error('List bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

/**
 * GET /api/bookings/:id
 * Get single booking detail (auth required)
 */
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const bookingId = parseInt(req.params.id);

    const result = await pool.query(
      `SELECT b.*, q.qr_token, q.scan_count, q.max_scans, q.status as qr_status, q.expires_at as qr_expires
       FROM bookings b
       LEFT JOIN booking_qr_codes q ON b.id = q.booking_id
       WHERE b.id = $1 AND b.user_id = $2`,
      [bookingId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const b = result.rows[0];
    res.json({
      booking: {
        id: b.id,
        gymId: b.gym_id,
        gymName: b.gym_name,
        date: b.booking_date,
        time: b.booking_time,
        price: parseFloat(b.price),
        status: b.status,
        createdAt: b.created_at,
        paidAt: b.paid_at,
        qr: b.qr_token ? {
          token: b.qr_token,
          scanCount: b.scan_count,
          maxScans: b.max_scans,
          scansRemaining: b.max_scans - b.scan_count,
          status: b.qr_status,
          expiresAt: b.qr_expires,
        } : null,
      },
    });
  } catch (err) {
    console.error('Get booking error:', err);
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

module.exports = router;
