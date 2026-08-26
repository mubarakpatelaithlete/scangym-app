/**
 * Every tab must be its own page.
 *
 * Regression guard for the state where /, /explore, /nearby, /checkout, /creator,
 * /partner and /profile all returned byte-identical HTML with one shared
 * <title> and one canonical URL pointing at the homepage.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { metaForPath, applyMeta } = require('../server/lib/route-meta');

const SHELL = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'index.html'), 'utf8');

const titleOf = (html) => (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
const descOf = (html) => (html.match(/<meta name="description" content="([^"]*)"/i) || [])[1];
const canonicalOf = (html) => (html.match(/<link rel="canonical" href="([^"]*)"/i) || [])[1];

// The tabs the SPA catch-all serves. /reels, /scansquad and /about ship their own
// HTML files and are deliberately not in the route-meta table.
const TABS = ['/explore', '/nearby', '/checkout', '/creator', '/partner', '/profile'];

test('the shell still has the head tags this feature rewrites', () => {
  assert.ok(titleOf(SHELL), 'index.html lost its <title>');
  assert.ok(descOf(SHELL), 'index.html lost its description meta');
  assert.ok(canonicalOf(SHELL), 'index.html lost its canonical link');
});

test('every tab gets a distinct title', () => {
  const titles = TABS.map((p) => titleOf(applyMeta(SHELL, p)));
  titles.forEach((t, i) => assert.ok(t && t.length > 5, `${TABS[i]} has no usable title`));
  const unique = new Set(titles);
  assert.equal(unique.size, TABS.length,
    `tabs still share titles: ${JSON.stringify(titles)}`);
});

test('every tab gets its own description and canonical', () => {
  for (const p of TABS) {
    const html = applyMeta(SHELL, p);
    assert.ok(descOf(html).length > 20, `${p} description is missing or too short`);
    assert.equal(canonicalOf(html), 'https://scangym.com' + p,
      `${p} canonical does not point at itself`);
  }
});

test('the homepage keeps the original brand title', () => {
  const html = applyMeta(SHELL, '/');
  assert.match(titleOf(html), /ScanGym/);
  assert.equal(canonicalOf(html), 'https://scangym.com/');
});

test('a trailing slash resolves to the same tab', () => {
  assert.equal(metaForPath('/creator/').title, metaForPath('/creator').title);
  assert.equal(metaForPath('/partner/').canonical, 'https://scangym.com/partner');
});

test('sub-paths inherit their tab, and unknown paths fall back to the brand page', () => {
  assert.equal(metaForPath('/creator-hub').canonical, 'https://scangym.com/creator-hub');
  assert.equal(metaForPath('/partner/settings').canonical, 'https://scangym.com/partner');
  assert.equal(metaForPath('/explore/').canonical, 'https://scangym.com/explore');
  assert.equal(metaForPath('/totally-unknown-page').canonical, 'https://scangym.com/');
});

test('private screens are not offered to crawlers', () => {
  for (const p of ['/checkout', '/booking-success', '/profile']) {
    assert.match(applyMeta(SHELL, p), /name="robots" content="noindex"/,
      `${p} should be noindex`);
  }
  assert.doesNotMatch(applyMeta(SHELL, '/explore'), /name="robots" content="noindex"/,
    '/explore must stay indexable');
});

test('og and twitter previews follow the page, not the homepage', () => {
  const html = applyMeta(SHELL, '/partner');
  const og = (html.match(/<meta property="og:title" content="([^"]*)"/i) || [])[1];
  const tw = (html.match(/<meta name="twitter:title" content="([^"]*)"/i) || [])[1];
  const ogUrl = (html.match(/<meta property="og:url" content="([^"]*)"/i) || [])[1];
  assert.match(og, /List Your Gym/);
  assert.match(tw, /List Your Gym/);
  assert.equal(ogUrl, 'https://scangym.com/partner');
});

test('rewriting never damages the shell', () => {
  const html = applyMeta(SHELL, '/explore');
  assert.equal((html.match(/<title>/gi) || []).length, 1, 'duplicated <title>');
  assert.ok(html.includes('</head>') && html.includes('<body'), 'shell structure broken');
  assert.ok(Math.abs(html.length - SHELL.length) < 600, 'shell size changed unexpectedly');
});
