'use strict';
// Owner request 2026-09-26: link + create end to end inside every chatbot.
const test = require('node:test');
const assert = require('node:assert');
const link = require('../server/chatbot/chat-link');

function fakes() {
  const codes = {}; const q = [];
  return {
    q,
    emailLogin: {
      issueCode: async ({ email }) => { codes[email] = '123456'; return { ok: true }; },
      checkCode: ({ email, code }) => (codes[email] && String(code).replace(/\D/g, '') === codes[email] ? { ok: true } : { ok: false, message: 'not right' }),
    },
    pool: { query: async (sql, args) => { q.push([sql, args]); return /SELECT/.test(sql) ? { rows: [{ id: 'u1', email: 'a@b.com', first_name: 'Raj' }] } : { rows: [] }; } },
  };
}

test('only platform-verified chats may link in chat', () => {
  assert.equal(link.canLink('telegram:42', { verified: true }), true);
  assert.equal(link.canLink('telegram:42', {}), false);
  assert.equal(link.canLink('messenger:x', { verified: true }), true);
  assert.equal(link.canLink('test:1', { verified: true }), false);
});

test('email → code → linked, waiting creation comes back', async () => {
  const d = fakes(); const s = {};
  assert.match(link.start(s, { create: { kind: 'image', prompt: 'gym' } }), /email/);
  const r1 = await link.handle(s, 'telegram:42', 'my email is A@b.com', d);
  assert.match(r1.text, /Code sent to a•@b\.com/);
  const bad = await link.handle(s, 'telegram:42', '000000', d);
  assert.match(bad.text, /not right/);
  const r2 = await link.handle(s, 'telegram:42', '123 456', d);
  assert.equal(r2.linked.userId, 'u1');
  assert.deepEqual(r2.create, { kind: 'image', prompt: 'gym' });
  const ins = d.q.find(([sql]) => /INSERT INTO user_channels/.test(sql));
  assert.deepEqual(ins[1].slice(0, 3), ['u1', 'telegram', '42']);
  assert.equal(s.pendingLink, null);
});

test('cancel, rate limit, LINK command', async () => {
  const d = fakes(); const s = {};
  link.start(s);
  for (let i = 0; i < 3; i++) await link.handle(s, 'sms:+44', 'x@y.com', d);
  assert.match((await link.handle(s, 'sms:+44', 'x@y.com', d)).text, /3 codes/);
  assert.match((await link.handle(s, 'sms:+44', 'cancel', d)).text, /Cancelled/);
  assert.equal(link.wantsLink('LINK'), true);
  assert.equal(link.wantsLink('connect my account'), true);
  assert.equal(link.wantsLink('link to gym in leeds'), false);
});
