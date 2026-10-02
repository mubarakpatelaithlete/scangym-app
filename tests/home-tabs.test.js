// Task 105 (owner, 2026-10-02): Home top tabs — For You, Following, Near me,
// Trending, #drama, #movie, #podcast, Live — each a working feed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const tabs = require('../server/lib/home-tabs');

test('all eight tabs exist in order', () => {
  assert.deepStrictEqual(tabs.TABS.map((t) => t.key),
    ['foryou', 'following', 'nearme', 'trending', 'drama', 'movie', 'podcast', 'live']);
});

test('Live searches streams on air; the others are Shorts only', () => {
  const live = tabs.youtubeParams({ query: 'live', live: true });
  assert.strictEqual(live.get('eventType'), 'live');
  assert.strictEqual(live.get('videoDuration'), null);
  const drama = tabs.youtubeParams({ query: 'x' });
  assert.strictEqual(drama.get('videoDuration'), 'short');
  assert.strictEqual(drama.get('videoEmbeddable'), 'true');
  const near = tabs.youtubeParams({ query: 'gym', lat: 51.5, lng: -0.5 });
  assert.strictEqual(near.get('location'), '51.5,-0.5');
  assert.strictEqual(near.get('locationRadius'), '50km');
});

test('Near me shares one cached search per ~50km cell and rejects junk', () => {
  assert.deepStrictEqual(tabs.cell(51.51, -0.12), { lat: 51.5, lng: 0 });
  assert.strictEqual(tabs.cell('x', 1), null);
  assert.strictEqual(tabs.cell(95, 1), null);
});

test('Following needs sign-in, then shows only followed creators', async () => {
  const all = [{ id: 1, author: 'GymTube' }, { id: 2, creator: { handle: 'Sam' } }, { id: 3 }];
  const out = await tabs.buildTab('following', { all, follows: null });
  assert.strictEqual(out.needsLogin, true);
  const mine = await tabs.buildTab('following', { all, follows: ['sam', 'gymtube'] });
  assert.deepStrictEqual(mine.videos.map((v) => v.id), [1, 2]);
});

test('Trending ranks by engagement and skips ads', async () => {
  const all = [{ id: 'a' }, { id: 'b' }, { id: 'ad', type: 'ad' }];
  const perf = new Map([['b', { views: 100, likeCount: 5 }], ['a', { views: 1 }], ['ad', { views: 1e6 }]]);
  const out = await tabs.buildTab('trending', { all, perf });
  assert.deepStrictEqual(out.videos.map((v) => v.id), ['b', 'a']);
});

test('tab videos never leak into For You, and the Home rail offers the tabs', () => {
  assert.match(read('server/routes/reels.js'), /category NOT LIKE 'Tab: %'/);
  assert.match(read('server/routes/reels.js'), /router\.get\('\/tab\/:tab', optionalAuth/);
  const html = read('frontend/public/reels/index.html');
  for (const k of ['following', 'nearme', 'trending', 'drama', 'movie', 'podcast', 'live']) assert.ok(html.includes("['" + k + "'"), k);
  assert.match(html, /'\/api\/reels\/tab\/' \+ key/);
});
