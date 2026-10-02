// Batch 7: Chats contact Notes, Shop Best sellers, Home Watch from start, Create Recent prompts.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: contact info has private Notes', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /data-i="note"/);
  assert.match(h, /if\(a==='note'\)noteSheet\(id\);/);
  assert.match(h, /function noteSheet\(id\)\{/);
  assert.match((read('frontend/public/app.ctr576.js') + read('frontend/public/sg-shop.js')), /chats\/app\.html\?v=2\.\d+/);
});
test('Shop: Best sellers = sold items, most sold first', () => {
  global.window = { _sgShopRender: function () {} };
  delete require.cache[require.resolve('../frontend/public/shop-extras.js')];
  require('../frontend/public/shop-extras.js');
  const b = global.window._sgShopExtras.bestSellers([
    { id: 1, salesCount: 3 }, { id: 2, salesCount: 0 }, { id: 3, salesCount: 9 }, { id: 4 }]);
  assert.deepStrictEqual(b.map((x) => x.id), [3, 1]);
});
test('Home: reel menu has Watch from start before Copy link', () => {
  const r = read('frontend/public/reels/index.html');
  assert.match(r, /'Watch from start'\)\s*\+ window\.sgSheetOption\('\\uD83D\\uDD17', 'Copy link'\)/);
  assert.match(r, /o\[o\.length - 2\]\.addEventListener/);
});
test('Create: voice prompt only when the browser supports speech; cache bumped', () => {
  const s = read('frontend/public/squad-create.js');
  assert.match(s, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(s, /if \(SR\) \{/);
  assert.doesNotMatch(s, /sg_recent_prompts/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=\d+\.\d+/);
  assert.match(read('frontend/public/index.html'), /shop-extras\.js\?v=1\.\d+/);
});
