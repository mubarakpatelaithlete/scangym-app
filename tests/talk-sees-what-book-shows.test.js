/**
 * The Talk assistant and the Book tab must show the same gyms.
 *
 * On 8 Sep 2026 a customer asked Talk for "a gym near Kings Cross" and was told there
 * were none, while the Book tab behind the sheet was showing Anytime Fitness King's
 * Cross 442m away. Two causes, both pinned here:
 *   1. find_gyms compared "Kings" against "King's" literally.
 *   2. find_gyms only read our own gyms table; Book searches Google Places live and
 *      creates the gym row at booking time.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/lib/book-tools.js'), 'utf8');

test('find_gyms ignores apostrophes on both sides of the comparison', () => {
  assert.ok(/replace\(\/\['\\u2019\]\/g, ''\)/.test(src), 'the query must have apostrophes stripped');
  assert.ok(/regexp_replace\(name, '\[''\\u2019\]', '', 'g'\) ILIKE/.test(src), 'the name column must be compared with apostrophes stripped');
});

test('find_gyms falls back to the same live search the Book tab uses', () => {
  assert.ok(src.includes('/api/live/search?q='), 'must call the live search route');
  assert.ok(src.includes('/api/live/ensure-gym'), 'must register hits so book_gym gets a real gym id');
  const dbMiss = src.indexOf('const live = await liveSearchFallback(');
  const noMatch = src.indexOf('No gyms on ScanGym match');
  assert.ok(dbMiss !== -1 && dbMiss < noMatch, 'the fallback must run before giving up');
});
