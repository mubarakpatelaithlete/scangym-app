/**
 * Reels discovery: category tabs and a search page worth opening.
 *
 * The Reels tab shipped with one undifferentiated feed and a plain text
 * "Search" button: you could type, but there was nothing to tap, no way to
 * narrow the feed to a kind of reel, and no memory of what you searched
 * before. TikTok's answer is a sideways-scrolling category rail on top of the
 * feed and a search page that suggests before you type. This suite fails if
 * either of those disappears again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REELS = path.join(__dirname, '..', 'frontend', 'public', 'reels', 'index.html');
const html = fs.readFileSync(REELS, 'utf8');

test('the feed has a category rail, not just one endless stream', () => {
  assert.match(html, /id="reels-cat-rail"/, 'no category rail in the Reels tab');
  assert.match(html, /\/api\/reels\/categories/, 'the rail invents categories instead of reading the API');
  assert.match(html, /For You/, 'the rail has no unfiltered default tab');
});

test('the rail scrolls sideways and marks the tab you are on', () => {
  const rail = html.match(/#reels-cat-rail\{[^}]*\}/);
  assert.ok(rail, 'the rail has no styles');
  assert.match(rail[0], /overflow-x:auto/, 'the rail does not scroll sideways');
  assert.match(html, /\.reels-cat\[aria-selected="true"\]/, 'the active category is not marked');
});

test('picking a category reloads the feed filtered to it', () => {
  assert.match(
    html,
    /category=' \+ encodeURIComponent\(activeCategory\)/,
    'the chosen category never reaches /api/reels/feed'
  );
  assert.match(html, /function applyVideoList/, 'no way to swap the playable list in place');
});

test('paging further into a filtered feed stays inside that category', () => {
  const loadMore = html.match(/function loadMoreFeed\(\)[\s\S]*?\n {6}\}/);
  assert.ok(loadMore, 'loadMoreFeed is gone');
  assert.match(
    loadMore[0],
    /activeCategory/,
    'page 2 of a filtered feed falls back to the unfiltered feed'
  );
});

test('search offers something to tap before you type', () => {
  assert.match(html, /id="reels-search-discover"/, 'search opens on an empty screen');
  assert.match(html, /You may like/, 'no suggestions');
  assert.match(html, /Trending searches/, 'no trending searches');
  assert.match(html, /id="reels-recent-wrap"/, 'recent searches are not offered');
  assert.match(html, /sg_reels_recent_searches/, 'recent searches are never stored');
});

test('a search can be run by tapping, by Enter, and by the Search button', () => {
  assert.match(html, /id="reels-search-submit"/, 'no Search button');
  assert.match(html, /event\.key === 'Enter'/, 'Enter does not run the search');
  assert.match(html, /function runSearch/, 'there is no single search entry point');
});

test('the search icon is an icon, and the reel counter does not sit under it', () => {
  const button = html.match(/<button type="button" id="reels-search-button"[\s\S]{0,400}?<\/button>/);
  assert.ok(button, 'the search control is gone');
  assert.match(button[0], /<svg/, 'the search control is still a text button');
  const counter = html.match(/\.reel-counter\{[^}]*\}/);
  assert.ok(counter, 'the reel counter lost its styles');
  assert.doesNotMatch(counter[0], /top:12px/, 'the counter overlaps the discovery header');
});
