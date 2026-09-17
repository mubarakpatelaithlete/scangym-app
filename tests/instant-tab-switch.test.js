/**
 * Tapping a tab rebuilt #app in the same frame, but everything floating OUTSIDE
 * #app found out by polling. Measured on production with the CPU throttled 4x:
 * the orange "Ask AI" bar appeared 638ms after tapping ScanSquad, and was still
 * on screen after moving on to Profile. Nielsen's 0.1s and Google's INP budget
 * (200ms) both put a poll of 600-800ms well outside "instant".
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'frontend', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('a tab change is announced in the same tap that causes it', () => {
  const app = read('app.ctr576.js');
  const fn = app.slice(app.indexOf('function switchTab(tab){'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /dispatchEvent\(new CustomEvent\('sg:tabchange'/, 'switchTab no longer announces the change');
  assert.ok(body.indexOf('sg:tabchange') > body.indexOf('render()'),
    'the event must fire after state and route are set, or listeners read the old tab');
});

test('every owner of floating chrome listens, and keeps its timer as a backup', () => {
  for (const f of ['sg-rail-ui.js', 'squad-create.js', 'profile-rail.js']) {
    const src = read(f);
    assert.match(src, /addEventListener\('sg:tabchange'/, `${f} still only polls for tab changes`);
    assert.match(src, /setInterval\(/, `${f} dropped its timer — a missed event would strand its rail`);
  }
});

test('the tab-change listener syncs immediately, not on another timer', () => {
  for (const f of ['sg-rail-ui.js', 'squad-create.js', 'profile-rail.js']) {
    const src = read(f);
    const idx = src.indexOf("addEventListener('sg:tabchange'");
    const handler = src.slice(idx, idx + 220);
    assert.ok(!/setTimeout\(/.test(handler), `${f} defers its tab-change sync, which is the bug again`);
    assert.match(handler, /(sync|tick)\(\)/, `${f} listens but does not sync`);
  }
});
