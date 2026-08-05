/**
 * Identity verification (Uber-style)
 * Level 1 (silent): phone OTP at login — already covered by auth.
 * Level 2 (step-up): Stripe Identity — photo ID + matching selfie.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Auto-migration: identity columns on users

// POST /api/identity/start — create a Stripe Identity session, return hosted URL
router.post('/start', authenticateUser, express.json(), async (req, res) => {
  try {
    const u = await pool.query('SELECT identity_verified, email FROM users WHERE id = $1', [req.user.id]);
    if (u.rows[0]?.identity_verified) return res.json({ success: true, alreadyVerified: true });

    const BASE = process.env.BASE_URL || 'https://scangym.com';
    const session = await stripe.identity.verificationSessions.create({
      type: 'document',
      options: { document: { require_matching_selfie: true } },
      metadata: { scangym_user_id: String(req.user.id) },
      return_url: `${BASE}/profile?identity=done`,
    });
    await pool.query('UPDATE users SET identity_session_id = $1 WHERE id = $2', [session.id, req.user.id]).catch(() => {});
    res.json({ success: true, url: session.url });
  } catch (err) {
    console.error('[Identity] start error:', err.message);
    res.status(500).json({ error: 'Could not start identity check — try again later' });
  }
});

// GET /api/identity/status — poll session, persist verified flag
router.get('/status', function(req, res, next){ if(!req.session || !req.session.userId){ return res.json({ verified:false, authenticated:false }); } next(); }, authenticateUser, async (req, res) => {
  try {
    const u = await pool.query('SELECT identity_verified, identity_session_id FROM users WHERE id = $1', [req.user.id]);
    if (!u.rows.length) return res.status(404).json({ error: 'User not found' });
    if (u.rows[0].identity_verified) return res.json({ verified: true });
    const sid = u.rows[0].identity_session_id;
    if (!sid) return res.json({ verified: false, started: false });
    const session = await stripe.identity.verificationSessions.retrieve(sid);
    if (session.status === 'verified') {
      await pool.query('UPDATE users SET identity_verified = true WHERE id = $1', [req.user.id]).catch(() => {});
      return res.json({ verified: true });
    }
    res.json({ verified: false, started: true, status: session.status });
  } catch (err) {
    console.error('[Identity] status error:', err.message);
    res.status(500).json({ error: 'Status check failed' });
  }
});

module.exports = router;
