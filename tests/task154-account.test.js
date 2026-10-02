const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pub = path.join(__dirname, '..', 'frontend', 'public');
test('Task 154: refund policy page exists and is linked from the Shop', () => {
  const html = fs.readFileSync(path.join(pub, 'refunds', 'index.html'), 'utf8');
  assert.match(html, /Refund Policy/);
  assert.match(html, /bookings@scangym\.com/);
  assert.match(fs.readFileSync(path.join(pub, 'sg-shop.js'), 'utf8'), /href="\/refunds"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8'), /'\/refunds'/);
});
test('Task 154: Edit Profile gets Log out + Delete account', () => {
  const js = fs.readFileSync(path.join(pub, 'sg-account.js'), 'utf8');
  assert.match(js, /Delete account/);
  assert.match(js, /handleLogout/);
  assert.match(fs.readFileSync(path.join(pub, 'index.html'), 'utf8'), /sg-account\.js\?v=/);
});
test('Task 154: Shop has My orders', () => {
  assert.match(fs.readFileSync(path.join(pub, 'sg-shop.js'), 'utf8'), /_sgShopOpenOrders=async/);
});
