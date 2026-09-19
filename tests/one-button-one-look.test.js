'use strict';
/**
 * One button look, everywhere — and only one place that decides it.
 *
 * "Why in reels tab below button are not same colour, same looking like share
 *  button or search button — book button, talk button, ask AI button? Same in
 *  book tab, scansquad tab, partner tab." (owner, 2026-09-19)
 *
 * Five files each painted their own circle: reels/index.html (.reel-action),
 * sg-rail-ui.js (.sg-rr-circle and .tt-action-btn.sgi), sg-scansquad.js
 * (.creator-side-btn, inline tints) and rails.js (.sg-row-trio, colour emoji).
 * rails.css even had a section promising "the same look, every tab" — written by
 * restating the numbers, which is how they drifted apart in the first place.
 *
 * These tests pin the shape of the fix rather than the pixels: the values live
 * once, in one-button.css, every row reads them through var(), and the strip's
 * icons come from the app's single icon table instead of emoji. A future change
 * that goes back to hardcoding a size or a colour in one of the five files fails
 * here, which is the drift these tests exist to catch.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

const tokens = read('one-button.css');
const railUi = read('sg-rail-ui.js');
const railsJs = read('rails.js');
const railsCss = read('rails.css');
const reels = read('reels/index.html');

const TOKENS = [
  '--sg-btn-size',
  '--sg-btn-bg',
  '--sg-btn-border-width',
  '--sg-btn-border-color',
  '--sg-btn-blur',
  '--sg-btn-shadow',
  '--sg-btn-icon',
  '--sg-btn-label-size',
  '--sg-btn-label-weight',
  '--sg-btn-label-color'
];

test('every button token is declared exactly once, in one-button.css', () => {
  const root = tokens.slice(tokens.indexOf(':root'));
  for (const t of TOKENS) {
    const declared = (root.match(new RegExp(`\\n\\s*${t}:`, 'g')) || []).length;
    assert.equal(declared, 1, `${t} is declared ${declared} times`);
  }
  // No other file may declare them — a second declaration is a second answer.
  for (const [name, src] of [['sg-rail-ui.js', railUi], ['rails.css', railsCss],
    ['rails.js', railsJs], ['reels/index.html', reels]]) {
    for (const t of TOKENS) {
      assert.ok(!new RegExp(`${t}\\s*:`).test(src), `${name} redeclares ${t}`);
    }
  }
});

test('all five rows read the shared circle instead of restating it', () => {
  const rows = [
    ['reels Share/Save', reels, '.reel-action .icon{'],
    ['reels rail', railUi, "+'.sg-rr-circle{"],
    ['book/partner rail', railUi, '.tt-action-btn.sgi{'],
    ['Book/Talk/Ask AI', railsCss, '.sg-row-slot .sg-row-trio > .tt-action-btn {']
  ];
  for (const [label, src, marker] of rows) {
    const i = src.indexOf(marker);
    assert.ok(i > 0, `${label}: rule ${marker} is gone`);
    const rule = src.slice(i, src.indexOf('}', i));
    assert.match(rule, /var\(--sg-btn-size/, `${label} hardcodes its size`);
    assert.match(rule, /var\(--sg-btn-bg/, `${label} hardcodes its background`);
    assert.match(rule, /var\(--sg-btn-blur/, `${label} does not share the glass`);
  }
  // ScanSquad's rail is styled inline from JS, so its shared look is the
  // !important block in one-button.css instead of a var() in its own file.
  const squad = tokens.slice(tokens.indexOf('.creator-side-btn {'));
  assert.match(squad, /var\(--sg-btn-size[^)]*\) !important/);
  assert.match(squad, /background: var\(--sg-btn-bg[^)]*\) !important/);
});

test('captions are one style, not three', () => {
  for (const [name, src] of [['reels', reels], ['sg-rail-ui.js', railUi], ['rails.css', railsCss]]) {
    assert.match(src, /var\(--sg-btn-label-size/, `${name} has its own caption size`);
    assert.match(src, /var\(--sg-btn-label-color/, `${name} has its own caption colour`);
  }
  // The trio's caption was the odd one out at 72% white.
  assert.ok(!railsCss.includes('rgba(255, 255, 255, .72) !important'),
    'the dimmed trio caption is back');
});

test('Book / Talk / Ask AI draw the app\'s icons, not emoji', () => {
  assert.match(railUi, /try\{window\.SG_ICONS=ICONS;\}catch\(e\)\{\}/,
    'the icon table is no longer shared, so rails.js has to invent glyphs again');
  assert.match(railUi, /\n\s*mic:I\(/, 'no mic icon for Talk');
  assert.match(railUi, /\n\s*sparkle:I\(/, 'no sparkle icon for Ask AI');

  const items = railsJs.slice(railsJs.indexOf('var ITEMS = ['), railsJs.indexOf('];', railsJs.indexOf('var ITEMS = [')));
  for (const key of ['calendar', 'mic', 'sparkle']) {
    assert.ok(items.includes(`'${key}'`), `the trio does not ask for the ${key} icon`);
  }
  const build = railsJs.slice(railsJs.indexOf('function buildTrio('));
  assert.match(build, /window\.SG_ICONS/, 'buildTrio does not use the shared icons');
  assert.match(build, /classList\.add\('sgi'\)/, 'the trio does not take the shared circle class');
  // The emoji stay as a fallback for the framed documents, which load rails.js
  // without sg-rail-ui.js — but only as a fallback.
  assert.match(build, /else \{\s*\n\s*btn\.textContent = it\.emoji;/,
    'the emoji path is no longer a fallback');
});

test('ScanSquad\'s rail is one colour and one icon family', () => {
  const fn = railUi.slice(railUi.indexOf('function labelCreatorRail('));
  assert.match(fn, /CREATOR_ICON=\{/, 'the creator buttons still show raw emoji');
  assert.match(fn, /window\.SG_ICONS/, 'the creator icons come from somewhere else');
  // Its inline tints are overridden, not edited out of the template: the sheet
  // has to keep winning over a style attribute.
  const squad = tokens.slice(tokens.indexOf('.creator-side-btn {'));
  assert.match(squad, /background-image: none !important/,
    'a purple or green inline tint can still show through');
});

test('the "More" circle is stated once', () => {
  const rules = (railUi.match(/\.tt-action\.sgi-more \.tt-action-btn\{/g) || []).length;
  assert.equal(rules, 0, 'sg-rail-ui.js paints the More circle again');
  assert.ok(!railUi.includes('rgba(255,109,0,.2)'), 'the orange More circle is back');
  assert.equal((tokens.match(/\.sgi-more \.tt-action-btn \{/g) || []).length, 1);
});

test('every document that has a strip loads the stylesheet that defines it', () => {
  for (const doc of ['index.html', 'reels/index.html', 'scansquad/index.html']) {
    assert.match(read(doc), /<link rel="stylesheet" href="\/one-button\.css/, `${doc} is missing it`);
  }
});
