/**
 * The purchase must be reachable by tap.
 *
 * one-cta.css hid #sg-continue-banner ("Book this gym · £4.49 →") so that Talk
 * would be the only call to action. A first-customer test on 8 Sep 2026 found the
 * result: nothing tappable on the Book tab books. book-by-tap.css puts the bar
 * back while there is something to sell, and shrinks Talk to a pill beside it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const css = fs.readFileSync(path.join(PUBLIC, 'book-by-tap.css'), 'utf8');
const SHELLS = ['index.html', 'reels/index.html', 'scansquad/index.html'];

test('the purchase bar is shown and orange while the app has something to sell', () => {
  assert.ok(/body\.sg-cb-active #sg-continue-banner\s*\{[^}]*display:\s*flex\s*!important/.test(css));
  assert.ok(/body\.sg-cb-active #sg-continue-banner\s*\{[^}]*#FF6D00/i.test(css));
});

test('Talk stays on screen but steps back to a pill beside the purchase bar', () => {
  assert.ok(!/display:\s*none/.test(css), 'book-by-tap.css must never hide the Talk pill');
  assert.ok(/#bchat-fab\.show[^{]*\{[^}]*left:\s*auto\s*!important/.test(css));
});

test('the ScanSquad form can be submitted', () => {
  assert.ok(/#join-btn\s*\{[^}]*display:\s*inline-flex\s*!important/.test(css));
});

test('every shell loads it after talk-bar.css', () => {
  for (const shell of SHELLS) {
    const html = fs.readFileSync(path.join(PUBLIC, shell), 'utf8');
    assert.ok(/book-by-tap\.css/.test(html), `${shell} does not load book-by-tap.css`);
    assert.ok(html.indexOf('talk-bar.css') < html.indexOf('book-by-tap.css'), `${shell} must load book-by-tap.css after talk-bar.css`);
  }
});
