// Batch 6: Chats Clear chat, Shop New arrivals, Home Copy link, Create Copy prompt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('Chats: chat menu has Clear chat (hides messages on this phone)', () => {
  const h = read('frontend/public/chats/app.html');
  assert.match(h, /data-i="clear"/);
  assert.match(h, /if\(a==='clear'\)clearChat\(\);/);
  assert.match(h, /function clearChat\(\)\{/);
  assert.match((read('frontend/public/app.ctr576.js') + read('frontend/public/sg-shop.js')), /chats\/app\.html\?v=2\.\d+/);
});
test('Shop: New arrivals = last 14 days, newest first', () => {
  global.window = { _sgShopRender: function () {} };
  delete require.cache[require.resolve('../frontend/public/shop-extras.js')];
  require('../frontend/public/shop-extras.js');
  const now = Date.parse('2026-10-02T00:00:00Z');
  const a = global.window._sgShopExtras.arrivals([
    { id: 1, createdAt: '2026-09-30T00:00:00Z' }, { id: 2, createdAt: '2026-08-01T00:00:00Z' },
    { id: 3, createdAt: '2026-10-01T00:00:00Z' }, { id: 4 }], now);
  assert.deepStrictEqual(a.map((x) => x.id), [3, 1]);
});
test('Home: reel menu ends with Copy link', () => {
  const r = read('frontend/public/reels/index.html');
  assert.match(r, /sgSheetOption\('\\uD83D\\uDD17', 'Copy link'\)/);
  assert.match(r, /o\[o\.length - 1\]\.addEventListener/);
});
test('Create: Copy prompt next to Clear; cache bumped', () => {
  assert.match(read('frontend/public/squad-create.js'), /Prompt copied/);
  assert.match(read('frontend/public/index.html'), /squad-create\.js\?v=\d+\.\d+/);
  assert.match(read('frontend/public/index.html'), /shop-extras\.js\?v=1\.\d+/);
});
