/**
 * Extended Analytics Routes (#99, #100, #103, #104, #105, #106)
 * Per-button analytics, funnel, views, likes, feedback, real-time visitors
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// In-memory stores for real-time tracking
const buttonClicks = {};    // #99: per-button click counts
const realtimeVisitors = new Set(); // #106: active visitor tracking
const viewCounts = {};      // #103: per-entity view counts
const likeCounts = {};       // #104: per-entity like counts
const feedbackStore = {};    // #105: per-element feedback

// ── #99: Per-Button Click Tracking ──
router.post('/button-click', express.json(), (req, res) => {
  const { buttonId, page, sessionId, timestamp } = req.body;
  if (!buttonId) return res.status(400).json({ error: 'buttonId required' });

  const key = `${page || 'unknown'}:${buttonId}`;
  if (!buttonClicks[key]) buttonClicks[key] = { count: 0, sessions: new Set(), first: Date.now(), last: 0 };
  buttonClicks[key].count++;
  buttonClicks[key].last = Date.now();
  if (sessionId) buttonClicks[key].sessions.add(sessionId);

  res.json({ success: true });
});

router.get('/button-clicks', authenticateUser, (req, res) => {
  const { page } = req.query;
  const result = {};
  Object.entries(buttonClicks).forEach(([key, data]) => {
    if (page && !key.startsWith(page + ':')) return;
    result[key] = {
      clicks: data.count,
      uniqueSessions: data.sessions.size,
      firstClick: new Date(data.first).toISOString(),
      lastClick: data.last ? new Date(data.last).toISOString() : null
    };
  });
  res.json({ buttons: result, total: Object.keys(result).length });
});

// ── #100: Traffic + Conversion Funnel ──
router.get('/funnel', authenticateUser, async (req, res) => {
  try {
    const { period } = req.query; // 'today', '7d', '30d', 'all'
    let dateFilter = '';
    if (period === 'today') dateFilter = "AND created_at >= CURRENT_DATE";
    else if (period === '7d') dateFilter = "AND created_at >= NOW() - INTERVAL '7 days'";
    else if (period === '30d') dateFilter = "AND created_at >= NOW() - INTERVAL '30 days'";

    // Try to get real data from tables
    const visits = await pool.query(`SELECT COUNT(*) as c FROM page_views WHERE 1=1 ${dateFilter}`).catch(() => ({ rows: [{ c: 0 }] }));
    const searches = await pool.query(`SELECT COUNT(*) as c FROM search_logs WHERE 1=1 ${dateFilter}`).catch(() => ({ rows: [{ c: 0 }] }));
    const gymViews = await pool.query(`SELECT COUNT(*) as c FROM gym_views WHERE 1=1 ${dateFilter}`).catch(() => ({ rows: [{ c: 0 }] }));
    const bookings = await pool.query(`SELECT COUNT(*) as c FROM bookings WHERE 1=1 ${dateFilter}`).catch(() => ({ rows: [{ c: 0 }] }));
    const payments = await pool.query(`SELECT COUNT(*) as c FROM payments WHERE status = 'completed' ${dateFilter}`).catch(() => ({ rows: [{ c: 0 }] }));

    const funnel = [
      { step: 'Visit Site', count: parseInt(visits.rows[0]?.c) || 0, color: '#3b82f6' },
      { step: 'Search Gym', count: parseInt(searches.rows[0]?.c) || 0, color: '#8b5cf6' },
      { step: 'View Gym', count: parseInt(gymViews.rows[0]?.c) || 0, color: '#FF6D00' },
      { step: 'Start Booking', count: parseInt(bookings.rows[0]?.c) || 0, color: '#eab308' },
      { step: 'Complete Payment', count: parseInt(payments.rows[0]?.c) || 0, color: '#22c55e' }
    ];

    // Calculate conversion rates
    for (let i = 1; i < funnel.length; i++) {
      const prev = funnel[i - 1].count;
      funnel[i].conversionRate = prev > 0 ? Math.round((funnel[i].count / prev) * 100) : 0;
    }
    funnel[0].conversionRate = 100;

    res.json({ funnel, period: period || 'all' });
  } catch (err) {
    console.error('Funnel error:', err.message);
    res.json({ funnel: [], period: req.query.period || 'all' });
  }
});

// ── #103: View Counts (like Instagram) ──
router.post('/view', express.json(), (req, res) => {
  const { entityType, entityId, sessionId } = req.body;
  // entityType: 'gym', 'reel', 'profile'
  if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId required' });

  const key = `${entityType}:${entityId}`;
  if (!viewCounts[key]) viewCounts[key] = { total: 0, unique: new Set() };
  viewCounts[key].total++;
  if (sessionId) viewCounts[key].unique.add(sessionId);

  // Also try to persist to DB
  pool.query(
    'INSERT INTO entity_views (entity_type, entity_id, session_id, created_at) VALUES ($1, $2, $3, NOW())',
    [entityType, entityId, sessionId]
  ).catch(() => {}); // ignore if table doesn't exist

  res.json({ views: viewCounts[key].total, uniqueViews: viewCounts[key].unique.size });
});

router.get('/views/:entityType/:entityId', (req, res) => {
  const key = `${req.params.entityType}:${req.params.entityId}`;
  const data = viewCounts[key] || { total: 0, unique: new Set() };
  res.json({ views: data.total, uniqueViews: data.unique.size });
});

// ── #104: Likes Count ──
router.post('/like', express.json(), (req, res) => {
  const { entityType, entityId, userId, action } = req.body;
  // action: 'like' or 'unlike'
  if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId required' });

  const key = `${entityType}:${entityId}`;
  if (!likeCounts[key]) likeCounts[key] = { count: 0, users: new Set() };

  if (action === 'unlike') {
    if (userId && likeCounts[key].users.has(userId)) {
      likeCounts[key].users.delete(userId);
      likeCounts[key].count = Math.max(0, likeCounts[key].count - 1);
    }
  } else {
    if (userId) {
      if (!likeCounts[key].users.has(userId)) {
        likeCounts[key].count++;
        likeCounts[key].users.add(userId);
      }
    } else {
      likeCounts[key].count++;
    }
  }

  res.json({ likes: likeCounts[key].count, liked: userId ? likeCounts[key].users.has(userId) : false });
});

router.get('/likes/:entityType/:entityId', (req, res) => {
  const key = `${req.params.entityType}:${req.params.entityId}`;
  const data = likeCounts[key] || { count: 0 };
  res.json({ likes: data.count });
});

// ── #105: Per-Element Thumbs Up/Down Feedback ──
router.post('/feedback', express.json(), (req, res) => {
  const { elementId, page, vote, sessionId } = req.body;
  // vote: 'up' or 'down'
  if (!elementId || !vote) return res.status(400).json({ error: 'elementId and vote required' });

  const key = `${page || 'unknown'}:${elementId}`;
  if (!feedbackStore[key]) feedbackStore[key] = { up: 0, down: 0 };
  if (vote === 'up') feedbackStore[key].up++;
  else if (vote === 'down') feedbackStore[key].down++;

  res.json({ success: true, feedback: feedbackStore[key] });
});

router.get('/feedback/:page', (req, res) => {
  const page = req.params.page;
  const result = {};
  Object.entries(feedbackStore).forEach(([key, data]) => {
    if (key.startsWith(page + ':')) {
      result[key.replace(page + ':', '')] = data;
    }
  });
  res.json({ elements: result });
});

// ── #106: Real-Time Visitors on Site ──
router.post('/heartbeat', express.json(), (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  realtimeVisitors.add(sessionId);

  // Auto-expire after 60 seconds of no heartbeat
  setTimeout(() => realtimeVisitors.delete(sessionId), 60000);

  res.json({ online: realtimeVisitors.size });
});

router.get('/realtime', (req, res) => {
  res.json({
    online: realtimeVisitors.size,
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
