/**
 * Auth Routes — Twilio Verify OTP Login
 * Flow: Enter phone → Send OTP → Verify → Session created
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// Auto-create users table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100),
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone)`);
    console.log('Users table ready');
  } catch (err) {
    console.error('Users table error:', err.message);
  }
})();

/**
 * POST /api/auth/send-code
 * Send OTP via Twilio Verify
 */
router.post('/send-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Phone number is required' });

    // Normalize phone — ensure it starts with +
    const normalizedPhone = phone.startsWith('+') ? phone : `+44${phone.replace(/^0/, '')}`;

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) {
      return res.status(500).json({ error: 'SMS service not configured' });
    }

    // Send verification via Twilio Verify API
    const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/Verifications`;
    const params = new URLSearchParams({ To: normalizedPhone, Channel: 'sms' });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Twilio send error:', data);
      return res.status(400).json({ error: 'Failed to send code', detail: data.message });
    }

    res.json({
      success: true,
      message: `Verification code sent to ${normalizedPhone}`,
      phone: normalizedPhone,
    });
  } catch (err) {
    console.error('Send code error:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

/**
 * POST /api/auth/verify
 * Verify OTP, create/find user, set session
 */
router.post('/verify', async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code are required' });

    const normalizedPhone = phone.startsWith('+') ? phone : `+44${phone.replace(/^0/, '')}`;

    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_VERIFY_SID) {
      return res.status(500).json({ error: 'SMS service not configured' });
    }

    // Verify code via Twilio Verify API
    const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/VerificationCheck`;
    const params = new URLSearchParams({ To: normalizedPhone, Code: code });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await response.json();

    if (!response.ok || data.status !== 'approved') {
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Find or create user
    let user = await pool.query('SELECT * FROM users WHERE phone = $1', [normalizedPhone]);

    if (user.rows.length === 0) {
      // New user — create account
      user = await pool.query(
        'INSERT INTO users (phone) VALUES ($1) RETURNING *',
        [normalizedPhone]
      );
    } else {
      // Existing user — update last login
      await pool.query('UPDATE users SET last_login = NOW() WHERE phone = $1', [normalizedPhone]);
    }

    const u = user.rows[0];

    // Set session
    req.session.userId = u.id;
    req.session.phone = u.phone;

    res.json({
      success: true,
      user: {
        id: u.id,
        phone: u.phone,
        name: u.name,
        email: u.email,
      },
      message: 'Logged in successfully',
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * GET /api/auth/user
 * Get current logged-in user from session
 */
router.get('/user', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }

    const user = await pool.query('SELECT id, phone, name, email, created_at FROM users WHERE id = $1', [req.session.userId]);

    if (user.rows.length === 0) {
      req.session.destroy();
      return res.status(401).json({ error: 'User not found' });
    }

    res.json(user.rows[0]);
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out' });
  });
});

module.exports = router;
