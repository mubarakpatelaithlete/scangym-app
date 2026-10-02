// Batch 8: Chats link preview, Shop Free row, Home Sleep timer, Create Paste.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: messages with a link get a preview card', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /return linkify\(b\)\+linkPreview\(b\);/);
  assert.match(h, /function linkPreview\(b\)\{/);
  assert.match(read('frontend/public/app.ctr576.js'), /chats\/app\.html\?v=2\.\d+/);
});
test('Shop: Free row = price 0 only, newest first', () => {
  global.window = { _sgShopRender: function () {} };
  delete require.cache[require.resolve('../frontend/public/shop-extras.js')];
  require('../frontend/public/shop-extras.js');
  const f = global.window._sgShopExtras.freebies([
    { id: 1, pricePence: 0, createdAt: '2026-09-01' }, { id: 2, pricePence: 99 },
    { id: 3, pricePence: 0, createdAt: '2026-10-01' }, { id: 4 }]);
  assert.deepStrictEqual(f.map((x) => x.id), [3, 1]);
});
test('Home: Sleep timer sits before Watch from start and Copy link', () => {
  const r = read('frontend/public/reels/index.html');
  assert.match(r, /'Sleep timer: '/);
  assert.match(r, /o\[o\.length - 3\]\.addEventListener/);
  assert.match(r, /\[0, 15, 30, 60\]/);
});
test('Create: Paste button; cache bumped', () => {
  assert.match(read('frontend/public/squad-create.js'), /clipboard\.readText/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=\d+\.\d+/);
  assert.match(read('frontend/public/index.html'), /shop-extras\.js\?v=1\.\d+/);
});
