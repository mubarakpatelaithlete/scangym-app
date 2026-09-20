/**
 * A gym we show for "Inverness" must actually be near Inverness — or be openly labelled
 * as somewhere else.
 *
 * Observed on live, 20 Sep 2026: Google Places was returning REQUEST_DENIED for every call
 * ("You must enable Billing on the Google Cloud Project"), so every channel fell through to
 * the database. That fallback, when the typed place matched nothing, ran a plain
 * "ORDER BY rating LIMIT 20" over the whole gyms table — so /api/live/search?query=Inverness
 * and ?query=Dubai both answered with Elite Boxing (Bolton) and CrossFit Naples, presented as
 * results for the city the customer typed. Silent, plausible-looking, and wrong.
 *
 * Rules pinned here:
 *   1. No saved gyms for the typed place => no gyms, not a global top-rated list.
 *   2. Widening is allowed, but it must name the city it actually searched.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'server/routes/liveSearch.js'),
  'utf8'
);

function dbSearchBody() {
  const start = SRC.indexOf('async function searchGymsFromDatabase');
  assert.ok(start > -1, 'searchGymsFromDatabase must exist');
  const next = SRC.indexOf('\nfunction formatDbGym', start);
  assert.ok(next > start, 'could not bound searchGymsFromDatabase');
  return SRC.slice(start, next);
}

test('an unmatched location returns nothing instead of gyms from anywhere', () => {
  const body = dbSearchBody();
  assert.ok(
    /result\.rows\.length === 0[\s\S]{0,400}?return \[\];/.test(body),
    'when no row matches the location the fallback must return an empty list'
  );
  assert.ok(
    !/const allGyms\b/.test(body),
    'the unbounded "top rated gyms anywhere" query must not come back'
  );
});

test('the location filter itself is still a location filter', () => {
  const body = dbSearchBody();
  assert.ok(
    /WHERE name ILIKE \$1 OR city ILIKE \$1 OR address ILIKE \$1/.test(body),
    'matching must stay scoped to name/city/address'
  );
});

test('widening from our own table is labelled with the city actually searched', () => {
  assert.ok(SRC.includes('async function dbFallbackToNearestCity'), 'helper must exist');
  const start = SRC.indexOf('async function dbFallbackToNearestCity');
  const body = SRC.slice(start, SRC.indexOf('\nrouter.get', start));
  assert.ok(body.includes('nearestMetro('), 'must pick a real nearest metro');
  assert.ok(
    body.includes("source: 'database_nearest_city_fallback'"),
    'a widened result must not be labelled as a normal local result'
  );
  assert.ok(
    /fallback: \{ requested: asked, city: metro\.city/.test(body),
    'the response must name both what was asked for and what was served'
  );
  assert.ok(
    /if \(asked && asked\.toLowerCase\(\) === metro\.city\.toLowerCase\(\)\) return null;/.test(body),
    'never widen a search to the city it already asked for'
  );
});

test('both Places-unavailable paths try the labelled widening before giving up', () => {
  const calls = SRC.match(/await dbFallbackToNearestCity\(/g) || [];
  assert.ok(
    calls.length >= 2,
    `expected the no-API-key and non-OK-status paths to widen, found ${calls.length}`
  );
  assert.ok(
    /liveSearchUnavailable: true/.test(SRC),
    'a widened/empty answer caused by a dead Places key must say live search was unavailable'
  );
});
