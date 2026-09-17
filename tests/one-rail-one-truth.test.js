/**
 * Three bug classes, one root cause: a control whose look and behaviour are
 * decided in more than one place.
 *
 *  1. The Book-tab action rail was written out twice — main renderer and lazy
 *     renderer — and the two copies had to stay byte-identical by hand.
 *  2. The Partner tab's Search button was rendered as the *customer* gym
 *     search and then re-wired at runtime, once per route change, on a 200ms
 *     timeout. Any later re-render (price edit, active toggle, dashboard
 *     reload) silently reverted it to the visitor gym-finder.
 *  3. Unbuilt Create modes shipped as visible buttons that apologise.
 *
 * These tests pin the fix: one template per rail, the partner Search wired in
 * its own template, no runtime hijack, and no hardcoded currency fallback.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const app = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');
const pe = fs.readFileSync(path.join(PUB, 'partner-editable.js'), 'utf8');
const squad = fs.readFileSync(path.join(PUB, 'squad-create.js'), 'utf8');

test('the Book rail is built by one template, not copy-pasted per renderer', () => {
  assert.ok(app.includes('function _sgBookRailHtml('), 'the shared rail template is gone');
  const calls = app.match(/_sgBookRailHtml\(/g) || [];
  assert.ok(calls.length >= 3, `expected the template plus both renderers, got ${calls.length}`);
  const nearMe = app.match(/'Near Me'/g) || [];
  assert.equal(nearMe.length, 1, 'the Near Me button is written in more than one place again');
});

test('the partner Search opens the claim search from its own template', () => {
  const rail = app.slice(app.indexOf('RIGHT SIDE ACTION BUTTONS'));
  const line = rail.split('\n').find((l) => l.includes('tt-action-label">Search<'));
  assert.ok(line, 'the partner rail has no Search button');
  assert.ok(line.includes('_peOpenClaimSearch'), 'partner Search is not wired to the claim search');
  const before = line.indexOf('_peOpenClaimSearch');
  const visitor = line.indexOf('_openSearchOverlay');
  assert.ok(visitor === -1 || before < visitor, 'the visitor search still wins over the claim search');
});

test('no runtime hijack rewrites a button someone else rendered', () => {
  assert.ok(!pe.includes('_peHijackSearch'), 'the Search hijack is back');
  assert.ok(!/setTimeout\(_peHijack/.test(pe), 'a timed hijack is back');
});

test('a Create mode with no backend is hidden, not shown apologising', () => {
  assert.ok(squad.includes('function isHidden('), 'the not_built filter is gone');
  assert.ok(squad.includes("reason === 'not_built'"), 'hiding no longer keys off server truth');
  assert.ok(squad.includes('visibleModes().forEach(function (m) { r.appendChild(makeBtn(m)); })'),
    'the rail no longer builds from the visible set');
  // Never guess: with no server answer yet, nothing may be hidden.
  const fn = squad.slice(squad.indexOf('function isHidden('));
  assert.ok(fn.includes('modeStatus && modeStatus[mode.key]'),
    'isHidden must return false until the server has spoken');
});

test('no price is printed with a hardcoded pound fallback', () => {
  assert.ok(!app.includes("'£8.98'"), 'the booking total still falls back to a GBP string');
  assert.ok(!app.includes("'£4.49'"), 'a GBP day-rate fallback is back in customer copy');
  const bad = app.match(/:'£[\d.]+'/g) || [];
  assert.deepEqual(bad, [], `hardcoded currency fallbacks found: ${bad.join(', ')}`);
});
