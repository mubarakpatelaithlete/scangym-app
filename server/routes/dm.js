/**
 * Chats tab (Task 11, step 1) — WhatsApp-style 1:1 messaging.
 *
 *   GET    /api/dm/me                       who am I (401 when signed out)
 *   GET    /api/dm/threads                  chat list: last message, unread, presence
 *   POST   /api/dm/threads {userId}         open (or create) a chat with someone
 *   GET    /api/dm/threads/:id/messages?after=<id>   new messages; marks them read
 *   POST   /api/dm/threads/:id/messages {body}
 *   POST   /api/dm/threads/:id/typing       "typing…" for 5s
 *   DELETE /api/dm/messages/:id             delete for everyone (sender only)
 *   PATCH  /api/dm/messages/:id {body}      edit (sender only, 15 min, text only)
 *   POST   /api/dm/messages/:id/react {emoji}  react / change / remove ('' removes)
 *   GET    /api/dm/business                 my greeting / away messages
 *   PUT    /api/dm/business {greeting, greetingOn, away, awayOn}
 *   GET    /api/dm/users?q=                 find people by name / email / phone
 *   POST   /api/dm/invite {phone}           SMS invite via Twilio
 *
 * Delivery is short polling (2s while a chat is open). That is what the single
 * Railway process can carry with no new infrastructure; a websocket can replace
 * it later without changing these endpoints.
 * Tables: migrations/20260930b_dm_chats.sql.
 */
const express = require('express');
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '32kb' }));
router.use(authenticateUser);

const ONLINE_MS = 30 * 1000;
const typing = new Map(); // `${threadId}:${userId}` -> expiry ms
const sendBuckets = new Map(); // userId -> { start, count }

const me = (req) => String(req.user.id);
const displayName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || (u.email ? String(u.email).split('@')[0] : 'ScanGym user');

// Every authenticated call counts as "seen".
router.use((req, res, next) => {
  pool.query(
    `INSERT INTO dm_presence (user_id, last_seen) VALUES ($1, NOW())
     ON CONFLICT (user_id) DO UPDATE SET last_seen = NOW()`, [me(req)]).catch(() => {});
  next();
});

function presence(lastSeen) {
  if (!lastSeen) return { online: false, lastSeen: null };
  const t = new Date(lastSeen).getTime();
  return { online: Date.now() - t < ONLINE_MS, lastSeen: new Date(t).toISOString() };
}

// Reactions are stored {userId: emoji}; the client gets counts + my own pick.
function extras(m, uid) {
  const r = (m && m.reactions) || {};
  const counts = {};
  Object.keys(r).forEach((k) => { counts[r[k]] = (counts[r[k]] || 0) + 1; });
  return { edited: !!(m && m.edited_at), reactions: counts, myReaction: r[uid] || '' };
}
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\uFE0F|\u200D|[\u{1F3FB}-\u{1F3FF}]){1,8}$/u;
const EDIT_MS = 15 * 60 * 1000;

async function threadFor(req, id) {
  const { rows: [t] } = await pool.query(
    `SELECT * FROM dm_threads t WHERE id=$1 AND (user_a=$2 OR user_b=$2 OR (user_a='grp' AND ${groups.MEMBER_SQL}))`, [parseInt(id, 10) || 0, me(req)]);
  return t || null;
}

// Task 154 Chats 4: groups (dm-groups.js).
const groups = require('./dm-groups');
groups.mount(router, { me });

// Task 11 step 2: voice & video calls (WebRTC signalling).
require('./dm-calls').mount(router, { me, threadFor, displayName });

router.get('/me', (req, res) => res.json({ id: me(req), name: req.user.name || displayName(req.user) }));

