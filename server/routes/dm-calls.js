/**
 * Chats tab — voice & video calls (Task 11 step 2), WhatsApp-style.
 *
 * Proven pattern: WebRTC peer-to-peer media, with a tiny HTTP signalling
 * relay (offer / answer / ICE) held in memory, and ICE servers from Google
 * STUN + Twilio Network Traversal (TURN) when TWILIO_ACCOUNT_SID/AUTH_TOKEN
 * are set, so calls also connect behind strict mobile/corporate NATs.
 * Media never touches our server. Each finished call is written into the
 * chat as a "📞 / 📹 …" message, which is also the Calls tab history.
 *
 * Mounted by dm.js (already authenticated):
 *   GET  /api/dm/ice                     iceServers for RTCPeerConnection
 *   POST /api/dm/threads/:id/call        {kind:'voice'|'video', offer}
 *   GET  /api/dm/calls/incoming          ringing calls for me
 *   GET  /api/dm/calls/log               call history (Calls tab)
 *   GET  /api/dm/calls/:id?since=n       state + the other side's ICE
 *   POST /api/dm/calls/:id/answer        {answer}
 *   POST /api/dm/calls/:id/ice           {candidate}
 *   POST /api/dm/calls/:id/end           {reason}
 */
const pool = require('../middleware/db');

const RING_MS = 45 * 1000;
const calls = new Map(); // id -> call
let seq = 0;
let iceCache = { at: 0, servers: null };

const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

async function iceServers() {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !tok) return STUN;
  if (iceCache.servers && Date.now() - iceCache.at < 50 * 60 * 1000) return iceCache.servers;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
                 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'Ttl=3600',
    });
    const d = await r.json();
    if (Array.isArray(d.ice_servers) && d.ice_servers.length) {
      iceCache = { at: Date.now(), servers: d.ice_servers.map((s) => ({ urls: s.urls || s.url, username: s.username, credential: s.credential })) };
      return iceCache.servers;
    }
  } catch (e) { console.warn('[dm-calls] twilio ice', e.message); }
  return STUN;
}

