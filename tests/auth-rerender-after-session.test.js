// Regression: a signed-in member who deep-linked to /bookings or /more/profile saw the
// logged-out copy, because the page painted before /api/auth/user answered and nothing
// re-rendered afterwards. Also: the "Book this gym" bar must not sit under a booking
// that was just paid for.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const app = fs.readFileSync(path.join(PUBLIC, 'app.ctr576.js'), 'utf8');
const css = fs.readFileSync(path.join(PUBLIC, 'book-by-tap.css'), 'utf8');

test('once the session resolves with a user, the page is painted again', () => {
  const m = app.match(/window\.__sgAuthReady = checkAuth\(\)\.then\(function\(\)\{([\s\S]*?)\n\}\);/);
  assert.ok(m, 'checkAuth().then block not found');
  assert.ok(/state\.user[\s\S]*render\(\)/.test(m[1]), 'must call render() when state.user was found');
});

test('render() stamps the current route on <body>', () => {
  assert.ok(/document\.body\.setAttribute\('data-route',\s*state\.route/.test(app));
});

test('the continue bar is hidden on the booking-success page', () => {
  assert.ok(/body\[data-route="\/booking-success"\] #sg-continue-banner\s*\{[^}]*display:\s*none/.test(css));
});
