// Batch 9: Chats text size, Shop Under £10, Home Back/Forward 10s, Create saved prompts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: Text size option cycles 4 sizes', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /data-i="font"/);
  assert.match(h, /if\(a==='font'\)cycleFont\(\);/);
  assert.match(h, /var FONT_PX=\[13,15,18,21\]/);
  assert.match((read('frontend/public/app.ctr576.js') + read('frontend/public/sg-shop.js')), /chats\/app\.html\?v=2\.4/);
});
test('Shop: Under £10 = £5.01–£10, cheapest first', () => {
  global.window = { _sgShopRender: function () {} };
  delete require.cache[require.resolve('../frontend/public/shop-extras.js')];
  require('../frontend/public/shop-extras.js');
  const u = global.window._sgShopExtras.under10([
    { id: 1, pricePence: 999 }, { id: 2, pricePence: 499 }, { id: 3, pricePence: 600 }, { id: 4, pricePence: 1200 }]);
  assert.deepStrictEqual(u.map((x) => x.id), [3, 1]);
});
test('Home: Back/Forward 10s before Sleep timer', () => {
  const r = read('frontend/public/reels/index.html');
  assert.match(r, /'Back 10s'\) \+ window\.sgSheetOption\('\\u23E9', 'Forward 10s'\)\s*\+ window\.sgSheetOption\('\\uD83D\\uDE34', 'Sleep timer: '/);
  assert.match(r, /\[\[o\.length - 5, -10\], \[o\.length - 4, 10\]\]/);
});
test('Create: Save prompt + Saved row; cache bumped', () => {
  const s = read('frontend/public/squad-create.js');
  assert.match(s, /sg_saved_prompts/);
  assert.match(s, /sh\.appendChild\(savedRow\); drawSaved\(\);/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=4\.\d+/);
  assert.match(read('frontend/public/index.html'), /shop-extras\.js\?v=1\.\d+/);
});
