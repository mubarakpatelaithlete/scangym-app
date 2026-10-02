// Batch 4: Chats search all messages, Shop Top creators (own file), Home screen time, Create negative prompt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: /api/dm/search finds my messages; list shows them under Messages', () => {
  assert.match(read('server/routes/dm.js'), /router\.get\('\/search'/);
  assert.match(read('frontend/public/chats/app.html'), /searchPeople\(q,\$\('people'\)\);searchMsgs\(q\);/);
});
test('Shop: Top creators lives in shop-extras.js, loaded after the core', () => {
  const ex = read('frontend/public/shop-extras.js');
  assert.match(ex, /Top creators/);
  assert.match(read('frontend/public/index.html'), /app\.ctr576\.js\?v=[\d.]+" defer><\/script>\n<script src="\/shop-extras\.js/);
  global.window = { _sgShopRender: function () {} }; // wraps at once, no retry timer
  require('../frontend/public/shop-extras.js');
  assert.ok(global.window._sgShopRender.__sgExtras);
  const top = global.window._sgShopExtras.topCreators([{ creatorHandle: 'a', salesCount: 1 }, { creatorHandle: 'b', salesCount: 5 }, { creatorHandle: 'a', salesCount: 1 }]);
  assert.deepStrictEqual(top.map((c) => c.h), ['b', 'a']);
  delete global.window;
});
test('Home: Screen time reminder in the long-press menu', () => {
  assert.match(read('frontend/public/reels/index.html'), /'Screen time: ' \+ \(sgScreenLimit\(\)/);
});
test('Create: negative prompt reaches Veo (fal + Gemini API)', () => {
  const v = require('../server/routes/squad-video.js')._internals;
  assert.strictEqual(v.cleanSettings({ negativePrompt: ' blur ' }).negativePrompt, 'blur');
  assert.strictEqual(v.cleanSettings({}).negativePrompt, undefined);
  assert.match(read('server/routes/squad-video.js'), /negative_prompt: s\.negativePrompt/);
});
