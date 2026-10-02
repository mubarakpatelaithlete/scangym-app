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
 *   GET  /api/reels/social/follows           creators you follow (Task 64)
 *   POST /api/reels/social/follow            { creator, on }
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

/* Task 64 (owner, 2026-10-01): a creator photo + Follow on every reel, as on
 * TikTok. `creator` is the feed's creator key: a ScanSquad handle, a YouTube
 * channel name, or "scangym" for our own reels. */
function creatorKey(raw) {
  const k = String(raw || '').trim().toLowerCase().slice(0, 120);
  return k || null;
}
router.get('/follows', optionalAuth, async (req, res) => {
  if (!req.user) return res.json({ signedIn: false, creators: [] });
  try {
    const q = await pool.query('SELECT creator FROM reel_follows WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500', [String(req.user.id)]);
    res.json({ signedIn: true, creators: q.rows.map(r => r.creator) });
  } catch (e) {
    console.error('[reel-social] follows:', e.message);
    res.status(500).json({ error: 'Could not load follows' });
  }
});
router.post('/follow', authenticateUser, async (req, res) => {
  const creator = creatorKey(req.body && req.body.creator);
  if (!creator) return res.status(400).json({ error: 'Bad creator' });
  const on = !(req.body && req.body.on === false);
  const uid = String(req.user.id);
  try {
    if (on) await pool.query('INSERT INTO reel_follows (creator, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [creator, uid]);
    else await pool.query('DELETE FROM reel_follows WHERE creator = $1 AND user_id = $2', [creator, uid]);
    res.json({ ok: true, creator, following: on });
  } catch (e) {
    console.error('[reel-social] follow:', e.message);
    res.status(500).json({ error: 'Could not save' });
  }
});

/* Owner 2026-10-02: "I repost but I don't know where it goes" — the list of
   what you reposted, shown in Create as "Your reposts". */
router.get('/my-reposts', authenticateUser, async (req, res) => {
  try {
    const q = await pool.query('SELECT reel_id, created_at FROM reel_reposts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 60', [String(req.user.id)]);
    res.json({ reposts: q.rows.map((r) => ({ id: r.reel_id, at: r.created_at })) });
  } catch (e) {
    console.error('[reel-social] my-reposts:', e.message);
    res.json({ reposts: [], degraded: true });
  }
});

/* Task 154 Profile 1: follower count for the Profile top section. */
router.get('/me-stats', authenticateUser, async (req, res) => {
  try {
    const u = await pool.query('SELECT referral_handle FROM public.users WHERE id = $1', [req.user.id]);
    const h = creatorKey(u.rows[0] && u.rows[0].referral_handle);
    let followers = 0;
    if (h) {
      const c = await pool.query('SELECT COUNT(DISTINCT user_id)::int AS n FROM reel_follows WHERE creator = ANY($1)', [[h, '@' + h]]);
      followers = (c.rows[0] && c.rows[0].n) || 0;
    }
    res.json({ handle: h, followers });
  } catch (e) {
    console.error('[reel-social] me-stats:', e.message);
    res.json({ handle: null, followers: 0, degraded: true });
  }
});

module.exports = router;
