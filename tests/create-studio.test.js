/**
 * Create Studio (frontend/public/create-studio.js) — the Create tab's landing
 * surface: a model catalogue grid plus a dated history feed, opening the
 * existing sheet with the tapped model preselected. It must never become a
 * second pipeline: no /generate call of its own, and it is loaded after the
 * sheet it drives.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('the studio is loaded after the sheet it opens', () => {
  const html = read('index.html');
  const sheet = html.indexOf('/squad-create.js');
  const studio = html.indexOf('/create-studio.js');
  assert.ok(sheet > -1 && studio > -1, 'both scripts load');
  assert.ok(sheet < studio, 'create-studio.js must come after squad-create.js');
});

test('tiles open the sheet with the model preselected; the studio never generates itself', () => {
  const studio = read('create-studio.js');
  assert.match(studio, /sgSquadCreate\.open\(t\.kind\.key, '', null, \{ model: t\.id \}\)/);
  assert.ok(!/\/generate/.test(studio), 'the studio must not call a generate route');
  const sheet = read('squad-create.js');
  assert.match(sheet, /open: function \(key, prompt, result, opts\)/);
  assert.match(sheet, /if \(opts && opts\.model\) \{ state\[mode\.key\]\.__model = opts\.model/);
});

test('the sheet quotes the price on one line with a Change model control', () => {
  const sheet = read('squad-create.js');
  assert.match(sheet, /<b>Using ' \+ price \+ '<\/b>/);
  assert.match(sheet, /Change model/);
});

test('catalogue and history come from the existing endpoints', () => {
  const studio = read('create-studio.js');
  assert.match(studio, /\/api\/squad-create\/modes/);
  assert.match(studio, /\/health/);
  assert.match(studio, /\/api\/squad-create\/library\?limit=40/);
  // failed and running jobs are shown, not hidden
  assert.match(studio, /Couldn\\u2019t generate|Couldn’t generate/);
  assert.match(studio, /Generating/);
});

const { test: t2 } = require('node:test');
const a2 = require('node:assert');
const fs2 = require('node:fs');
const path2 = require('node:path');

t2('the billing status line lifts an unjustified suspension before reporting "paused"', () => {
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'server', 'routes', 'squad-billing.js'), 'utf8');
  const route = src.slice(src.indexOf("router.get('/status'"), src.indexOf('suspended:'));
  a2.match(route, /liftUnjustifiedSuspensions\(/, 'status reports the raw suspended flag without the re-check gate() does');
});

t2('the model price line never wraps into "Change model"', () => {
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'squad-create.js'), 'utf8');
  const pill = src.slice(src.indexOf('var paintPill'), src.indexOf('pill.addEventListener'));
  a2.match(pill, /text-overflow:ellipsis;white-space:nowrap/, 'the price span can wrap onto two lines');
});

/* Higgsfield-style, one flow (owner, 2026-09-30): the create surface is a full
   page with ← back, the type tabs and the history list are the grid's job,
   "Change model" is the grid, and the Library strip leads the Create tab. */
t2('the create surface has \u2190 back, no type tabs and no second history list', () => {
  const sheet = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'squad-create.js'), 'utf8');
  a2.match(sheet, /'\.sv-back\{/, 'a back control is how the page is left');
  a2.match(sheet, /sv-head-name/, 'the header names the model');
  a2.doesNotMatch(sheet, /sh\.appendChild\(seg\)/, 'type tabs belong to the grid only');
  a2.doesNotMatch(sheet, /hist\.id = 'sv-history'/, 'the page has no second history list');
  a2.match(sheet, /function openGrid\(mode\)/);
  a2.match(sheet, /pill\.addEventListener\('click', function \(\) \{ openGrid\(mode\); \}\)/, '"Change model" opens the grid');
  a2.match(sheet, /state\[mode\.key\]\.__prompt = ta\.value/, 'the prompt survives the trip to the grid');
});

t2('the Create tab leads with a Library strip and can be shown filtered from the page', () => {
  const studio = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'create-studio.js'), 'utf8');
  a2.match(studio, /<b>Library<\/b>/);
  a2.match(studio, /show: function \(kind\)/);
  a2.ok(studio.indexOf("'cs-lib'") < studio.indexOf("el('div', 'cs-grid')"), 'the Library strip is built before the grid');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'index.html'), 'utf8');
  a2.match(html, /squad-create\.js\?v=2\.[4-9]/);
  a2.match(html, /create-studio\.js\?v=1\.6/);
});

