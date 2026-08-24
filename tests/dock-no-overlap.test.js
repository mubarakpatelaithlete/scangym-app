/**
 * The pinned overlays must never sit on top of each other.
 *
 * This is the bug this suite exists to prevent: on Profile the "Get ID verified"
 * row rendered at y=689..768 while the Continue bar sat at y=736..788, so the
 * card was half-buried. On Book the "Ask AI" pill (678..724) cut through the
 * price summary (710..736). Each bar had hardcoded its own `bottom:` guess.
 *
 * sg-dock.js now assigns every bottom offset from one measured stack. We run it
 * against a miniature DOM and assert the invariant directly.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DOCK = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'sg-dock.js'),
  'utf8'
);

const VIEWPORT_H = 844;

/** Minimal element that reports a rect derived from the `bottom`/`top` it was given. */
function makeEl(id, height, opts = {}) {
  const el = {
    id,
    height,
    hidden: opts.hidden || false,
    _bottom: opts.bottom == null ? 0 : opts.bottom,
    _top: null,
    scrollHeight: opts.scrollHeight == null ? 0 : opts.scrollHeight,
    clientHeight: opts.clientHeight == null ? 0 : opts.clientHeight,
    style: {
      removeProperty(prop) { delete el.style[prop]; },
      setProperty(prop, value) {
        const n = parseFloat(value);
        if (prop === 'bottom') el._bottom = n;
        if (prop === 'top') el._top = n;
        el.style[prop] = value;
      },
    },
    getBoundingClientRect() {
      if (el._top != null) {
        return { top: el._top, bottom: el._top + el.height, height: el.height };
      }
      const bottom = VIEWPORT_H - el._bottom;
      return { top: bottom - el.height, bottom, height: el.height };
    },
  };
  return el;
}

function run(elements) {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const appended = [];

  const doc = {
    readyState: 'complete',
    documentElement: { style: { setProperty() {} } },
    body: {
      appendChild(el) {
        appended.push(el);
        byId.set(el.id, el);
      },
    },
    getElementById: (id) => byId.get(id) || null,
    querySelector(sel) {
      // sg-dock uses '#id' and 'tag.class'; the harness keys everything by name
      let key = sel.startsWith('#') ? sel.slice(1) : sel;
      if (key.includes('.')) key = key.split('.').pop();
      return byId.get(key) || null;
    },
    addEventListener() {},
    createElement: (tag) => makeEl('sg-safe-probe', 0),
  };

  const sandbox = {
    document: doc,
    getComputedStyle: (el) => ({
      display: el && el.hidden ? 'none' : 'block',
      visibility: 'visible',
      opacity: '1',
    }),
    requestAnimationFrame: () => {},
    MutationObserver: function () {
      return { observe() {} };
    },
    addEventListener() {},
    setInterval: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DOCK, sandbox);
  sandbox.sgDockLayout();
  return byId;
}

/** Every pair of visible bars must be disjoint vertically. */
function assertNoOverlap(ids, byId) {
  const rects = ids
    .map((id) => byId.get(id))
    .filter((el) => el && !el.hidden)
    .map((el) => ({ id: el.id, ...el.getBoundingClientRect() }));

  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];
      const clash = a.bottom > b.top && b.bottom > a.top;
      assert.ok(
        !clash,
        `${a.id} (${a.top}..${a.bottom}) overlaps ${b.id} (${b.top}..${b.bottom})`
      );
    }
  }
}

test('Profile: the ID row is not buried under the Continue bar', () => {
  const els = [
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('sg-id-row', 80),
    makeEl('sg-tab-content', 0),
  ];
  const byId = run(els);
  assertNoOverlap(['sg-tab-bar', 'sg-continue-banner', 'sg-id-row'], byId);
});

test('Book: the Ask AI pill clears the price summary and the CTA', () => {
  const els = [
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('sg-book-summary', 26),
    makeEl('bchat-fab', 46),
    makeEl('sg-tab-content', 0),
  ];
  const byId = run(els);
  assertNoOverlap(
    ['sg-tab-bar', 'sg-continue-banner', 'sg-book-summary', 'bchat-fab'],
    byId
  );
});

test('the two promo strips at the top do not share pixels', () => {
  const els = [
    makeEl('sg-usp-banner', 45),
    makeEl('sg-sps', 30),
    makeEl('sg-tab-content', 0),
  ];
  const byId = run(els);
  const usp = byId.get('sg-usp-banner').getBoundingClientRect();
  const sps = byId.get('sg-sps').getBoundingClientRect();
  assert.ok(
    sps.top >= usp.bottom,
    `sg-sps (${sps.top}..${sps.bottom}) overlaps sg-usp-banner (${usp.top}..${usp.bottom})`
  );
});

test('a hidden bar takes up no space in the stack', () => {
  const withRow = run([
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('sg-id-row', 80),
    makeEl('bchat-fab', 46),
    makeEl('sg-tab-content', 0),
  ]);
  const withoutRow = run([
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('sg-id-row', 80, { hidden: true }),
    makeEl('bchat-fab', 46),
    makeEl('sg-tab-content', 0),
  ]);
  assert.ok(
    withoutRow.get('bchat-fab')._bottom < withRow.get('bchat-fab')._bottom,
    'hiding the ID row should let the pill sit lower'
  );
});

test('content reserves room for the whole stack', () => {
  const byId = run([
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('bchat-fab', 46),
    makeEl('sg-tab-content', 0, { scrollHeight: 2000, clientHeight: 800 }),
  ]);
  const pad = parseFloat(byId.get('sg-tab-content').style['padding-bottom']);
  const fabBottom = byId.get('bchat-fab')._bottom;
  assert.ok(
    pad >= fabBottom,
    `content padding ${pad} must clear the highest docked item at ${fabBottom}`
  );
});

test('a full-bleed tab gets no padding, so the hero keeps its height', () => {
  const byId = run([
    makeEl('sg-tab-bar', 56),
    makeEl('sg-continue-banner', 52),
    makeEl('bchat-fab', 46),
    // hero exactly fills the viewport: nothing to scroll past
    makeEl('sg-tab-content', 0, { scrollHeight: 800, clientHeight: 800 }),
  ]);
  assert.ok(
    byId.get('sg-tab-content').style['padding-bottom'] === undefined,
    'full-bleed content must not gain a dead band below the hero'
  );
});
