/**
 * Task 154 Chats 4 — WhatsApp-style groups on top of the 1:1 Chats tables.
 *
 *   POST /api/dm/groups {name, userIds[]}   create a group (max 256 people)
 *   POST /api/dm/groups/:threadId/members {userIds[]}   add people (members only)
 *   POST /api/dm/groups/:threadId/leave
 *
 * The group's chat is an ordinary dm_threads row, so the existing message,
 * upload, react, edit and delete endpoints work once threadFor() lets members
 * in. Tables: migrations/20261002d_dm_groups.sql.
 */
const pool = require('../middleware/db');

const MAX_MEMBERS = 256;
const MEMBER_SQL = `EXISTS (SELECT 1 FROM dm_groups g JOIN dm_group_members gm ON gm.group_id = g.id
                    WHERE g.thread_id = t.id AND gm.user_id = $2)`;

async function groupForThread(threadId) {
  const { rows: [g] } = await pool.query('SELECT * FROM dm_groups WHERE thread_id = $1', [threadId]);
  return g || null;
}

async function listFor(uid) {
  const { rows } = await pool.query(`
    SELECT g.id AS gid, g.name, t.id, t.last_message_at, gm.last_read_id,
           (SELECT COUNT(*)::int FROM dm_group_members x WHERE x.group_id = g.id) AS members,
           lm.body AS last_body, lm.sender_id AS last_sender, lm.deleted_at AS last_deleted,
           (SELECT COUNT(*)::int FROM dm_messages m WHERE m.thread_id = t.id AND m.sender_id <> $1
              AND m.id > gm.last_read_id AND m.deleted_at IS NULL) AS unread
      FROM dm_group_members gm
      JOIN dm_groups g ON g.id = gm.group_id
      JOIN dm_threads t ON t.id = g.thread_id
      LEFT JOIN LATERAL (SELECT body, sender_id, deleted_at FROM dm_messages WHERE thread_id = t.id ORDER BY id DESC LIMIT 1) lm ON true
     WHERE gm.user_id = $1
     ORDER BY t.last_message_at DESC LIMIT 100`, [uid]);
  return rows.map((r) => ({
    id: r.id, group: true, members: r.members, otherId: null, name: r.name, online: false, lastSeen: null,
    lastMessage: r.last_deleted ? 'This message was deleted' : (r.last_body || 'Group created'),
    lastFromMe: r.last_sender === uid, lastRead: false, lastMessageAt: r.last_message_at, unread: r.unread,
  }));
}

/** GET messages for a group thread: sender names, per-member read marker. */
async function messagesFor(t, g, uid, after, displayName, extras) {
  const { rows } = await pool.query(
    `SELECT m.id, m.sender_id, m.body, m.created_at, m.delivered_at, m.read_at, m.deleted_at, m.edited_at, m.reactions,
            u.first_name, u.last_name, u.email
       FROM dm_messages m LEFT JOIN users u ON u.id::text = m.sender_id
      WHERE m.thread_id = $1 AND m.id > $2 ORDER BY m.id DESC LIMIT 200`, [t.id, after]);
  const { rows: [mx] } = await pool.query('SELECT COALESCE(MAX(id),0) AS id FROM dm_messages WHERE thread_id = $1', [t.id]);
  await pool.query('UPDATE dm_group_members SET last_read_id = GREATEST(last_read_id, $3) WHERE group_id = $1 AND user_id = $2', [g.id, uid, mx.id]);
  // ✓✓ once any other member has read it (WhatsApp shows blue only when all have; one is the honest minimum here).
  await pool.query(`UPDATE dm_messages SET read_at = NOW(), delivered_at = COALESCE(delivered_at, NOW())
                     WHERE thread_id = $1 AND sender_id <> $2 AND read_at IS NULL`, [t.id, uid]);
  const { rows: recent } = await pool.query(
    'SELECT id, sender_id, body, deleted_at, edited_at, reactions FROM dm_messages WHERE thread_id = $1 ORDER BY id DESC LIMIT 50', [t.id]);
  const { rows: ticks } = await pool.query(
    'SELECT id, delivered_at, read_at, deleted_at FROM dm_messages WHERE thread_id = $1 AND sender_id = $2 ORDER BY id DESC LIMIT 50', [t.id, uid]);
  const { rows: mem } = await pool.query(
    `SELECT gm.user_id, u.first_name, u.last_name, u.email FROM dm_group_members gm
       LEFT JOIN users u ON u.id::text = gm.user_id WHERE gm.group_id = $1 ORDER BY gm.joined_at LIMIT 300`, [g.id]);
  const names = mem.map((m) => (m.user_id === uid ? 'You' : displayName(m)));
  return {
    other: { id: null, group: true, name: g.name, online: false, lastSeen: null, typing: false,
             members: mem.length, memberNames: names.slice(0, 12) },
    messages: rows.reverse().map((m) => ({
      id: Number(m.id), mine: m.sender_id === uid, from: m.sender_id === uid ? null : displayName(m),
      body: m.deleted_at ? '' : m.body, deleted: !!m.deleted_at, at: m.created_at,
      delivered: !!m.delivered_at, read: !!m.read_at, ...extras(m, uid),
    })),
    recent: recent.map((m) => ({ id: Number(m.id), deleted: !!m.deleted_at, body: m.deleted_at ? '' : m.body, ...extras(m, uid) })),
    ticks: ticks.map((m) => ({ id: Number(m.id), delivered: !!m.delivered_at, read: !!m.read_at, deleted: !!m.deleted_at })),
  };
}

