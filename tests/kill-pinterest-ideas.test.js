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
test('cleanId: feed ids only (catalog number or social_N)', () => {
  assert.strictEqual(ideas._cleanId(12), '12');
  assert.strictEqual(ideas._cleanId('social_54921'), 'social_54921');
  assert.strictEqual(ideas._cleanId('1; DROP TABLE x'), null);
  assert.strictEqual(ideas._cleanId(''), null);
});
test('toIdea: thumbnail first, own MP4 frame as fallback, keeps gym + shop', () => {
  const a = ideas._toIdea({ id: 7, name: 'Glutes', category: 'Workout', thumb: null, url: 'https://cdn/x.mp4', kind: 'catalog', gym_id: 3, shop_product_id: 9 });
  assert.deepStrictEqual(a, { id: '7', name: 'Glutes', category: 'Workout', poster: null, video: 'https://cdn/x.mp4', gymId: 3, shopProductId: 9 });
  const b = ideas._toIdea({ id: 'social_1', name: 'Abs', thumb: 'https://i.ytimg.com/t.jpg', url: 'https://youtube.com/shorts/x', kind: 'social' });
  assert.strictEqual(b.poster, 'https://i.ytimg.com/t.jpg');
  assert.strictEqual(b.video, null);
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
