/**
 * Auth Routes — Twilio Verify OTP Login
 * Flow: Enter phone → Send OTP → Verify → Session created
 * 
 * IMPORTANT: Uses existing public.users table schema:
 *   - id: VARCHAR (UUID via gen_random_uuid())
 *   - phone_number: VARCHAR (not "phone")
 *   - first_name, last_name: VARCHAR (not "name")
 *   - email, stripe_customer_id, etc.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

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
 * Uses existing public.users table (phone_number column, UUID id)
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
      console.error('Twilio verify response:', JSON.stringify(data));
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    }

    // Find or create user in existing public.users table
    // Column is phone_number (not phone), id is UUID string
    let user = await pool.query('SELECT * FROM public.users WHERE phone_number = $1', [normalizedPhone]);

    if (user.rows.length === 0) {
      // New user — create account with UUID
      user = await pool.query(
        `INSERT INTO public.users (id, phone_number, created_at, updated_at) 
         VALUES (gen_random_uuid(), $1, NOW(), NOW()) RETURNING *`,
        [normalizedPhone]
      );
      console.log('Created new user:', normalizedPhone);
    } else {
      // Existing user — update timestamp
      await pool.query('UPDATE public.users SET updated_at = NOW() WHERE phone_number = $1', [normalizedPhone]);
      console.log('Existing user login:', normalizedPhone);
    }

    const u = user.rows[0];

    // Set session
    req.session.userId = u.id;
    req.session.phone = u.phone_number;

    res.json({
      success: true,
      user: {
        id: u.id,
        phone: u.phone_number,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
        email: u.email,
      },
      message: 'Logged in successfully',
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ error: 'Verification failed', detail: err.message });
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

    const user = await pool.query(
      'SELECT id, phone_number, first_name, last_name, email, created_at FROM public.users WHERE id = $1',
      [req.session.userId]
    );

    if (user.rows.length === 0) {
      req.session.destroy();
      return res.status(401).json({ error: 'User not found' });
    }

    const u = user.rows[0];
    res.json({
      id: u.id,
      phone: u.phone_number,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
      email: u.email,
      created_at: u.created_at,
    });
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
