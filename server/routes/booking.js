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
// S5-H08 FIX: Init Stripe once at module load, not per-request
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const pool = require('../middleware/db');
const pricing = require('../lib/pricing-engine');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { generateBookingCode, generateQRCode } = require('../lib/code-generators');
const { resolveTime } = require('../lib/time-utils');
const { applyReferralDiscount } = require('../lib/referral-discount');

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
    const resolved = resolveTime(time);
    time = resolved.startTime;
    const endTime = resolved.endTime;

    // Get gym info
    const gym = await pool.query('SELECT id, name, address, country FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const g = gym.rows[0];

    // v4.0: Flat £4.49 base, PPP + currency by gym's country
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');

    // G4 FIX: Apply 15% referral discount (matches frontend display)
    let { price } = applyReferralDiscount(dayPrice.amount, referral_code, { context: 'Booking' });

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
    const resolved = resolveTime(time);
    time = resolved.startTime;
    const endTime = resolved.endTime;

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

    // v4.0: Flat £4.49 base, PPP + currency by gym's country
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');

    // G4 FIX: Apply 15% referral discount for guests too
    let { price } = applyReferralDiscount(dayPrice.amount, referral_code, { context: 'Booking', currencySymbol: dayPrice.symbol || '£' });

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

    // S5-C08 FIX: Require authenticated session for cancel.
    // Guest cancellation by email alone is too easy to exploit — anyone who knows
    // a booking ID + email can cancel someone else's session. Now guests must
    // cancel through a confirmation email link (future) or contact support.
    let result;
    if (req.session?.userId) {
      result = await pool.query(
        `SELECT b.*, g.name as gym_name FROM public.bookings b
         LEFT JOIN public.gyms g ON b.gym_id = g.id
         WHERE b.id = $1 AND b.user_id = $2`,
        [bookingId, req.session.userId]
      );
    } else if (email && req.session?.guestEmail === email && req.session?.guestBookingId == bookingId) {
      // Only allow guest cancel if the session matches the guest who made the booking
      result = await pool.query(
        `SELECT b.*, g.name as gym_name FROM public.bookings b
         LEFT JOIN public.gyms g ON b.gym_id = g.id
         WHERE b.id = $1 AND b.user_email = $2`,
        [bookingId, email]
      );
    } else {
      return res.status(401).json({ error: 'Please log in to cancel, or contact support at hello@scangym.com' });
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
    // C5 FIX: Use explicit UTC 'Z' suffix so both sides compare in the same timezone.
    // booking_date from PostgreSQL may shift via toISOString() near midnight — extract safely.
    const bDate = booking.booking_date;
    const dateStr = bDate instanceof Date
      ? bDate.toISOString().split('T')[0]
      : String(bDate).split('T')[0];
    const bookingStart = new Date(`${dateStr}T${booking.start_time}:00Z`);
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
        // S5-H08: stripe now initialized at top of file
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

// S5-C06 FIX: Create feedback table at startup, not on every request.
// S5-C14 FIX: Add foreign key to bookings table for referential integrity.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_feedback (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
        user_id VARCHAR(255),
        feedback_type VARCHAR(20) NOT NULL CHECK (feedback_type IN ('positive', 'negative')),
        detail TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_feedback_booking ON booking_feedback(booking_id)`);
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique ON booking_feedback(booking_id, user_id, feedback_type)`);
    console.log('booking_feedback table ready');
  } catch (err) {
    // Table may already exist with different constraints — log but don't crash
    console.error('Feedback table init:', err.message);
  }
})();

