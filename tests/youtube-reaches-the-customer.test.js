/**
 * The YouTube slides have to reach the feed the customer actually gets.
 *
 * Goal 3 was reported done: routes/social-reels.js fills social_reels from the
 * YouTube Data API, /api/reels/feed interleaves them, and the reels player has
 * a whole social-slide renderer (one iframe at a time, badge, attribution).
 * Every one of those parts worked.
 *
 * But the player asks /api/reels/geo-feed FIRST and only falls back to /feed
 * when geo-feed errors or returns nothing. geo-feed sliced the raw catalog and
 * nothing else — so the first page every visitor swiped was catalog-only.
 * Checked on the live site in a browser, logged out: 7 video elements, zero
 * iframes, zero "YouTube" badges. The feature existed and no customer saw it.
 *
 * These tests pin the two endpoints together: whatever the fallback does with
 * social reels, the primary path must do too.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'routes', 'reels.js'),
  'utf8'
);

/** Body of a route handler, from its declaration to the next one. */
function handler(pathName) {
  const start = SRC.indexOf(`router.get('${pathName}'`);
  assert.ok(start > -1, `${pathName} must exist`);
  const next = SRC.indexOf('\nrouter.', start + 10);
  return SRC.slice(start, next === -1 ? SRC.length : next);
}

test('geo-feed interleaves social reels, exactly like the feed it stands in front of', () => {
  const geo = handler('/geo-feed');
  assert.match(
    geo,
    /loadSocialReels\(\)/,
    'geo-feed must load social reels — the player asks it before /feed'
  );
  assert.match(
    geo,
    /interleaveSocial\([^)]*SOCIAL_EVERY_NTH\)/,
    'geo-feed must use the same interleave helper and spacing as /feed'
  );
});

test('geo-feed pages over the interleaved list, not the raw catalog', () => {
  const geo = handler('/geo-feed');
  // Slicing the catalog and then adding social items would shift every page.
  const sliceAt = geo.search(/\.slice\(offset/);
  const interleaveAt = geo.search(/interleaveSocial\(/);
  assert.ok(interleaveAt > -1 && sliceAt > interleaveAt,
    'interleave must happen before the offset slice, or paging drifts');
  assert.match(
    geo,
    /const total = reels\.length/,
    'the total must count what the customer can actually swipe through'
  );
});

test('a social failure never takes the reels tab down with it', () => {
  const geo = handler('/geo-feed');
  const block = geo.slice(geo.indexOf('loadSocialReels'));
  assert.match(block.slice(0, 400), /catch/, 'social loading must be wrapped in its own catch');
  assert.match(geo, /reels = catalog/, 'the catalog must remain the fallback when social fails');
});

test('the player still prefers geo-feed, so this is the path that matters', () => {
  const player = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'public', 'reels', 'index.html'),
    'utf8'
  );
  const geoAt = player.indexOf('/api/reels/geo-feed');
  const feedAt = player.indexOf('/api/reels/feed?limit=');
  assert.ok(geoAt > -1 && feedAt > -1, 'both endpoints are used by the player');
  assert.ok(
    geoAt < feedAt,
    'geo-feed is requested first; if that ever changes, this test should be revisited'
  );
});

test('the social slide renderer is still wired to the type geo-feed now emits', () => {
  const player = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'public', 'reels', 'index.html'),
    'utf8'
  );
  assert.match(player, /video\.type === 'social'/, 'the player branches on type: social');
  assert.match(SRC, /type: 'social'/, 'loadSocialReels must emit that exact type');
});
