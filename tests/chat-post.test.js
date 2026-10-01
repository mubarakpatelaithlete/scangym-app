// Task 56: "post it" from any chatbot posts the latest creation everywhere.
const test = require('node:test');
const assert = require('node:assert');
const cp = require('../server/chatbot/chat-post');

const pe = (accounts, calls) => ({
  APPS: { instagram_business: { name: 'Instagram' }, facebook_pages: { name: 'Facebook Page' } },
  isConfigured: () => true,
  myAccounts: async () => accounts,
  postEverywhere: async (uid, p) => { calls.push(p); return { posted: 2, results: [{ appName: 'Instagram', status: 'posted' }, { appName: 'Facebook Page', status: 'posted' }] }; },
});
const lib = async () => ({ items: [{ kind: 'image', url: 'https://cdn.scangym.com/gen/image/1.png', prompt: 'gym at sunrise', status: 'done' }] });

test('detects post requests, not gym sharing', () => {
  for (const t of ['post it', 'post this everywhere', 'publish to instagram', 'share it on my socials']) assert.ok(cp.detectPost(t), t);
  for (const t of ['share this gym', 'post my booking code', 'find a gym in leeds']) assert.ok(!cp.detectPost(t), t);
});

test('asks first, posts only after YES', async () => {
  const calls = [], s = {};
  const deps = { postEverywhere: pe([{ slug: 'instagram_business' }, { slug: 'facebook_pages' }], calls), libraryFor: lib };
  const ask = await cp.askPost(s, 'u1', deps);
  assert.match(ask.text, /Instagram, Facebook Page/);
  assert.equal(calls.length, 0, 'nothing posted before YES');
  const done = await cp.answerPost(s, 'u1', 'yes', deps);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mediaUrl, 'https://cdn.scangym.com/gen/image/1.png');
  assert.match(done.text, /Posted to 2 of 2/);
});

test('no linked accounts -> connect link, no post', async () => {
  const calls = [], s = {};
  const r = await cp.askPost(s, 'u1', { postEverywhere: pe([], calls), libraryFor: lib });
  assert.match(r.text, /post-everywhere/);
  assert.ok(!s.pendingPost);
});

test('NO cancels', async () => {
  const calls = [], s = { pendingPost: { item: { kind: 'image', url: 'https://x/y.png' }, at: Date.now() } };
  const r = await cp.answerPost(s, 'u1', 'no', { postEverywhere: pe([], calls) });
  assert.match(r.text, /Not posted/);
  assert.equal(calls.length, 0);
});
