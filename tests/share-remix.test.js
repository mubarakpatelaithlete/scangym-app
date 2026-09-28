'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sr = require('../server/lib/share-remix');
const chat = require('../server/chatbot/chat-create');

const job = { id: 'abcdef0123456789', kind: 'video', model: 'kling-2.5-turbo', prompt: 'a boxer at sunrise',
  params: { aspectRatio: '9:16', durationSeconds: 8, resolution: '1080p', op: 'x' }, handle: 'fruga' };

test('targetFor pre-selects model, shape, length, resolution, prompt and ref', () => {
  const u = new URL(sr.targetFor(job, job.handle), 'https://x');
  assert.strictEqual(u.pathname, '/creator');
  const q = u.searchParams;
  assert.strictEqual(q.get('mode'), 'video');
  assert.strictEqual(q.get('prompt'), 'a boxer at sunrise');
  assert.strictEqual(q.get('model'), 'kling-2.5-turbo');
  assert.strictEqual(q.get('ar'), '9:16');
  assert.strictEqual(q.get('dur'), '8');
  assert.strictEqual(q.get('res'), '1080p');
  assert.strictEqual(q.get('ref'), 'fruga');
  assert.strictEqual(q.get('src'), 'remix');
});

test('targetFor drops a bad handle', () => {
  const q = new URL(sr.targetFor(job, 'bad handle!'), 'https://x').searchParams;
  assert.strictEqual(q.get('ref'), null);
});

test('shareLink only for real job ids', () => {
  assert.match(sr.shareLink('abcdef0123456789'), /\/s\/abcdef0123456789$/);
  assert.strictEqual(sr.shareLink('../etc'), null);
  assert.strictEqual(sr.shareLink(null), null);
});

test('loadShare rejects bad ids without a query and reads the owner handle', async () => {
  let called = 0;
  const pool = { query: async () => { called++; return { rows: [job] }; } };
  assert.strictEqual(await sr.loadShare('nope', { pool }), null);
  assert.strictEqual(called, 0);
  const j = await sr.loadShare(job.id, { pool });
  assert.strictEqual(j.handle, 'fruga');
});

test('handler redirects to prefilled Create, share=1 serves the share page', async () => {
  const pool = { query: async () => ({ rows: [job] }) };
  const h = sr.handler({ pool });
  const mk = (query) => { const r = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, redirect(c, u) { this.code = c; this.loc = u; }, type() { return this; }, send(b) { this.body = b; } }; return r; };
  const a = mk(); await h({ params: { id: job.id }, query: {} }, a);
  assert.strictEqual(a.code, 302); assert.match(a.loc, /^\/creator\?mode=video/);
  const b = mk(); await h({ params: { id: job.id }, query: { share: '1' } }, b);
  assert.match(b.body, /Share &amp; earn/); assert.match(b.body, /wa\.me/); assert.match(b.body, /t\.me\/share/);
  const c = mk(); await h({ params: { id: 'zz' }, query: {} }, { ...c, redirect(code, u) { c.loc = u; } });
  assert.strictEqual(c.loc, '/creator');
});

test('chatbot done reply carries the Share & earn link', () => {
  const t = chat.doneReply('image', 'https://v3b.fal.media/files/a.jpg', 'abcdef0123456789');
  assert.match(t, /💸 Share & earn: https:\/\/www\.scangym\.com\/s\/abcdef0123456789/);
  assert.match(t, /\?share=1/);
  assert.doesNotMatch(chat.doneReply('image', 'https://v3b.fal.media/files/a.jpg'), /Share & earn/);
});
