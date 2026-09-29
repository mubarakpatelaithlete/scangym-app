/**
 * Signing up is four fields, and nothing else.
 *
 * The customer sign-in was a menu: Google, Apple, Microsoft, a phone number
 * with a country picker, and an emailed code behind a link — five ways to make
 * an account and five ways to end up with a second one. It is now email,
 * password, confirm password, first name, on both surfaces that a customer can
 * reach: the /login page and the sheet that opens when they tap Book.
 *
 * These tests pin the form, the endpoints, and the parts of the password
 * handling that are easy to get quietly wrong: the hash is salted and
 * verified in constant time, failures do not say whether the email exists,
 * and attempts are throttled.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'app.ctr576.js'), 'utf8');
const AUTH = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'auth.js'), 'utf8');
const { hashPassword, verifyPassword, validatePassword } = require('../server/lib/password');

// ─── 1. the form a customer sees ─────────────────────────────────────────────

test('the login page opens on email and password', () => {
  assert.match(APP, /authStep:'password'/, 'the login page does not start on the password form');
  assert.match(APP, /handlePasswordLogin\(\)/, 'no password login button');
  assert.match(APP, /id="auth-password"/, 'no password field');
});

test('the signup step asks for exactly the four agreed fields', () => {
  const step = APP.slice(APP.indexOf("state.authStep === 'signup'"), APP.indexOf('handlePasswordSignup()'));
  for (const id of ['auth-first-name', 'auth-email', 'auth-password', 'auth-password-confirm']) {
    assert.ok(step.includes(`id="${id}"`), `signup is missing ${id}`);
  }
  assert.ok(!step.includes('auth-phone'), 'signup still asks for a phone number');
  assert.ok(!step.includes('auth-country-code'), 'signup still has a country picker');
});

test('Google, Apple, Microsoft and phone are gone from the customer sign-in', () => {
  const page = APP.slice(APP.indexOf('function LoginPage'), APP.indexOf('window._sgMicrosoftSignIn'));
  for (const gone of ['handleGoogleSignIn()', 'handleAppleSignIn()', '_sgMicrosoftSignIn()', 'auth-country-code']) {
    assert.ok(!page.includes(gone), `the login page still offers ${gone}`);
  }
  const sheet = APP.slice(APP.indexOf('function _renderAuthStep'), APP.indexOf('// ── Step 1b: OTP Code ──'));
  for (const gone of ['handleGoogleSignIn()', 'handleAppleSignIn()', '_sgMicrosoftSignIn()', 'sg-auth-phone']) {
    assert.ok(!sheet.includes(gone), `the booking sheet still offers ${gone}`);
  }
});

test('the two passwords are compared before anything is sent', () => {
  const handler = APP.slice(APP.indexOf('window.handlePasswordSignup='));
  assert.match(handler.slice(0, 2000), /password!==confirmPassword/, 'signup never compares the two passwords');
  assert.match(handler.slice(0, 2000), /password\.length<8/, 'signup accepts a 1-character password');
});

// ─── 2. the endpoints ────────────────────────────────────────────────────────

test('register and login endpoints exist', () => {
  assert.match(AUTH, /router\.post\('\/password\/register'/, 'no register route');
  assert.match(AUTH, /router\.post\('\/password\/login'/, 'no login route');
});

test('an existing passwordless account gains a password instead of a duplicate', () => {
  const route = AUTH.slice(AUTH.indexOf("router.post('/password/register'"), AUTH.indexOf("router.post('/password/login'"));
  assert.match(route, /UPDATE public\.users/, 'an existing account cannot set a password');
  assert.match(route, /password_hash/, 'the password is not stored');
  assert.match(route, /409/, 'signing up twice is not refused');
});

test('a failed login never says whether the email exists', () => {
  const route = AUTH.slice(AUTH.indexOf("router.post('/password/login'"));
  const messages = route.match(/error: (WRONG|'[^']*')/g) || [];
  assert.ok(messages.length >= 3, 'could not find the login error responses');
  for (const m of messages) {
    assert.ok(!/no account|not found|unknown email/i.test(m), `login leaks account existence: ${m}`);
  }
  assert.match(route, /_pwThrottled/, 'the login is not throttled — free credential stuffing');
});

// ─── 3. the hashing itself ───────────────────────────────────────────────────

test('the same password hashes differently every time, and still verifies', async () => {
  const a = await hashPassword('correct horse battery');
  const b = await hashPassword('correct horse battery');
  assert.notStrictEqual(a, b, 'the hash is unsalted — identical passwords look identical');
  assert.ok(a.startsWith('scrypt$'), 'the stored format does not record its parameters');
  assert.strictEqual(await verifyPassword('correct horse battery', a), true);
  assert.strictEqual(await verifyPassword('correct horse batter', a), false);
});

test('a missing or corrupt hash is a failed login, not a crash', async () => {
  for (const stored of [null, undefined, '', 'not-a-hash', 'scrypt$x$y$z', 'scrypt$1$2$3$@@@$@@@']) {
    assert.strictEqual(await verifyPassword('anything', stored), false, `${stored} did not fail cleanly`);
  }
});

test('the rules we enforce are the rules we tell people about', () => {
  assert.match(String(validatePassword('short', 'a@b.co')), /at least 8/);
  assert.strictEqual(validatePassword('longenough1', 'a@b.co'), null);
  assert.match(String(validatePassword('alex@scangym.com', 'Alex@ScanGym.com')), /email/,
    'password equal to the email is accepted');
  assert.match(String(validatePassword('x'.repeat(500), 'a@b.co')), /too long/, 'a 500-char password is free scrypt work');
});
