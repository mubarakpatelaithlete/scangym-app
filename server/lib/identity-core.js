/**
 * Stripe Identity step-up — one function, used by routes/identity.js (the Verify button)
 * and account-tools.js start_verification (saying "verify me"). Photo ID + matching
 * selfie happen on Stripe's hosted page; the only thing we can do by voice is open it.
 */
const pool = require('../middleware/db');

function stripeClient() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

/**
 * @returns {{ ok:true, alreadyVerified:true } | { ok:true, url } }  throws on Stripe failure
 */
async function startVerification(userId, deps = {}) {
  const db = deps.pool || pool;
  const u = await db.query('SELECT identity_verified FROM users WHERE id = $1', [userId]);
  if (u.rows[0]?.identity_verified) return { ok: true, alreadyVerified: true };
  const BASE = process.env.BASE_URL || 'https://scangym.com';
  const stripe = deps.stripe || stripeClient();
  const session = await stripe.identity.verificationSessions.create({
    type: 'document',
    options: { document: { require_matching_selfie: true } },
    metadata: { scangym_user_id: String(userId) },
    return_url: `${BASE}/profile?identity=done`,
  });
  await db.query('UPDATE users SET identity_session_id = $1 WHERE id = $2', [session.id, userId]).catch(() => {});
  return { ok: true, url: session.url };
}

module.exports = { startVerification };
