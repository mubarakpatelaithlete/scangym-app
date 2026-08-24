/**
 * The Book tab must never present a far-away result as a nearby one.
 *
 * The live site showed a UK visitor a single gym in Boardman, Ohio, labelled
 * "3163.6km", under a red "Location sharing disabled" error, with a
 * "<- 1 of 1 ->" swipe counter. Every part of that is a credibility bug: the
 * number is meaningless at that range, the error blames the user for a normal
 * choice, and the counter advertises swiping that does nothing.
 *
 * These tests run the real helpers out of app.ctr576.js so the rules cannot
 * silently regress.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_PATH = path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/**
 * app.ctr576.js is a 1.6MB browser bundle that cannot be require()d. Extract the
 * self-contained distance helpers and evaluate just those.
 */
function loadHelpers() {
  const start = SRC.indexOf('var SG_FAR_KM=');
  assert.notStrictEqual(start, -1, 'SG_FAR_KM block missing from app.ctr576.js');
  const marker = 'window.sgIsFar=sgIsFar;';
  const end = SRC.indexOf(marker, start);
  assert.notStrictEqual(end, -1, 'sgIsFar export missing from app.ctr576.js');

  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SRC.slice(start, end + marker.length), sandbox);
  return sandbox;
}

const H = loadHelpers();

const OHIO = {
  name: 'Creekside Fitness & Health Center',
  address: '1419 Boardman-Canfield Rd Ste 390, Boardman, OH 44512, USA',
  distance: 3163.6,
};

// ─── distance honesty ────────────────────────────────────────────────────────

test('the exact live regression: 3163.6km is never printed on the card', () => {
  const label = H.sgDistanceLabel(OHIO);
  assert.doesNotMatch(label, /3163/);
  assert.doesNotMatch(label, /km/);
});

test('a far gym is labelled with its own locality instead', () => {
  assert.strictEqual(H.sgDistanceLabel(OHIO), 'Boardman, OH');
});

test('a far gym with no usable address still avoids a bogus distance', () => {
  const label = H.sgDistanceLabel({ distance: 4000, address: '' });
  assert.strictEqual(label, 'Far from you');
  assert.doesNotMatch(label, /\d/);
});

test('genuinely nearby distances are still shown, in km', () => {
  assert.strictEqual(H.sgDistanceLabel({ distance: 2.4, address: 'Camden, London, UK' }), '2.4km');
});

test('sub-kilometre distances are shown in metres, not "0.4km"', () => {
  assert.strictEqual(H.sgDistanceLabel({ distance: 0.42, address: 'Soho, London, UK' }), '420m');
});

test('a real Google travel label wins over straight-line distance when close', () => {
  assert.strictEqual(
    H.sgDistanceLabel({ distance: 3, _realTravelLabel: '11 min walk' }),
    '11 min walk'
  );
});

test('but a travel label cannot rescue a gym on another continent', () => {
  const gym = Object.assign({ _realTravelLabel: '35 hr drive' }, OHIO);
  assert.strictEqual(H.sgDistanceLabel(gym), 'Boardman, OH');
});

test('missing distance degrades to "Nearby" rather than NaN or undefined', () => {
  assert.strictEqual(H.sgDistanceLabel({ address: 'Leeds, UK' }), 'Nearby');
  assert.strictEqual(H.sgDistanceLabel({}), 'Nearby');
});

test('non-finite distances never reach the card', () => {
  for (const d of [NaN, Infinity, null, undefined]) {
    assert.strictEqual(H.sgDistanceLabel({ distance: d }), 'Nearby');
  }
});

test('the far threshold sits above real commutes but well below a continent', () => {
  assert.ok(H.SG_FAR_KM >= 25 && H.SG_FAR_KM <= 150, `SG_FAR_KM=${H.SG_FAR_KM}`);
  assert.strictEqual(H.sgIsFar({ distance: H.SG_FAR_KM - 1 }), false);
  assert.strictEqual(H.sgIsFar({ distance: H.SG_FAR_KM + 1 }), true);
});

test('locality parsing survives address shapes other than the US one', () => {
  // UK postcodes are alphanumeric ("LS1 4HR"), US state codes must survive ("OH").
  assert.strictEqual(H.sgGymLocality({ address: '12 High St, Leeds, LS1 4HR, UK' }), 'Leeds');
  assert.strictEqual(H.sgGymLocality({ address: 'Leeds, UK' }), 'Leeds');
  assert.strictEqual(H.sgGymLocality({ address: '' }), '');
});

// ─── the "1 of 1" swipe counter ──────────────────────────────────────────────

test('single-result lists do not render a swipe counter', () => {
  assert.match(SRC, /if\(totalC>1\)\s*html\+='<div class="tt-counter"/);
  assert.match(SRC, /if\(_cards\.length>1\)\s*cardHtml\+='<div class="tt-counter"/);
});

test('no unguarded tt-counter render remains', () => {
  const renders = SRC.match(/\+='<div class="tt-counter">/g) || [];
  const guards =
    SRC.match(/if\((?:totalC|_cards\.length)>1\)\s*(?:html|cardHtml)\+='<div class="tt-counter">/g) ||
    [];
  assert.strictEqual(renders.length, guards.length, 'every tt-counter render must be guarded');
});

// ─── the location banner blames nobody ───────────────────────────────────────

test('the alarming "Location sharing disabled" copy is gone', () => {
  assert.doesNotMatch(SRC, /Location sharing disabled/);
});

test('the denied state names the city actually being shown', () => {
  assert.match(SRC, /Showing gyms in/);
  assert.match(SRC, /Not your area\? Tap to change/);
});

test('sgCurrentSearchCity exists to source that city name', () => {
  assert.match(SRC, /function sgCurrentSearchCity\(\)/);
});
