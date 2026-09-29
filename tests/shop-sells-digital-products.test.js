/**
 * The Shop actually sells something.
 *
 * /shop shipped as a placeholder: a disabled search box, five decorative
 * category chips and "Digital products are coming soon". Everything a customer
 * could tap did nothing. This suite pins the parts of a real storefront that
 * are easy to get wrong when money and files are involved:
 *
 *   - the split of a sale always adds back to what was paid
 *   - a file is never reachable without a paid order behind it
 *   - a payment is only ever counted once, whichever path reports it
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');
const SHOP = read('server', 'routes', 'shop.js');
const SERVER = read('server', 'server.js');
const APP = read('frontend', 'public', 'app.ctr576.js');
const MIGRATION = read('migrations', '20260929b_shop_products.sql');
const { splitEarnings, validatePrice, formatPence } = require('../server/lib/shop-earnings');

// ─── 1. the money split ──────────────────────────────────────────────────────

test('a split always adds back to exactly what the customer paid', () => {
  for (let amount = 100; amount <= 50000; amount += 137) {
    const { platformFeePence, creatorEarningsPence } = splitEarnings(amount, 30);
    assert.strictEqual(platformFeePence + creatorEarningsPence, amount,
      `${amount}p split into ${platformFeePence} + ${creatorEarningsPence}`);
    assert.ok(platformFeePence >= 0 && creatorEarningsPence >= 0, 'a negative share is not a split');
  }
});

test('the rounding penny goes to the creator, not to us', () => {
  // £4.99 at 30% is 149.7p. Rounding our fee up would quietly shave the creator.
  const { platformFeePence, creatorEarningsPence } = splitEarnings(499, 30);
  assert.strictEqual(platformFeePence, 149);
  assert.strictEqual(creatorEarningsPence, 350);
});

test('a nonsense amount or percentage cannot produce money from nowhere', () => {
  assert.deepStrictEqual(splitEarnings(0), { platformFeePence: 0, creatorEarningsPence: 0 });
  assert.deepStrictEqual(splitEarnings(-500), { platformFeePence: 0, creatorEarningsPence: 0 });
  const over = splitEarnings(1000, 250);
  assert.strictEqual(over.platformFeePence + over.creatorEarningsPence, 1000);
});

test('prices below a pound and above five hundred are refused, with the reason', () => {
  assert.match(String(validatePrice(50)), /at least £1/);
  assert.match(String(validatePrice(60000)), /more than £500/);
  assert.strictEqual(validatePrice(499), null);
  assert.strictEqual(formatPence(499), '£4.99');
});

// ─── 2. the schema ───────────────────────────────────────────────────────────

test('products and orders are stored in pence, as integers', () => {
  assert.match(MIGRATION, /price_pence\s+INTEGER/);
  assert.match(MIGRATION, /amount_pence\s+INTEGER/);
  assert.match(MIGRATION, /creator_earnings_pence\s+INTEGER/);
  // Comments explain the choice; the column types are what actually enforce it.
  const columns = MIGRATION.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(columns, /NUMERIC|FLOAT|REAL|DOUBLE PRECISION/i, 'money in floating point');
});

test('an order records which payment it belongs to and which token unlocks it', () => {
  assert.match(MIGRATION, /stripe_payment_intent_id/);
  assert.match(MIGRATION, /download_token\s+TEXT UNIQUE/);
});

// ─── 3. selling ──────────────────────────────────────────────────────────────

test('only a signed-in creator with their own handle can list a product', () => {
  const route = SHOP.slice(SHOP.indexOf("router.post('/products'"), SHOP.indexOf("router.get('/my-products'"));
  assert.match(route, /authenticateUser/, 'anyone could list a product');
  assert.match(route, /ownHandle\(req\.user\.id\)/, 'the handle comes from the request, not the account');
  assert.match(route, /no_creator_handle/, 'a non-creator is not told why they cannot sell');
});

test('a seller cannot upload anything they like', () => {
  assert.match(SHOP, /ALLOWED_TYPES/, 'no file-type allowlist');
  assert.match(SHOP, /fileSize: 50 \* 1024 \* 1024/, 'no upload size limit');
  assert.match(SHOP, /replace\(\/\[\^a-zA-Z0-9\._-\]\/g, '_'\)/, 'the original filename is trusted on disk');
});

test('editing a product you do not own is a 404, not an edit', () => {
  const route = SHOP.slice(SHOP.indexOf("router.patch('/products/:id'"), SHOP.indexOf('/* ── Buying'));
  assert.match(route, /creator_handle !== handle/, 'ownership is not checked before updating');
});

// ─── 4. buying and downloading ───────────────────────────────────────────────

test('the order is written before the card is charged', () => {
  const route = SHOP.slice(SHOP.indexOf("router.post('/checkout'"), SHOP.indexOf('async function markOrderPaid'));
  assert.ok(route.indexOf('INSERT INTO shop_orders') < route.indexOf('paymentIntents.create'),
    'a payment could succeed with no order row to attach it to');
  assert.match(route, /alreadyOwned/, 'buying twice charges twice');
  assert.match(route, /needs_card/, 'a customer with no card gets no way forward');
});

test('a sale is counted exactly once, however the payment is reported', () => {
  assert.match(SHOP, /WHERE id = \$2 AND status <> 'paid'/, 'markOrderPaid is not idempotent');
  assert.match(SHOP, /if \(!rows\.length\) return null;/, 'a repeat webhook would double-count the sale');
  assert.match(SERVER, /shopRouter\.markOrderPaid/, 'the Stripe webhook cannot rescue a shop order');
});

test('a download needs a paid order, and does not last forever', () => {
  const route = SHOP.slice(SHOP.indexOf("router.get('/download/:token'"));
  assert.match(route, /order\.status !== 'paid'/, 'an unpaid order can download the file');
  assert.match(route, /DOWNLOAD_DAYS/, 'the link never expires');
  assert.match(route, /MAX_DOWNLOADS/, 'the link can be shared without limit');
  assert.match(route, /Content-Disposition/, 'the file opens in the tab instead of downloading');
  assert.doesNotMatch(SHOP, /res\.sendFile\(req\.(params|query)/, 'a path from the request reaches the filesystem');
});

// ─── 5. the storefront ───────────────────────────────────────────────────────

test('the Shop page lists real products instead of promising them', () => {
  const page = APP.slice(APP.indexOf('function ShopPage()'), APP.indexOf('window._sgShopBuy='));
  assert.ok(!page.includes('coming soon'), 'the placeholder copy is still there');
  assert.ok(!page.includes('disabled'), 'the search box is still disabled');
  assert.match(APP, /\/api\/shop\/products\?limit=40/, 'nothing fetches the listings');
  assert.match(APP, /window\._sgShopBuy=/, 'there is no way to buy');
  assert.match(APP, /_sgShopOpenSell/, 'creators have no way to list a product');
});

test('product text from a creator cannot inject markup into the page', () => {
  assert.match(APP, /function _sgShopEsc/, 'no escaping helper');
  const render = APP.slice(APP.indexOf('window._sgShopRender='), APP.indexOf('function _sgShopEsc'));
  assert.ok(!/\+p\.title\+/.test(render), 'a title is concatenated into HTML unescaped');
  assert.match(render, /_sgShopEsc\(p\.title\)/, 'the title is not escaped');
});
