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
const dockJs = read('sg-dock.js');

test('rails.css is loaded, and after the stylesheets it has to beat', () => {
  const css = index.indexOf('rails.css');
  assert.ok(css > 0, 'rails.css is not linked from index.html');
  assert.ok(css > index.indexOf('talk-bar.css'), 'rails.css must come after talk-bar.css');
  const js = index.indexOf('rails.js');
  assert.ok(js > 0, 'rails.js is not loaded');
  assert.ok(js > index.indexOf('sg-rail-ui.js'), 'rails.js must run after the rail enhancer');
});

test('the row sits between the nav and the CTA, and every rail reads it from here', () => {
  // Owner, 2026-09-18: "Between bottom navigation and Ask AI orange CTA button".
  // So the row is defined against the nav, not against a hardcoded stack of
  // furniture — sg-dock.js measures the nav and publishes --sg-nav-h, and the
  // same file reserves the row so the CTA/summary/pill stack on top of it.
  assert.match(railsCss, /--sg-band-bottom:\s*calc\(var\(--sg-nav-h[^)]*\)[^;]*var\(--sg-safe-b/,
    'the row position is not derived from the measured nav — a hardcoded offset drifts');
  assert.ok(!/--sg-band-bottom:\s*calc\(1?\d\dpx/.test(railsCss),
    'the row is back on a hardcoded offset above the CTA');
  assert.match(dockJs, /ROW_SELECTORS/, 'the dock does not know the row exists, so the CTA can cover it');
  assert.match(dockJs, /if \(rowH\) cursor \+= rowH \+ GAP;/,
    'the dock does not reserve the row, which is what keeps the CTA above it');
  for (const sel of ['#sg-reels-rail', '#sg-sv-rail.sv-float', '#sg-profile-rail', '.tt-actions']) {
    assert.ok(railsCss.includes(sel), `${sel} does not read its geometry from rails.css`);
    assert.ok(dockJs.includes(sel), `${sel} is not reserved by the dock`);
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

test('a row is pinned to something that is actually full-screen', () => {
  // The first pass used `position: fixed` everywhere. `.tt-card` ships
  // `contain: layout style paint` and `.tt-carousel` `contain: strict`, and a
  // contained element is the containing block for its fixed descendants — so
  // the Book and Partner rows were measured from the bottom of the CARD and
  // landed in the middle of the photo.
  const app = read('app.ctr576.js');
  assert.ok(/\.tt-card\{[^}]*contain:layout style paint/.test(app),
    'the containment that breaks position:fixed is gone — this rule can be simplified');
  assert.match(railsCss, /\.tt-actions\s*\{\s*position:\s*absolute\s*!important;\s*bottom:\s*var\(--sg-band-bottom-card\)/,
    'card rails are positioned against the card again');
  assert.match(railsCss, /--sg-band-bottom-card:\s*var\(--sg-band-gap\)/,
    'a card rail must not reserve the tab bar twice: .tt-view already stops above it');
  assert.match(railsCss, /#sg-profile-rail\s*\{\s*position:\s*fixed/,
    'the body-level rails should stay fixed — they have no contained ancestor');
});

test('the Reels feed gets the same row as every other tab', () => {
  const reels = read('reels/index.html');
  assert.ok(reels.includes('rails.css'), 'the Reels document never loads the band');
  assert.ok(reels.includes('rails.js'), 'the Reels row has no scroll indication');
  assert.match(railsCss, /\.reel-actions\s*\{\s*position:\s*absolute\s*!important;\s*bottom:\s*var\(--sg-band-bottom\)/,
    '.reel-actions is not pinned to the bottom of its 100dvh slide');
  assert.match(railsJs, /ROWS = '\.tt-actions, \.reel-actions/, 'reel rows get no arrow');
});

test('every row is the same white, not grey over a bright photo', () => {
  assert.match(railsCss, /\.tt-actions \.tt-action-label[\s\S]{0,260}color:\s*#fff/,
    'card labels are still rgba(255,255,255,.7), which reads grey on a gym photo');
  assert.match(railsCss, /text-shadow:[^;]+rgba\(0, 0, 0, \.85\)/, 'white with no shadow is unreadable on white');
  const ui = read('sg-rail-ui.js');
  for (const label of ['verify', 'locks', 'earnings', 'pricing', 'facilities', 'bookings']) {
    assert.ok(ui.includes(`'${label}'`), `the Partner label "${label}" has no icon, so it keeps its raw emoji`);
  }
});

test('a changed row ships: the cache-busting versions moved together', () => {
  // The row lives in three files. index.html was still asking for
  // rails.css?v=1.0 after the first fix, so a phone with the old file cached
  // kept the old position and the fix looked like it had not deployed.
  const versions = new Set();
  for (const doc of [index, read('reels/index.html')]) {
    for (const m of doc.matchAll(/\/rails\.(?:css|js)\?v=([\d.]+)/g)) versions.add(m[1]);
  }
  assert.equal(versions.size, 1, `the two documents ask for different row versions: ${[...versions]}`);
  assert.ok(parseFloat([...versions][0]) >= 1.2, 'the row changed but its ?v= did not');
  for (const m of index.matchAll(/\/sg-dock\.js\?v=([\d.]+)/g)) {
    assert.ok(parseFloat(m[1]) >= 1.1, 'the dock changed but its ?v= did not');
  }
});

test('the card tabs reach the nav, so the in-card row has a strip to sit in', () => {
  // Book/Partner draw the row inside .tt-card, which clips its overflow. If
  // main.sg-tab-content stops 134px above the bottom (sg-rail-ui.js reserves
  // that for the CTA + summary), the row lands where the CTA is and its icons
  // are covered — the 2026-09-18 production bug.
  assert.match(railsCss, /main\.sg-tab-content\.sg-tab-content\s*\{\s*bottom:\s*calc\(var\(--sg-nav-h[^)]*\)\s*\+\s*var\(--sg-safe-b/,
    'the tab container does not end at the nav, so the in-card row has nowhere to go');
  assert.match(railsCss, /html body main\.sg-tab-content/,
    'the rule needs to out-specify the !important that sg-rail-ui.js injects later');
});
