/**
 * Two properties a visitor judges in the first five seconds.
 *
 *   1. The first screen shows real gyms without waiting on a live Google call.
 *   2. The reel — global content anyone can watch from anywhere — carries a *local* offer:
 *      the viewer's own city and a real price, never an invented one.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/public/app.ctr576.js'), 'utf8');

/** Run just the local-offer helper against a fake app state. */
function localOffer(state, cachedCity) {
  const start = src.indexOf('window._sgLocalOffer=function(){');
  const end = src.indexOf('\n};', start) + 3;
  const sandbox = {
    state,
    getCachedLocation: () => (cachedCity ? { city: cachedCity } : null),
    window: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(start, end), sandbox);
  return sandbox.window._sgLocalOffer();
}

test('the reel offer names the viewer city and the cheapest real price', () => {
  const offer = localOffer({
    searchQuery: 'gyms in Manchester',
    gyms: [{ price: '£5.00' }, { price: '£4.49' }, { price: '£6.99' }],
  });
  assert.equal(offer.city, 'Manchester');
  assert.equal(offer.from, '£4.49');
});

test('a price is never invented when no gym has one', () => {
  const offer = localOffer({ searchQuery: 'gyms in Leeds', gyms: [{}, { price: '' }] });
  assert.equal(offer.city, 'Leeds');
  assert.equal(offer.from, null, 'better no price than a made-up one under a video');
});

test('the city falls back to the cached location, and stays null when truly unknown', () => {
  assert.equal(localOffer({ searchQuery: '', gyms: [] }, 'Dubai').city, 'Dubai');
  assert.equal(localOffer({ searchQuery: '', gyms: [] }, null), null);
});

test('a non-sterling currency is preserved rather than forced to pounds', () => {
  const offer = localOffer({ searchQuery: 'gyms in New York', gyms: [{ price: '$8.00' }, { price: '$6.49' }] });
  assert.equal(offer.from, '$6.49');
});

test('the reels bar sells the local offer instead of asking the viewer to go looking', () => {
  assert.ok(src.includes("('Book in '+_local.city)"), 'the reels CTA must name the city');
  assert.ok(src.includes("('\\u00b7 from '+_lo.from)"), 'the reels CTA must carry the price');
});

test('the first paint comes from the last visit, before any network call', () => {
  assert.ok(src.includes('BOOT_KEY:'), 'boot cache missing');
  assert.ok(src.includes('L0 instant paint'), 'the instant paint must happen in autoLoadGyms');
  // Compare inside autoLoadGyms itself — auto-city is also fetched by an older helper above it.
  const fn = src.slice(src.indexOf('window.autoLoadGyms=async function()'));
  const boot = fn.indexOf('L0 instant paint');
  const layer3 = fn.indexOf("fetch('/api/geolocation/auto-city'");
  assert.ok(boot > -1 && layer3 > -1, 'both steps must live in autoLoadGyms');
  assert.ok(boot < layer3, 'the cached paint must run before any network layer');
});

test('the boot cache is written from successful searches and expires', () => {
  assert.ok(src.includes('persistBoot(q,gyms)'), 'successful searches must seed the boot cache');
  assert.ok(src.includes('BOOT_TTL:24*60*60*1000'), 'a day-old cache is stale enough to expire');
  assert.ok(src.includes('gyms.slice(0,12)'), 'keep the payload small enough for localStorage');
});

test('the London default no longer overwrites a real cached first paint', () => {
  assert.ok(src.includes('if(window._locationLayer===0&&!state._bootPainted)'), 'guard missing');
});

test('every path that puts gyms on screen also seeds the next visit', () => {
  const kept = src.slice(src.indexOf('nothing better is showing yet'), src.indexOf('nothing better is showing yet') + 500);
  assert.ok(kept.includes('_gymCache.setSearch(query,_stale)'), 'the early-return path skipped the boot cache');
});
