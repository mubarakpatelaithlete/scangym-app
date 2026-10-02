/**
 * Task 158 (Shop Batch 1): the Shop tab moved out of app.ctr576.js into the
 * lazy sg-shop chunk. The main bundle had 61 bytes of budget left, which is
 * what blocked the Shop "Top creators" row and every later Shop feature.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PUB = path.join(__dirname, '..', 'frontend', 'public');
const APP = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');
const SHOP = fs.readFileSync(path.join(PUB, 'sg-shop.js'), 'utf8');

test('the Shop lives in sg-shop.js, not in the main bundle', () => {
  assert.match(SHOP, /^function ShopPage\(\)/m);
  assert.match(SHOP, /window\._sgShopRender\s*=/);
  assert.ok(!/^function ShopPage\(\)/m.test(APP), 'ShopPage must not be back in core');
  assert.ok(Buffer.byteLength(APP) < 1_500_000, 'the split should leave real headroom');
});

test('/shop and the Shop tab wait for the chunk before rendering', () => {
  const start = APP.indexOf('function _sgChunkForView(');
  const end = APP.indexOf('\nfunction _renderInner(', start);
  const sb = {}; vm.createContext(sb);
  vm.runInContext(APP.slice(start, end) + ';this.gate=_sgChunkForView;', sb);
  assert.strictEqual(sb.gate('/shop', 'book'), 'sg-shop');
  assert.strictEqual(sb.gate('/shop/123', 'book'), 'sg-shop');
  assert.strictEqual(sb.gate('/', 'shop'), 'sg-shop');
  assert.strictEqual(sb.gate('/', 'book'), '');
});

test('entry points other scripts call have core stubs; the chunk is built and prefetched', () => {
  for (const n of ['_sgShopOpen', '_sgShopOpenSell', '_sgShopSimpleSheet', '_sgShopStore']) {
    assert.match(APP, new RegExp(`window\\.${n}=sgChunkStub\\('sg-shop','${n}'\\)`));
    assert.match(SHOP, new RegExp(`window\\.${n}\\s*=`), `${n} defined in the chunk`);
  }
  assert.match(APP, /_sgShopState=/, 'state stays in core for shop-extras/reel-shop');
  assert.match(APP, /sgPrefetchChunks\(\['sg-scansquad','sg-shop'\]\)/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'build.js'), 'utf8'), /LAZY_CHUNKS = \['sg-scansquad', 'sg-shop'\]/);
});

test('wrappers re-attach when the chunk lands', () => {
  assert.match(fs.readFileSync(path.join(PUB, 'shop-extras.js'), 'utf8'), /sgOnChunk\('sg-shop', wrap\)/);
  assert.match(fs.readFileSync(path.join(PUB, 'sg-signin-ask.js'), 'utf8'), /sgOnChunk\('sg-shop', wrapBuy\)/);
});
