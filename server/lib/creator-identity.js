/**
 * Creator identity middleware.
 *
 * The creator growth and distribution endpoints originally identified a creator by a
 * `handle` in the request body. Handles are public — they are printed on every
 * referral link (scangym.com/r/<handle>) — so any visitor could pass someone else's
 * handle and spend their balance on boosts and giveaways, cancel their giveaway, or
 * post announcements to their followers.
 *
 * requireOwnHandle authenticates the caller and then OVERWRITES req.body.handle with
 * the handle on their own user row, so a handle supplied by the client can never be
 * acted on. Existing route bodies keep working unchanged.
 */
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;

async function attachOwnHandle(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [
      req.user.id,
    ]);
    const handle = rows[0] && rows[0].referral_handle;
    if (!handle || !HANDLE_RE.test(handle)) {
      return res.status(403).json({
        error: 'You need a creator handle before you can do this',
        code: 'no_creator_handle',
      });
    }
    const claimed = req.body && req.body.handle;
    if (claimed && claimed !== handle) {
      console.warn(
        `[CreatorIdentity] user ${req.user.id} (${handle}) sent handle "${claimed}" — ignored`
      );
    }
    req.body = req.body || {};
    req.body.handle = handle;
    req.creatorHandle = handle;
    next();
  } catch (err) {
    console.error('[CreatorIdentity] lookup failed:', err.message);
    res.status(500).json({ error: 'Could not verify your creator account' });
  }
}

/** Use as: router.post('/boost', ...requireOwnHandle, handler) */
const requireOwnHandle = [authenticateUser, attachOwnHandle];

module.exports = { requireOwnHandle, attachOwnHandle, HANDLE_RE };
