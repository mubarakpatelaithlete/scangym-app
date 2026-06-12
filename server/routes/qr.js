/**
 * Task 12: QR Code 2-Scan System — NEW
 * CEO: "QR code works only 2 times: one for going in and one for going out.
 *        Then expires if scanned 2 times, like JD Gym."
 *
 * Flow:
 * 1. User pays for 24hr day pass → system generates unique QR code
 * 2. Scan 1 (entry): User scans QR at gym entrance → check-in recorded, AI Coach unlocks
 * 3. Scan 2 (exit): User scans QR when leaving → check-out recorded, QR expires
 * 4. After 2 scans: QR is permanently expired. Cannot be reused.
 * 5. After 24 hours: QR auto-expires even if not fully used.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const QRCode = require('qrcode');

// Ensure QR tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_qr_codes (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        gym_id INTEGER NOT NULL,
        qr_token VARCHAR(100) UNIQUE NOT NULL,
        max_scans INTEGER DEFAULT 2,
        scan_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qr_token ON booking_qr_codes(qr_token)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qr_booking ON booking_qr_codes(booking_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_checkins (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        qr_code_id INTEGER NOT NULL,
        gym_id INTEGER NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        scan_type VARCHAR(10) NOT NULL,
        scan_number INTEGER NOT NULL,
        scanned_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_checkin_booking ON booking_checkins(booking_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_checkin_user ON booking_checkins(user_id)`);
    console.log('QR code tables ready (2-scan JD Gym model)');
  } catch (err) {
    console.error('QR table creation error:', err.message);
  }
})();

/**
 * Generate a unique QR token
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

// POST /api/qr/generate — Generate QR code for a paid booking
router.post('/generate', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId } = req.body;

    if (!bookingId) return res.status(400).json({ error: 'bookingId is required' });

    // Verify booking belongs to user and is paid
    const booking = await pool.query(
      `SELECT b.id, b.gym_id, b.status FROM bookings b WHERE b.id = $1 AND b.user_id = $2`,
      [parseInt(bookingId), userId]
    );
    if (booking.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    if (!['confirmed', 'completed', 'active'].includes(booking.rows[0].status)) {
      return res.status(400).json({ error: 'Booking must be paid/confirmed to generate QR code' });
    }

    // Check if QR already exists for this booking
    const existing = await pool.query(
      'SELECT * FROM booking_qr_codes WHERE booking_id = $1', [parseInt(bookingId)]
    );
    if (existing.rows.length > 0) {
      const qr = existing.rows[0];
      if (qr.status === 'active' && new Date(qr.expires_at) > new Date()) {
        // Return existing active QR
        const qrDataUrl = await QRCode.toDataURL(`https://scangym.com/scan/${qr.qr_token}`, {
          width: 400, margin: 2, color: { dark: '#000000', light: '#FFFFFF' },
        });
        return res.json({
          qrCode: {
            id: qr.id,
            token: qr.qr_token,
            scanUrl: `https://scangym.com/scan/${qr.qr_token}`,
            dataUrl: qrDataUrl,
            maxScans: qr.max_scans,
            scanCount: qr.scan_count,
            scansRemaining: qr.max_scans - qr.scan_count,
            status: qr.status,
            expiresAt: qr.expires_at,
          },
          policy: {
            maxScans: 2,
            scanFlow: ['Entry scan (check-in)', 'Exit scan (check-out)'],
            expiresAfterScans: 'QR expires permanently after 2 scans',
            expiresAfterTime: '24 hours from generation',
            model: 'JD Gym style',
          },
        });
      }
    }

    // Generate new QR code
    const qrToken = generateQRToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const result = await pool.query(`
      INSERT INTO booking_qr_codes (booking_id, user_id, gym_id, qr_token, max_scans, expires_at)
      VALUES ($1, $2, $3, $4, 2, $5)
      RETURNING *
    `, [parseInt(bookingId), userId, booking.rows[0].gym_id, qrToken, expiresAt]);

    const qr = result.rows[0];

    // Generate QR code image as data URL
    const scanUrl = `https://scangym.com/scan/${qrToken}`;
    const qrDataUrl = await QRCode.toDataURL(scanUrl, {
      width: 400,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' },
      errorCorrectionLevel: 'H',
    });

    res.status(201).json({
      qrCode: {
        id: qr.id,
        token: qrToken,
        scanUrl,
        dataUrl: qrDataUrl,
        maxScans: 2,
        scanCount: 0,
        scansRemaining: 2,
        status: 'active',
        expiresAt: expiresAt.toISOString(),
      },
      policy: {
        maxScans: 2,
        scanFlow: ['Scan 1: Entry (check-in at gym door)', 'Scan 2: Exit (check-out when leaving)'],
        expiresAfterScans: 'QR expires permanently after 2 scans',
        expiresAfterTime: '24 hours from generation',
        model: 'JD Gym style — entry + exit, then done',
      },
    });
  } catch (err) {
    console.error('QR generate error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// POST /api/qr/scan — Gym scans user's QR (called by gym's scanner hardware)
router.post('/scan', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'QR token is required' });

    // Find the QR code
    const qrResult = await pool.query(
      'SELECT * FROM booking_qr_codes WHERE qr_token = $1', [token]
    );
    if (qrResult.rows.length === 0) {
      return res.status(404).json({
        valid: false,
        error: 'Invalid QR code',
        message: 'This QR code is not recognized.',
      });
    }

    const qr = qrResult.rows[0];

    // Check if expired by time
    if (new Date(qr.expires_at) < new Date()) {
      await pool.query("UPDATE booking_qr_codes SET status = 'expired' WHERE id = $1", [qr.id]);
      return res.json({
        valid: false,
        error: 'QR code expired',
        message: 'This 24-hour day pass has expired.',
        scanCount: qr.scan_count,
        maxScans: qr.max_scans,
      });
    }

    // Check if already used up (2 scans max)
    if (qr.scan_count >= qr.max_scans || qr.status === 'expired') {
      return res.json({
        valid: false,
        error: 'QR code fully used',
        message: 'This QR code has already been scanned 2 times (entry + exit) and is now expired.',
        scanCount: qr.scan_count,
        maxScans: qr.max_scans,
      });
    }

    // ── M18 FIX: Cash booking verification ──
    // For cash bookings, first entry scan requires staff to confirm cash was received
    const bookingRow = await pool.query(
      'SELECT status, booking_type, total_amount FROM bookings WHERE id = $1',
      [qr.booking_id]
    );
    const booking = bookingRow.rows[0] || {};
    const isCashBooking = (booking.booking_type || '').includes('cash');

    // Determine scan type
    const newScanCount = qr.scan_count + 1;
    const scanType = newScanCount === 1 ? 'entry' : 'exit';
    const newStatus = newScanCount >= qr.max_scans ? 'expired' : 'active';

    // Get user + gym info for display
    let userName = 'Member';
    let gymName = 'Gym';
    try {
      const user = await pool.query('SELECT first_name, last_name, phone_number FROM users WHERE id = $1', [qr.user_id]);
      if (user.rows[0]) userName = [user.rows[0].first_name, user.rows[0].last_name].filter(Boolean).join(' ') || 'Member';
      const gym = await pool.query('SELECT name FROM gyms WHERE id = $1', [qr.gym_id]);
      if (gym.rows[0]) gymName = gym.rows[0].name;
    } catch (e) {}

    // If cash booking + entry scan + not yet confirmed → ask staff to confirm cash first
    if (isCashBooking && scanType === 'entry' && booking.status === 'reserved') {
      const amount = booking.total_amount || 0;
      return res.json({
        valid: true,
        cashPaymentRequired: true,
        message: `💰 Cash payment required: ${amount.toFixed(2)}. Please collect cash from ${userName} before granting entry.`,
        amountDue: amount,
        bookingId: qr.booking_id,
        qrToken: token,
        gymId: qr.gym_id,
        userId: qr.user_id,
        userName,
        gymName,
        instruction: 'Collect cash, then tap "Confirm Cash Received" to grant entry.',
      });
    }

    // Record the scan
    await pool.query(`
      INSERT INTO booking_checkins (booking_id, qr_code_id, gym_id, user_id, scan_type, scan_number)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [qr.booking_id, qr.id, qr.gym_id, qr.user_id, scanType, newScanCount]);

    // Update QR code
    await pool.query(`
      UPDATE booking_qr_codes SET scan_count = $1, status = $2 WHERE id = $3
    `, [newScanCount, newStatus, qr.id]);

    res.json({
      valid: true,
      scanType,
      scanNumber: newScanCount,
      scansRemaining: qr.max_scans - newScanCount,
      status: newStatus,
      message: scanType === 'entry'
        ? `✅ Welcome ${userName}! Entry recorded. Enjoy your workout at ${gymName}! (1 exit scan remaining)`
        : `👋 Goodbye ${userName}! Exit recorded. QR code is now expired. See you next time!`,
      bookingId: qr.booking_id,
      gymId: qr.gym_id,
      userId: qr.user_id,
      userName,
      gymName,
      expiresAt: qr.expires_at,
      aiCoachUnlocked: scanType === 'entry',
    });
  } catch (err) {
    console.error('QR scan error:', err);
    res.status(500).json({ error: 'Failed to process scan' });
  }
});

// GET /api/qr/status/:bookingId — Check QR code status
router.get('/status/:bookingId', authenticateUser, async (req, res) => {
  try {
    const bookingId = parseInt(req.params.bookingId);
    const userId = req.user.id;

    const qr = await pool.query(
      'SELECT * FROM booking_qr_codes WHERE booking_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1',
      [bookingId, userId]
    );

    if (qr.rows.length === 0) {
      return res.json({ hasQR: false, message: 'No QR code generated for this booking yet.' });
    }

    const q = qr.rows[0];
    const isExpiredByTime = new Date(q.expires_at) < new Date();
    const isExpiredByScans = q.scan_count >= q.max_scans;
    const isExpired = isExpiredByTime || isExpiredByScans || q.status === 'expired';

    // Get scan history
    const scans = await pool.query(
      'SELECT scan_type, scan_number, scanned_at FROM booking_checkins WHERE qr_code_id = $1 ORDER BY scanned_at',
      [q.id]
    );

    res.json({
      hasQR: true,
      qrCode: {
        id: q.id,
        token: q.qr_token,
        scanUrl: `https://scangym.com/scan/${q.qr_token}`,
        maxScans: q.max_scans,
        scanCount: q.scan_count,
        scansRemaining: Math.max(0, q.max_scans - q.scan_count),
        status: isExpired ? 'expired' : 'active',
        expiresAt: q.expires_at,
        isExpired,
        expiredReason: isExpiredByScans ? '2 scans used (entry + exit)' : isExpiredByTime ? '24-hour period ended' : null,
      },
      scanHistory: scans.rows,
      aiCoachUnlocked: scans.rows.some(s => s.scan_type === 'entry'),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check QR status' });
  }
});

// ── M18 FIX: POST /api/qr/confirm-cash — Staff confirms cash was received ──
// Called after scanning a cash booking QR. Confirms payment + records entry scan.
router.post('/confirm-cash', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'QR token is required' });

    // Find the QR code
    const qrResult = await pool.query(
      'SELECT * FROM booking_qr_codes WHERE qr_token = $1', [token]
    );
    if (qrResult.rows.length === 0) {
      return res.status(404).json({ error: 'Invalid QR code' });
    }
    const qr = qrResult.rows[0];

    // Verify it's a cash booking still in 'reserved' status
    const bookingRow = await pool.query(
      'SELECT id, status, booking_type, total_amount FROM bookings WHERE id = $1',
      [qr.booking_id]
    );
    if (bookingRow.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    const booking = bookingRow.rows[0];
    if (!(booking.booking_type || '').includes('cash')) {
      return res.status(400).json({ error: 'Not a cash booking' });
    }
    if (booking.status !== 'reserved') {
      return res.status(400).json({ error: 'Cash already confirmed or booking cancelled' });
    }

    // ── Confirm: update booking status to 'confirmed' ──
    await pool.query(
      "UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1",
      [booking.id]
    );

    // ── Record entry scan (scan 1) ──
    const newScanCount = qr.scan_count + 1;
    const newStatus = newScanCount >= qr.max_scans ? 'expired' : 'active';

    await pool.query(`
      INSERT INTO booking_checkins (booking_id, qr_code_id, gym_id, user_id, scan_type, scan_number)
      VALUES ($1, $2, $3, $4, 'entry', $5)
    `, [qr.booking_id, qr.id, qr.gym_id, qr.user_id, newScanCount]);

    await pool.query(
      'UPDATE booking_qr_codes SET scan_count = $1, status = $2 WHERE id = $3',
      [newScanCount, newStatus, qr.id]
    );

    // Get names for response
    let userName = 'Member';
    let gymName = 'Gym';
    try {
      const user = await pool.query('SELECT first_name, last_name FROM users WHERE id = $1', [qr.user_id]);
      if (user.rows[0]) userName = [user.rows[0].first_name, user.rows[0].last_name].filter(Boolean).join(' ') || 'Member';
      const gym = await pool.query('SELECT name FROM gyms WHERE id = $1', [qr.gym_id]);
      if (gym.rows[0]) gymName = gym.rows[0].name;
    } catch (e) {}

    res.json({
      valid: true,
      cashConfirmed: true,
      scanType: 'entry',
      scanNumber: newScanCount,
      scansRemaining: qr.max_scans - newScanCount,
      status: newStatus,
      message: `✅ Cash received! Welcome ${userName}! Entry recorded at ${gymName}. (1 exit scan remaining)`,
      bookingId: qr.booking_id,
      gymId: qr.gym_id,
      userName,
      gymName,
      aiCoachUnlocked: true,
    });
  } catch (err) {
    console.error('Confirm cash error:', err);
    res.status(500).json({ error: 'Failed to confirm cash payment' });
  }
});

module.exports = router;
