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

// Stripe — create Customer at signup like Uber
const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

/**
 * Ensure user has a Stripe Customer (Uber creates one at signup).
 * Safe to call repeatedly — skips if already set.
 */
async function ensureStripeCustomer(userId, phone, email) {
  if (!stripe) return null;
  try {
    const user = await pool.query(
      'SELECT stripe_customer_id, email, phone_number FROM public.users WHERE id = $1',
      [userId]
    );
    if (user.rows.length === 0) return null;
    const u = user.rows[0];
    if (u.stripe_customer_id) return u.stripe_customer_id;

    const customer = await stripe.customers.create({
      phone: phone || u.phone_number || undefined,
      email: email || u.email || undefined,
      metadata: { userId, source: 'scangym', created_at_signup: 'true' },
    });

    await pool.query(
      'UPDATE public.users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
      [customer.id, userId]
    );
    console.log(`[Auth] Created Stripe Customer ${customer.id} at signup for user ${userId}`);
    return customer.id;
  } catch (err) {
    // Non-fatal — payment will create Customer later as fallback
    console.error('[Auth] Stripe Customer creation failed (non-fatal):', err.message);
    return null;
  }
}

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

    // Uber-style: ensure Stripe Customer exists at signup/login
    // For new users this creates it immediately; for existing users it backfills
    const stripeCustomerId = await ensureStripeCustomer(u.id, normalizedPhone, u.email);

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
        hasStripeCustomer: !!stripeCustomerId,
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

    // Try with extended fields; fall back if columns don't exist yet
    let user;
    try {
      user = await pool.query(
        `SELECT id, phone_number, first_name, last_name, email, created_at,
                fitness_level, emergency_contact, profile_complete
         FROM public.users WHERE id = $1`,
        [req.session.userId]
      );
    } catch (e) {
      // Extended columns may not exist yet
      user = await pool.query(
        'SELECT id, phone_number, first_name, last_name, email, created_at FROM public.users WHERE id = $1',
        [req.session.userId]
      );
    }

    if (user.rows.length === 0) {
      req.session.destroy();
      return res.status(401).json({ error: 'User not found' });
    }

    const u = user.rows[0];
    res.json({
      id: u.id,
      phone: u.phone_number,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      email: u.email,
      fitness_level: u.fitness_level || '',
      emergency_contact: u.emergency_contact || '',
      profile_complete: u.profile_complete || false,
      member_since: u.created_at,
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PUT /api/auth/profile
 * Update user profile — name, email, fitness level, emergency contact
 * Server-side storage so profile syncs across devices (replaces localStorage)
 */
router.put('/profile', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { first_name, last_name, email, fitness_level, emergency_contact } = req.body;
    const userId = req.session.userId;

    // Ensure profile columns exist (idempotent)
    await pool.query(`
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fitness_level VARCHAR(50);
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;
    `);

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    if (first_name !== undefined) { fields.push(`first_name = $${idx++}`); values.push(first_name); }
    if (last_name !== undefined) { fields.push(`last_name = $${idx++}`); values.push(last_name); }
    if (email !== undefined) { fields.push(`email = $${idx++}`); values.push(email); }
    if (fitness_level !== undefined) { fields.push(`fitness_level = $${idx++}`); values.push(fitness_level); }
    if (emergency_contact !== undefined) { fields.push(`emergency_contact = $${idx++}`); values.push(emergency_contact); }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Check profile completeness
    fields.push(`profile_complete = (
      COALESCE(${first_name !== undefined ? `$${values.indexOf(first_name) + 1}` : 'first_name'}, '') != '' AND
      COALESCE(${email !== undefined ? `$${values.indexOf(email) + 1}` : 'email'}, '') != '' AND
      phone_number IS NOT NULL
    )`);
    fields.push(`updated_at = NOW()`);

    values.push(userId);
    const query = `UPDATE public.users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, first_name, last_name, email, phone_number, fitness_level, emergency_contact, profile_complete, created_at`;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = result.rows[0];
    res.json({
      success: true,
      user: {
        id: u.id,
        phone: u.phone_number,
        name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
        first_name: u.first_name,
        last_name: u.last_name,
        email: u.email,
        fitness_level: u.fitness_level,
        emergency_contact: u.emergency_contact,
        profile_complete: u.profile_complete,
        member_since: u.created_at,
      },
    });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile', detail: err.message });
  }
});