function fmtDur(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function logCall(c) {
  const ico = c.kind === 'video' ? '📹' : '📞';
  const what = c.kind === 'video' ? 'video call' : 'voice call';
  const body = c.answeredAt
    ? `${ico} ${what[0].toUpperCase() + what.slice(1)} · ${fmtDur(c.endedAt - c.answeredAt)}`
    : (c.reason === 'declined' ? `${ico} Declined ${what}` : `${ico} Missed ${what}`);
  try {
    await pool.query('INSERT INTO dm_messages (thread_id, sender_id, body) VALUES ($1,$2,$3)', [c.threadId, c.from, body]);
    await pool.query('UPDATE dm_threads SET last_message_at=NOW() WHERE id=$1', [c.threadId]);
  } catch (e) { console.warn('[dm-calls] log', e.message); }
}

function end(c, reason) {
  if (c.status === 'ended') return;
  c.status = 'ended'; c.reason = reason || 'hangup'; c.endedAt = Date.now();
  logCall(c);
  setTimeout(() => calls.delete(c.id), 60 * 1000);
}

// Ringing calls nobody answered become "missed".
setInterval(() => {
  const now = Date.now();
  for (const c of calls.values()) {
    if (c.status === 'ringing' && now - c.createdAt > RING_MS) end(c, 'missed');
    if (c.status === 'active' && now - c.lastBeat > 30 * 1000) end(c, 'lost');
  }
}, 5000).unref();

function mount(router, { me, threadFor, displayName }) {
  const mine = (req, c) => c && (c.from === me(req) || c.to === me(req));

  router.get('/ice', async (req, res) => res.json({ iceServers: await iceServers() }));

  router.post('/threads/:id/call', async (req, res) => {
    try {
      const t = await threadFor(req, req.params.id);
      if (!t) return res.status(404).json({ error: 'Chat not found' });
      const { kind, offer } = req.body || {};
      if (!offer || !offer.sdp) return res.status(400).json({ error: 'offer required' });
      const uid = me(req);
      const to = t.user_a === uid ? t.user_b : t.user_a;
      for (const c of calls.values()) if (c.status !== 'ended' && (c.from === uid || c.to === uid)) end(c, 'hangup');
      const id = `${Date.now().toString(36)}${(++seq).toString(36)}`;
      calls.set(id, { id, threadId: t.id, from: uid, to, fromName: req.user.name || displayName(req.user),
        kind: kind === 'video' ? 'video' : 'voice', status: 'ringing', offer, answer: null,
        ice: { [uid]: [], [to]: [] }, createdAt: Date.now(), lastBeat: Date.now() });
      res.status(201).json({ id });
    } catch (e) { console.error('[dm-calls] start', e.message); res.status(500).json({ error: 'Could not start call' }); }
  });

  router.get('/calls/incoming', (req, res) => {
    const uid = me(req);
    const c = [...calls.values()].find((x) => x.to === uid && x.status === 'ringing');
    res.json({ call: c ? { id: c.id, threadId: c.threadId, kind: c.kind, fromName: c.fromName, offer: c.offer } : null });
  });

  router.get('/calls/log', async (req, res) => {
    try {
      const uid = me(req);
      const { rows } = await pool.query(`
        SELECT m.id, m.thread_id, m.sender_id, m.body, m.created_at,
               CASE WHEN t.user_a=$1 THEN t.user_b ELSE t.user_a END AS other_id,
               u.first_name, u.last_name, u.email
        FROM dm_messages m JOIN dm_threads t ON t.id=m.thread_id
        LEFT JOIN users u ON u.id::text = CASE WHEN t.user_a=$1 THEN t.user_b ELSE t.user_a END
        WHERE (t.user_a=$1 OR t.user_b=$1) AND m.deleted_at IS NULL
          AND (m.body LIKE '📞 %' OR m.body LIKE '📹 %')
        ORDER BY m.id DESC LIMIT 100`, [uid]);
      res.json({ calls: rows.map((r) => ({
        id: Number(r.id), threadId: r.thread_id, otherId: r.other_id, name: displayName(r),
        outgoing: r.sender_id === uid, video: r.body.startsWith('📹'),
        missed: /Missed|Declined/.test(r.body), label: r.body.slice(2).trim(), at: r.created_at,
      })) });
    } catch (e) { console.error('[dm-calls] log', e.message); res.status(500).json({ error: 'Could not load calls' }); }
  });

  router.get('/calls/:id', (req, res) => {
    const c = calls.get(req.params.id);
    if (!mine(req, c)) return res.status(404).json({ error: 'Call not found' });
    const uid = me(req); const other = c.from === uid ? c.to : c.from;
    if (c.status === 'active') c.lastBeat = Date.now();
    const since = parseInt(req.query.since, 10) || 0;
    res.json({ status: c.status, reason: c.reason || null, answer: c.from === uid ? c.answer : null,
      ice: c.ice[other].slice(since), iceCount: c.ice[other].length, answeredAt: c.answeredAt || null });
  });

  router.post('/calls/:id/answer', (req, res) => {
    const c = calls.get(req.params.id);
    if (!c || c.to !== me(req)) return res.status(404).json({ error: 'Call not found' });
    if (c.status !== 'ringing') return res.status(409).json({ error: 'Call already ended' });
    const a = (req.body || {}).answer;
    if (!a || !a.sdp) return res.status(400).json({ error: 'answer required' });
    c.answer = a; c.status = 'active'; c.answeredAt = Date.now(); c.lastBeat = Date.now();
    res.json({ ok: true });
  });

  router.post('/calls/:id/ice', (req, res) => {
    const c = calls.get(req.params.id);
    if (!mine(req, c)) return res.status(404).json({ error: 'Call not found' });
    const cand = (req.body || {}).candidate;
    if (cand && c.ice[me(req)].length < 200) c.ice[me(req)].push(cand);
    res.json({ ok: true });
  });

  router.post('/calls/:id/end', (req, res) => {
    const c = calls.get(req.params.id);
    if (!mine(req, c)) return res.status(404).json({ error: 'Call not found' });
    const r = String((req.body || {}).reason || '');
    end(c, c.status === 'ringing' && c.to === me(req) ? 'declined' : (r === 'declined' ? 'declined' : 'hangup'));
    res.json({ ok: true });
  });
}

module.exports = { mount, _calls: calls };
