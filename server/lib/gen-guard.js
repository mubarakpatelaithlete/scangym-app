/**
 * The login gate on generation.
 *
 * Create used to accept anonymous callers (optionalAuth), which meant two
 * things: a stranger could spend real money on a $3.78 render, and a creator
 * who did generate something owned nothing afterwards — no history, no account,
 * no share loop, because there was no one to attach it to.
 *
 * This is deliberately not `authenticateUser` verbatim: the answer a Create
 * sheet needs is a flag it can act on (`needsLogin`) and a sentence a creator
 * can act on, not "Not authenticated". Everything else about the session check
 * is reused rather than reimplemented.
 *
 * Reads, on purpose, stay open: /health, /modes, /templates and the catalogue
 * cost nothing and are how the tab decides what to show a visitor before they
 * sign in. Only spending needs a name attached.
 */

const { optionalAuth } = require('../middleware/auth');

/** Session → req.user, then insist there is one. */
function requireCreator(req, res, next) {
  optionalAuth(req, res, () => {
    if (req.user && (req.user.id || req.user.userId)) return next();
    return res.status(401).json({
      error: 'Sign in to create — it keeps your creations, and your earnings, on your account.',
      needsLogin: true,
    });
  });
}

module.exports = { requireCreator };
