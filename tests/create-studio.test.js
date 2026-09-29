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
