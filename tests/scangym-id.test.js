'use strict';
/* ScanGym ID (items 23/24, 2026-09-28): every exchange is logged to
   chat_messages, history loads across chatbots, memory shows identity. */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');

function fakeDb() {
  const log = [];
  return {
    log,
    async query(sql, params) {
      if (/FROM user_channels/.test(sql)) return { rows: [{ user_id: 7, email: 'sam@x.com', first_name: 'Sam' }] };
      if (/INSERT INTO chat_messages/.test(sql)) {
        assert.match(sql, /\(memory_key, platform, role, text\) VALUES \(\$1, \$2, \$3, \$4\)/);
        const [key, platform, ...rest] = params;
        for (let i = 0; i < rest.length; i += 2) log.push({ memory_key: key, platform, role: rest[i], text: rest[i + 1] });
        return { rows: [] };
      }
      if (/SELECT role, text, platform FROM chat_messages/.test(sql)) {
        return { rows: log.filter((r) => r.memory_key === params[0]).slice(-params[1]).reverse() };
      }
      if (/COUNT\(\*\)/.test(sql)) {
        const mine = log.filter((r) => r.memory_key === params[0]);
        return { rows: [{ n: mine.length, via: [...new Set(mine.map((r) => r.platform))] }] };
      }
      if (/FROM public.users/.test(sql)) return { rows: [{ first_name: 'Sam', last_name: 'Lee', email: 'sam@x.com', phone_number: '+447700900123', stripe_customer_id: 'cus_1' }] };
      return { rows: [] };
    },
  };
}

test('logs both sides and shares history across chatbots', async () => {
  const pool = fakeDb();
  await mem.logExchange('user:7', { text: 'hi', reply: 'hello', platform: 'telegram' }, { pool });
  await mem.logExchange('user:7', { text: 'gyms in leeds', reply: 'Found 3', platform: 'whatsapp' }, { pool });
  const r = await mem.recentMessages('user:7', 16, { pool });
  assert.deepEqual(r.map((m) => m.text), ['hi', 'hello', 'gyms in leeds', 'Found 3']);
});

test('memory answer shows identity masked, card label only', async () => {
  mem._linkCache.clear();
  const pool = fakeDb();
  await mem.logExchange('user:7', { text: 'hi', reply: 'hello', platform: 'telegram' }, { pool });
  const { handleMessage } = require('../server/chatbot/message-handler');
  const a = await handleMessage('whatsapp:555', 'what do you know about me', { platform: 'whatsapp', verified: true },
    { pool, cardLabel: async () => 'VISA ••5661', awaitSave: true });
  assert.match(a.text, /Sam Lee/);
  assert.match(a.text, /sa•••@x\.com/);
  assert.match(a.text, /••••0123/);
  assert.match(a.text, /VISA ••5661/);
  assert.match(a.text, /Telegram/);
  assert.ok(!/447700900123/.test(a.text));
  assert.ok(pool.log.some((r) => r.platform === 'whatsapp' && r.role === 'assistant'), 'exchange logged');
});
