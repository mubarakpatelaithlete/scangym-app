/**
 * Auth middleware — validates user session (local session-based auth)
 */
const pool = require('./db');

async function authenticateUser(req, res, next) {
  try {
    // Check local session first
    if (req.session && req.session.userId) {
      const user = await pool.query('SELECT id, phone, name, email FROM users WHERE id = $1', [req.session.userId]);
      if (user.rows.length > 0) {
        req.user = user.rows[0];
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
      const user = await pool.query('SELECT id, phone, name, email FROM users WHERE id = $1', [req.session.userId]);
      if (user.rows.length > 0) {
        req.user = user.rows[0];
      }
    }
  } catch (err) {
    // Silently continue without auth
  }
  next();
}

module.exports = { authenticateUser, optionalAuth };
