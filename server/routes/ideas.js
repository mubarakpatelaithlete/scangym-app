/**
 * Kill-Pinterest (owner, 2026-10-03): Ideas — calm, searchable grid of reels
 * you save into named boards and act on later (workouts, recipes, gyms, gear).
 *
 *   GET    /api/ideas/search?q=word&offset=N   grid of ideas (open to all)
 *   GET    /api/ideas/boards                   my boards + pin counts (signed in)
 *   POST   /api/ideas/boards   { name }        create (or reuse) a board
 *   POST   /api/ideas/pin      { video_id, board_id | board_name }
 *   DELETE /api/ideas/pin      { video_id, board_id }
 *   GET    /api/ideas/boards/:id               a board's pins (public, shareable)
 */
const express = require('express');
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '4kb' }));

const PAGE = 40;

function cleanName(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 40);
}
function poster(row) {
  if (row.cdn_key) return '/api/reels/poster/' + encodeURIComponent(row.cdn_key);
  return row.thumb || null;
}
function toIdea(r) {
  return { id: r.id, name: r.name, category: r.category, poster: poster(r),
    gymId: r.gym_id || null, shopProductId: r.shop_product_id || null };
}
function intOrNull(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const COLS = 'v.id, v.name, v.category, v.cdn_key, v.thumb, v.gym_id, v.shop_product_id';

router.get('/search', optionalAuth, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const offset = Math.min(parseInt(req.query.offset, 10) || 0, 2000);
  const args = [];
  let where = 'v.active = true AND (v.cdn_key IS NOT NULL OR v.thumb IS NOT NULL)';
  if (q) { args.push('%' + q + '%'); where += ` AND (v.name ILIKE $1 OR v.category ILIKE $1)`; }
  try {
    const r = await pool.query(
      `SELECT ${COLS} FROM video_catalog v WHERE ${where}
        ORDER BY v.dopamine_tier ASC NULLS LAST, v.id DESC LIMIT ${PAGE} OFFSET ${offset}`, args);
    res.json({ q, ideas: r.rows.map(toIdea), more: r.rows.length === PAGE });
  } catch (e) {
    console.error('[ideas] search:', e.message);
    res.status(500).json({ error: 'Could not load ideas' });
  }
});

router.get('/boards', authenticateUser, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.id, b.name, COUNT(p.video_id)::int AS pins,
              (SELECT v.cdn_key FROM idea_pins p2 JOIN video_catalog v ON v.id = p2.video_id
                WHERE p2.board_id = b.id ORDER BY p2.created_at DESC LIMIT 1) AS cover
         FROM idea_boards b LEFT JOIN idea_pins p ON p.board_id = b.id
        WHERE b.user_id = $1 GROUP BY b.id ORDER BY MAX(p.created_at) DESC NULLS LAST, b.id DESC`,
      [String(req.user.id)]);
    res.json({ boards: r.rows.map(b => ({ id: String(b.id), name: b.name, pins: b.pins,
      cover: b.cover ? '/api/reels/poster/' + encodeURIComponent(b.cover) : null })) });
  } catch (e) {
    console.error('[ideas] boards:', e.message);
    res.status(500).json({ error: 'Could not load boards' });
  }
});

async function boardFor(userId, name) {
  const r = await pool.query(
    `INSERT INTO idea_boards (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = idea_boards.name
     RETURNING id, name`, [userId, name]);
  return r.rows[0];
}

router.post('/boards', authenticateUser, async (req, res) => {
  const name = cleanName(req.body && req.body.name);
  if (!name) return res.status(400).json({ error: 'Board name required' });
  try {
    const b = await boardFor(String(req.user.id), name);
    res.json({ board: { id: String(b.id), name: b.name } });
  } catch (e) {
    console.error('[ideas] board create:', e.message);
    res.status(500).json({ error: 'Could not create board' });
  }
});

router.post('/pin', authenticateUser, async (req, res) => {
  const uid = String(req.user.id);
  const body = req.body || {};
  const videoId = intOrNull(body.video_id);
  if (!videoId) return res.status(400).json({ error: 'video_id required' });
  try {
    let board;
    const bid = intOrNull(body.board_id);
    if (bid) {
      const r = await pool.query('SELECT id, name FROM idea_boards WHERE id = $1 AND user_id = $2', [bid, uid]);
      board = r.rows[0];
      if (!board) return res.status(404).json({ error: 'Board not found' });
    } else {
      board = await boardFor(uid, cleanName(body.board_name) || 'Saved ideas');
    }
    await pool.query('INSERT INTO idea_pins (board_id, video_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [board.id, videoId]);
    res.json({ ok: true, board: { id: String(board.id), name: board.name } });
  } catch (e) {
    console.error('[ideas] pin:', e.message);
    res.status(500).json({ error: 'Could not save' });
  }
});

router.delete('/pin', authenticateUser, async (req, res) => {
  const body = req.body || {};
  const videoId = intOrNull(body.video_id), bid = intOrNull(body.board_id);
  if (!videoId || !bid) return res.status(400).json({ error: 'video_id and board_id required' });
  try {
    await pool.query(
      `DELETE FROM idea_pins p USING idea_boards b
        WHERE p.board_id = b.id AND b.id = $1 AND b.user_id = $2 AND p.video_id = $3`,
      [bid, String(req.user.id), videoId]);
    res.json({ ok: true });
  } catch (e) {
    console.error('[ideas] unpin:', e.message);
    res.status(500).json({ error: 'Could not remove' });
  }
});

router.get('/boards/:id', optionalAuth, async (req, res) => {
  const bid = intOrNull(req.params.id);
  if (!bid) return res.status(404).json({ error: 'Board not found' });
  try {
    const b = await pool.query('SELECT id, name, user_id FROM idea_boards WHERE id = $1', [bid]);
    if (!b.rows[0]) return res.status(404).json({ error: 'Board not found' });
    const r = await pool.query(
      `SELECT ${COLS} FROM idea_pins p JOIN video_catalog v ON v.id = p.video_id
        WHERE p.board_id = $1 ORDER BY p.created_at DESC LIMIT 200`, [bid]);
    res.json({ board: { id: String(bid), name: b.rows[0].name,
      mine: !!req.user && String(req.user.id) === String(b.rows[0].user_id) },
      ideas: r.rows.map(toIdea) });
  } catch (e) {
    console.error('[ideas] board:', e.message);
    res.status(500).json({ error: 'Could not load board' });
  }
});

module.exports = router;
module.exports._cleanName = cleanName;
module.exports._poster = poster;
module.exports._toIdea = toIdea;
