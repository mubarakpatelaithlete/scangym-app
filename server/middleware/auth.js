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
    // Silently continue without auth
  }
  next();
}

module.exports = { authenticateUser, optionalAuth };