async function validUsers(ids, uid) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).slice(0, 64)).filter((x) => x && x !== uid))].slice(0, MAX_MEMBERS);
  if (!list.length) return [];
  const { rows } = await pool.query('SELECT id::text AS id FROM users WHERE id::text = ANY($1::text[])', [list]);
  return rows.map((r) => r.id);
}

function mount(router, { me }) {
  router.post('/groups', async (req, res) => {
    try {
      const uid = me(req);
      const name = String((req.body || {}).name || '').trim().slice(0, 60);
      if (!name) return res.status(400).json({ error: 'Give the group a name' });
      const users = await validUsers((req.body || {}).userIds, uid);
      if (!users.length) return res.status(400).json({ error: 'Add at least one person' });
      const { rows: [g] } = await pool.query('INSERT INTO dm_groups (name, created_by) VALUES ($1,$2) RETURNING id', [name, uid]);
      const { rows: [t] } = await pool.query("INSERT INTO dm_threads (user_a, user_b) VALUES ('grp', $1) RETURNING id", ['grp:' + g.id]);
      await pool.query('UPDATE dm_groups SET thread_id = $1 WHERE id = $2', [t.id, g.id]);
      await pool.query(
        `INSERT INTO dm_group_members (group_id, user_id) SELECT $1, x FROM unnest($2::text[]) x ON CONFLICT DO NOTHING`,
        [g.id, [uid].concat(users)]);
      res.status(201).json({ id: t.id, groupId: g.id, members: users.length + 1 });
    } catch (e) { console.error('[dm] group create', e.message); res.status(500).json({ error: 'Could not create the group' }); }
  });

  router.post('/groups/:id/members', async (req, res) => {
    try {
      const uid = me(req);
      const g = await groupForThread(parseInt(req.params.id, 10) || 0);
      if (!g) return res.status(404).json({ error: 'Group not found' });
      const { rows: mine } = await pool.query('SELECT 1 FROM dm_group_members WHERE group_id=$1 AND user_id=$2', [g.id, uid]);
      if (!mine.length) return res.status(403).json({ error: 'Only members can add people' });
      const users = await validUsers((req.body || {}).userIds, uid);
      if (!users.length) return res.status(400).json({ error: 'Pick someone to add' });
      await pool.query('INSERT INTO dm_group_members (group_id, user_id) SELECT $1, x FROM unnest($2::text[]) x ON CONFLICT DO NOTHING', [g.id, users]);
      res.json({ added: users.length });
    } catch (e) { console.error('[dm] group add', e.message); res.status(500).json({ error: 'Could not add people' }); }
  });

  router.post('/groups/:id/leave', async (req, res) => {
    try {
      const g = await groupForThread(parseInt(req.params.id, 10) || 0);
      if (!g) return res.status(404).json({ error: 'Group not found' });
      await pool.query('DELETE FROM dm_group_members WHERE group_id=$1 AND user_id=$2', [g.id, me(req)]);
      res.json({ left: true });
    } catch (e) { res.status(500).json({ error: 'Could not leave' }); }
  });
}

module.exports = { mount, listFor, messagesFor, groupForThread, MEMBER_SQL };
