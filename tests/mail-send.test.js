/**
 * The email supplier is a variable, not a dependency of the product.
 *
 * Twilio SendGrid refused to activate this account (ticket #29229316), so every send
 * answered 401 and the customer was told "I could not email you" — while the code
 * looked perfectly correct. Editing the product to change supplier is the actual bug.
 *
 * These tests pin the behaviour that makes the next change a variable change:
 * providers are used in order of what is configured, a rejection moves on to the
 * next one, and when nothing works the caller is told so — never "sent".
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { sendMail, providersConfigured } = require('../server/lib/mail-send');

const FROM = 'ScanGym Bookings <bookings@scangym.com>';
const MAIL = { to: 'owner@example.com', subject: 'Tap to sign in', text: 'link', html: '<a>link</a>' };

const okResponse = { ok: true, status: 202, json: async () => ({}), text: async () => '' };
const failResponse = (status) => ({ ok: false, status, json: async () => ({}), text: async () => '' });

test('only configured providers are considered, in order', () => {
  assert.deepEqual(providersConfigured({}), []);
  assert.deepEqual(providersConfigured({ SENDGRID_API_KEY: 'k' }), ['sendgrid']);
  assert.deepEqual(
    providersConfigured({ RESEND_API_KEY: 'r', SENDGRID_API_KEY: 'k', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }),
    ['resend', 'sendgrid', 'smtp']
  );
  assert.deepEqual(providersConfigured({ SMTP_HOST: 'h' }), [], 'half-configured SMTP is not a provider');
});

test('with nothing configured, nothing is sent and nothing is claimed', async () => {
  const res = await sendMail({ ...MAIL, deps: { env: { SMTP_FROM: FROM }, fetch: async () => okResponse } });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-email-provider');
});

test('Resend is used first, with the address in the header form it wants', async () => {
  let seen = null;
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, RESEND_API_KEY: 're_123', SENDGRID_API_KEY: 'sg_123' },
      fetch: async (url, opts) => { seen = { url, body: JSON.parse(opts.body), headers: opts.headers }; return okResponse; },
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'resend');
  assert.match(seen.url, /api\.resend\.com/);
  assert.equal(seen.body.from, 'ScanGym Bookings <bookings@scangym.com>');
  assert.deepEqual(seen.body.to, ['owner@example.com']);
  assert.equal(seen.headers.Authorization, 'Bearer re_123');
});

test('SendGrid still gets the bare address, which is what it rejected before', async () => {
  let seen = null;
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, SENDGRID_API_KEY: 'sg_123' },
      fetch: async (url, opts) => { seen = JSON.parse(opts.body); return okResponse; },
    },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(seen.from, { email: 'bookings@scangym.com', name: 'ScanGym Bookings' });
});

test('a refused provider falls through to the next one', async () => {
  const calls = [];
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, RESEND_API_KEY: 'r', SENDGRID_API_KEY: 'k' },
      fetch: async (url) => {
        calls.push(String(url));
        return /resend/.test(String(url)) ? failResponse(401) : okResponse;
      },
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'sendgrid');
  assert.deepEqual(res.tried, ['resend', 'sendgrid']);
  assert.equal(calls.length, 2);
});

test('SMTP is a real fallback, so Postmark, SES or Mailgun need no code change', async () => {
  let sent = null;
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, SMTP_HOST: 'smtp.postmarkapp.com', SMTP_USER: 'u', SMTP_PASS: 'p' },
      transportFactory: () => ({ async sendMail(opts) { sent = opts; return { messageId: '1' }; } }),
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'smtp');
  assert.equal(sent.from, 'ScanGym Bookings <bookings@scangym.com>');
  assert.equal(sent.to, 'owner@example.com');
  assert.equal(sent.subject, 'Tap to sign in');
});

test('a provider that throws does not take the send down with it', async () => {
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, RESEND_API_KEY: 'r', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' },
      fetch: async () => { throw new Error('DNS exploded'); },
      transportFactory: () => ({ async sendMail() { return { messageId: '1' }; } }),
    },
  });
  assert.equal(res.ok, true);
  assert.equal(res.provider, 'smtp');
});

test('when every provider fails, the answer is a failure naming what was tried', async () => {
  const res = await sendMail({
    ...MAIL,
    deps: {
      env: { SMTP_FROM: FROM, RESEND_API_KEY: 'r', SENDGRID_API_KEY: 'k', SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' },
      fetch: async () => failResponse(401),
      transportFactory: () => ({ async sendMail() { throw new Error('auth failed'); } }),
    },
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /^all-providers-failed:resend,sendgrid,smtp$/);
});

test('no recipient is refused before any provider is called', async () => {
  let called = false;
  const res = await sendMail({
    ...MAIL,
    to: '  ',
    deps: { env: { RESEND_API_KEY: 'r' }, fetch: async () => { called = true; return okResponse; } },
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-recipient');
  assert.equal(called, false);
});

test('the sign-in link email is the one the customer taps', async () => {
  // End to end through login-link.js: what lands in the inbox must contain the link.
  const link = require('../server/lib/login-link');
  process.env.RESEND_API_KEY = 're_test';
  process.env.SMTP_FROM = FROM;
  let body = null;
  const pool = { async query() { return { rows: [] }; } };
  const res = await link.issueLink({
    contact: 'owner@example.com',
    origin: 'https://scangym.com',
    deps: {
      pool,
      token: 'Z'.repeat(43),
      fetch: async (url, opts) => { body = JSON.parse(opts.body); return okResponse; },
    },
  });
  delete process.env.RESEND_API_KEY;
  assert.equal(res.ok, true);
  assert.match(body.text, /https:\/\/scangym\.com\/login\/link\?t=Z+/);
  assert.match(body.html, /Sign me in/);
  assert.equal(body.subject, 'Tap to sign in to ScanGym');
});
