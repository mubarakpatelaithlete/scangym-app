// Batch 5: Chats message Info, Shop Deals under £5, Home title decode, Create prompt counter + Clear.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: long-press menu has Info, which opens a Message info sheet', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /data-a="info"/);
  assert.match(h, /if\(a==='info'\)msgInfo\(m\);/);
  assert.match(h, /function msgInfo\(m\)/);
});
test('Shop: Deals under £5 picks cheapest paid items', () => {
  global.window = { _sgShopRender: function () {} };
  delete require.cache[require.resolve('../frontend/public/shop-extras.js')];
  require('../frontend/public/shop-extras.js');
  const d = global.window._sgShopExtras.deals([{ id: 1, pricePence: 499 }, { id: 2, pricePence: 0 }, { id: 3, pricePence: 900 }, { id: 4, pricePence: 150 }]);
  assert.deepStrictEqual(d.map((x) => x.id), [4, 1]);
});
test('Home: YouTube titles are decoded (no &amp; on screen)', () => {
  const { decodeEntities } = require('../server/lib/home-tabs.js');
  assert.strictEqual(decodeEntities('Rock &amp; Roll &#39;Live&#39; &quot;x&quot;'), 'Rock & Roll \'Live\' "x"');
  assert.strictEqual(decodeEntities(null), '');
});
test('Create: prompt counter + Clear under the prompt; cache bumped', () => {
  assert.match(read('frontend/public/squad-create.js'), /cnt\.id = 'sv-count'/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=\d+\.\d+/);
  assert.match(read('frontend/public/index.html'), /shop-extras\.js\?v=1\.[1-9]/);
});
