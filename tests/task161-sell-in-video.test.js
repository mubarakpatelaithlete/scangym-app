const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const r = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('Task 161: a posted creation can sell its creator\'s own product', () => {
  assert.match(r('migrations/20261002e_video_shop_product.sql'), /shop_product_id/);
  const pe = r('server/routes/post-everywhere.js');
  assert.match(pe, /creator_user_id::text = \$2 AND status = 'active'/);
  assert.match(r('server/routes/reels.js'), /shopProductId: row\.shop_product_id/);
  assert.match(r('frontend/public/reels/index.html'), /productId: \(video && video\.shopProductId\)/);
  assert.match(r('frontend/public/reel-shop.js'), /Sold in this video/);
  assert.match(r('frontend/public/squad-create.js'), /_sgSoldFor\[abs\]/);
});
