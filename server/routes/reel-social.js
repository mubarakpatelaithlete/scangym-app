/**
 * Task 52 (owner, 2026-09-30): Like / Comment / Save / Share / Repost on the
 * Home tab, like TikTok. Save and Share already existed (reels/index.html);
 * this is the server side of the other three.
 *
 *   GET  /api/reels/social/state?ids=a,b,c   counts + whether *you* liked/reposted
 *   POST /api/reels/social/:id/like          { on: true|false }
 *   POST /api/reels/social/:id/repost        { on: true|false }
 *   GET  /api/reels/social/:id/comments      newest first
 *   POST /api/reels/social/:id/comments      { body }
 *
 * Reading is open to everyone; writing needs a signed-in customer (the reels
 * frame asks the app to show its sign-in sheet on a 401). Tables live in
 * migrations/20260930c_reel_social.sql.
 */
const express = require('express');
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '16kb' }));

const MAX_IDS = 60;
const MAX_BODY = 500;

function reelId(raw) {
  const id = String(raw || '').trim();
  return id && id.length <= 160 ? id : null;
}

async function countsFor(ids, userId) {
  const out = {};
  for (const id of ids) out[id] = { likes: 0, comments: 0, reposts: 0, liked: false, reposted: false };
  if (!ids.length) return out;
  const q = await pool.query(
    `SELECT r.id,
            (SELECT COUNT(*) FROM reel_likes l WHERE l.reel_id = r.id)::int AS likes,
            (SELECT COUNT(*) FROM reel_comments c WHERE c.reel_id = r.id AND c.deleted_at IS NULL)::int AS comments,
            (SELECT COUNT(*) FROM reel_reposts p WHERE p.reel_id = r.id)::int AS reposts,
            EXISTS (SELECT 1 FROM reel_likes l WHERE l.reel_id = r.id AND l.user_id = $2) AS liked,
            EXISTS (SELECT 1 FROM reel_reposts p WHERE p.reel_id = r.id AND p.user_id = $2) AS reposted
       FROM unnest($1::text[]) AS r(id)`,
    [ids, userId ? String(userId) : '']
  );
  for (const row of q.rows) out[row.id] = {
    likes: row.likes, comments: row.comments, reposts: row.reposts,
    liked: !!row.liked, reposted: !!row.reposted,
  };
  return out;
}

router.get('/state', optionalAuth, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(reelId).filter(Boolean).slice(0, MAX_IDS);
  try {
    res.json({ signedIn: !!req.user, items: await countsFor(ids, req.user && req.user.id) });
  } catch (e) {
    console.error('[reel-social] state:', e.message);
    res.status(500).json({ error: 'Could not load counts' });
  }
});

function toggle(table) {
  return async (req, res) => {
    const id = reelId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Bad reel id' });
    const on = !(req.body && req.body.on === false);
    const uid = String(req.user.id);
    try {
      if (on) {
        await pool.query(`INSERT INTO ${table} (reel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, uid]);
      } else {
        await pool.query(`DELETE FROM ${table} WHERE reel_id = $1 AND user_id = $2`, [id, uid]);
      }
      res.json({ ok: true, ...(await countsFor([id], uid))[id] });
    } catch (e) {
      console.error(`[reel-social] ${table}:`, e.message);
      res.status(500).json({ error: 'Could not save' });
    }
  };
}
router.post('/:id/like', authenticateUser, toggle('reel_likes'));
router.post('/:id/repost', authenticateUser, toggle('reel_reposts'));

router.get('/:id/comments', async (req, res) => {
  const id = reelId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad reel id' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
  try {
    const q = await pool.query(
      `SELECT id, user_name, body, created_at FROM reel_comments
        WHERE reel_id = $1 AND deleted_at IS NULL ORDER BY id DESC LIMIT $2`,
      [id, limit]
    );
    res.json({ comments: q.rows.map(r => ({ id: String(r.id), name: r.user_name || 'ScanGym member', body: r.body, at: r.created_at })) });
  } catch (e) {
    console.error('[reel-social] comments:', e.message);
    res.status(500).json({ error: 'Could not load comments' });
  }
});

router.post('/:id/comments', authenticateUser, async (req, res) => {
  const id = reelId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Bad reel id' });
  const body = String((req.body && req.body.body) || '').trim().slice(0, MAX_BODY);
  if (!body) return res.status(400).json({ error: 'Write something first' });
  const name = req.user.first_name || (req.user.name || '').split(' ')[0] || 'ScanGym member';
  try {
    const q = await pool.query(
      `INSERT INTO reel_comments (reel_id, user_id, user_name, body) VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [id, String(req.user.id), name, body]
    );
    res.json({ ok: true, comment: { id: String(q.rows[0].id), name, body, at: q.rows[0].created_at } });
  } catch (e) {
    console.error('[reel-social] add comment:', e.message);
    res.status(500).json({ error: 'Could not post comment' });
  }
});

module.exports = router;
