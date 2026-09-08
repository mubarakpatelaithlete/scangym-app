// Regression: /api/auth/profile returns stats as { total_bookings, gyms_visited } and
// window.sgCards returns cards as { expMonth, expYear }; the profile page and the
// sign-in "Pay with" sheet read different names, so a member with ten bookings saw
// "0 sessions · 0 gyms" and their saved Visa read "Expires /".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'auth.js'), 'utf8');

test('the server still names the stats total_bookings / gyms_visited', () => {
  assert.ok(/total_bookings:\s*totalBookings/.test(auth));
  assert.ok(/gyms_visited:\s*gymsVisited/.test(auth));
});

test('the profile page reads the names the server sends', () => {
  assert.ok(/_ps\.total_bookings/.test(app), 'profile must fall back to stats.total_bookings');
  assert.ok(/_ps\.gyms_visited/.test(app), 'profile must fall back to stats.gyms_visited');
});

test('the sign-in card list accepts camelCase expiry', () => {
  assert.ok(/card\.exp_month\|\|card\.expMonth/.test(app));
  assert.ok(/card\.exp_year\|\|card\.expYear/.test(app));
});
