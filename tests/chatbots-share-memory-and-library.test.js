/**
 * One customer, one memory, one library across every chatbot
 * (owner request 2026-09-26). See server/chatbot/customer-memory.js.
 */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');

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

test('phrases are recognised without stealing bookings', () => {
  assert.equal(mem.detectMemoryAsk('show my library'), 'library');
  assert.equal(mem.detectMemoryAsk('my videos'), 'library');
  assert.equal(mem.detectMemoryAsk('remix my last video'), 'remix');
  assert.equal(mem.detectMemoryAsk('what do you remember about me'), 'memory');
  for (const t of ['my bookings', 'gyms in Leeds', 'Book gym 1 for tomorrow', 'make an image of a gym']) {
    assert.equal(mem.detectMemoryAsk(t), null, t);
  }
});

test('linked Telegram and WhatsApp chats share one memory row', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:111': 42, 'whatsapp:+447700900000': 42 });
  const a = await mem.resolveCustomer('telegram:111', { verified: true }, { pool });
  const b = await mem.resolveCustomer('whatsapp:+447700900000', { verified: true }, { pool });
  assert.equal(mem.memoryKey('telegram:111', a), 'user:42');
  assert.equal(mem.memoryKey('whatsapp:+447700900000', b), 'user:42');
  const c = await mem.resolveCustomer('discord:999', { verified: true }, { pool });
  assert.equal(c, null);
  assert.equal(mem.memoryKey('discord:999', c), 'chat:discord:999');
});

test('what is made on Telegram is remembered on WhatsApp', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:111': 42, 'whatsapp:+447700900000': 42 });
  const { handleMessage } = require('../server/chatbot/message-handler');
  await handleMessage('telegram:111', 'make a video of a boxer training at dawn', { platform: 'telegram', verified: true }, { pool, awaitSave: true });
  const saved = JSON.parse(pool.store.get('user:42'));
  assert.equal(saved.lastCreate.kind, 'video');
  const r = await handleMessage('whatsapp:+447700900000', 'remix my last video', { platform: 'whatsapp', verified: true }, { pool, awaitSave: true });
  assert.match(r.text, /Remixing/);
  assert.match(r.text, /Reply \*YES\*/);
  const after = JSON.parse(pool.store.get('user:42'));
  assert.deepEqual(after.channels.sort(), ['telegram', 'whatsapp']);
});

test('library lists creations from every model; unlinked chats get the link step', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:111': 42 });
  const { handleMessage } = require('../server/chatbot/message-handler');
  const libraryFor = async (uid) => ({ items: [
    { kind: 'image', model: 'fal-ai/flux/dev', prompt: 'gym at sunrise', status: 'done', url: 'https://cdn/x.png' },
    { kind: 'music', model: 'fal-ai/stable-audio', prompt: 'leg day song', status: 'done', url: 'https://cdn/y.mp3' },
    { kind: 'video', prompt: 'still going', status: 'running', url: null },
  ] });
  const r = await handleMessage('telegram:111', 'show my library', { platform: 'telegram', verified: true }, { pool, libraryFor, awaitSave: true });
  assert.match(r.text, /gym at sunrise/);
  assert.match(r.text, /leg day song/);
  assert.doesNotMatch(r.text, /still going/);
  const anon = await handleMessage('discord:5', 'show my library', { platform: 'discord', verified: true }, { pool, libraryFor, awaitSave: true });
  assert.match(anon.text, /Type LINK/); // verified chats now link right here (chat-link.js)
});

test('memory keeps only recent chat', () => {
  let m = {};
  for (let i = 0; i < 20; i++) m = mem.remember(m, { text: `hi ${i}`, reply: 'ok', platform: 'sms' });
  assert.equal(m.history.length, 12);
  assert.equal(m.history[m.history.length - 2].text, 'hi 19');
});

test('a linkedUser that the platform did not prove is ignored (public test endpoint, spoofed webhooks)', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:111': 42 });
  assert.equal(await mem.resolveCustomer('telegram:111', {}, { pool }), null);
  assert.equal(await mem.resolveCustomer('test:x', { linkedUser: { userId: 42 } }, { pool }), null);
  const { handleMessage } = require('../server/chatbot/message-handler');
  let called = false;
  const libraryFor = async () => { called = true; return { items: [] }; };
  const r = await handleMessage('test:spoof', 'show my library', { platform: 'test', linkedUser: { userId: 42 } }, { pool, libraryFor, awaitSave: true });
  assert.equal(called, false);
  assert.match(r.text, /Link/);
});

test('in-chat create: price first, nothing spent until YES, file comes back in the chat', async () => {
  mem._linkCache.clear();
  const pool = fakeDb({ 'telegram:222': 7 });
  const { handleMessage } = require('../server/chatbot/message-handler');
  const calls = [];
  const chatCreate = { startCreation: async (uid, kind, prompt) => { calls.push({ uid, kind, prompt }); return { done: true, url: 'https://cdn/sunrise.png' }; } };
  const meta = { platform: 'telegram', verified: true };
  const ask = await handleMessage('telegram:222', 'make an image of a gym at sunrise', meta, { pool, chatCreate, awaitSave: true });
  assert.match(ask.text, /Reply \*YES\*/);
  assert.doesNotMatch(ask.text, /scangym\.com\/creator\?mode/);
  assert.equal(calls.length, 0);
  const done = await handleMessage('telegram:222', 'yes', meta, { pool, chatCreate, awaitSave: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].uid, '7');
  assert.equal(calls[0].kind, 'image');
  assert.match(done.text, /https:\/\/cdn\/sunrise\.png/);
  // NO cancels and charges nothing
  await handleMessage('telegram:222', 'make a song about leg day', meta, { pool, chatCreate, awaitSave: true });
  const no = await handleMessage('telegram:222', 'no', meta, { pool, chatCreate, awaitSave: true });
  assert.match(no.text, /nothing was charged/);
  assert.equal(calls.length, 1);
});

test('unlinked chats still get the Create link plus how to create in chat', async () => {
  const { handleMessage } = require('../server/chatbot/message-handler');
  const r = await handleMessage('test:anon-create', 'make an image of a gym', { platform: 'test' });
  assert.match(r.text, /creator\?mode=image/);
  assert.match(r.text, /right here in the chat/);
});

test('chat-create runs the real ScanSquad route and reads the file url', async () => {
  const chat = require('../server/chatbot/chat-create');
  const seen = [];
  const router = (req, res) => { seen.push([req.method, req.url, req.session.userId, req.body.prompt]); res.status(200).json(req.method === 'POST' ? { jobId: 'j1' } : { status: 'done', imageUrl: 'https://cdn/i.png' }); };
  const out = await chat.startCreation('9', 'image', 'gym', { deps: { router, pollMs: 1 } });
  assert.deepEqual(out, { done: true, url: 'https://cdn/i.png' });
  assert.deepEqual(seen[0], ['POST', '/generate', '9', 'gym']);
  const refused = await chat.startCreation('9', 'image', 'gym', { deps: { router: (q, s) => s.status(402).json({ error: 'Add a card' }) } });
  assert.match(refused.error, /Add a card/);
});
