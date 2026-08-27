'use strict';

/**
 * One orange circle logo per tab, in the same place on every tab.
 *
 * Measured on the live site (mobile viewport, whole page, 2026-08-27) the mark
 * appeared 5 times on Reels, once on ScanSquad and not at all on Book, Partner
 * or Profile — because it was attached to feed cards, whose number varies,
 * instead of to the app. brand-mark.css paints it once on the page.
 *
 * These tests pin the two halves of that: the single fixed mark exists and is
 * loaded everywhere, and the per-card copies stay retired.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const raw = fs.readFileSync(path.join(PUBLIC, 'brand-mark.css'), 'utf8');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

/** The page shells that must carry the mark. */
const SHELLS = ['index.html', 'reels/index.html', 'scansquad/index.html'];

test('every page shell loads the brand mark', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(/brand-mark\.css/.test(html), `${shell} does not load brand-mark.css`);
  }
});

test('the mark is painted exactly once, on the page itself', () => {
  // Attached to body, not to a card: that is what makes the count independent
  // of how many reels happen to be rendered.
  assert.ok(/body::before/.test(css), 'the mark must be a single page-level element');
  const rule = css.slice(css.indexOf('body::before'), css.indexOf('}', css.indexOf('body::before')));
  assert.ok(/position:\s*fixed/.test(rule), 'the mark must be fixed so it sits in the same place on every tab');
  assert.ok(/#FF6D00/i.test(rule), 'the mark must be brand orange');
  assert.ok(/border-radius:\s*50%/.test(rule), 'the mark must be a circle');
});

test('the mark never swallows a tap', () => {
  // It is fixed over the top-left corner of every screen. Without this it would
  // intercept taps on whatever sits underneath, on all five tabs.
  const rule = css.slice(css.indexOf('body::before'), css.indexOf('}', css.indexOf('body::before')));
  assert.ok(/pointer-events:\s*none/.test(rule), 'the mark must be decorative only');
});

test('the per-card copies stay retired', () => {
  const rule = css.slice(css.indexOf('.sg-brand-circle'));
  assert.ok(/display:\s*none/.test(rule), '.sg-brand-circle must not paint a second logo');
});

test('hiding lives here, not in the colour layer', () => {
  // one-orange.css is only allowed to recolour — see one-orange.test.js. This
  // file exists so the logo rules do not have to break that separation.
  const orange = fs.readFileSync(path.join(PUBLIC, 'one-orange.css'), 'utf8');
  assert.ok(!/display:\s*none/.test(orange), 'one-orange.css must stay a pure colour layer');
  assert.ok(!/\.sg-brand-circle/.test(orange), 'the logo rules belong in brand-mark.css');
});
