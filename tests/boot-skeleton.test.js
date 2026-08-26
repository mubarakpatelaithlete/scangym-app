/**
 * The boot screen must belong to the route being served.
 *
 * Regression guard for the state where every SPA route rendered the same
 * centred logo, two grey bars and a three-item tab bar (Reels / Book /
 * Profile) until 1.6MB of JavaScript parsed and replaced it — so /partner
 * booted looking like a search page and two of the five tabs were missing.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const {
  applyBootSkeleton, renderSkeleton, tabForPath, primaryActionFor, TABS, START, END
} = require('../server/lib/boot-skeleton');

const SHELL = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'index.html'), 'utf8');

const hrefsIn = (html) => (html.match(/href="([^"]*)"/g) || []).map(h => h.slice(6, -1));

test('the shell carries the boot markers this feature replaces between', () => {
  assert.ok(SHELL.includes(START), 'index.html lost <!--boot:start-->');
  assert.ok(SHELL.includes(END), 'index.html lost <!--boot:end-->');
  assert.ok(SHELL.indexOf(START) < SHELL.indexOf(END), 'boot markers are inverted');
  assert.ok(
    SHELL.indexOf('<div id="app">') < SHELL.indexOf(START),
    'the boot block must sit inside #app so the SPA overwrites it'
  );
});

test('every tab boots with all five tabs, not three', () => {
  for (const p of ['/', '/explore', '/partner', '/creator', '/more/profile', '/wallet']) {
    const html = renderSkeleton(p);
    for (const tab of TABS) {
      assert.ok(
        html.includes('href="' + tab.href + '"'),
        `${p} boot screen is missing the ${tab.label} tab`
      );
    }
  }
});

test('the boot bar marks the tab the SPA will mark', () => {
  const cases = {
    '/': 'book', '/explore': 'book', '/nearby': 'book', '/search': 'book',
    '/checkout': 'book', '/booking-success': 'book', '/gym/anytime-fitness': 'book',
    '/reels': 'reels', '/reels/abc': 'reels',
    '/scansquad': 'creator', '/creator': 'creator', '/creator-hub': 'creator',
    '/partner': 'partner', '/partners': 'partner', '/list-your-gym': 'partner',
    '/more/profile': 'more', '/profile': 'more', '/wallet': 'more'
  };
  for (const [p, key] of Object.entries(cases)) {
    assert.strictEqual(tabForPath(p), key, `${p} should activate the ${key} tab`);
  }
});

test('trailing slashes, casing and query strings resolve to the same tab', () => {
  assert.strictEqual(tabForPath('/partner/'), 'partner');
  assert.strictEqual(tabForPath('/Partner'), 'partner');
  assert.strictEqual(tabForPath('/explore?q=london'), 'book');
  assert.strictEqual(tabForPath('/more/profile#top'), 'more');
});

test('exactly one tab is marked current, and only when a tab owns the route', () => {
  const marked = (html) => (html.match(/aria-current="page"/g) || []).length;
  assert.strictEqual(marked(renderSkeleton('/partner')), 1);
  assert.strictEqual(marked(renderSkeleton('/')), 1);
  assert.strictEqual(marked(renderSkeleton('/some-unknown-page')), 0,
    'an unowned route must not fake an active tab');
});

test('primary actions point at routes that exist and differ per tab', () => {
  const expected = {
    '/': '/nearby',
    '/explore': '/nearby',
    '/nearby': '/explore',
    '/partner': '/list-your-gym',
    '/partners': '/list-your-gym',
    '/creator': '/scansquad',
    '/more/profile': '/login',
    '/wallet': '/login'
  };
  for (const [p, href] of Object.entries(expected)) {
    const action = primaryActionFor(p);
    assert.ok(action, `${p} should offer a primary action`);
    assert.strictEqual(action.href, href);
    assert.ok(action.label && action.label.length > 3, `${p} action needs a real label`);
    assert.ok(
      renderSkeleton(p).includes('href="' + href + '"'),
      `${p} boot screen does not render its own primary action`
    );
  }
});

test('a primary action never sends you to the page you are already on', () => {
  for (const p of Object.keys({
    '/': 1, '/explore': 1, '/nearby': 1, '/partner': 1, '/creator': 1,
    '/more/profile': 1, '/wallet': 1
  })) {
    const action = primaryActionFor(p);
    assert.notStrictEqual(action.href, p, `${p} links to itself`);
  }
});

test('checkout, booking-success and gym pages get no call to action', () => {
  for (const p of ['/checkout', '/booking-success', '/gym/anytime-fitness']) {
    assert.strictEqual(primaryActionFor(p), null, `${p} must not be interrupted by a CTA`);
    const html = renderSkeleton(p);
    assert.ok(!html.includes('/list-your-gym'), `${p} boot screen shows an unrelated CTA`);
    assert.ok(!html.includes('/login'), `${p} boot screen shows an unrelated CTA`);
  }
});

test('boot screens are shaped differently per tab', () => {
  const seen = new Map();
  for (const p of ['/', '/partner', '/creator', '/more/profile', '/wallet', '/checkout']) {
    const body = renderSkeleton(p).split('<nav')[0];
    for (const [other, html] of seen) {
      assert.notStrictEqual(body, html, `${p} boots identically to ${other}`);
    }
    seen.set(p, body);
  }
});

test('every href in a boot screen is an absolute in-app path', () => {
  for (const p of ['/', '/partner', '/creator', '/more/profile', '/checkout']) {
    for (const href of hrefsIn(renderSkeleton(p))) {
      assert.ok(href.startsWith('/'), `${p} boot screen links off-app: ${href}`);
      assert.ok(!href.includes('..'), `${p} boot screen has a traversal href: ${href}`);
    }
  }
});

test('applying to the shell replaces the boot block and nothing else', () => {
  const out = applyBootSkeleton(SHELL, '/partner');

  assert.ok(!out.includes('skeleton-tab-bar'), 'the old three-tab boot bar survived');
  assert.ok(out.includes('List your gym'), 'the partner action is missing');

  // Everything outside the markers must be untouched.
  const head = (s) => s.slice(0, s.indexOf(START));
  const tail = (s) => s.slice(s.indexOf(END));
  assert.strictEqual(head(out), head(SHELL), 'content above the boot block changed');
  assert.strictEqual(tail(out), tail(SHELL), 'content below the boot block changed');

  // The shell's own machinery has to survive.
  assert.ok(out.includes('app.ctr576.js'), 'the app bundle script tag was dropped');
  assert.ok(out.includes('__configPromise'), 'the config bootstrap was dropped');
  assert.ok(out.includes('<div id="app">'), '#app was dropped');
});

test('the boot block stays inside #app so the SPA can overwrite it', () => {
  const out = applyBootSkeleton(SHELL, '/');
  const appStart = out.indexOf('<div id="app">');
  const configScript = out.indexOf('__configPromise');
  const bar = out.indexOf('sg-boot-tabbar');
  assert.ok(appStart < bar && bar < configScript,
    'the boot tab bar escaped #app — the SPA will not clear it');
});

test('a shell without markers is returned untouched instead of throwing', () => {
  const plain = '<html><body><div id="app">hi</div></body></html>';
  assert.strictEqual(applyBootSkeleton(plain, '/partner'), plain);
  assert.strictEqual(applyBootSkeleton(null, '/'), null);
});

test('the boot bar matches sg-tabbar.js, which owns the bar on standalone pages', () => {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'frontend', 'public', 'sg-tabbar.js'), 'utf8');
  for (const tab of TABS) {
    assert.ok(src.includes("href: '" + tab.href + "'"),
      `sg-tabbar.js has no ${tab.label} tab pointing at ${tab.href} — the two bars disagree`);
    assert.ok(src.includes("label: '" + tab.label + "'"),
      `sg-tabbar.js does not label this tab "${tab.label}"`);
  }
});

test('the boot bar removes itself inside an iframe, like sg-tabbar.js does', () => {
  const html = renderSkeleton('/');
  assert.ok(html.includes('window.top!==window.self'),
    'embedded views would get a stray boot tab bar');
});
