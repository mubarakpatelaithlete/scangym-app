/**
 * The sender address, in the shape each API actually accepts.
 *
 * Found live, not in review: asking production to email a sign-in link returned "I
 * could not email you". SendGrid was configured, the key was present, the address was
 * real. `SMTP_FROM` is `ScanGym Bookings <bookings@scangym.com>` — perfect for
 * nodemailer, and a 400 from SendGrid's JSON API, which wants a bare address in
 * `from.email`. Both JSON senders passed the whole string through, so the email login
 * code had also been failing on the sender since the day it shipped.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { mailFrom, DEFAULT_ADDRESS } = require('../server/lib/mail-from');
const LIB = path.join(__dirname, '..', 'server', 'lib');

test('the display-name form is split, which is the bug that was live', () => {
  const from = mailFrom('ScanGym Bookings <bookings@scangym.com>');
  assert.equal(from.email, 'bookings@scangym.com', 'SendGrid must get the bare address');
  assert.equal(from.name, 'ScanGym Bookings');
});

test('a bare address is passed through', () => {
  assert.deepEqual(mailFrom('book@scangym.com'), { email: 'book@scangym.com', name: 'ScanGym' });
});

test('quotes and spacing do not leak into the name', () => {
  assert.deepEqual(mailFrom('"ScanGym Team" < help@scangym.com >'), {
    email: 'help@scangym.com',
    name: 'ScanGym Team',
  });
});

test('a missing or unusable value falls back to a bare address, never a 400', () => {
  for (const bad of [undefined, '', '   ', 'ScanGym', 'not an address']) {
    const from = mailFrom(bad);
    assert.match(from.email, /^[^<>\s]+@[^<>\s]+\.[^<>\s]+$/, `${JSON.stringify(bad)} must still yield a usable address`);
    assert.ok(!from.email.includes('<'), 'the fallback must never contain a display name');
  }
  assert.equal(mailFrom('').email, DEFAULT_ADDRESS);
});

test('both SendGrid JSON senders go through the helper', () => {
  for (const file of ['login-link.js', 'email-login-code.js']) {
    const src = fs.readFileSync(path.join(LIB, file), 'utf8');
    assert.match(src, /mail-from'\)\.mailFrom\(\)/, `${file} must resolve the sender through the helper`);
    assert.match(src, /from: \{ email: from\.email, name: from\.name \}/, `${file} must send the bare address`);
    assert.ok(!/from: \{ email: from,/.test(src), `${file} must not pass the raw variable as an address again`);
  }
});
