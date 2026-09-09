'use strict';

/**
 * A sheet a customer cannot close is a broken app.
 *
 * The sign-in sheet slid up over everything with exactly one way out: a tap on
 * the backdrop above the panel. That works — but it is the one gesture nobody
 * is told about, the strip shrinks to a sliver when the panel is tall, and the
 * three things people actually try all failed: there was no x, Escape did
 * nothing, and the drag handle drawn at the top of the panel was decoration.
 * Tapping Book and changing your mind meant reloading the site.
 *
 * These run the real sheet-dismiss.js in a minimal DOM and assert on gestures,
 * not on markup, because a regex cannot tell whether a swipe closes anything.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { El, makeSandbox, fire, fireDoc } = require('./helpers/mini-dom');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const SRC = fs.readFileSync(path.join(PUB, 'sheet-dismiss.js'), 'utf8');
const APP = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');

/** Boot sheet-dismiss.js over an open panel, as the auth sheet does. */
function boot({ scrollTop = 0 } = {}) {
  const { sandbox, doc } = makeSandbox();
  vm.runInNewContext(SRC, sandbox);

  const panel = new El('div');
  panel.className = 'sg-auth-panel';
  panel.scrollTop = scrollTop;
  doc.body.appendChild(panel);

  let open = true;
  sandbox.sgMakeSheetDismissible({
    panel,
    onClose: () => { open = false; },
    isOpen: () => open,
  });
  return { sandbox, doc, panel, isOpen: () => open };
}

function swipe(panel, from, to, ms = 120) {
  fire(panel, 'touchstart', { touches: [{ clientY: from }] });
  const started = Date.now();
  while (Date.now() - started < 1) { /* keep the gesture inside the time budget */ }
  fire(panel, 'touchend', { changedTouches: [{ clientY: to }], touches: [] });
  return ms;
}

test('the sheet gets a real close button, and it closes the sheet', () => {
  const { panel, isOpen } = boot();
  const x = panel.querySelector('.sg-sheet-x');
  assert.ok(x, 'no close button was added to the panel');
  assert.equal(x.getAttribute('aria-label'), 'Close', 'the close button must be reachable by name');
  x.click();
  assert.equal(isOpen(), false, 'tapping the x did not close the sheet');
});

test('Escape closes the sheet', () => {
  const { doc, isOpen } = boot();
  fireDoc(doc, 'keydown', { key: 'Escape' });
  assert.equal(isOpen(), false, 'Escape did nothing');
});

test('Escape leaves an already-closed sheet alone', () => {
  const { sandbox, doc } = makeSandbox();
  vm.runInNewContext(SRC, sandbox);
  const panel = new El('div');
  doc.body.appendChild(panel);
  let closes = 0;
  sandbox.sgMakeSheetDismissible({ panel, onClose: () => { closes++; }, isOpen: () => false });
  fireDoc(doc, 'keydown', { key: 'Escape' });
  assert.equal(closes, 0, 'Escape closed a sheet that was not open');
});

test('a downward swipe closes the sheet', () => {
  const { panel, isOpen } = boot();
  swipe(panel, 120, 320);
  assert.equal(isOpen(), false, 'swiping down did not close the sheet');
});

test('a small drag is a scroll, not a dismissal', () => {
  const { panel, isOpen } = boot();
  swipe(panel, 120, 140);
  assert.equal(isOpen(), true, 'a 20px drag threw the sheet away');
});

test('swiping a scrolled panel does not close it', () => {
  const { panel, isOpen } = boot({ scrollTop: 200 });
  swipe(panel, 120, 400);
  assert.equal(isOpen(), true, 'flicking a scrolled form closed the sheet mid-read');
});

test('wiring the same panel twice does not stack buttons or handlers', () => {
  const { sandbox, doc } = makeSandbox();
  vm.runInNewContext(SRC, sandbox);
  const panel = new El('div');
  doc.body.appendChild(panel);
  let closes = 0;
  const opts = { panel, onClose: () => { closes++; }, isOpen: () => true };
  sandbox.sgMakeSheetDismissible(opts);
  sandbox.sgMakeSheetDismissible(opts);
  assert.equal(panel.querySelectorAll('.sg-sheet-x').length, 1, 'a second x was added');
  fireDoc(doc, 'keydown', { key: 'Escape' });
  assert.equal(closes, 1, 'one Escape closed the sheet twice');
});

test('the auth sheet actually asks to be dismissible', () => {
  /* The module is useless if the sheet never calls it, and the sheet is the
     only place in the app that covers the tab bar. */
  const build = APP.slice(APP.indexOf('function _buildSheet'), APP.indexOf('// ── Step 1: Sign In ──'));
  assert.ok(build.length > 100, 'could not find _buildSheet in app.ctr576.js');
  assert.match(build, /sgMakeSheetDismissible/, '_buildSheet does not make the panel dismissible');
  assert.match(build, /sg-auth-bg[^]*?_sgCloseAuthSheet/, 'the backdrop lost its close handler');
});

test('the shell loads sheet-dismiss.js', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.match(html, /src="\/sheet-dismiss\.js"/, 'index.html does not load sheet-dismiss.js');
});