router.get('/threads', async (req, res) => {
  try {
    const uid = me(req);
    const { rows } = await pool.query(`
      SELECT t.id, t.last_message_at,
             CASE WHEN t.user_a=$1 THEN t.user_b ELSE t.user_a END AS other_id,
             u.first_name, u.last_name, u.email, p.last_seen,
             lm.body AS last_body, lm.sender_id AS last_sender, lm.read_at AS last_read, lm.deleted_at AS last_deleted,
             (SELECT COUNT(*)::int FROM dm_messages m WHERE m.thread_id=t.id AND m.sender_id<>$1 AND m.read_at IS NULL AND m.deleted_at IS NULL) AS unread
      FROM dm_threads t
      LEFT JOIN users u ON u.id::text = CASE WHEN t.user_a=$1 THEN t.user_b ELSE t.user_a END
      LEFT JOIN dm_presence p ON p.user_id = CASE WHEN t.user_a=$1 THEN t.user_b ELSE t.user_a END
      LEFT JOIN LATERAL (SELECT body, sender_id, read_at, deleted_at FROM dm_messages WHERE thread_id=t.id ORDER BY id DESC LIMIT 1) lm ON true
      WHERE t.user_a=$1 OR t.user_b=$1
      ORDER BY t.last_message_at DESC LIMIT 200`, [uid]);
    // Anything I fetch in my list has reached my device: mark delivered.
    pool.query(`UPDATE dm_messages SET delivered_at=NOW() WHERE delivered_at IS NULL AND sender_id<>$1
                AND thread_id IN (SELECT id FROM dm_threads WHERE user_a=$1 OR user_b=$1)`, [uid]).catch(() => {});
    let grp = [];
    try { grp = await groups.listFor(uid); } catch (e) { console.error('[dm] groups list', e.message); }
    res.json({ threads: grp.concat(rows.filter((r) => r.other_id && !/^grp/.test(String(r.other_id))).map((r) => ({
      id: r.id, otherId: r.other_id, name: displayName(r), ...presence(r.last_seen),
      lastMessage: r.last_deleted ? 'This message was deleted' : (r.last_body || ''),
      lastFromMe: r.last_sender === uid, lastRead: !!r.last_read,
      lastMessageAt: r.last_message_at, unread: r.unread,
    }))).sort((x, y) => new Date(y.lastMessageAt) - new Date(x.lastMessageAt)) });
  } catch (e) { console.error('[dm] threads', e.message); res.status(500).json({ error: 'Could not load chats' }); }
});

router.post('/threads', async (req, res) => {
  try {
    const uid = me(req);
    const other = String((req.body || {}).userId || '').slice(0, 64);
    if (!other || other === uid) return res.status(400).json({ error: 'Pick someone to chat with' });
    const { rows: [u] } = await pool.query('SELECT id FROM users WHERE id::text=$1', [other]);
    if (!u) return res.status(404).json({ error: 'User not found' });
    const [a, b] = [uid, other].sort();
    const { rows: [t] } = await pool.query(
      `INSERT INTO dm_threads (user_a, user_b) VALUES ($1,$2)
       ON CONFLICT (user_a, user_b) DO UPDATE SET user_a=EXCLUDED.user_a RETURNING id`, [a, b]);
    res.json({ id: t.id });
  } catch (e) { console.error('[dm] open', e.message); res.status(500).json({ error: 'Could not open chat' }); }
});

router.get('/threads/:id/messages', async (req, res) => {
  try {
    const uid = me(req);
    const t = await threadFor(req, req.params.id);
    if (!t) return res.status(404).json({ error: 'Chat not found' });
    const after = parseInt(req.query.after, 10) || 0;
    if (t.user_a === 'grp') {
      const g = await groups.groupForThread(t.id);
      if (!g) return res.status(404).json({ error: 'Chat not found' });
      return res.json(await groups.messagesFor(t, g, uid, after, displayName, extras));
    }
    const otherId = t.user_a === uid ? t.user_b : t.user_a;
    await pool.query(
      `UPDATE dm_messages SET read_at=NOW(), delivered_at=COALESCE(delivered_at, NOW())
       WHERE thread_id=$1 AND sender_id<>$2 AND read_at IS NULL`, [t.id, uid]);
    const { rows } = await pool.query(
      `SELECT id, sender_id, body, created_at, delivered_at, read_at, deleted_at, edited_at, reactions FROM dm_messages
       WHERE thread_id=$1 AND id>$2 ORDER BY id DESC LIMIT 200`, [t.id, after]);
    // Edits and reactions change older messages too: send the latest 50 of both people.
    const { rows: recent } = await pool.query(
      `SELECT id, sender_id, body, deleted_at, edited_at, reactions FROM dm_messages WHERE thread_id=$1
       ORDER BY id DESC LIMIT 50`, [t.id]);
    // Ticks change on old messages too, so return the status of my recent sent ones.
    const { rows: ticks } = await pool.query(
      `SELECT id, delivered_at, read_at, deleted_at FROM dm_messages WHERE thread_id=$1 AND sender_id=$2
       ORDER BY id DESC LIMIT 50`, [t.id, uid]);
    const { rows: [o] } = await pool.query(
      `SELECT u.first_name, u.last_name, u.email, p.last_seen FROM users u
       LEFT JOIN dm_presence p ON p.user_id=u.id::text WHERE u.id::text=$1`, [otherId]);
    res.json({
      other: { id: otherId, name: o ? displayName(o) : 'ScanGym user', ...presence(o && o.last_seen),
               typing: (typing.get(`${t.id}:${otherId}`) || 0) > Date.now() },
      messages: rows.reverse().map((m) => ({
        id: Number(m.id), mine: m.sender_id === uid, body: m.deleted_at ? '' : m.body, deleted: !!m.deleted_at,
        at: m.created_at, delivered: !!m.delivered_at, read: !!m.read_at, ...extras(m, uid),
      })),
      recent: recent.map((m) => ({ id: Number(m.id), deleted: !!m.deleted_at, body: m.deleted_at ? '' : m.body, ...extras(m, uid) })),
      ticks: ticks.map((m) => ({ id: Number(m.id), delivered: !!m.delivered_at, read: !!m.read_at, deleted: !!m.deleted_at })),
    });
  } catch (e) { console.error('[dm] messages', e.message); res.status(500).json({ error: 'Could not load messages' }); }
});

