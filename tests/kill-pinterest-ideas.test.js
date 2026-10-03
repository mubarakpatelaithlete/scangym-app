const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
/* Stub express / db / auth so the pure helpers load without node_modules or a DB. */
const stubs = {
  express: Object.assign(() => ({}), { Router: () => ({ use() {}, get() {}, post() {}, delete() {} }), json: () => () => {} }),
  '../middleware/db': {},
  '../middleware/auth': { authenticateUser() {}, optionalAuth() {} },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req in stubs ? stubs[req] : origLoad.call(this, req, ...rest); };
const ideas = require('../server/routes/ideas');
Module._load = origLoad;

test('cleanName: trims, collapses spaces, caps at 40', () => {
  assert.strictEqual(ideas._cleanName('  Leg   day  '), 'Leg day');
  assert.strictEqual(ideas._cleanName('x'.repeat(90)).length, 40);
  assert.strictEqual(ideas._cleanName(null), '');
});
test('poster: CDN poster first, then thumb, else null', () => {
  assert.strictEqual(ideas._poster({ cdn_key: 'a b' }), '/api/reels/poster/a%20b');
  assert.strictEqual(ideas._poster({ thumb: 'https://x/t.jpg' }), 'https://x/t.jpg');
  assert.strictEqual(ideas._poster({}), null);
});
test('toIdea: carries gym + shop so a pin can be acted on', () => {
  const i = ideas._toIdea({ id: 7, name: 'Glutes', category: 'Workout', cdn_key: 'g', gym_id: 3, shop_product_id: 9 });
  assert.deepStrictEqual(i, { id: 7, name: 'Glutes', category: 'Workout', poster: '/api/reels/poster/g', gymId: 3, shopProductId: 9 });
});
test('server mounts /api/ideas, serves /ideas, and Home links it', () => {
  const fs = require('fs'); const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const srv = read('server/server.js');
  assert.match(srv, /app\.use\('\/api\/ideas', ideasRouter\)/);
  assert.match(srv, /app\.get\(\['\/ideas', '\/ideas\/'\]/);
  const reels = read('frontend/public/reels/index.html');
  assert.match(reels, /value:'ideas:'/);
  assert.match(reels, /location\.href = '\/ideas\/'/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'frontend/public/ideas/index.html')));
});