t2('every Home, Create and Shop button opens the one half-screen sheet: red ✕, swipe down, back', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const hs = fs2.readFileSync(path2.join(pub, 'sg-half-sheet.js'), 'utf8');
  a2.match(hs, /window\.sgOpenSheet = openSheet/);
  a2.match(hs, /\.shs-x\{[^}]*color:#ef4444/, 'the ✕ is red');
  a2.match(hs, /history\.pushState\(\{ sgHalfSheet: 1 \}/, 'the phone back button closes the sheet, not the page');
  a2.match(hs, /'touchmove'/, 'swipe down follows the finger');
  a2.match(hs, /max-height:62vh/, 'half screen, page visible behind');
  const sheet = fs2.readFileSync(path2.join(pub, 'squad-create.js'), 'utf8');
  a2.match(sheet, /'\.sv-x\{[^}]*color:#ef4444/, 'the Create model sheet has the red ✕');
  a2.match(sheet, /max-height:70vh/, 'the Create model page is a bottom sheet again');
  a2.match(sheet, /window\.sgSheetDrag\(sh/, 'and swipes down');
  a2.match(sheet, /ov\.id = 'sg-sv-overlay'/, 'with the grid dimmed behind it');
  const reels = fs2.readFileSync(path2.join(pub, 'reels', 'index.html'), 'utf8');
  a2.match(reels, /sgOpenSheet\([\s\S]{0,400}title: 'Share this reel'/, 'Share opens the sheet');
  a2.match(reels, /title: 'Save this reel'/, 'Save opens the sheet');
  a2.match(reels, /sg-half-sheet\.js\?v=1\.4/, 'the Reels frame loads it');
  const app = fs2.readFileSync(path2.join(pub, 'app.ctr576.js'), 'utf8');
  a2.match(app, /if\(typeof window\.sgOpenSheet==='function'\) return window\.sgOpenSheet\(html,opts\|\|\{\}\)/, 'the Shop uses it');
  for (const f of ['index.html', 'scansquad/index.html']) {
    a2.match(fs2.readFileSync(path2.join(pub, f), 'utf8'), /sg-half-sheet\.js\?v=1\.4/, f + ' loads it');
  }
});

t2('a button inside a sheet opens the next step in the same sheet: ← one step back, ✕ closes all', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const hs = fs2.readFileSync(path2.join(pub, 'sg-half-sheet.js'), 'utf8');
  a2.match(hs, /window\.sgSheetPush = pushStep/);
  a2.match(hs, /window\.sgSheetPop = popStep/);
  a2.match(hs, /current\.stack\.push\(\{ head: head, body: body/, 'the previous step is kept, not rebuilt');
  a2.match(hs, /nh\.querySelector\('\.shs-x'\)\.addEventListener\('click', function \(\) \{ closeSheet\(\); \}\)/, '✕ on a step closes the whole sheet');
  const reels = fs2.readFileSync(path2.join(pub, 'reels', 'index.html'), 'utf8');
  a2.match(reels, /searchSheet = window\.sgOpenSheet\(searchPanel, \{ title: 'Search reels'/, 'the Home 🔍 opens the half sheet, not a full page');
  a2.match(reels, /#sg-half-sheet #reels-search-panel\{position:static/);
  const sheet = fs2.readFileSync(path2.join(pub, 'squad-create.js'), 'utf8');
  a2.doesNotMatch(sheet, /function toggleSettings/, 'Settings no longer unfolds under the prompt');
  a2.match(sheet, /function enterSettings\(sh, mode\)/);
  a2.match(sheet, /if \(sh\.__step\) exitSettings\(sh, mode\); else closeSheet\(\);/, '← leaves the Settings step before it closes the sheet');
  a2.match(sheet, /'Done \\u2713'/);
});

t2('an open app notices a new build and reloads itself on the next tab switch', () => {
  const app = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');
  a2.match(app, /Stale-build watch/);
  a2.match(app, /fetch\('\/\?sg_build='\+Date\.now\(\),\{cache:'no-store'/, 'asks the server, not the cache, which build is current');
  a2.match(app, /document\.addEventListener\('sg:tabchange',function\(\)\{if\(stale\)/, 'reloads between tabs, never mid-task');
});

t2('the button row is a solid rectangle on the tab bar and the reel ends above it', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const css = fs2.readFileSync(path2.join(pub, 'rails.css'), 'utf8');
  a2.match(css, /--sg-band-gap: 0px;/, 'the band touches the tab bar');
  a2.match(css, /\.reel-actions,\n#sg-reels-rail,\n#sg-sv-rail\.sv-float,\n#sg-profile-rail,\n\.sg-pr-host-capped \{\n  background: rgba\(8, 8, 18, \.98\) !important;/, 'solid, like the tab bar');
  const reels = fs2.readFileSync(path2.join(pub, 'reels', 'index.html'), 'utf8');
  a2.match(reels, /\.reel video, \.reel canvas\.frame-preview, \.reel iframe, \.reel \.reel-poster\{\n\s+height:calc\(100% - var\(--sg-band-height,76px\)\)/, 'the video stops above the band');
  a2.match(reels, /\.reel-progress\{ bottom:var\(--sg-band-height,76px\)/, 'so does the progress line');
  for (const f of ['index.html', 'reels/index.html', 'scansquad/index.html']) a2.match(fs2.readFileSync(path2.join(pub, f), 'utf8'), /rails\.css\?v=(3\.[89]|[4-9]\.\d+)/, f);
});

t2('the button row looks like the tab bar: 56px, flat icon + label, spread evenly', () => {
  const css = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'rails.css'), 'utf8');
  a2.match(css, /--sg-band-height: 56px;/);
  a2.match(css, /justify-content: space-around !important;/);
  a2.match(css, /\.reel-actions \.icon \{\n  width: 24px !important;[\s\S]{0,200}background: transparent !important;/, 'no circles');
});

t2('every page ends above the two bars and the Create type row is no longer covered by the grid', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const studio = fs2.readFileSync(path2.join(pub, 'create-studio.js'), 'utf8');
  a2.match(studio, /bottom:calc\(var\(--sg-tab-height,56px\) \+ var\(--sg-band-height,56px\)\);z-index:8995/, 'the grid stops at the top of the type row');
  const css = fs2.readFileSync(path2.join(pub, 'rails.css'), 'utf8');
  a2.match(css, /z-index: 8996 !important;/, 'the row sits above the tab pages');
  a2.match(css, /html body\.sg-cta-rides-row \.sg-tab-content:not\(\.reels-active\) \{\n  bottom: calc\(var\(--sg-nav-h, 56px\) \+ var\(--sg-safe-b, 0px\) \+ var\(--sg-band-height, 56px\)\)/, 'so does every other tab page');
  a2.match(css, /#sg-sv-rail\.sv-float \.sv-circle,\n[\s\S]{0,160}width: 24px !important;/, 'Create type buttons are flat like the tab bar');
});

t2('the fixed bars carry no backdrop blur and sheets open in 200 ms', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const css = fs2.readFileSync(path2.join(pub, 'rails.css'), 'utf8');
  a2.match(css, /backdrop-filter: none !important;\n  -webkit-backdrop-filter: none !important;\n\}/, 'button bar: no blur');
  const app = fs2.readFileSync(path2.join(pub, 'app.ctr576.js'), 'utf8');
  a2.doesNotMatch(app, /\.sg-tab-bar\{[^}]*backdrop-filter/, 'tab bar: no blur');
  a2.match(fs2.readFileSync(path2.join(pub, 'sg-half-sheet.js'), 'utf8'), /transition:transform \.2s cubic-bezier/);
  a2.match(fs2.readFileSync(path2.join(pub, 'squad-create.js'), 'utf8'), /transition:transform \.2s cubic-bezier/);
});

t2('the sign-in sheet is the same half sheet: 62vh, red ✕, ← back, no blur', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  const app = fs2.readFileSync(path2.join(pub, 'app.ctr576.js'), 'utf8');
  a2.match(app, /\.sg-auth-panel\{[^}]*max-height:62vh/);
  a2.doesNotMatch(app, /\.sg-auth-bg\{[^}]*backdrop-filter/);
  a2.match(app, /class="sg-auth-backbtn" role="button" aria-label="Back" onclick="window\._sgAuthBack\(\)"/);
  a2.match(app, /window\._sgAuthBack=function\(\)\{\n\s+if\(_sheetStep==='auth'\|\|_sheetStep==='done'\)\{window\._sgCloseAuthSheet\(\);return;\}/);
  const sd = fs2.readFileSync(path2.join(pub, 'sheet-dismiss.js'), 'utf8');
  a2.match(sd, /\.sg-sheet-x\{[^}]*color:#ef4444/, 'every legacy sheet closes with the red ✕');
});

t2('sheets animate on the compositor and a tab switch does not smooth-scroll', () => {
  const pub = path2.join(__dirname, '..', 'frontend', 'public');
  a2.match(fs2.readFileSync(path2.join(pub, 'sg-half-sheet.js'), 'utf8'), /will-change:transform;transform:translateY\(105%\)/);
  a2.match(fs2.readFileSync(path2.join(pub, 'squad-create.js'), 'utf8'), /will-change:transform;transform:translateY\(105%\)/);
  const app = fs2.readFileSync(path2.join(pub, 'app.ctr576.js'), 'utf8');
  a2.match(app, /\.sg-tab-content\{[^}]*scroll-behavior:auto/, 'scrollTop=0 on a tab switch must be instant');
});

t2('the Profile row matches every other row: flat icons, no dots, no second Book', () => {
  const css = fs2.readFileSync(path2.join(__dirname, '..', 'frontend', 'public', 'rails.css'), 'utf8');
  a2.match(css, /\.sg-pr-host-capped > :not\(#sg-profile-rail-ext\) > div:first-child,\n\.sg-pr-host-capped \.sg-pr-circle,[\s\S]{0,160}width: 24px !important;/);
  a2.match(css, /#sg-profile-rail-ext \.sg-pr-dot \{ display: none !important; \}/);
  a2.match(css, /\.sg-pr-host-capped > button\[aria-label="Book a gym"\] \{ display: none !important; \}/);
});
