// Batch 2 (Tasks 156/157/158): Create chips folded under More, a more solid sheet,
// a stronger caption fade on Home, and Shop zoom + "About this item".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const r = (f) => fs.readFileSync(require('node:path').join(__dirname, '..', f), 'utf8');
test('Create: Recent/Style/Surprise fold under one More chip', () => {
  const s = r('frontend/public/squad-create.js');
  assert.match(s, /sv-ptools-more/);
  assert.match(s, /\\u22EF More/);
});
test('Home: taller caption fade', () => { assert.match(r('frontend/public/reels/index.html'), /height:300px;\s*background:linear-gradient\(0deg,rgba\(0,0,0,\.8\)/); });
test('Shop: zoom and About this item', () => {
  const s = r('frontend/public/sg-shop.js');
  assert.match(s, /window\._sgShopZoom=/);
  assert.match(s, /About this item/);
  assert.match(s, /_sgShopAbout\(desc\)/);
});
test('Shop B3: basket — add, open, buy all through the one-tap checkout', () => {
  const s = r('frontend/public/sg-shop.js');
  for (const f of ['_sgShopAddBasket', '_sgShopOpenBasket', '_sgShopBuyAll', '_sgShopRemoveBasket']) assert.match(s, new RegExp(`window\\.${f}=`));
  assert.match(s, /id="sg-shop-basket-btn"/);
  assert.match(s, /\/api\/shop\/checkout/);
});
