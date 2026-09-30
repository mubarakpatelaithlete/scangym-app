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
t2('the create surface is a full page, not a sheet stacked on the grid', () => {
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
  a2.match(html, /squad-create\.js\?v=1\.6/);
  a2.match(html, /create-studio\.js\?v=1\.3/);
});
