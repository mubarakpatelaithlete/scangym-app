/**
 * Auth middleware - validates user session by calling the upstream service.
 */
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'https://gym-link-ai-production.up.railway.app';

async function authenticateUser(req, res, next) {
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }
    const response = await fetch(`${UPSTREAM_URL}/api/auth/user`, {
      headers: {
        'Cookie': cookieHeader,
        'Accept': 'application/json',
      },
    });
    if (!response.ok) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Please log in first' });
    }
    const user = await response.json();
    if (!user || !user.id) {
      return res.status(401).json({ error: 'Not authenticated', message: 'Session expired' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err.message);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

async function optionalAuth(req, res, next) {
  try {
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) return next();
    const response = await fetch(`${UPSTREAM_URL}/api/auth/user`, {
      headers: { 'Cookie': cookieHeader, 'Accept': 'application/json' },
    });
    if (response.ok) {
      const user = await response.json();
      if (user && user.id) req.user = user;
    }
  } catch (err) {
    // Silently continue without auth
  }
  next();
}

module.exports = { authenticateUser, optionalAuth };