/**
 * GET /api/auth/profile
 * Get full profile with all fields (extended version of /user)
 */
router.get('/profile', async (req, res) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Ensure columns exist
    await pool.query(`
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS fitness_level VARCHAR(50);
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS emergency_contact VARCHAR(255);
      ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;
    `);

    const result = await pool.query(
      `SELECT id, phone_number, first_name, last_name, email, fitness_level, emergency_contact, 
              profile_complete, stripe_customer_id, created_at
       FROM public.users WHERE id = $1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const u = result.rows[0];

    // Count bookings for stats
    let totalBookings = 0;
    let gymsVisited = 0;
    try {
      const bookingStats = await pool.query(
        `SELECT COUNT(*) as total, COUNT(DISTINCT gym_id) as gyms FROM bookings WHERE user_id = $1`,
        [req.session.userId]
      );
      totalBookings = parseInt(bookingStats.rows[0]?.total || 0);
      gymsVisited = parseInt(bookingStats.rows[0]?.gyms || 0);
    } catch (e) { /* bookings table may not exist yet */ }

    res.json({
      id: u.id,
      phone: u.phone_number,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
      first_name: u.first_name || '',
      last_name: u.last_name || '',
      email: u.email || '',
      fitness_level: u.fitness_level || '',
      emergency_contact: u.emergency_contact || '',
      profile_complete: u.profile_complete || false,
      has_payment: !!u.stripe_customer_id,
      member_since: u.created_at,
      stats: {
        total_bookings: totalBookings,
        gyms_visited: gymsVisited,
      },
    });
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to get profile' });
  }
});


/**
 * POST /api/auth/google-login (Fix #5B — Google Sign-In)
 * Verify Google ID token and create/find user
 */
router.post('/google-login', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

    // Decode the JWT payload (Google ID token is a JWT)
    // For production, verify with Google's tokeninfo endpoint
    const tokenInfoResp = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + credential);
    if (!tokenInfoResp.ok) {
      return res.status(401).json({ error: 'Invalid Google token' });
    }
    const tokenInfo = await tokenInfoResp.json();

    const email = tokenInfo.email;
    const name = tokenInfo.name || '';
    const firstName = tokenInfo.given_name || name.split(' ')[0] || '';
    const lastName = tokenInfo.family_name || name.split(' ').slice(1).join(' ') || '';

    if (!email) return res.status(400).json({ error: 'No email in Google token' });

    // Find or create user by email
    let user = await pool.query('SELECT * FROM public.users WHERE email = $1', [email]);

    if (user.rows.length === 0) {
      // Create new user with Google info
      user = await pool.query(
        `INSERT INTO public.users (id, email, first_name, last_name, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING *`,
        [email, firstName, lastName]
      );
      console.log('Created new user via Google:', email);
    } else {
      // Update name if empty
      const u = user.rows[0];
      if (!u.first_name && firstName) {
        await pool.query('UPDATE public.users SET first_name=$1, last_name=$2, updated_at=NOW() WHERE id=$3',
          [firstName, lastName, u.id]);
      }
      console.log('Existing user Google login:', email);
    }

    const u = user.rows[0];

    // Ensure Stripe Customer
    const stripeCustomerId = await ensureStripeCustomer(u.id, u.phone_number, email);

    // Set session
    req.session.userId = u.id;
    req.session.phone = u.phone_number;

    res.json({
      success: true,
      user: {
        id: u.id,
        phone: u.phone_number,
        name: [firstName || u.first_name, lastName || u.last_name].filter(Boolean).join(' ') || null,
        email: email,
        hasStripeCustomer: !!stripeCustomerId,
      },
      message: 'Logged in with Google',
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Google login failed', detail: err.message });
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
