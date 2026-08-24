/**
 * A first-time visitor must never be shown an empty product.
 *
 * Observed on live, 24 Aug 2026: a visitor's IP resolved to Boardman, Oregon; the app searched
 * "gyms in Boardman", Google honestly returned zero, and the running app *replaced* the London
 * results already on screen with "No Gyms Found". The precision upgrade was treated as an
 * improvement even though it had no inventory behind it.
 *
 * These pin the three rules that came out of it:
 *   1. Automatic (location-derived) empty results never overwrite results already showing.
 *   2. When a town has nothing, offer the nearest city that does — and label it honestly.
 *   3. An explicit search the visitor typed is never silently relocated.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const { nearestMetro, requestedCity, mayWiden, haversineKm } = require(path.join(ROOT, 'server/lib/search-fallback.js'));

test('the nearest metro to Boardman, Oregon is a real US city, not London', () => {
  const m = nearestMetro(45.8234, -119.7257);
  assert.equal(m.city, 'San Francisco');
  assert.ok(m.distanceKm > 0 && m.distanceKm < 2000, `implausible distance ${m.distanceKm}`);
});

test('a UK visitor with no gyms nearby is offered a UK city', () => {
  assert.equal(nearestMetro(53.79, -1.55).city, 'Manchester'); // Leeds
  assert.equal(nearestMetro(50.72, -1.88).city, 'London');     // Bournemouth
});

test('with no coordinates at all we fall back to the home market rather than guessing', () => {
  assert.equal(nearestMetro(undefined, undefined).city, 'London');
  assert.equal(nearestMetro('nonsense', null).city, 'London');
  assert.equal(nearestMetro(undefined, undefined).distanceKm, null);
});

test('distances are real: London to Manchester is about 260km', () => {
  const km = haversineKm(51.5074, -0.1278, 53.4808, -2.2426);
  assert.ok(km > 240 && km < 280, `got ${km}`);
});

test('we can name the town the visitor actually asked about, for an honest message', () => {
  assert.equal(requestedCity('gyms in Boardman'), 'Boardman');
  assert.equal(requestedCity('gym near Shoreditch'), 'Shoreditch');
  assert.equal(requestedCity('gyms in Leeds 24 hour'), 'Leeds');
  assert.equal(requestedCity(''), null);
});

test('a typed search is never widened; an automatic empty one is', () => {
  assert.equal(mayWiden({ explicit: true, hasResults: false }), false, 'do not relocate a deliberate search');
  assert.equal(mayWiden({ explicit: false, hasResults: false }), true);
  assert.equal(mayWiden({ explicit: false, hasResults: true }), false, 'nothing to widen when results exist');
});

test('the search route widens instead of returning an empty list', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/liveSearch.js'), 'utf8');
  assert.ok(src.includes('fallbackToNearestCity'), 'zero results must attempt a nearest-city fallback');
  assert.ok(src.includes("widened = { reason: 'distance'"), 'the 50km cap must widen before giving up');
  assert.ok(src.includes("source: 'nearest_city_fallback'"), 'the client must be able to tell it was widened');
});

test('the client never lets an automatic empty result wipe a working screen', () => {
  const src = fs.readFileSync(path.join(ROOT, 'frontend/public/app.ctr576.js'), 'utf8');
  assert.ok(src.includes("if(!isExplicit && _incoming.length===0 && state.gyms.length>0)"), 'guard missing');
  assert.ok(src.includes('No gyms in '), 'the visitor must be told when we widened the area');
});
