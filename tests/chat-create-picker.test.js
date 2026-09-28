'use strict';
/* Create picker (owner request 2026-09-28): Image/Video/Music/Audio → model →
   shape, one question at a time, skip what was said, remember last picks. */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');
const wiz = require('../server/chatbot/create-wizard');

function fakeDb(links = {}) {
  const store = new Map();
  return {
    store,
    async query(sql, params) {
      if (/FROM user_channels/.test(sql)) {
        const u = links[`${params[0]}:${params[1]}`];
        return { rows: u ? [{ user_id: u, email: 'a@b.com', first_name: 'Sam' }] : [] };
      }
      if (/FROM public.users/.test(sql)) return { rows: [] };
      if (/SELECT data FROM chatbot_memory/.test(sql)) {
        return { rows: store.has(params[0]) ? [{ data: JSON.parse(store.get(params[0])) }] : [] };
      }
      if (/INSERT INTO chatbot_memory/.test(sql)) { store.set(params[0], params[1]); return { rows: [] }; }
      return { rows: [] };
    },
  };
}

test('bare "create" asks kind → model → shape → idea, then price + YES with the picks', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:501': 5 });
  const { handleMessage } = require('../server/chatbot/message-handler');
  const calls = [];
  const chatCreate = { startCreation: async (uid, kind, prompt, o) => { calls.push({ kind, prompt, extra: o.extra }); return { done: true, url: 'https://cdn/v.mp4' }; } };
  const meta = { platform: 'telegram', verified: true };
  const d = { pool, chatCreate, awaitSave: true };
  const a = await handleMessage('telegram:501', 'create', meta, d);
  assert.match(a.text, /What would you like to create/);
  assert.equal(a.data.options.length, 4);
  const b = await handleMessage('telegram:501', '2', meta, d); // video
  assert.match(b.text, /Which model for your video/);
  assert.match(b.text, /Auto \(recommended\)/);
  const c = await handleMessage('telegram:501', '3', meta, d); // 2nd listed model
  assert.match(c.text, /Shape and length/);
  const e = await handleMessage('telegram:501', '2', meta, d); // 16:9 · 8s
  assert.match(e.text, /describe your video/);
  const f = await handleMessage('telegram:501', 'a boxer at sunrise', meta, d);
  assert.match(f.text, /Reply \*YES\*/);
  assert.match(f.text, /16:9 · 8s/);
  assert.equal(calls.length, 0);
  await handleMessage('telegram:501', 'yes', meta, d);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, 'video');
  assert.equal(calls[0].prompt, 'a boxer at sunrise');
  assert.equal(calls[0].extra.aspectRatio, '16:9');
  assert.equal(calls[0].extra.durationSeconds, 8);
  assert.ok(calls[0].extra.model);
  // Remembered in shared memory: next time "same as last time" comes first
  const saved = JSON.parse(pool.store.get('user:5'));
  assert.equal(saved.createPrefs.video.model, calls[0].extra.model);
  const g = await handleMessage('telegram:501', 'make a video of a runner', meta, d);
  assert.match(g.text, /1\. 🔁 Same as last time/);
});

test('what the customer already said is skipped', () => {
  const w = wiz.start({ kind: 'image', prompt: 'a square photo of a gym', model: 'x', text: 'a square photo of a gym' });
  assert.equal(wiz.nextStep(w), null);
  assert.deepEqual(wiz.body(w), { aspectRatio: '1:1', model: 'x' });
  const m = wiz.start({ kind: 'music', prompt: 'upbeat', model: null });
  assert.equal(wiz.nextStep(m), 'model'); // music has no shape step
  assert.equal(wiz.answer(m, 'auto'), 'next');
  assert.equal(wiz.nextStep(m), null);
  assert.deepEqual(wiz.body(m), {});
});

test('NO cancels the picker; an unrelated message drops it', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:502': 6 });
  const { handleMessage } = require('../server/chatbot/message-handler');
  const meta = { platform: 'telegram', verified: true };
  await handleMessage('telegram:502', 'make an image of a gym', meta, { pool, awaitSave: true });
  const no = await handleMessage('telegram:502', 'no', meta, { pool, awaitSave: true });
  assert.match(no.text, /nothing was charged/);
});

test('"create image" alone asks for the idea instead of drawing "create image"', () => {
  const wz = require('../server/chatbot/create-wizard');
  assert.equal(wz.bareTrigger('create image'), true);
  assert.equal(wz.bareTrigger('make a video please'), true);
  assert.equal(wz.bareTrigger('a boxer in a sunny gym'), false);
  const w = wz.start({ kind: 'image', prompt: 'create image', model: 'seedream-v4', text: 'create image' });
  w.settings.aspectRatio = '1:1';
  assert.equal(wz.nextStep(w), 'prompt');
});
