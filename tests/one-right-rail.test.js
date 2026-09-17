/**
 * One right-edge rail, one owner of its geometry.
 *
 * Measured on production before this change (iPhone width, Book tab, rail's
 * "More" list open): the current card's rail ran from y197 to y741 with
 * "4.4 (136)" under the Talk pill, "Share" under the summary strip and "Earn"
 * off-screen — while the NEXT card's rail was already on screen at y775 with
 * its own "Filter" and "Near Me" behind the tab bar. Two columns of the same
 * buttons, and the bottom of both unreachable.
 *
 * Nothing was wrong with any single file: four of them each decided where a
 * right rail belongs. These tests keep that decision in one place.
 *
 * The owner has since chosen a different shape — one horizontal row that
 * side-scrolls, above the bottom navigation — so the geometry assertions now
 * describe that row. What they protect is unchanged: one owner of the geometry,
 * clear of the bottom furniture, nothing silently cut off, one row at a time.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const railsCss = read('rails.css');
const railsJs = read('rails.js');
const index = read('index.html');

test('rails.css is loaded, and after the stylesheets it has to beat', () => {
  const css = index.indexOf('rails.css');
  assert.ok(css > 0, 'rails.css is not linked from index.html');
  assert.ok(css > index.indexOf('talk-bar.css'), 'rails.css must come after talk-bar.css');
  const js = index.indexOf('rails.js');
  assert.ok(js > 0, 'rails.js is not loaded');
  assert.ok(js > index.indexOf('sg-rail-ui.js'), 'rails.js must run after the rail enhancer');
});

test('the row clears the bottom furniture and every rail reads it from here', () => {
  assert.match(railsCss, /--sg-band-bottom:\s*calc\((\d+)px/, 'the row has no defined height above the bottom');
  assert.match(railsCss, /env\(safe-area-inset-bottom/, 'the row ignores the home-bar inset');
  const clearance = Number(railsCss.match(/--sg-band-bottom:\s*calc\((\d+)px/)[1]);
  // tab bar 56 + orange CTA 52 + Talk pill 46 + its 12px gap = 166px, measured
  // on production. Anything less puts the row back under the pill, which is the
  // bug this file exists for.
  assert.ok(clearance >= 166, `the row sits ${clearance}px up — the Talk pill starts at 166px`);
  for (const sel of ['#sg-reels-rail', '#sg-sv-rail.sv-float', '#sg-profile-rail', '.tt-actions']) {
    assert.ok(railsCss.includes(sel), `${sel} does not read its geometry from rails.css`);
  }
  assert.match(railsCss, /bottom:\s*var\(--sg-band-bottom\)/, 'a rail is not bounded by the row position');
  const caps = railsCss.match(/max-height:[^;]+/g) || [];
  assert.ok(caps.length > 0 && caps.every((c) => c.includes('--sg-band-height')),
    `a row height is set without the band variable: ${caps.join(' | ')}`);
  // Sideways scrolling replaces hiding: "More" must not swallow buttons any more.
  assert.match(railsCss, /\.sgi-x\s*\{\s*display:\s*flex/, 'buttons are still hidden behind "More"');
  assert.match(railsCss, /\.sgi-more\s*\{\s*display:\s*none/, 'the redundant "More" button is still shown');
});

test('no other file sets right-rail position any more', () => {
  const others = ['squad-create.js', 'sg-rail-ui.js', 'profile-rail.js'];
  for (const f of others) {
    const src = read(f);
    // `[;{']` so this asks about the property, not margin-bottom/padding-top.
    const offenders = src.match(/[;{'"](top|right|bottom):\s*(96px|120px|190px|10px)/g) || [];
    assert.deepEqual(offenders, [],
      `${f} still positions a rail itself: ${offenders.join(', ')}`);
    assert.ok(!/max-height:\s*(64vh|calc\(100vh - 300px\))/.test(src),
      `${f} still caps a rail's height itself`);
  }
});

test('only the card you are looking at keeps its rail', () => {
  assert.match(railsCss, /\.tt-card:not\(\.sg-card-live\)\s*\.tt-actions\s*\{\s*display:\s*none/,
    'non-live cards still render a second rail');
  // Never guess: the hiding rule must be gated on the arbiter having run.
  assert.match(railsCss, /\.sg-rails-arbitrated[^{]*\.tt-card:not\(\.sg-card-live\)/,
    'rails would be hidden even if rails.js never ran');
  assert.ok(railsJs.includes("classList.add(ON)"), 'rails.js never enables the rule');
  assert.match(railsJs, /intersectionRatio/, 'the live card is not chosen by what is visible');
});

test('the arbiter picks one winner and cleans up cards that left', () => {
  assert.match(railsJs, /classList\.toggle\(LIVE, cards\[j\] === winner\)/,
    'more than one card could be marked live');
  assert.match(railsJs, /unobserve/, 'observers leak on re-render');
  assert.match(railsJs, /threshold: \[/,
    'the observer has no threshold list, so ratios are meaningless');
});

test('a row with more buttons to the right says so, and stops saying it at the end', () => {
  assert.match(railsJs, /scrollWidth - row\.clientWidth - row\.scrollLeft/,
    'the indication is still measured vertically, or ignores how far the row is scrolled');
  assert.match(railsJs, /addEventListener\('scroll'[\s\S]{0,80}markRow/,
    'the arrow never updates while the row is scrolled, so it points at nothing at the end');
  assert.match(railsJs, /#sg-reels-rail[\s\S]{0,80}#sg-profile-rail/,
    'the floating rows do not get the same indication as the card rows');
  assert.match(railsCss, /\.sg-rail-scrollable::after[\s\S]{0,200}content:\s*'›'/,
    'there is no visible affordance for a row that scrolls');
  assert.match(railsCss, /mask-image:\s*linear-gradient\(to right/,
    'the right edge is not faded, so a cut-off button looks like a whole one');
  assert.match(railsCss, /:not\(\.sg-rail-scrollable\)[\s\S]{0,220}mask-image:\s*none/,
    'a row that fits is still faded and arrowed');
});

test('one brand mark per tab: no per-card copies', () => {
  const app = read('app.ctr576.js');
  const disc = app.match(/border-radius:50%;z-index:20;opacity:\.85/g) || [];
  assert.deepEqual(disc, [], `${disc.length} per-card brand discs are back`);
  const brand = read('brand-mark.css');
  assert.match(brand, /body::before/, 'the one fixed brand mark is gone');
  assert.match(brand, /position:\s*fixed/, 'the brand mark is no longer page-fixed');
});

test('the four unbuilt Reels rail buttons are off, and an empty rail hides', () => {
  const rail = read('sg-rail-ui.js');
  const items = rail.slice(rail.indexOf("{tab:'music'"), rail.indexOf('].filter('));
  for (const label of ['Music', 'Photos', 'Chat', 'Trainer']) {
    assert.ok(items.includes(label), `${label} was deleted instead of switched off`);
  }
  assert.equal((items.match(/on:\s*true/g) || []).length, 0, 'an unbuilt rail button is switched on');
  assert.match(rail, /rail\.children\.length\s*>\s*0\s*&&\s*isReelsActive\(\)/,
    'an empty rail can still render as a stray column');
});

test('a rail is decorated in the frame it appears, and never shown half-built', () => {
  const rail = read('sg-rail-ui.js');
  // The 600ms heartbeat alone left the app's raw emoji rail on screen for up to
  // 600ms per new card — visible next to the finished white rail during a swipe.
  assert.match(rail, /new MutationObserver\(/, 'new cards are still only decorated by the interval');
  assert.match(rail, /requestAnimationFrame\(function\s*\(\)\s*\{[\s\S]{0,200}railIcons\(\)/,
    'the mutation path does not decorate rails in the same frame');
  assert.ok(!/requestAnimationFrame\(function\s*\(\)\s*\{[^}]*\btick\(\)/.test(rail),
    'the mutation path runs the full tick, which rewrites the DOM and would re-trigger itself');
  assert.match(rail, /sg-rail-ui-ready/, 'nothing signals that the decorator is alive');
  assert.match(rail, /\.tt-actions\[data-sgi\]/, 'the ready flag is set without proof a rail was decorated');

  const css = read('rails.css');
  assert.match(css, /\.sg-rail-ui-ready \.tt-actions:not\(\[data-sgi\]\)\s*\{[^}]*opacity:\s*0/,
    'an undecorated rail can still paint next to the decorated one');
  assert.ok(!/:not\(\[data-sgi\]\)\s*\{[^}]*display:\s*none/.test(css),
    'hiding with display:none would stop the rail being measured before it is decorated');
});