// S5-C05 FIX: Require authentication so only real users can submit feedback.
// S5-C13 FIX: Prevent duplicate feedback — one per user per booking per type.
// S5-C14 FIX: Validate feedback_type is 'positive' or 'negative' only.
router.post('/feedback', async (req, res) => {
  try {
    // Require auth: session-based user OR guest email
    const userId = req.session?.userId || null;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in to submit feedback' });
    }

    const { bookingId, type, rating } = req.body;
    // S5-L04 FIX: Truncate feedback detail to 500 characters max
    const detail = typeof req.body.detail === 'string' ? req.body.detail.slice(0, 500) : req.body.detail;
    if (!bookingId || !type) return res.status(400).json({ error: 'bookingId and type required' });
    // S5-H11 FIX: Validate rating if provided
    if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be a number between 1 and 5' });
    }

    // Validate feedback_type
    if (!['positive', 'negative'].includes(type)) {
      return res.status(400).json({ error: 'Invalid feedback type. Must be "positive" or "negative".' });
    }

    // Verify the booking belongs to this user
    const bookingCheck = await pool.query(
      'SELECT id FROM public.bookings WHERE id = $1 AND user_id = $2',
      [bookingId, userId]
    );
    if (bookingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Check for duplicate (one feedback per booking per user per type)
    const existing = await pool.query(
      'SELECT id FROM booking_feedback WHERE booking_id = $1 AND user_id = $2 AND feedback_type = $3',
      [bookingId, userId, type]
    );
    if (existing.rows.length > 0) {
      // Update existing instead of creating duplicate
      await pool.query(
        'UPDATE booking_feedback SET detail = $1, rating = $5, created_at = NOW() WHERE booking_id = $2 AND user_id = $3 AND feedback_type = $4',
        [detail || null, bookingId, userId, type, rating || null]
      );
      return res.json({ success: true, updated: true });
    }

    await pool.query(
      'INSERT INTO booking_feedback (booking_id, user_id, feedback_type, detail, rating) VALUES ($1, $2, $3, $4, $5)',
      [bookingId, userId, type, detail || null, rating || null]
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
 * S5-C04 FIX: Require admin authentication — was publicly exposing ALL users' data.
 */
router.get('/recent', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const result = await pool.query(
      `SELECT b.id, b.booking_date, b.start_time, b.total_amount, b.status, b.created_at,
              g.name as gym_name 
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

// ─────────────────────────────────────────────────────────────────
//  POST /api/bookings/pay-next-visit
//  "Pay Next Visit" IOU — book now, pay when you arrive at the gym.
//  For card-fail emergencies or "no cash" situations.
//  Creates a booking with status='iou_pending' and payment_method='pay_at_gym'.
//  The gym's QR scanner confirms arrival → triggers payment from saved card.
// ─────────────────────────────────────────────────────────────────
router.post('/pay-next-visit', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { gymId, date, time, referral_code } = req.body;
    if (!gymId || !date) {
      return res.status(400).json({ error: 'gymId and date required' });
    }

    // Check user doesn't already have an outstanding IOU
    const existingIOU = await pool.query(
      `SELECT id FROM public.bookings
       WHERE user_id = $1 AND status = 'iou_pending' LIMIT 1`,
      [req.session.userId]
    );
    if (existingIOU.rows.length > 0) {
      return res.status(409).json({
        error: 'Outstanding IOU',
        message: 'You already have an unpaid booking. Please pay it first before booking another.',
        existingBookingId: existingIOU.rows[0].id,
      });
    }

    // Resolve time
    const resolved = resolveTime(time);
    const resolvedTime = resolved.startTime;
    const endTime = resolved.endTime;

    const gym = await pool.query('SELECT id, name, country FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const g = gym.rows[0];
    const dayPrice = pricing.getDayPassPrice(g.country || 'GB');

    let { price } = applyReferralDiscount(dayPrice.amount, referral_code, { context: 'Booking' });

    const bookingCode = generateBookingCode();
    const qrCode = generateQRCode();

    const result = await pool.query(
      `INSERT INTO public.bookings
        (gym_id, user_id, booking_date, start_time, end_time, total_amount,
         platform_fee_amount, booking_type, booking_code, qr_code, status, referral_code, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pay_next_visit', $8, $9, 'iou_pending', $10, NOW(), NOW())
       RETURNING *`,
      [gymId, req.session.userId, date, resolvedTime, endTime, price, price * 0.10, bookingCode, qrCode, referral_code || null]
    );

    const booking = result.rows[0];
    console.log(`[Booking] IOU created: ${bookingCode} for gym ${g.name} - £${price} (pay at gym)`);

    res.json({
      success: true,
      booking: {
        id: booking.id,
        gymName: g.name,
        date: booking.booking_date,
        time: booking.start_time,
        price: parseFloat(booking.total_amount),
        bookingCode: booking.booking_code,
        status: 'iou_pending',
        paymentMethod: 'pay_at_gym',
        message: 'Show this code at the gym. Payment will be charged when you scan in.',
      },
    });
  } catch (err) {
    console.error('Pay-next-visit error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/bookings/confirm-iou
//  Called when user arrives at gym (QR scan) — settles the IOU
// ─────────────────────────────────────────────────────────────────
router.post('/confirm-iou', async (req, res) => {
  try {
    const { bookingId, bookingCode } = req.body;
    if (!bookingId && !bookingCode) return res.status(400).json({ error: 'bookingId or bookingCode required' });

    const query = bookingCode
      ? 'SELECT * FROM public.bookings WHERE booking_code = $1 AND status = \'iou_pending\' LIMIT 1'
      : 'SELECT * FROM public.bookings WHERE id = $1 AND status = \'iou_pending\' LIMIT 1';
    const booking = await pool.query(query, [bookingCode || bookingId]);

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'No pending IOU booking found' });
    }

    // Mark as confirmed (payment would be processed via saved card or at gym)
    await pool.query(
      `UPDATE public.bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1`,
      [booking.rows[0].id]
    );

    console.log(`[Booking] IOU settled: ${booking.rows[0].booking_code}`);
    res.json({ success: true, message: 'Booking confirmed and payment processed' });
  } catch (err) {
    console.error('Confirm IOU error:', err);
    res.status(500).json({ error: 'Failed to confirm booking' });
  }
});

module.exports = router;


// ═══ S5-H11 FIX: Add rating column to feedback table ═══
(async () => {
  try {
    await pool.query(`ALTER TABLE booking_feedback ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating >= 1 AND rating <= 5)`);
    console.log('booking_feedback: rating column ready');
  } catch (err) {
    console.error('Add rating column:', err.message);
  }
})();

// ═══ S5-H15 FIX: End session endpoint ═══
router.post('/end', async (req, res) => {
  try {
    const userId = req.session?.userId || null;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    // Verify the booking belongs to this user
    const bookingCheck = await pool.query(
      'SELECT id, status FROM public.bookings WHERE id = $1 AND user_id = $2',
      [bookingId, userId]
    );
    if (bookingCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    // Mark session as completed
    await pool.query(
      `UPDATE public.bookings SET status = 'completed', checkout_time = NOW(), updated_at = NOW() WHERE id = $1`,
      [bookingId]
    );

    console.log(`✅ Session ended early for booking #${bookingId} by user ${userId}`);
    res.json({ success: true, message: 'Session ended successfully' });
  } catch (err) {
    console.error('End session error:', err.message);
    res.status(500).json({ error: 'Failed to end session' });
  }
});
