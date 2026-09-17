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

/**
 * Signed in *and* in good standing to pay for it.
 *
 * Create is postpaid: nothing is prepaid, so the render we are about to buy is
 * credit we extend. Two conditions beyond a session, both from lib/gen-billing:
 * a saved card we may charge, and an unpaid balance under this creator's limit.
 * A suspended account is refused here too, which is what makes suspension mean
 * anything.
 *
 * Reads stay open, as above: prices, templates and the catalogue are how a
 * visitor decides whether to sign up at all.
 */
function requireBillable(req, res, next) {
  requireCreator(req, res, async () => {
    try {
      const verdict = await require('./gen-billing').gate(req);
      if (verdict) return res.status(verdict.status).json(verdict.body);
    } catch (e) {
      /* A billing check that throws must not take Create down with it: the
         daily budget in lib/gen-budget.js still caps the exposure. */
      console.error('[SquadBilling] gate error, allowing generation:', e.message);
    }
    return next();
  });
}

module.exports = { requireCreator, requireBillable };
