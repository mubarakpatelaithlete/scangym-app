'use strict';
/* ScanGym ID part 2 (2026-09-28): personality, summary, forget X, delete my memory. */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');

function fakeDb() {
  const store = new Map(); const log = [];
  return {
    store, log,
    async query(sql, params) {
      if (/FROM user_channels/.test(sql)) return { rows: [{ user_id: 7, email: 'sam@x.com', first_name: 'Sam' }] };
      if (/SELECT data FROM chatbot_memory/.test(sql)) return { rows: store.has(params[0]) ? [{ data: JSON.parse(store.get(params[0])) }] : [] };
      if (/INSERT INTO chatbot_memory/.test(sql)) { store.set(params[0], params[1]); return { rows: [] }; }
      if (/DELETE FROM chatbot_memory/.test(sql)) { store.delete(params[0]); return { rows: [] }; }
      if (/DELETE FROM chat_messages/.test(sql)) { log.length = 0; return { rows: [] }; }
      if (/INSERT INTO chat_messages/.test(sql)) { const [k, pf, ...r] = params; for (let i = 0; i < r.length; i += 2) log.push({ memory_key: k, platform: pf, role: r[i], text: r[i + 1] }); return { rows: [] }; }
      if (/SELECT role, text, platform FROM chat_messages/.test(sql)) return { rows: log.slice(-params[1]).reverse() };
      return { rows: [] };
    },
  };
}
const meta = { platform: 'telegram', verified: true };

test('learns style, language and notes by rules', () => {
  let p = mem.learnProfile({}, { text: 'please keep it short', city: 'Leeds' });
  p = mem.learnProfile(p, { text: 'reply in Hindi' });
  p = mem.learnProfile(p, { text: 'remember that I train at 6am', city: 'Leeds' });
  assert.equal(p.style, 'short');
  assert.equal(p.language, 'Hindi');
  assert.deepEqual(p.notes, ['I train at 6am']);
  assert.equal(p.cities.Leeds, 2);
  assert.match(mem.contextNote({ profile: p, summary: 'Boxer.' }), /Leeds.*short.*Hindi.*6am/);
});

test('forget X removes it; delete my memory asks then wipes', async () => {
  mem._linkCache.clear();
  const { handleMessage } = require('../server/chatbot/message-handler');
  const pool = fakeDb();
  const d = { pool, awaitSave: true, cardLabel: async () => null };
  await handleMessage('telegram:77', 'remember that I love boxing', meta, d);
  let m = JSON.parse(pool.store.get('user:7'));
  assert.deepEqual(m.profile.notes, ['I love boxing']);
  const f = await handleMessage('telegram:77', 'forget boxing', meta, d);
  assert.match(f.text, /Forgotten/);
  m = JSON.parse(pool.store.get('user:7'));
  assert.deepEqual(m.profile.notes, []);
  const a = await handleMessage('telegram:77', 'delete my memory', meta, d);
  assert.match(a.text, /Reply YES/);
  assert.ok(a.data.options.every((o) => o.label && o.value));
  const b = await handleMessage('telegram:77', 'YES', meta, d);
  assert.match(b.text, /deleted everything/);
  assert.ok(!pool.store.has('user:7'));
  assert.equal(pool.log.length, 0);
});

test('summary runs after SUMMARY_EVERY exchanges', async () => {
  const pool = fakeDb();
  await mem.logExchange('user:9', { text: 'gyms in leeds', reply: 'Found 3', platform: 'telegram' }, { pool });
  const s = await mem.maybeSummarise('user:9', { sinceSummary: mem.SUMMARY_EVERY }, { pool, summarise: async (p) => (/leeds/.test(p) ? 'Looks for gyms in Leeds.' : null) });
  assert.equal(s, 'Looks for gyms in Leeds.');
  assert.equal(await mem.maybeSummarise('user:9', { sinceSummary: 1 }, { pool, summarise: async () => 'x' }), null);
});
