'use strict';

/**
 * First paint must not wait for a timer tick.
 *
 * The patch layer coordinates by polling: "wait until the app bundle defines
 * this global", "wait until the route changes". A bare setInterval(fn, N) does
 * not run fn until N ms have already passed, so each of those polls put its own
 * period between the data being ready and the pixels appearing.
 *
 * Measured live at 4x CPU throttle before this was fixed:
 *
 *   Partner  LCP 2044ms — 200ms (wait for _showPartnerScreen, which already
 *                        existed) + 300ms (route poll) + 100ms (setTimeout)
 *                        of pure waiting, on top of auth + dashboard fetch.
 *   Profile  LCP 1732ms — the LCP element is drawn by batch3.js, which loads
 *                        from the idle bucket and then waited 900ms for its
 *                        first tick.
 *
 * The fix in both cases is the same and is what these tests protect: run the
 * work once, immediately, then keep the interval for the cases it genuinely
 * covers (state changing later). The interval is not the enemy; the interval
 * *owning the first render* is.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// -- partner-editable.js --------------------------------------------------

test('partner-editable installs its patch synchronously, not on a 200ms tick', () => {
  const src = read('partner-editable.js');
  // The install must be a callable function tried immediately...
  assert.ok(/function\s+_peInstallPatch\s*\(/.test(src), 'no _peInstallPatch function');
  assert.ok(/if\s*\(\s*!_peInstallPatch\(\)\s*\)/.test(src),
    'the patch is not attempted synchronously before falling back to polling');
  // ...and the old shape — an interval that owns the install — must be gone.
  assert.ok(!/var\s+_waitPatch\s*=\s*setInterval\(function\(\)\{\s*\n?\s*if\s*\(\s*typeof\s+_showPartnerScreen/.test(src),
    'the bare install-by-polling ladder is back');
});

test('partner first render is not behind a 300ms route poll plus a 100ms timeout', () => {
  const src = read('partner-editable.js');
  assert.ok(/_peRouteTick\(\);/.test(src), 'the route check is never run eagerly');
  // The eager call must come before the interval that repeats it.
  const eager = src.indexOf('_peRouteTick();');
  const repeat = src.indexOf('setInterval(_peRouteTick');
  assert.ok(eager !== -1 && repeat !== -1 && eager < repeat,
    'the first route check must happen before the poll is scheduled');
  assert.ok(!/setTimeout\(function\(\)\{_peLoadAndRender\(\);\},100\)/.test(src),
    'the 100ms delay before the first partner render is back');
});

test('partner route tick reads window.state, so it is safe to call early', () => {
  const src = read('partner-editable.js');
  const tick = src.slice(src.indexOf('function _peRouteTick'), src.indexOf('_peRouteTick();'));
  assert.ok(/window\.state\s*&&\s*window\.state\.route/.test(tick),
    'a bare `state` reference throws when the tick runs before the bundle boots');
});

test('the duplicate-screen sweep is still on a timer', () => {
  // This one *should* keep polling — a stale .pe-view can appear at any time,
  // there is no event for it. Removing it would resurrect the "two partner
  // screens" bug, so the fix must not have thrown it away.
  const src = read('partner-editable.js');
  assert.ok(/function\s+_peSweep\s*\(/.test(src), 'the sweep was lost');
  assert.ok(/setInterval\(_peRouteTick\s*,\s*300\)/.test(src), 'the sweep no longer repeats');
  assert.ok(/querySelectorAll\('\.pe-view'\)/.test(src), 'the sweep no longer removes .pe-view');
});

// -- batch2.js / batch3.js -----------------------------------------------

test('batch3 draws the ID row once immediately, then keeps polling', () => {
  const src = read('batch3.js');
  assert.ok(/_sgB3IdentityTick\(\);/.test(src), 'the identity row still waits 900ms for a first tick');
  const eager = src.indexOf('_sgB3IdentityTick();');
  const repeat = src.indexOf('setInterval(_sgB3IdentityTick');
  assert.ok(eager !== -1 && repeat !== -1 && eager < repeat,
    'the eager call must precede the interval');
  assert.ok(!/setInterval\(function\(\)\{checkIdentity\(\)\.then\(injectIdRow\);\},900\)/.test(src),
    'the original first-tick-delayed poll is back');
});

test('batch2 rebook row gets the same treatment', () => {
  const src = read('batch2.js');
  const eager = src.indexOf('_sgB2RebookTick();');
  const repeat = src.indexOf('setInterval(_sgB2RebookTick');
  assert.ok(eager !== -1 && repeat !== -1 && eager < repeat,
    'batch2 still waits 900ms before its first paint');
});

// -- the general rule ----------------------------------------------------

test('no first-paint script waits on a bare "does this global exist yet" poll', () => {
  // sg-chunk-loader.js provides sgOnChunk/sgLoadScript precisely so this
  // pattern is unnecessary. Files listed here are on a render path.
  const RENDER_PATH = ['partner-editable.js', 'batch2.js', 'batch3.js'];
  for (const f of RENDER_PATH) {
    const src = read(f);
    const bad = src.match(/setInterval\(function\s*\([^)]*\)\s*\{\s*if\s*\(\s*typeof\s+\w+\s*===?\s*'function'/g) || [];
    assert.strictEqual(bad.length, 0,
      f + ' waits for a global by polling; call it synchronously first or use sgOnChunk');
  }
});

// -- runner --------------------------------------------------------------

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}
console.log((failed ? 'FAILED ' + failed + '/' : 'passed ') + tests.length + ' no-poll-before-paint tests');
if (failed) process.exit(1);
