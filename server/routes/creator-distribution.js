/**
 * Creator Distribution — Phase 3 of ScanSquad Creator Empowerment.
 *
 *  - Schedule Share  (YouTube Studio style): queue posts for best times
 *  - Notify Followers (YouTube style): passive followers + announcements
 *  - Mass Share support: channel-tagged links handled client-side
 *  - Link Sticker: personalised watermark handled in reels download
 *
 * Self-migrating tables (same pattern as referrals.js). All writes are
 * scoped by creator handle; announcements rate-limited to 1/hour.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

router.use(express.json());

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const PLATFORMS = ['instagram', 'tiktok', 'youtube', 'x', 'facebook', 'whatsapp', 'telegram', 'snapchat', 'other'];

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scheduled_shares (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        platform VARCHAR(30) NOT NULL DEFAULT 'other',
        caption TEXT,
        share_url TEXT,
        scheduled_at TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sched_shares_handle ON scheduled_shares(creator_handle, status)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_followers (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        follower_session VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(creator_handle, follower_session)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_creator_followers_handle ON creator_followers(creator_handle)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_announcements (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_creator_announcements_handle ON creator_announcements(creator_handle, created_at)`);
    console.log('[CreatorDistribution] Tables ready');
  } catch (err) {
    console.error('[CreatorDistribution] Table setup error:', err.message);
  }
})();

// ── Schedule Share ──────────────────────────────────────────────

router.post('/schedule', async (req, res) => {
  try {
    const { handle, platform, caption, scheduledAt } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const plat = PLATFORMS.includes(platform) ? platform : 'other';
    const when = new Date(scheduledAt);
    if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid scheduledAt' });
    if (when.getTime() < Date.now() - 60000) return res.status(400).json({ error: 'Scheduled time must be in the future' });
    const pending = await pool.query(
      `SELECT COUNT(*)::int AS n FROM scheduled_shares WHERE creator_handle = $1 AND status = 'pending'`,
      [handle]
    );
    if (pending.rows[0].n >= 20) return res.status(429).json({ error: 'Max 20 pending scheduled shares' });
    const shareUrl = `https://scangym.com/r/${handle}?src=${plat}`;
    const result = await pool.query(
      `INSERT INTO scheduled_shares (creator_handle, platform, caption, share_url, scheduled_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [handle, plat, String(caption || '').slice(0, 2000), shareUrl, when.toISOString()]
    );
    res.json({ success: true, share: result.rows[0] });
  } catch (err) {
    console.error('[CreatorDistribution] schedule error:', err.message);
    res.status(500).json({ error: 'Failed to schedule share' });
  }
});

router.get('/schedule/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const shares = await pool.query(
      `SELECT * FROM scheduled_shares
       WHERE creator_handle = $1 AND (status = 'pending' OR created_at > NOW() - INTERVAL '14 days')
       ORDER BY status = 'pending' DESC, scheduled_at ASC LIMIT 40`,
      [handle]
    );
    // Best-time suggestion from this creator's own click history
    let bestHour = 18, bestDow = 7; // sensible defaults: Sunday 6pm
    try {
      const hour = await pool.query(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/London')::int AS h, COUNT(*)::int AS n
         FROM creator_referrals WHERE creator_handle = $1 GROUP BY 1 ORDER BY n DESC LIMIT 1`,
        [handle]
      );
      const dow = await pool.query(
        `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'Europe/London')::int AS d, COUNT(*)::int AS n
         FROM creator_referrals WHERE creator_handle = $1 GROUP BY 1 ORDER BY n DESC LIMIT 1`,
        [handle]
      );
      if (hour.rows[0] && hour.rows[0].n > 2) bestHour = hour.rows[0].h;
      if (dow.rows[0] && dow.rows[0].n > 2) bestDow = dow.rows[0].d;
    } catch (e) { /* keep defaults */ }
    res.json({ handle, shares: shares.rows, bestTime: { hour: bestHour, isoWeekday: bestDow } });
  } catch (err) {
    console.error('[CreatorDistribution] schedule list error:', err.message);
    res.status(500).json({ error: 'Failed to load schedule' });
  }
});

router.post('/schedule/:id/:action(cancel|done)', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { handle } = req.body || {};
    if (!id || !handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid request' });
    const status = req.params.action === 'cancel' ? 'cancelled' : 'done';
    const result = await pool.query(
      `UPDATE scheduled_shares SET status = $1
       WHERE id = $2 AND creator_handle = $3 AND status = 'pending' RETURNING id`,
      [status, id, handle]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Share not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[CreatorDistribution] schedule update error:', err.message);
    res.status(500).json({ error: 'Failed to update share' });
  }
});

// ── Followers + Announcements (Notify Followers) ────────────────

router.post('/follow', async (req, res) => {
  try {
    const { handle, session } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const sess = String(session || '').slice(0, 200);
    if (!sess) return res.status(400).json({ error: 'session required' });
    await pool.query(
      `INSERT INTO creator_followers (creator_handle, follower_session)
       VALUES ($1, $2) ON CONFLICT (creator_handle, follower_session) DO NOTHING`,
      [handle, sess]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[CreatorDistribution] follow error:', err.message);
    res.status(500).json({ error: 'Failed to follow' });
  }
});

router.get('/followers/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::int AS count FROM creator_followers WHERE creator_handle = $1`,
      [handle]
    );
    res.json({ handle, count: result.rows[0].count });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load followers' });
  }
});

router.post('/announce', async (req, res) => {
  try {
    const { handle, message } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const msg = String(message || '').trim().slice(0, 500);
    if (msg.length < 3) return res.status(400).json({ error: 'Message too short' });
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM creator_announcements
       WHERE creator_handle = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [handle]
    );
    if (recent.rows[0].n >= 1) return res.status(429).json({ error: 'You can notify followers once per hour' });
    const result = await pool.query(
      `INSERT INTO creator_announcements (creator_handle, message) VALUES ($1, $2) RETURNING *`,
      [handle, msg]
    );
    const followers = await pool.query(
      `SELECT COUNT(*)::int AS count FROM creator_followers WHERE creator_handle = $1`,
      [handle]
    );
    res.json({ success: true, announcement: result.rows[0], notified: followers.rows[0].count });
  } catch (err) {
    console.error('[CreatorDistribution] announce error:', err.message);
    res.status(500).json({ error: 'Failed to send announcement' });
  }
});

router.get('/announcements/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const result = await pool.query(
      `SELECT id, message, created_at FROM creator_announcements
       WHERE creator_handle = $1 ORDER BY created_at DESC LIMIT 3`,
      [handle]
    );
    res.json({ handle, announcements: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load announcements' });
  }
});

module.exports = router;
