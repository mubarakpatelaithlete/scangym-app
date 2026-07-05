/**
 * Task 21: Analytics Tracking Middleware — CORRECTED
 * CEO: "I want to know traffic volume and conversion of that traffic"
 *
 * Tracks every request for the CEO dashboard funnel:
 * Visitor → Search → Profile → Checkout → Paid Booking
 * Also tracks: referrer (traffic source), funnel step classification.
 */
const pool = require('./db');

// Create analytics table if not exists (with migration for missing columns)
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id SERIAL PRIMARY KEY,
        event_type VARCHAR(50) NOT NULL,
        funnel_step VARCHAR(30),
        path VARCHAR(500),
        method VARCHAR(10),
        user_id VARCHAR(64),
        session_id VARCHAR(100),
        user_agent TEXT,
        ip_address VARCHAR(50),
        referrer TEXT,
        query_params JSONB,
        response_status INTEGER,
        response_time_ms INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Add missing columns if table was created before they were added
    const cols = ['funnel_step VARCHAR(30)', 'query_params JSONB', 'response_status INTEGER', 'response_time_ms INTEGER'];
    for (const col of cols) {
      const name = col.split(' ')[0];
      try { await pool.query(`ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS ${col}`); } catch(e) { /* column exists */ }
    }
    // MIGRATION: user_id was INTEGER but users.id is a UUID string, so every
    // INSERT for an authenticated request failed silently and no logged-in
    // activity was ever recorded. Widen to VARCHAR.
    try {
      await pool.query(`ALTER TABLE analytics_events ALTER COLUMN user_id TYPE VARCHAR(64) USING user_id::text`);
    } catch (e) { /* already varchar */ }
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_path ON analytics_events(path)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_funnel ON analytics_events(funnel_step)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_analytics_ip ON analytics_events(ip_address)`);
    console.log('Analytics table ready (CEO funnel tracking)');
  } catch (err) {
    console.error('Analytics table creation error:', err.message);
  }
})();

/**
 * Classify the request into a funnel step for CEO dashboard
 */
function classifyFunnelStep(path, method) {
  if (!path) return null;

  // Step 1: Just visiting (page views, homepage, etc.)
  if (path === '/' || path === '/index.html' || path.match(/^\/(about|contact|faq|pricing)/)) {
    return 'visitor';
  }

  // Step 2: Searching for gyms
  if (path.includes('/guest/gyms') || path.includes('/guest/quick-search') ||
      path.includes('/guest/cities') || path.includes('/guest/popular')) {
    return 'search';
  }

  // Step 3: Viewing a gym profile
  if (path.match(/\/gym-profile\/\d/) || path.match(/\/guest\/gym\/\d/) ||
      path.match(/\/reviews\/gym\/\d/) || path.match(/\/directions\/gym\/\d/)) {
    return 'profile_view';
  }

  // Step 4: Starting checkout / booking
  if ((path.includes('/booking') || path.includes('/payment') ||
       path.includes('/checkout') || path.includes('/wallet/spend')) && method === 'POST') {
    return 'checkout';
  }

  // Step 5: QR generated = confirmed booking
  if (path.includes('/qr/generate') && method === 'POST') {
    return 'booking_confirmed';
  }

  // Creator landing page
  if (path.match(/\/creators\/r\//)) {
    return 'creator_landing';
  }

  return null;
}

function analyticsMiddleware(req, res, next) {
  // Skip health checks and static assets
  if (req.path === '/api/v2/health' || req.path.match(/\.(js|css|png|jpg|ico|svg|woff|ttf|map)$/)) {
    return next();
  }

  const startTime = Date.now();
  const funnelStep = classifyFunnelStep(req.path, req.method);

  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;

    // Fire and forget
    pool.query(`
      INSERT INTO analytics_events (event_type, funnel_step, path, method, user_id, session_id, user_agent, ip_address, referrer, query_params, response_status, response_time_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [
      req.path.startsWith('/api/') ? 'api_call' : 'page_view',
      funnelStep,
      req.path,
      req.method,
      req.user ? req.user.id : null,
      req.headers.cookie ? req.headers.cookie.substring(0, 100) : null,
      req.headers['user-agent'] || null,
      req.headers['x-forwarded-for'] || req.ip || null,
      req.headers.referer || null,
      Object.keys(req.query).length > 0 ? JSON.stringify(req.query) : null,
      res.statusCode,
      responseTime,
    ]).catch(() => {});

    originalEnd.apply(res, args);
  };

  next();
}

module.exports = analyticsMiddleware;
