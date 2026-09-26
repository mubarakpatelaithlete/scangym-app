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
  // (#sg-profile-rail now shares this rule with .sg-pr-host-capped)
  assert.match(railsCss, /#sg-profile-rail,\s*\n?\s*\.sg-pr-host-capped\s*\{\s*position:\s*fixed/,
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
  const rule = railsCss.match(/html body main(\.sg-tab-content)+\s*\{[^}]*\}/);
  assert.ok(rule, 'the tab container does not end at the nav, so the in-card row has nowhere to go');
  assert.match(rule[0], /bottom:\s*calc\(var\(--sg-nav-h[^)]*\)\s*\+\s*var\(--sg-safe-b/,
    'the container bottom is not derived from the measured nav');
  // sg-rail-ui.js injects `body.sg-r4-summary.sg-cb-active .sg-tab-content`
  // (three classes) with !important. Book carries both body classes, so three
  // classes here lost and only Partner got fixed. Four is the minimum.
  const classes = (rule[0].match(/\.sg-tab-content/g) || []).length;
  assert.ok(classes >= 4, `the rule has ${classes} classes; it needs 4 to beat sg-rail-ui.js on Book`);
});

test('the Reels iframe reaches the nav and the dock reserves the band for it', () => {
  // /reels is its own document inside `.sg-reels-frame`. app.ctr576.js ends the
  // frame above the orange CTA, so the row inside it rendered ABOVE the CTA
  // (production 2026-09-18: row y660-730, CTA y736-788 — the wrong order).
  const rule = railsCss.match(/html body [^{]*sg-reels-frame[^{]*\{[^}]*\}/);
  assert.ok(rule, 'nothing makes the Reels frame end at the nav');
  assert.match(rule[0], /bottom:\s*calc\(var\(--sg-nav-h/,
    'the frame bottom is not derived from the measured nav');
  const classes = (rule[0].match(/\.sg-reels-frame/g) || []).length;
  assert.ok(classes >= 3,
    `the rule has ${classes} classes; it needs 3 to beat body.sg-cb-active .sg-reels-frame`);
  // The parent cannot measure a row in another document, so it reserves the band.
  // The SPA's live path: #sg-reels-iframe inside #sg-reels-persistent, which
  // already ends at the nav. app.ctr576.js shortened the iframe by the CTA's
  // 52px, so the row inside it sat under the CTA.
  const fr = railsCss.match(/html body #sg-reels-iframe[^{]*\{[^}]*\}/);
  assert.ok(fr && /height:\s*100%/.test(fr[0]),
    'the Reels iframe does not fill its wrapper, so its row stops short of the nav');
  // `body.sg-cb-active #sg-reels-iframe` is one id AND a class, so one id here
  // loses — v1.6 shipped and changed nothing on screen.
  assert.ok((fr[0].match(/#sg-reels-iframe/g) || []).length >= 2,
    'one id does not beat body.sg-cb-active #sg-reels-iframe');
  assert.match(dockJs, /REELS_FRAME/,
    'sg-dock.js does not know about the Reels frame, so the CTA will take the row strip');
  assert.match(dockJs, /--sg-band-height/,
    'the reserved height should come from rails.css, not a second hardcoded number');

  // ── The orange CTA joined the row (owner, 2026-09-18) ──────────────────
  // It must stay the same element: the tap handler, the checkout flow and the
  // per-tab label are all bound to #sg-continue-banner, so a rebuild would
  // mean re-testing checkout on every tab.
  const pill = railsCss.match(/body\.sg-cta-in-row #sg-continue-banner[^{]*\{[^}]*\}/);
  assert.ok(pill, 'the CTA pill rule is gone: the CTA is back to a full-width bar');
  assert.ok((pill[0].match(/#sg-continue-banner/g) || []).length >= 2,
    'one id does not beat the #sg-continue-banner rules in sg-dock.js/app-patches.js');
  assert.match(pill[0], /bottom:\s*calc\(var\(--sg-band-bottom\)/,
    'the pill must sit in the band rails.css already reserves, not at its own offset');

  // The rows have to start after the pill, or it covers their first button.
  // Must be margin, not padding: padding is inside the scroller and scrolls
  // away, letting the first buttons slide under the fixed pills.
  assert.match(railsCss, /body\.sg-cta-in-row[^{]*\.tt-actions[\s\S]{0,400}?margin-left:\s*calc\(var\(--sg-cta-w\)/,
    'rows are not inset by the pill width');

  // rails.js owns the class and the measurement, so the change reverts in one
  // line, and the Reels iframe cannot measure a pill in the parent document.
  assert.match(railsJs, /sg-cta-in-row/, 'rails.js no longer sets the CTA-in-row class');
  assert.match(railsJs, /--sg-cta-w/, 'rails.js does not publish the pill width');
  // The CTA is position:fixed, so offsetParent is null even on screen. v1.8
  // used it, published 0px, and the row's buttons rendered under the pill.
  // (matched with a dot so the explanatory comment in rails.js does not trip it)
  assert.ok(!/\.offsetParent/.test(railsJs),
    'rails.js uses offsetParent, which is null for the fixed CTA');
  assert.match(railsJs, /postMessage/, 'the Reels frame is never told the pill width');

  // The dock must let go of the CTA, inline value removed — otherwise it both
  // fights the pill rule and reserves a second 52px strip.
  assert.match(dockJs, /sg-cta-in-row/, 'sg-dock.js does not know about the CTA-in-row mode');
  assert.match(dockJs, /ctaInRow\(\)[\s\S]{0,200}removeProperty\('bottom'\)/,
    'sg-dock.js still docks the CTA as its own layer instead of releasing it');

  // ── Profile's second rail (found on production 2026-09-18) ──────────────
  // profile-rail.js floats #sg-profile-rail only when the app has no rail of
  // its own; otherwise it extends the app's native rail and marks it
  // sg-pr-host-capped. Unstyled, that host stayed a vertical column
  // (x330-380, y92-696) while every other tab had the row.
  assert.match(railsCss, /\.sg-pr-host-capped[\s\S]{0,600}?position:\s*fixed/,
    'the native Profile rail host is not pinned into the band');
  assert.match(railsCss, /\.sg-pr-host-capped\s*\{[\s\S]{0,300}?overflow-y:\s*hidden/,
    'the Profile host keeps its own vertical scroll, so it stays a column');
  assert.match(dockJs, /sg-pr-host-capped/, 'the dock does not reserve the Profile host');
  assert.match(railsJs, /sg-pr-host-capped/, 'rails.js does not watch the Profile host');

  // The pill must leave room for the row: uncapped labels ("Ask AI \"How much
  // have I made this week\"") took 293-312px of 390px.
  assert.match(pill[0], /max-width:\s*58%/, 'the CTA pill is uncapped and will eat the row');

  // A fixed rail inside the tab content is not pinned to the viewport: on
  // Profile a computed bottom of 60px landed the row at y676-748. The dock
  // measures where it landed and corrects the difference.
  assert.match(dockJs, /wantBottom[\s\S]{0,600}?getBoundingClientRect[\s\S]{0,400}?setProperty\('bottom'/,
    'sg-dock.js does not verify where a fixed rail actually landed');
  // The primary word must not be the flex item that shrinks ("As...").
  assert.match(railsCss, /\.sg-cb-text\s*\{[^}]*flex:\s*0 0 auto/,
    'the CTA label can shrink again');
  assert.match(railsCss, /\.sg-cb-sub\s*\{[^}]*text-overflow:\s*ellipsis/,
    'the sub-label is not the one giving way');
  // profile-rail.js injects its overflow rule later, so specificity must win.
  assert.match(railsCss, /html body \.sg-pr-host-capped/,
    'the Profile host override is not specific enough to beat profile-rail.js');

  // ── Owner, 2026-09-18: no orange, and the Talk pill joins the row ───────
  // Nothing floats over the content any more: nav + one strip.
  assert.match(railsCss, /html body\.sg-cta-in-row #sg-continue-banner#sg-continue-banner\s*\{[^}]*background:\s*rgba\(0, 0, 0/,
    'the main button is orange again');
  for (const fab of ['#bchat-fab', '#pchat-fab', '#schat-fab', '#rchat-fab', '#mchat-fab', '#chat-fab']) {
    // Two ids: book-by-tap.css uses id + two classes to pin it right: 12px.
    assert.ok(railsCss.includes('body.sg-cta-in-row ' + fab + fab),
      fab + ' is not placed in the row, so it stays at the right edge over the buttons');
    assert.ok(railsJs.includes(fab),
      fab + ' is not measured, so the row will not leave room for it');
  }
  // The pill sits after the main button, whose width changes with its label.
  assert.match(railsCss, /left:\s*var\(--sg-talk-left/, 'the Talk pill has no measured position');
  assert.match(railsJs, /--sg-talk-left/, 'rails.js does not publish where the Talk pill starts');
  // And the dock must stop lifting it above the stack.
  assert.match(dockJs, /ctaInRow\(\)[\s\S]{0,120}removeProperty\('bottom'\);\s*continue;\s*\}\s*\n\s*el\.style\.setProperty\('bottom', \(cursor \+ FAB_GAP\)/,
    'sg-dock.js still docks the Talk pill above the row');
});

/* Option A (owner, 2026-09-18): the main button and Talk take the row's shape,
   not just its colour — a 42px circle with a 10px caption under it. The bug
   this guards is the one the owner reported twice: same colour, wrong size. */
test('the CTA and Talk are icon-and-label items, sized like the row', () => {
  const railsCss = read('rails.css');
  const railsJs = read('rails.js');

  // The words are what made the button 218px wide.
  assert.match(railsCss,
    /#sg-continue-banner \.sg-cb-text,[\s\S]{0,240}?display:\s*none/,
    'the CTA still shows its own label text, so it cannot match the row width');
  assert.match(railsCss, /\.sg-cb-ico[\s\S]{0,400}?width:\s*var\(--sg-row-ico\)/,
    'the CTA glyph is not sized from --sg-row-ico');
  assert.match(railsJs, /\.sg-cb-ico/, 'rails.js never creates the glyph the CSS styles');
  assert.match(railsJs, /\.sg-cb-cap/, 'rails.js never creates the caption');

  // Talk's own text is a bare node; only font-size:0 collapses it.
  for (const fab of ['#bchat-fab', '#pchat-fab', '#schat-fab', '#rchat-fab', '#mchat-fab', '#chat-fab']) {
    assert.ok(railsCss.includes('body.sg-cta-in-row ' + fab + fab + '::before'),
      fab + ' has no glyph, so it would render as an empty circle');
  }
  assert.match(railsCss, /font-size:\s*0\s*!important/,
    'the Talk label is not collapsed, so the circle stays pill-shaped');

  // The caption must not be read back into the label match.
  assert.ok(!/\(cta\.textContent/.test(railsJs),
    'iconify reads textContent, which includes the caption it just wrote');
});

/* Production, 2026-09-18: rails.js called ensureSlots(), a function that had
   been renamed. init() ran the first pass BEFORE setInterval, so the throw
   killed the heartbeat and every tab fell back to the pre-rails layout — the
   pills back in the corner, the rows full width. Nothing in this file noticed,
   because it all reads text. These two tests read the text that matters. */
test('rails.js calls no function it does not define, and one bad pass cannot kill the heartbeat', () => {
  const raw = read('rails.js');
  // Comments and strings are prose and selectors: "the rail (measured at y775)"
  // is not a call. Strip them, then read what is left.
  const js = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');

  // Every `name(` that is called, minus the ones it declares and the platform's.
  const declared = new Set();
  for (const m of js.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
  for (const m of js.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*=\s*function/g)) declared.add(m[1]);
  const known = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', 'setTimeout', 'clearInterval',
    'getComputedStyle', 'IntersectionObserver', 'MutationObserver', 'Event', 'Math', 'parseFloat',
    'Number', 'String', 'Boolean', 'Array', 'Object', 'Set', 'Map']);
  const missing = new Set();
  for (const m of js.matchAll(/(?:^|[\s;{}(,=!?:&|+])([a-z][\w$]*)\s*\(/g)) {
    const name = m[1];
    if (declared.has(name) || known.has(name)) continue;
    // Method calls (`el.remove()`) and property reads are matched by the class above.
    missing.add(name);
  }
  assert.deepEqual([...missing], [],
    'rails.js calls ' + [...missing].join(', ') + ' without declaring it: the first pass throws');

  // The heartbeat must be armed even if a pass throws.
  assert.match(raw, /setInterval\(\s*safeScan/,
    'the heartbeat runs scan() raw, so one throw stops every later pass');
  assert.match(raw, /function safeScan\(\)\s*\{\s*try\s*\{\s*scan\(\)/,
    'safeScan does not actually catch anything');
});

test('every tab gets the same three row buttons, built from the row\'s own markup', () => {
  const js = read('rails.js');
  const css = read('rails.css');

  // Owner, 2026-09-18: "why all buttons are not in 1 row… why they're not same
  // colour, same size, same design… why reels tab is missing ask AI and talk".
  for (const cap of ['Book', 'Talk', 'Ask AI']) {
    assert.ok(js.includes("cap: '" + cap + "'"), cap + ' is not one of the row items');
  }
  // Built from the app's own item markup, so the look is inherited, not copied.
  assert.match(js, /className = 'tt-action /, 'the items do not use the row\'s item class');
  assert.match(js, /className = 'tt-action-btn'/, 'the glyph is not the row\'s own circle');
  assert.match(js, /className = 'tt-action-label'/, 'the caption is not the row\'s own label');
  // And repeated for the rows that are not .tt-actions, or the tabs diverge again.
  assert.match(css, /\.sg-row-slot \.sg-row-trio > \.tt-action-btn[\s\S]{0,400}?border-radius:\s*50%/,
    'the three buttons are not given the circle look outside .tt-actions');

  // Talk and Ask AI open the chat the tab already has; Book uses the card's own
  // button when there is one. Nothing here may invent a second chat or checkout.
  assert.match(js, /fab\.click\(\)/, 'Talk and Ask AI do not open the existing chat');
  assert.match(js, /'-mic'/, 'Talk does not reach the microphone');
  assert.match(js, /'-input'/, 'Ask AI does not reach the typing box');
  assert.match(js, /tt-cta-btn'\)/, 'Book ignores the card\'s own book button');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(js), 'rails.js talks to the server: it is a layout file');

  // The Reels tab is a separate document: its copy asks the parent to act.
  assert.match(js, /sg: 'row-act'/, 'the framed row cannot ask the parent to open the chat');
  assert.match(js, /d\.sg !== 'row-act'/, 'the parent never serves taps from the Reels frame');

  // A card is replaced wholesale on re-render; a lost sign-in bar means no way in.
  assert.match(js, /MutationObserver/, 'nothing watches for the row being removed');
  assert.match(js, /function rescue\(el\)[\s\S]{0,200}?appendChild\(el\)/,
    'an element taken out with its card is never put back');
  assert.match(js, /pills\.indexOf\(el\)/,
    'detached elements are not remembered, and querySelector cannot find them');
  assert.match(css, /\.sg-row-slot > #sg-continue-banner#sg-continue-banner[\s\S]{0,600}?position:\s*static/,
    'the main bar keeps its fixed position inside the row');
});

test('a rail already in the right place keeps its correction (no 500ms jump)', () => {
  // Removing the inline bottom once the row landed correctly made the next pass
  // see it wrong again: the Profile rail flickered between two heights.
  const dockJs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'sg-dock.js'), 'utf8');
  assert.ok(!/landed - wantBottom\) <= 1\) \{ el\.style\.removeProperty\('bottom'\)/.test(dockJs),
    'sg-dock.js must not strip the correction from a rail that is already in place');
});
