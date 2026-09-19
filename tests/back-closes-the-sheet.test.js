'use strict';

/**
 * The back button has to close the sheet, not leave ScanGym.
 *
 * Measured on production, 2026-09-19: open Passes, Payment, Hours, Reviews,
 * Calendar or Search on a 412x915 phone, press back, and the browser navigated
 * away from the app — because no sheet pushed a history entry. Mid-booking, that
 * is the app throwing the customer out for using the phone's own gesture.
 *
 * These drive the real sg-sheets.js over the mini DOM and assert on behaviour:
 * that opening pushes one entry, that a pop closes the top sheet instead of
 * routing, that closing by ✕ consumes the entry it pushed (otherwise the next
 * back press does nothing), and that a drag past a quarter of the sheet
 * dismisses while a short drag springs back.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { El, makeSandbox, fire, tick } = require('./helpers/mini-dom');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'sg-sheets.js'),
  'utf8',
);

/**
 * Boot sg-sheets.js with a fake gym overlay and spies for the app's own
 * open/close functions.
 */
function boot() {
  const { sandbox, doc } = makeSandbox({ pathname: '/explore' });

  // The sheet, as app.ctr576.js builds it.
  const root = new El('div');
  root.id = 'gym-overlay';
  const panel = new El('div');
  panel.className = 'gym-overlay-panel';
  panel.rect = { height: 400, top: 515, bottom: 915, width: 412 };
  const scrim = new El('div');
  scrim.className = 'gym-overlay-bg';
  const handle = new El('div');
  handle.className = 'gym-overlay-drag';
  panel.appendChild(handle);
  root.appendChild(scrim);
  root.appendChild(panel);
  doc.body.appendChild(root);

  const calls = { open: 0, close: 0 };
  const entries = [];
  const winListeners = {};

  sandbox.openGymDirectOverlay = () => { calls.open++; root.classList.add('open'); };
  sandbox.closeGymOverlay = () => { calls.close++; root.classList.remove('open'); };
  // The other three sheets are absent from this DOM on purpose: sg-sheets.js
  // must skip what it cannot find rather than throwing.
  sandbox.history = {
    pushState: (st) => { entries.push(st); },
    back: () => {
      entries.pop();
      (winListeners.popstate || []).forEach((fn) => fn({}));
    },
  };
  sandbox.addEventListener = (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); };
  sandbox.getComputedStyle = () => ({ display: 'block', opacity: '1' });
  sandbox.MutationObserver = class { observe() {} disconnect() {} };

  vm.runInNewContext(SRC, sandbox, { filename: 'sg-sheets.js' });
  return { sandbox, doc, root, panel, scrim, calls, entries, winListeners };
}

test('opening a sheet pushes exactly one history entry', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(s.entries.length, 1);
  assert.equal(s.entries[0].sgSheet, 'gym');
});

test('back closes the sheet instead of leaving the page', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));

  // The phone's back gesture: the entry is gone, then popstate fires.
  s.entries.pop();
  s.winListeners.popstate.forEach((fn) => fn({}));

  assert.equal(s.calls.close, 1, 'the sheet closed');
  assert.equal(s.sandbox._sgSheets.stack.length, 0, 'and nothing is left open');
});

test('a second back press, with nothing open, is left to the app', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));
  s.entries.pop();
  s.winListeners.popstate.forEach((fn) => fn({}));
  const closesAfterFirst = s.calls.close;

  s.winListeners.popstate.forEach((fn) => fn({}));
  assert.equal(s.calls.close, closesAfterFirst, 'no phantom close — the router gets it');
});

test('closing by ✕ consumes the entry it pushed', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(s.entries.length, 1);

  s.sandbox.closeGymOverlay();            // what the ✕ and the backdrop call
  assert.equal(s.entries.length, 0, 'otherwise the next back press does nothing');
  assert.equal(s.sandbox._sgSheets.stack.length, 0);
});

test('a drag past a quarter of the sheet dismisses it; a nudge springs back', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));

  const top = s.panel.rect.top;           // drag must start in the grab zone
  const drag = (dy) => {
    fire(s.panel, 'touchstart', { touches: [{ clientY: top + 10 }], target: s.panel });
    fire(s.panel, 'touchmove', { touches: [{ clientY: top + 10 + dy }] });
    fire(s.panel, 'touchend', {});
  };

  drag(30);                               // 30 of 400px: a scroll, not a dismissal
  assert.equal(s.calls.close, 0);

  drag(150);                              // past 25% of 400px
  assert.equal(s.calls.close, 1);
});

test('a drag that starts deep in the scrollable body is a scroll, not a dismissal', async () => {
  const s = boot();
  s.sandbox.openGymDirectOverlay('gym-1', true, 'passes');
  await new Promise((r) => setTimeout(r, 90));

  const deep = s.panel.rect.top + 300;    // well below the header
  fire(s.panel, 'touchstart', { touches: [{ clientY: deep }], target: s.panel });
  fire(s.panel, 'touchmove', { touches: [{ clientY: deep + 200 }] });
  fire(s.panel, 'touchend', {});
  assert.equal(s.calls.close, 0, 'reading a long review must not throw the sheet away');
});

test('sheets missing from the DOM are skipped, not thrown on', async () => {
  const s = boot();
  // Only the gym overlay exists in this DOM; the file registers four.
  assert.equal(s.sandbox._sgSheets.sheets.length, 4);
  await tick();
  assert.ok(true, 'booting did not throw');
});
