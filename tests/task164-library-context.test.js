/** Task 164: shared library feeds the chatbot's memory context and remix. */
const test = require('node:test');
const assert = require('node:assert');
const mem = require('../server/chatbot/customer-memory');

const lib = [
  { kind: 'video', model: 'fal-ai/wan-2.5', prompt: 'battle ropes slow mo', status: 'done', created_at: '2026-10-02T12:00:00Z' },
  { kind: 'image', model: 'nano-banana', prompt: 'gym at sunrise', status: 'done', created_at: '2026-10-02T11:00:00Z' },
  { kind: 'image', model: 'x', prompt: 'broken one', status: 'failed', created_at: '2026-10-02T13:00:00Z' },
];

test('contextNote includes recent library creations and models', () => {
  const n = mem.contextNote({}, lib);
  assert.match(n, /battle ropes slow mo/);
  assert.match(n, /wan-2\.5/);
  assert.doesNotMatch(n, /broken one/);
  assert.strictEqual(mem.contextNote({}, []), '');
});

test('lastCreation picks the newer of chatbot memory and website library', () => {
  const old = { lastCreate: { kind: 'image', prompt: 'old chat idea', at: '2026-10-01T00:00:00Z' } };
  assert.strictEqual(mem.lastCreation(old, lib).prompt, 'battle ropes slow mo');
  const fresh = { lastCreate: { kind: 'image', prompt: 'new chat idea', at: '2026-10-03T00:00:00Z' } };
  assert.strictEqual(mem.lastCreation(fresh, lib).prompt, 'new chat idea');
  assert.strictEqual(mem.lastCreation({}, lib, 'image').prompt, 'gym at sunrise');
  assert.strictEqual(mem.lastCreation({}, []), null);
});

test('formatMemory shows what it builds on', () => {
  assert.match(mem.formatMemory({}, null, null, lib), /Recent creations I build on/);
});
