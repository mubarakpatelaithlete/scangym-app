/**
 * Fan Chat — Phase 5 of ScanSquad Creator Empowerment (OnlyFans style).
 *
 * Fans message creators from the creator's /r/ page (auth required,
 * rate-limited). Creators read + reply from a handle-scoped inbox in
 * the Creator Hub (same public-by-handle model as earnings/withdrawals).
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

router.use(express.json());

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fan_messages (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        fan_user_id TEXT NOT NULL,
        direction VARCHAR(10) NOT NULL DEFAULT 'fan',
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fan_messages_thread ON fan_messages(creator_handle, fan_user_id, created_at)`);
    console.log('[FanChat] Tables ready');
  } catch (err) {
    console.error('[FanChat] Table setup error:', err.message);
  }
})();

// Fan → creator
router.post('/send', authenticateUser, async (req, res) => {
  try {
    const { handle } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const msg = String((req.body || {}).message || '').trim().slice(0, 1000);
    if (msg.length < 1) return res.status(400).json({ error: 'Message required' });
    const userId = String(req.user.id);
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS n FROM fan_messages
       WHERE fan_user_id = $1 AND direction = 'fan' AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId]
    );
    if (recent.rows[0].n >= 20) return res.status(429).json({ error: 'Slow down — try again in a bit' });
    const result = await pool.query(
      `INSERT INTO fan_messages (creator_handle, fan_user_id, direction, message)
       VALUES ($1, $2, 'fan', $3) RETURNING *`,
      [handle, userId, msg]
    );
    res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    console.error('[FanChat] send error:', err.message);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Fan's own thread with a creator
router.get('/thread/:handle', authenticateUser, async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const userId = String(req.user.id);
    const msgs = await pool.query(
      `SELECT id, direction, message, created_at FROM fan_messages
       WHERE creator_handle = $1 AND fan_user_id = $2
       ORDER BY created_at ASC LIMIT 100`,
      [handle, userId]
    );
    await pool.query(
      `UPDATE fan_messages SET is_read = true
       WHERE creator_handle = $1 AND fan_user_id = $2 AND direction = 'creator' AND is_read = false`,
      [handle, userId]
    );
    res.json({ handle, messages: msgs.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load messages' });
  }
});

// Creator inbox: one row per fan, latest message + unread count
router.get('/inbox/:handle', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
  try {
    const result = await pool.query(
      `SELECT fm.fan_user_id,
              MAX(fm.created_at) AS last_at,
              (ARRAY_AGG(fm.message ORDER BY fm.created_at DESC))[1] AS last_message,
              COUNT(*) FILTER (WHERE fm.direction = 'fan' AND fm.is_read = false)::int AS unread,
              COALESCE(MAX(u.name), 'Fan') AS fan_name,
              (COUNT(cb.id) > 0) AS via_link
       FROM fan_messages fm
       LEFT JOIN public.users u ON u.id::text = fm.fan_user_id
       LEFT JOIN creator_bounties cb ON cb.user_id = fm.fan_user_id AND cb.creator_handle = fm.creator_handle
       WHERE fm.creator_handle = $1
       GROUP BY fm.fan_user_id
       ORDER BY MAX(fm.created_at) DESC LIMIT 50`,
      [handle]
    );
    res.json({ handle, conversations: result.rows });
  } catch (err) {
    console.error('[FanChat] inbox error:', err.message);
    res.status(500).json({ error: 'Failed to load inbox' });
  }
});

// Creator opens one conversation (marks fan messages read)
router.get('/conversation/:handle/:userId', async (req, res) => {
  const { handle } = req.params;
  const userId = String(req.params.userId || '').slice(0, 100);
  if (!HANDLE_RE.test(handle) || !userId) return res.status(400).json({ error: 'Invalid request' });
  try {
    const msgs = await pool.query(
      `SELECT id, direction, message, created_at FROM fan_messages
       WHERE creator_handle = $1 AND fan_user_id = $2
       ORDER BY created_at ASC LIMIT 100`,
      [handle, userId]
    );
    await pool.query(
      `UPDATE fan_messages SET is_read = true
       WHERE creator_handle = $1 AND fan_user_id = $2 AND direction = 'fan' AND is_read = false`,
      [handle, userId]
    );
    res.json({ handle, userId, messages: msgs.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// Creator → fan
router.post('/reply', async (req, res) => {
  try {
    const { handle, userId } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    const uid = String(userId || '').slice(0, 100);
    const msg = String((req.body || {}).message || '').trim().slice(0, 1000);
    if (!uid || msg.length < 1) return res.status(400).json({ error: 'Message and userId required' });
    // Creator can only reply within an existing thread (fan messaged first)
    const thread = await pool.query(
      `SELECT id FROM fan_messages WHERE creator_handle = $1 AND fan_user_id = $2 LIMIT 1`,
      [handle, uid]
    );
    if (thread.rows.length === 0) return res.status(404).json({ error: 'No conversation with this fan' });
    const result = await pool.query(
      `INSERT INTO fan_messages (creator_handle, fan_user_id, direction, message)
       VALUES ($1, $2, 'creator', $3) RETURNING *`,
      [handle, uid, msg]
    );
    res.json({ success: true, message: result.rows[0] });
  } catch (err) {
    console.error('[FanChat] reply error:', err.message);
    res.status(500).json({ error: 'Failed to reply' });
  }
});

module.exports = router;
