const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
/* Stub express / db / auth so the pure helpers load without node_modules or a DB. */
const stubs = {
  express: Object.assign(() => ({}), { Router: () => ({ use() {}, get() {}, post() {} }), json: () => () => {} }),
  '../middleware/db': {},
  '../middleware/auth': { authenticateUser() {}, optionalAuth() {} },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req in stubs ? stubs[req] : origLoad.call(this, req, ...rest); };
const pulse = require('../server/routes/pulse');
Module._load = origLoad;

test('tagsOf: lowercase, unique, ignores 1-char tags', () => {
  assert.deepStrictEqual(pulse._tagsOf('Leg day #PR #pr #legday #a'), ['pr', 'legday']);
});
test('topTags: most used first', () => {
  const t = pulse._topTags(['#crowded now', '#crowded again #deal', '#deal', '#crowded']);
  assert.deepStrictEqual(t[0], { tag: 'crowded', posts: 3 });
  assert.deepStrictEqual(t[1], { tag: 'deal', posts: 2 });
});
test('cleanBody: trims and caps at 280', () => {
  assert.strictEqual(pulse._cleanBody('  hi  '), 'hi');
  assert.strictEqual(pulse._cleanBody('x'.repeat(400)).length, 280);
});
test('server mounts /api/pulse and Home links it', () => {
  const fs = require('fs'); const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  assert.match(read('server/server.js'), /app\.use\('\/api\/pulse', pulseRouter\)/);
  assert.match(read('server/server.js'), /app\.get\(\['\/pulse', '\/pulse\/'\]/);
  assert.match(read('frontend/public/reels/index.html'), /value:'pulse:'/);
  assert.match(read('frontend/public/reels/index.html'), /location\.href = '\/pulse\/'/);
});
