/**
 * Every tab must be reachable from every tab.
 *
 * /reels and /scansquad are standalone HTML documents, not SPA routes. Neither
 * contained any reference to `sg-tab-bar`, so the bottom navigation disappeared
 * on two of the five tabs — from Reels the only way back to Book was the
 * browser's back button. This suite fails if a standalone page ever ships
 * without the shared bar again.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');

/** Documents that are served outside the SPA shell and so need the shared bar. */
const STANDALONE = ['reels/index.html', 'scansquad/index.html'];

const EXPECTED_TABS = ['Reels', 'Book', 'ScanSquad', 'Partner', 'Profile'];

for (const rel of STANDALONE) {
  test(`${rel} loads the shared tab bar`, () => {
    const html = fs.readFileSync(path.join(PUBLIC, rel), 'utf8');
    assert.match(
      html,
      /sg-tabbar\.js/,
      `${rel} has no bottom navigation — that tab dead-ends`
    );
  });
}

/** Render the bar in a miniature DOM and inspect what it produced. */
function renderAt(pathname) {
  const src = fs.readFileSync(path.join(PUBLIC, 'sg-tabbar.js'), 'utf8');
  const made = [];
  const head = { appendChild: (el) => made.push(el) };
  const body = { appendChild: (el) => made.push(el), style: {} };

  const sandbox = {
    location: { pathname },
    document: {
      readyState: 'complete',
      head,
      body,
      querySelector: () => null,
      addEventListener() {},
      createElement: () => ({
        style: {},
        setAttribute(k, v) { this[k] = v; },
        set innerHTML(v) { this._html = v; },
        get innerHTML() { return this._html; },
      }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  const nav = made.find((el) => el.className === 'sg-tab-bar');
  assert.ok(nav, 'no nav element was rendered');
  return nav.innerHTML || '';
}

test('the bar offers all five tabs', () => {
  const html = renderAt('/reels');
  for (const label of EXPECTED_TABS) {
    assert.ok(html.includes('>' + label + '<'), `missing tab: ${label}`);
  }
});

test('every tab links somewhere real', () => {
  const html = renderAt('/reels');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(hrefs.length, EXPECTED_TABS.length);
  for (const h of hrefs) {
    assert.ok(h.startsWith('/'), `bad href: ${h}`);
  }
});

test('the current tab is the one marked active', () => {
  const cases = [
    ['/reels', 'Reels'],
    ['/scansquad', 'ScanSquad'],
    ['/scansquad/', 'ScanSquad'],
    ['/partner', 'Partner'],
    ['/more/profile', 'Profile'],
  ];
  for (const [pathname, expected] of cases) {
    const html = renderAt(pathname);
    const active = [...html.matchAll(
      /class="sg-tab-item active"[\s\S]*?sg-tab-label">([^<]+)</g
    )].map((m) => m[1]);
    assert.deepStrictEqual(
      active, [expected],
      `at ${pathname} the active tab should be exactly ["${expected}"]`
    );
  }
});

test('the bar refuses to render twice', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'sg-tabbar.js'), 'utf8');
  const made = [];
  const sandbox = {
    location: { pathname: '/reels' },
    document: {
      readyState: 'complete',
      head: { appendChild: (el) => made.push(el) },
      body: { appendChild: (el) => made.push(el), style: {} },
      // pretend the SPA already rendered its own bar
      querySelector: (sel) => (sel === 'nav.sg-tab-bar' ? {} : null),
      addEventListener() {},
      createElement: () => ({ style: {}, setAttribute() {} }),
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.strictEqual(made.length, 0, 'must not add a second nav on SPA pages');
});
