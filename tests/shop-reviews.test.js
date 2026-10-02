// Task 108/119 step 1: star ratings + verified-purchase reviews in the Shop.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('reviews table: one per buyer, 1-5 stars', () => {
  const sql = read('migrations/20261002b_shop_reviews.sql');
  assert.match(sql, /CHECK \(rating BETWEEN 1 AND 5\)/);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS shop_reviews_one_per_buyer ON shop_reviews \(product_id, user_id\)/);
});
test('only paying buyers can post a review; listings carry the star average', () => {
  const shop = read('server/routes/shop.js');
  assert.match(shop, /router\.get\('\/products\/:id\/reviews'/);
  assert.match(shop, /router\.post\('\/products\/:id\/reviews', authenticateUser/);
  assert.match(shop, /Only buyers can review this product/);
  assert.match(shop, /rating_avg, rv\.rating_n FROM shop_products \$\{RATING_JOIN\}/);
});
test('product sheet shows reviews and a rate box for owners; cards show stars', () => {
  const app = (read('frontend/public/app.ctr576.js') + read('frontend/public/sg-shop.js'));
  assert.match(app, /window\._sgShopReviews\(p\.id,!!owned\)/);
  assert.match(app, /id="sg-shop-reviews"/);
  assert.match(app, /Verified purchase/);
  assert.match(app, /\+_sgShopStars\(p\)/);
});
