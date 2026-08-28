'use strict';

/**
 * The email half of voice sign-in, which was dead on arrival.
 *
 * voice-login.js has always offered two spoken ways in: a text, or an email. Asked
 * live to log someone in by email, production answered "that address did not work"
 * — not a typo, a shut door. Twilio replied `60223 Delivery channel disabled:
 * EMAIL`. The code could not see that, so nothing here could have caught it; these
 * tests pin the behaviour of the replacement path, which sends through SendGrid.
 */

const test = require('node:test');
const assert = require('node:assert');

const email = require('../server/lib/email-login-code');
const { sendCode, verifyCode } = require('../server/lib/voice-login');

const ADDR = 'someone@example.com';

function fakeFetch(result = { ok: true }) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: result.ok, status: result.status || 200, text: async () => result.text || '' };
  };
  fn.calls = calls;
  return fn;
}

test.beforeEach(() => {
  email._reset();
  process.env.SENDGRID_API_KEY = 'SG.test';
});

test('the code is emailed, and it is the code the customer must say back', async () => {
  const fetchImpl = fakeFetch();
  const sent = await email.issueCode({ email: ADDR, deps: { fetch: fetchImpl, code: '123456' } });

  assert.equal(sent.ok, true);
  assert.match(sent.message, /Read me the six digits/);

  const req = fetchImpl.calls[0];
  assert.match(req.url, /api\.sendgrid\.com/);
  assert.equal(req.body.personalizations[0].to[0].email, ADDR);
  assert.match(req.body.subject, /123456/);
  assert.match(req.body.content[0].value, /123456/);

  assert.equal(email.checkCode({ email: ADDR, code: '123456' }).ok, true);
});

test('a code is single use — a replayed code is refused', async () => {
  await email.issueCode({ email: ADDR, deps: { fetch: fakeFetch(), code: '111111' } });

  assert.equal(email.checkCode({ email: ADDR, code: '111111' }).ok, true);
  assert.equal(email.checkCode({ email: ADDR, code: '111111' }).ok, false);
});

test('spoken digits arrive messy, so punctuation and spaces are stripped', async () => {
  await email.issueCode({ email: ADDR, deps: { fetch: fakeFetch(), code: '420901' } });
  assert.equal(email.checkCode({ email: ADDR, code: 'four two 09-01' }).ok, false, 'letters are not digits');
  assert.equal(email.checkCode({ email: ADDR, code: '42 09 01' }).ok, true);
});

test('six digits cannot be brute-forced: five wrong guesses burn the code', async () => {
  await email.issueCode({ email: ADDR, deps: { fetch: fakeFetch(), code: '222222' } });

  for (let i = 0; i < 5; i++) assert.equal(email.checkCode({ email: ADDR, code: '000000' }).ok, false);

  const after = email.checkCode({ email: ADDR, code: '222222' });
  assert.equal(after.ok, false, 'the right code must not work after the attempt budget is spent');
});

test('a code expires, and an expired code is not "wrong password" — it offers a new one', async () => {
  const t0 = 1000;
  await email.issueCode({ email: ADDR, deps: { fetch: fakeFetch(), code: '333333', now: t0 } });

  const late = email.checkCode({ email: ADDR, code: '333333', deps: { now: t0 + email.TTL_MS + 1 } });
  assert.equal(late.ok, false);
  assert.match(late.message, /expired/i);
});

test('an address that was never sent a code cannot be verified into an account', () => {
  const out = email.checkCode({ email: 'stranger@example.com', code: '123456' });
  assert.equal(out.ok, false);
  assert.match(out.message, /have not sent a code/i);
});

test('if the email does not send, nobody is logged in and nothing is stored', async () => {
  const sent = await email.issueCode({
    email: ADDR,
    deps: { fetch: fakeFetch({ ok: false, status: 403, text: 'forbidden' }), code: '444444' },
  });

  assert.equal(sent.ok, false);
  assert.match(sent.message, /not logged you in/);
  assert.equal(email.checkCode({ email: ADDR, code: '444444' }).ok, false, 'a failed send must not leave a live code');
});

test('voice login sends email codes through SendGrid, never through the disabled Twilio channel', async () => {
  let twilioCalled = false;
  const out = await sendCode({
    contact: 'Someone@Example.com',
    deps: {
      twilio: async () => { twilioCalled = true; return { ok: true, data: {} }; },
      fetch: fakeFetch(),
      code: '555555',
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.channel, 'email');
  assert.equal(out.to, ADDR, 'the address is lower-cased before anything is stored against it');
  assert.equal(twilioCalled, false, 'Twilio Verify has EMAIL disabled — sending there is what broke this');
});

test('a phone number still goes to Twilio: only the email path moved', async () => {
  const calls = [];
  const out = await sendCode({
    contact: '07700900123',
    deps: {
      twilio: async (path, params) => { calls.push({ path, params }); return { ok: true, data: {} }; },
    },
  });

  assert.equal(out.ok, true);
  assert.equal(out.channel, 'sms');
  assert.equal(calls[0].params.To, '+447700900123');
  assert.equal(calls[0].params.Channel, 'sms');
});

test('verifying an emailed code logs that session in, and a wrong one does not', async () => {
  await email.issueCode({ email: ADDR, deps: { fetch: fakeFetch(), code: '666666' } });

  const user = { id: 'user-1', email: ADDR };
  const pool = { query: async () => ({ rows: [user], command: 'SELECT' }) };

  const bad = await verifyCode({ contact: ADDR, code: '999999', session: {}, deps: { pool } });
  assert.equal(bad.ok, false);

  const session = {};
  const good = await verifyCode({ contact: ADDR, code: '666666', session, deps: { pool } });
  assert.equal(good.ok, true);
  assert.equal(session.userId, 'user-1');
});
