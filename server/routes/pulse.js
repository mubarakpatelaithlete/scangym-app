/**
 * Kill-X (owner, 2026-10-03): Pulse — X/Twitter-style public text posts.
 *
 *   GET  /api/pulse?since=ID&before=ID&tag=word   newest first, with counts
 *   POST /api/pulse                               { body, gym_id }  (signed in)
 *   GET  /api/pulse/trending                      top #tags of the last 24h
 *
 * Likes, replies and reposts go through /api/reels/social/pulse:<id>/...
 * (same tables as reels). Reading is open; posting needs a signed-in user.
 */
const express = require('express');
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '8kb' }));

const MAX_BODY = 280;
const PAGE = 30;
const TAG_RE = /#([a-z0-9_]{2,30})/gi;

function cleanBody(raw) {
  return String(raw || '').replace(/\s+\n/g, '\n').trim().slice(0, MAX_BODY);
}
function tagsOf(text) {
  const out = new Set();
  String(text || '').replace(TAG_RE, (_, t) => { out.add(t.toLowerCase()); return _; });
  return [...out];
}
function topTags(bodies, n = 8) {
  const c = new Map();
  for (const b of bodies) for (const t of tagsOf(b)) c.set(t, (c.get(t) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n).map(([tag, posts]) => ({ tag, posts }));
}
function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

router.get('/', optionalAuth, async (req, res) => {
  const since = intOrNull(req.query.since);
  const before = intOrNull(req.query.before);
  const tag = String(req.query.tag || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 30);
  const uid = req.user ? String(req.user.id) : '';
  const where = ['p.deleted_at IS NULL'];
  const args = [uid];
  if (since) { args.push(since); where.push(`p.id > $${args.length}`); }
  if (before) { args.push(before); where.push(`p.id < $${args.length}`); }
  if (tag) { args.push(`#${tag}`); where.push(`p.body ILIKE '%' || $${args.length} || '%'`); }
  try {
    const q = await pool.query(
      `SELECT p.id, p.user_name, p.body, p.created_at, p.gym_id, g.name AS gym_name,
              (SELECT COUNT(*) FROM reel_likes l WHERE l.reel_id = 'pulse:' || p.id)::int AS likes,
              (SELECT COUNT(*) FROM reel_comments c WHERE c.reel_id = 'pulse:' || p.id AND c.deleted_at IS NULL)::int AS replies,
              (SELECT COUNT(*) FROM reel_reposts r WHERE r.reel_id = 'pulse:' || p.id)::int AS reposts,
              EXISTS (SELECT 1 FROM reel_likes l WHERE l.reel_id = 'pulse:' || p.id AND l.user_id = $1) AS liked,
              EXISTS (SELECT 1 FROM reel_reposts r WHERE r.reel_id = 'pulse:' || p.id AND r.user_id = $1) AS reposted
         FROM pulse_posts p LEFT JOIN gyms g ON g.id = p.gym_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.id DESC LIMIT ${PAGE}`,
      args
    );
    res.json({
      signedIn: !!req.user,
      posts: q.rows.map(r => ({
        id: String(r.id), key: 'pulse:' + r.id, name: r.user_name || 'ScanGym member',
        body: r.body, at: r.created_at,
        gym: r.gym_id ? { id: r.gym_id, name: r.gym_name || 'this gym' } : null,
        likes: r.likes, replies: r.replies, reposts: r.reposts,
        liked: !!r.liked, reposted: !!r.reposted,
      })),
    });
  } catch (e) {
    console.error('[pulse] list:', e.message);
    res.status(500).json({ error: 'Could not load Pulse' });
  }
});

router.get('/trending', async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT body FROM pulse_posts WHERE deleted_at IS NULL
          AND created_at > NOW() - INTERVAL '24 hours' AND body LIKE '%#%' LIMIT 2000`
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ trending: topTags(q.rows.map(r => r.body)) });
  } catch (e) {
    console.error('[pulse] trending:', e.message);
    res.status(500).json({ error: 'Could not load trending' });
  }
});

router.post('/', authenticateUser, async (req, res) => {
  const body = cleanBody(req.body && req.body.body);
  if (!body) return res.status(400).json({ error: 'Write something first' });
  const gymId = intOrNull(req.body && req.body.gym_id);
  const name = req.user.first_name || (req.user.name || '').split(' ')[0] || 'ScanGym member';
  try {
    const q = await pool.query(
      `INSERT INTO pulse_posts (user_id, user_name, body, gym_id) VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [String(req.user.id), name, body, gymId]
    );
    const id = String(q.rows[0].id);
    res.json({ ok: true, post: { id, key: 'pulse:' + id, name, body, at: q.rows[0].created_at,
      gym: gymId ? { id: gymId } : null, likes: 0, replies: 0, reposts: 0, liked: false, reposted: false } });
  } catch (e) {
    console.error('[pulse] post:', e.message);
    res.status(500).json({ error: 'Could not post' });
  }
});

module.exports = router;
module.exports._tagsOf = tagsOf;
module.exports._topTags = topTags;
module.exports._cleanBody = cleanBody;
