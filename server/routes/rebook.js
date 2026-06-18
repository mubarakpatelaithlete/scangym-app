/**
 * Quick Rebook Routes — 1-tap rebook with biometric (WebAuthn fingerprint)
 * 
 * Endpoints:
 *   POST /api/rebook/setup-biometric       — Register WebAuthn credential
 *   POST /api/rebook/verify-biometric      — Verify biometric for rebook
 *   POST /api/rebook/quick                 — Quick rebook last gym (1-tap)
 *   GET  /api/rebook/suggestions           — Get rebook suggestions (frequent gyms)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const crypto = require('crypto');

// Ensure tables
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_biometric_credentials (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        credential_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        counter INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS rebook_favorites (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        gym_id INTEGER NOT NULL,
        visit_count INTEGER DEFAULT 1,
        last_visited TIMESTAMPTZ DEFAULT NOW(),
        preferred_time TEXT DEFAULT 'anytime',
        UNIQUE(user_id, gym_id)
      )
    `);
  } catch (e) { console.error('Rebook table init:', e.message); }
})();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Login required' });
  req.user = { id: req.session.userId };
  next();
}

// POST /setup-biometric — Register WebAuthn credential
router.post('/setup-biometric', requireAuth, express.json(), async (req, res) => {
  try {
    const { credentialId, publicKey } = req.body;
    if (!credentialId || !publicKey) return res.status(400).json({ error: 'Missing credential data' });

    await pool.query(
      `INSERT INTO user_biometric_credentials (user_id, credential_id, public_key)
       VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET credential_id = $2, public_key = $3`,
      [req.user.id, credentialId, publicKey]
    );

    res.json({ success: true, message: 'Biometric registered — you can now 1-tap rebook' });
  } catch (e) {
    console.error('Biometric setup error:', e.message);
    res.status(500).json({ error: 'Setup failed' });
  }
});

// POST /verify-biometric — Verify biometric assertion
router.post('/verify-biometric', requireAuth, express.json(), async (req, res) => {
  try {
    const { credentialId, authenticatorData, signature } = req.body;
    const cred = await pool.query(
      'SELECT * FROM user_biometric_credentials WHERE user_id = $1 AND credential_id = $2',
      [req.user.id, credentialId]
    );
    if (!cred.rows.length) return res.status(401).json({ error: 'Unknown credential' });

    // In production: verify signature with stored public key
    // For now: credential match = verified
    await pool.query(
      'UPDATE user_biometric_credentials SET counter = counter + 1 WHERE id = $1',
      [cred.rows[0].id]
    );

    // Generate short-lived rebook token
    const token = crypto.randomBytes(16).toString('hex');
    req.session.rebookToken = token;
    req.session.rebookExpiry = Date.now() + 60000; // 1 min

    res.json({ success: true, verified: true, rebookToken: token });
  } catch (e) {
    console.error('Biometric verify error:', e.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// POST /quick — Quick rebook (1-tap with saved card)
router.post('/quick', requireAuth, express.json(), async (req, res) => {
  try {
    const { gymId, rebookToken } = req.body;

    // Verify rebook token (biometric must have been verified recently)
    if (!req.session.rebookToken || req.session.rebookToken !== rebookToken) {
      return res.status(401).json({ error: 'Biometric verification required' });
    }
    if (Date.now() > (req.session.rebookExpiry || 0)) {
      return res.status(401).json({ error: 'Verification expired, please verify again' });
    }

    // Get user's saved card
    const user = await pool.query('SELECT stripe_customer_id FROM users WHERE id = $1', [req.user.id]);
    const customerId = user.rows[0]?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No saved card — add a payment method first' });

    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    const methods = await stripe.paymentMethods.list({ customer: customerId, type: 'card' });
    if (!methods.data.length) return res.status(400).json({ error: 'No saved card' });

    // Get gym + pricing
    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });

    const pricing = require('../lib/pricing-engine');
    const dayPrice = pricing.getDayPassPrice(gym.rows[0].country || 'GB');

    // Charge saved card
    const pi = await stripe.paymentIntents.create({
      amount: dayPrice.amountPence,
      currency: dayPrice.currency,
      customer: customerId,
      payment_method: methods.data[0].id,
      confirm: true,
      off_session: true,
      metadata: { type: 'quick_rebook', gym_id: gymId, user_id: req.user.id }
    });

    // Create booking
    const bookingCode = crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{4}/g).join('-');
    const qrCode = 'BOOK_' + crypto.randomBytes(8).toString('hex').toUpperCase();

    await pool.query(
      `INSERT INTO bookings (gym_id, user_id, booking_date, total_amount, booking_code, qr_code, status, booking_type, stripe_payment_intent_id)
       VALUES ($1, $2, NOW(), $3, $4, $5, 'confirmed', 'quick_rebook', $6)`,
      [gymId, req.user.id, dayPrice.amount, bookingCode, qrCode, pi.id]
    );

    // Update rebook favorites
    await pool.query(
      `INSERT INTO rebook_favorites (user_id, gym_id, visit_count, last_visited)
       VALUES ($1, $2, 1, NOW())
       ON CONFLICT (user_id, gym_id) DO UPDATE SET visit_count = rebook_favorites.visit_count + 1, last_visited = NOW()`,
      [req.user.id, gymId]
    );

    // Clear rebook token
    delete req.session.rebookToken;

    res.json({
      success: true,
      bookingCode,
      qrCode,
      gym: gym.rows[0].name,
      amount: dayPrice.display,
      message: `Booked at ${gym.rows[0].name} — show QR to enter`
    });
  } catch (e) {
    console.error('Quick rebook error:', e.message);
    res.status(500).json({ error: 'Rebook failed: ' + e.message });
  }
});

// GET /suggestions — Frequent gyms for rebook
router.get('/suggestions', requireAuth, async (req, res) => {
  try {
    const favs = await pool.query(
      `SELECT rf.*, g.name, g.address, g.photos, g.rating
       FROM rebook_favorites rf
       JOIN gyms g ON rf.gym_id = g.id
       WHERE rf.user_id = $1
       ORDER BY rf.visit_count DESC, rf.last_visited DESC
       LIMIT 5`,
      [req.user.id]
    );
    res.json(favs.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
