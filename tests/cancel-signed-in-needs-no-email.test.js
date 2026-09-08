// Regression: the cancel modal demanded "the email you used to book" from a signed-in
// phone-only member (no email on file) and refused to proceed — while the server
// ignores the email entirely for a logged-in session. A real customer could not
// cancel a real booking from the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'booking.js'), 'utf8');

test('the server cancels by session when logged in, without an email', () => {
  assert.ok(/if \(req\.session\?\.userId\) \{[\s\S]*?cancelBooking\(\{ userId: req\.session\.userId, bookingId \}\)/.test(route));
});

test('the cancel modal does not ask a signed-in member for an email', () => {
  assert.ok(/const needEmail = !knownEmail && !state\.user;/.test(app));
  assert.ok(/if\(!email&&!state\.user\)\{sgToast\('Please enter your email'\)/.test(app));
});