router.post('/threads/:id/messages', async (req, res) => {
  try {
    const uid = me(req);
    const body = String((req.body || {}).body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'Message is empty' });
    const now = Date.now(); const b = sendBuckets.get(uid);
    if (!b || now - b.start > 60000) sendBuckets.set(uid, { start: now, count: 1 });
    else if (++b.count > 60) return res.status(429).json({ error: 'Slow down — too many messages' });
    const t = await threadFor(req, req.params.id);
    if (!t) return res.status(404).json({ error: 'Chat not found' });
    const { rows: [m] } = await pool.query(
      'INSERT INTO dm_messages (thread_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, created_at', [t.id, uid, body]);
    await pool.query('UPDATE dm_threads SET last_message_at=NOW() WHERE id=$1', [t.id]);
    typing.delete(`${t.id}:${uid}`);
    res.status(201).json({ id: Number(m.id), at: m.created_at });
    if (t.user_a !== 'grp') autoReply(t.id, t.user_a === uid ? t.user_b : t.user_a).catch((e) => console.error('[dm] auto-reply', e.message));
  } catch (e) { console.error('[dm] send', e.message); res.status(500).json({ error: 'Could not send' }); }
});

/* Task 24: WhatsApp-style attachments (photo, video, document, audio).
   Files sit on the Railway volume next to review media; the name is random
   and the file is only served to signed-in users. The message body carries
   "📎 <url>|<original name>" so no table change is needed. */
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const DM_DIR = process.env.RAILWAY_ENVIRONMENT ? '/data/uploads/dm' : path.join(__dirname, '..', 'uploads', 'dm');
const DM_FILE_RE = /^dm_\d+_[a-f0-9]{16}\.[a-z0-9]{1,5}$/;
const dmUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => { try { fs.mkdirSync(DM_DIR, { recursive: true }); } catch (e) {} cb(null, DM_DIR); },
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || '.bin').slice(0, 6);
      cb(null, `dm_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/|video\/|audio\/|application\/pdf|text\/plain|application\/(msword|vnd\.openxmlformats))/i.test(file.mimetype || '');
    cb(ok ? null : new Error('That file type cannot be sent'), ok);
  },
});

router.post('/threads/:id/upload', (req, res) => {
  dmUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    try {
      if (!req.file) return res.status(400).json({ error: 'No file' });
      const t = await threadFor(req, req.params.id);
      if (!t) { fs.unlink(req.file.path, () => {}); return res.status(404).json({ error: 'Chat not found' }); }
      const name = String(req.file.originalname || 'file').replace(/[|\n\r]/g, ' ').slice(0, 120);
      const body = `📎 /api/dm/file/${req.file.filename}|${name}`;
      const { rows: [m] } = await pool.query(
        'INSERT INTO dm_messages (thread_id, sender_id, body) VALUES ($1,$2,$3) RETURNING id, created_at', [t.id, me(req), body]);
      await pool.query('UPDATE dm_threads SET last_message_at=NOW() WHERE id=$1', [t.id]);
      res.status(201).json({ id: Number(m.id), at: m.created_at, body });
    } catch (e) { console.error('[dm] upload', e.message); res.status(500).json({ error: 'Could not send' }); }
  });
});

router.get('/file/:name', (req, res) => {
  if (!DM_FILE_RE.test(req.params.name)) return res.status(400).json({ error: 'Invalid file' });
  const fp = path.join(DM_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(fp);
});

router.post('/threads/:id/typing', async (req, res) => {
  const t = await threadFor(req, req.params.id).catch(() => null);
  if (!t) return res.status(404).json({ error: 'Chat not found' });
  typing.set(`${t.id}:${me(req)}`, Date.now() + 5000);
  res.json({ ok: true });
});

router.delete('/messages/:id', async (req, res) => {
  try {
    const r = await pool.query(
      'UPDATE dm_messages SET deleted_at=NOW() WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL',
      [parseInt(req.params.id, 10) || 0, me(req)]);
    if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });
    res.json({ deleted: true });
  } catch (e) { res.status(500).json({ error: 'Could not delete' }); }
});

/* Task 107 batch 2 — WhatsApp Business: a greeting the first time someone
   messages you, and an away message (at most once an hour per chat). Sent as
   the owner, so it appears in the chat exactly like a normal reply. */
const AWAY_GAP_MS = 60 * 60 * 1000;
async function autoReply(threadId, ownerId) {
  const { rows: [b] } = await pool.query('SELECT * FROM dm_business WHERE user_id=$1', [ownerId]);
  if (!b) return null;
  const said = async (body, sinceMs) => {
    const { rows } = await pool.query(
      `SELECT 1 FROM dm_messages WHERE thread_id=$1 AND sender_id=$2 ${body ? 'AND body=$3' : ''}
       ${sinceMs ? `AND created_at > NOW() - INTERVAL '${Math.round(sinceMs / 1000)} seconds'` : ''} LIMIT 1`,
      body ? [threadId, ownerId, body] : [threadId, ownerId]);
    return rows.length > 0;
  };
  let text = null;
  if (b.greeting_on && b.greeting && !(await said(null, 0))) text = b.greeting;
  else if (b.away_on && b.away && !(await said(b.away, AWAY_GAP_MS))) text = b.away;
  if (!text) return null;
  await pool.query('INSERT INTO dm_messages (thread_id, sender_id, body) VALUES ($1,$2,$3)', [threadId, ownerId, text]);
  await pool.query('UPDATE dm_threads SET last_message_at=NOW() WHERE id=$1', [threadId]);
  return text;
}

router.get('/business', async (req, res) => {
  try {
    const { rows: [b] } = await pool.query('SELECT * FROM dm_business WHERE user_id=$1', [me(req)]);
    res.json({ greeting: (b && b.greeting) || '', greetingOn: !!(b && b.greeting_on), away: (b && b.away) || '', awayOn: !!(b && b.away_on) });
  } catch (e) { res.status(500).json({ error: 'Could not load' }); }
});

router.put('/business', async (req, res) => {
  try {
    const b = req.body || {};
    const clip = (v) => String(v || '').trim().slice(0, 1000);
    await pool.query(
      `INSERT INTO dm_business (user_id, greeting, greeting_on, away, away_on, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (user_id) DO UPDATE SET greeting=EXCLUDED.greeting, greeting_on=EXCLUDED.greeting_on,
         away=EXCLUDED.away, away_on=EXCLUDED.away_on, updated_at=NOW()`,
      [me(req), clip(b.greeting), !!b.greetingOn && !!clip(b.greeting), clip(b.away), !!b.awayOn && !!clip(b.away)]);
    res.json({ saved: true });
  } catch (e) { res.status(500).json({ error: 'Could not save' }); }
});

router.patch('/messages/:id', async (req, res) => {
  try {
    const body = String((req.body || {}).body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ error: 'Message is empty' });
    const { rows: [m] } = await pool.query(
      'SELECT id, body, created_at FROM dm_messages WHERE id=$1 AND sender_id=$2 AND deleted_at IS NULL',
      [parseInt(req.params.id, 10) || 0, me(req)]);
    if (!m) return res.status(404).json({ error: 'Message not found' });
    if (Date.now() - new Date(m.created_at).getTime() > EDIT_MS) return res.status(403).json({ error: 'Messages can only be edited for 15 minutes' });
    if (String(m.body).indexOf('📎 ') === 0) return res.status(400).json({ error: 'Files cannot be edited' });
    await pool.query('UPDATE dm_messages SET body=$1, edited_at=NOW() WHERE id=$2', [body, m.id]);
    res.json({ edited: true, body });
  } catch (e) { res.status(500).json({ error: 'Could not edit' }); }
});

router.post('/messages/:id/react', async (req, res) => {
  try {
    const uid = me(req);
    const emoji = String((req.body || {}).emoji || '').trim();
    if (emoji && !EMOJI_RE.test(emoji)) return res.status(400).json({ error: 'Pick an emoji' });
    const r = await pool.query(
      `UPDATE dm_messages m SET reactions = CASE WHEN $3 = '' THEN m.reactions - $2::text
                                               ELSE m.reactions || jsonb_build_object($2::text, $3::text) END
       FROM dm_threads t WHERE m.id=$1 AND t.id=m.thread_id AND (t.user_a=$2 OR t.user_b=$2 OR (t.user_a='grp' AND ${groups.MEMBER_SQL})) AND m.deleted_at IS NULL
       RETURNING m.reactions`, [parseInt(req.params.id, 10) || 0, uid, emoji]);
    if (!r.rowCount) return res.status(404).json({ error: 'Message not found' });
    res.json(extras(r.rows[0], uid));
  } catch (e) { console.error('[dm] react', e.message); res.status(500).json({ error: 'Could not react' }); }
});

/* Task 107/118 batch 4: search messages in all my chats (WhatsApp "Search"). */
router.get('/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 60);
    if (q.length < 2) return res.json({ hits: [] });
    const uid = me(req);
    const { rows } = await pool.query(
      `SELECT m.id, m.thread_id, m.body, m.created_at, m.sender_id, t.user_a, t.user_b
         FROM dm_messages m JOIN dm_threads t ON t.id = m.thread_id
        WHERE (t.user_a = $1 OR t.user_b = $1) AND m.deleted_at IS NULL
          AND m.body ILIKE '%' || $2 || '%' AND m.body NOT LIKE '📎 %'
        ORDER BY m.id DESC LIMIT 20`, [uid, q.replace(/[%_\\]/g, (c) => '\\' + c)]);
    res.json({ hits: rows.map((r) => ({ id: Number(r.id), threadId: r.thread_id, body: String(r.body).slice(0, 140), at: r.created_at, mine: r.sender_id === uid })) });
  } catch (e) { console.error('[dm] search', e.message); res.json({ hits: [] }); }
});

router.get('/users', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 80);
    if (q.length < 2) return res.json({ users: [] });
    const digits = q.replace(/\D/g, '');
    const { rows } = await pool.query(`
      SELECT u.id, u.first_name, u.last_name, u.email, p.last_seen FROM users u
      LEFT JOIN dm_presence p ON p.user_id=u.id::text
      WHERE u.id::text<>$1 AND (
        (COALESCE(u.first_name,'') || ' ' || COALESCE(u.last_name,'')) ILIKE $2
        OR LOWER(u.email) = LOWER($3)
        OR ($4 <> '' AND length($4) >= 7 AND regexp_replace(COALESCE(u.phone_number,''), '\\D', '', 'g') LIKE '%' || $4)
      ) ORDER BY p.last_seen DESC NULLS LAST LIMIT 20`,
      [me(req), '%' + q.replace(/[%_]/g, '') + '%', q, digits]);
    // Never return email/phone: only what WhatsApp shows a stranger.
    res.json({ users: rows.map((u) => ({ id: String(u.id), name: displayName(u), ...presence(u.last_seen) })) });
  } catch (e) { console.error('[dm] users', e.message); res.status(500).json({ error: 'Search failed' }); }
});

const inviteBuckets = new Map();
router.post('/invite', async (req, res) => {
  const phone = String((req.body || {}).phone || '').replace(/[^\d+]/g, '');
  if (!/^\+\d{8,15}$/.test(phone)) return res.status(400).json({ error: 'Use international format, e.g. +447700900123' });
  const uid = me(req); const day = new Date().toISOString().slice(0, 10);
  const k = `${uid}:${day}`; const n = (inviteBuckets.get(k) || 0) + 1;
  if (n > 10) return res.status(429).json({ error: 'Invite limit reached for today' });
  inviteBuckets.set(k, n);
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_PHONE_NUMBER: from } = process.env;
  if (!sid || !tok || !from) return res.status(503).json({ error: 'SMS is not set up' });
  const who = req.user.first_name || 'A friend';
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64') },
      body: new URLSearchParams({ To: phone, From: from, Body: `${who} invited you to chat on ScanGym 💬 https://www.scangym.com/chats` }),
    });
    if (!r.ok) return res.status(502).json({ error: 'SMS could not be sent' });
    res.json({ sent: true });
  } catch (e) { res.status(502).json({ error: 'SMS could not be sent' }); }
});

module.exports = router;
module.exports._internals = { autoReply };
