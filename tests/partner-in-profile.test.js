const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const app = (fs.readFileSync(require('node:path').join(__dirname, '../frontend/public/app.ctr576.js'), 'utf8') + fs.readFileSync(require('node:path').join(__dirname, '../frontend/public/sg-shop.js'), 'utf8'));
const nav = app.slice(app.indexOf('function BottomTabBar('), app.indexOf('// ═══ STAFF QR SCANNER PAGE'));
const profile = app.slice(app.indexOf('function MoreHubPage('), app.indexOf('// ═══════════════════════════════════════════════════════════════════\n//  CREATOR EARNINGS DASHBOARD'));
test('Partner is not a main tab; Profile is active on /partner', () => {
  for (const tab of ['more', 'partner']) {
    const ctx = { state: { activeTab: tab } };
    vm.runInNewContext(nav + ';result=BottomTabBar()', ctx);
    assert.doesNotMatch(ctx.result, /aria-label="Partner"/);
    assert.match(ctx.result, /class="sg-tab-item active"[^>]*aria-selected="true" aria-label="Profile and settings"/);
  }
});
test('both signed-in and signed-out Profile have a button to the preserved Partner page', () => {
  for (const user of [null, {id:'test',name:'Test'}]) {
    const ctx = {state:{user},sgRailCircle:()=>'<svg></svg>',sgPriceDisplay:()=> '£5'};
    vm.runInNewContext(profile + ';result=MoreHubPage()', ctx);
    assert.match(ctx.result, /<button[^>]*onclick="navigate\('\/partner'\)"[^>]*aria-label="Partner"/);
    assert.match(ctx.result, /<button[^>]*onclick="navigate\('\/explore'\)"[^>]*aria-label="Book a gym"/);
  }
  assert.match(app, /else if\(path==='\/partner'\|\|path==='\/partner\/'\)page=PartnerFullPage\(\)/);
});

test('Book remains reachable from Profile and the Shop stays digital-only', () => {
  assert.match(profile, /aria-label="Book a gym"/);
  const shopStart = app.indexOf('function ShopPage()');
  const shopEnd = app.indexOf('// ─── More Hub Page', shopStart);
  const shop = app.slice(shopStart, shopEnd);
  assert.match(shop, /Digital Shop/);
  assert.match(shop, /No physical goods/);
  // The Shop is live now (creator listings + checkout); what must not change
  // is that it stays digital-only — no physical goods, no shipping.
  assert.match(shop, /_sgShopLoad/);
  assert.match(nav, /aria-label="Create"[\s\S]*?sg-tab-label\">Create/);
  assert.match(nav, /aria-label="Shop"[\s\S]*?sg-tab-label\">Shop/);
  assert.doesNotMatch(nav, /aria-label="Book a gym"/);
});

test('Book stays reachable from Profile, and the live Shop stays digital-only', () => {
  for (const user of [null, { id: 'test', name: 'Test' }]) {
    const ctx = { state: { user }, sgRailCircle: () => '<svg></svg>', sgPriceDisplay: () => '£5' };
    vm.runInNewContext(profile + ';result=MoreHubPage()', ctx);
    assert.match(ctx.result, /aria-label="Book a gym"/);
  }
  const shop = app.slice(app.indexOf('function ShopPage()'), app.indexOf('// ─── More Hub Page'));
  assert.match(shop, /Digital Shop/);
  assert.match(shop, /No physical goods/);
  // The Shop is live now (creator listings + checkout); what must not change
  // is that it stays digital-only — no physical goods, no shipping.
  assert.match(shop, /_sgShopLoad/);
  assert.match(nav, /aria-label="Create"[\s\S]*?sg-tab-label">Create/);
  assert.match(nav, /aria-label="Shop"[\s\S]*?sg-tab-label">Shop/);
  assert.doesNotMatch(nav, /aria-label="Book a gym"/);
});
