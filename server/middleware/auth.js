/**
 * Auth middleware — validates user session (local session-based auth)
 * Uses existing public.users table:
 *   - id: VARCHAR (UUID)
 *   - phone_number: VARCHAR (not "phone")
 *   - first_name, last_name: VARCHAR (not "name")
 *   - email: VARCHAR
 */
const pool = require('./db');

async function authenticateUser(req, res, next) {
  try {
    // Check local session first
    if (req.session && req.session.userId) {
      const user = await pool.query(
        'SELECT id, phone_number, first_name, last_name, email FROM users WHERE id = $1',
        [req.session.userId]
      );
      if (user.rows.length > 0) {
        const u = user.rows[0];
        // Normalize field names for downstream compatibility
        req.user = {
          id: u.id,
          phone: u.phone_number,
          phone_number: u.phone_number,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
        };
        return next();
      }
      // User not found, destroy stale session
      req.session.destroy();
    }
    return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      const user = await pool.query(
        'SELECT id, phone_number, first_name, last_name, email FROM users WHERE id = $1',
        [req.session.userId]
      );
      if (user.rows.length > 0) {
        const u = user.rows[0];
        req.user = {
          id: u.id,
          phone: u.phone_number,
          phone_number: u.phone_number,
          name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
          first_name: u.first_name,
          last_name: u.last_name,
          email: u.email,
        };
      }
    }
  } catch (err) {
    console.warn('[Auth] Optional auth check failed:', err.message);
  }
  next();
}

/**
 * requireAdmin — must be chained AFTER authenticateUser.
 * Checks req.user against ADMIN_EMAILS env var (comma-separated list).
 * Falls back to ADMIN_USER_IDS if email-based lookup isn't configured.
 *
 * Set in Railway env:  ADMIN_EMAILS=you@example.com,co-founder@example.com
 */
function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Check by email
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (adminEmails.length > 0 && req.user.email && adminEmails.includes(req.user.email.toLowerCase())) {
    return next();
  }

  // Check by user ID
  const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  if (adminIds.length > 0 && adminIds.includes(req.user.id)) {
    return next();
  }

  // If no admin env vars are set at all, deny everyone (secure by default)
  console.warn(`Admin access denied for user ${req.user.id} (${req.user.email})`);
  return res.status(403).json({ error: 'Admin access required' });
}

module.exports = { authenticateUser, optionalAuth, requireAdmin };
