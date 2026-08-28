/**
 * A spoken booking that pays for itself, and a voice login that never asks for a password.
 *
 * These are the properties that make both safe. They are pinned here because every one
 * of them is the kind of thing a later refactor removes by accident:
 *
 *   1. Charging is a write, so the customer hears the price and says yes first.
 *   2. Saying yes twice must not charge twice (idempotency key on the PaymentIntent).
 *   3. A declined card leaves nothing confirmed.
 *   4. A first-timer with no saved card is told, not charged and not half-booked.
 *   5. Login by voice is a one-time code — never a spoken password.
 *   6. Google / Apple / SSO are handed over as one tap, not attempted by voice.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const bookTools = require(path.join(ROOT, 'server/lib/book-tools.js'));
const { bookAndPay } = require(path.join(ROOT, 'server/lib/checkout-actions.js'));
const voiceLogin = require(path.join(ROOT, 'server/lib/voice-login.js'));

/* ── test doubles ─────────────────────────────────────────────────────────── */

function fakePool({ user = { id: 'u1', stripe_customer_id: 'cus_1', email: 'a@b.co' } } = {}) {
  const updates = [];
  return {
    updates,
    async query(sql, params) {
      if (/FROM public\.users/.test(sql)) return { rows: user ? [user] : [] };
      if (/FROM gyms/.test(sql)) return { rows: [{ country: 'GB' }] };
      if (/UPDATE public\.bookings/.test(sql)) {
        updates.push({ sql, params });
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function fakeStripe({ intent, error } = {}) {
  const created = [];
  return {
    created,
    customers: { retrieve: async () => ({ invoice_settings: { default_payment_method: 'pm_1' } }) },
    paymentMethods: { list: async () => ({ data: [{ id: 'pm_1' }] }) },
    paymentIntents: {
      async create(args, opts) {
        created.push({ args, opts });
        if (error) throw error;
        return intent || { id: 'pi_1', status: 'succeeded' };
      },
    },
  };
}

const booking = {
  id: 77,
  gymName: 'PureGym Shoreditch',
  date: '2026-08-25',
  time: '18:00',
  price: 4.49,
  bookingCode: '5WCB-8VDY',
};

const deps = (over = {}) => ({
  pool: fakePool(),
  stripe: fakeStripe(),
  createBooking: async () => ({ ok: true, booking }),
  generate2ScanQR: async () => ({ token: 'SG-aaa', dataUrl: 'data:image/png;base64,x' }),
  ...over,
});

/* ── the money ────────────────────────────────────────────────────────────── */

test('paying is a write tool, so the price is confirmed before anything is charged', () => {
  assert.equal(bookTools.isWrite('book_and_pay'), true);
  assert.equal(bookTools.isWrite('find_gyms'), false);
  assert.equal(bookTools.isWrite('send_login_code'), false, 'logging in must not need a confirmation tap');
});

test('a confirmed booking is charged once and comes back with its code', async () => {
  const d = deps();
  const result = await bookAndPay({ userId: 'u1', gymId: 5, date: booking.date, deps: d });

  assert.equal(result.ok, true);
  assert.equal(d.stripe.created.length, 1, 'exactly one charge');
  assert.equal(d.stripe.created[0].args.off_session, true);
  assert.equal(d.stripe.created[0].args.confirm, true);
  assert.match(result.message, /5WCB-8VDY/);
  assert.match(result.message, /£4\.49/);
  assert.ok(d.pool.updates.some((u) => /confirmed/.test(u.sql)), 'booking must end up confirmed');
});

test('saying yes twice cannot charge twice', async () => {
  const d = deps();
  await bookAndPay({ userId: 'u1', gymId: 5, date: booking.date, deps: d });

  const key = d.stripe.created[0].opts?.idempotencyKey;
  assert.ok(key, 'every charge must carry an idempotency key');
  assert.match(key, /77/, 'the key must be derived from the booking, not the moment');
});

test('a declined card confirms nothing and says so plainly', async () => {
  const err = Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError' });
  const d = deps({ stripe: fakeStripe({ error: err }) });

  const result = await bookAndPay({ userId: 'u1', gymId: 5, date: booking.date, deps: d });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'declined');
  assert.match(result.message, /declined/i);
  assert.ok(d.pool.updates.every((u) => !/confirmed/.test(u.sql)), 'nothing may be confirmed');
  assert.ok(d.pool.updates.some((u) => u.params.includes('failed')), 'the booking must be marked failed');
});

test('3-D Secure holds the slot instead of failing the booking', async () => {
  const err = Object.assign(new Error('auth required'), {
    code: 'authentication_required',
    raw: { payment_intent: { id: 'pi_2', client_secret: 'cs_2' } },
  });
  const result = await bookAndPay({ userId: 'u1', gymId: 5, date: booking.date, deps: deps({ stripe: fakeStripe({ error: err }) }) });

  assert.equal(result.code, 'requires_action');
  assert.equal(result.clientSecret, 'cs_2');
  assert.equal(result.bookingId, 77);
});

test('a first-timer with no saved card is told, not charged', async () => {
  const d = deps({ pool: fakePool({ user: { id: 'u1', stripe_customer_id: null } }) });
  const result = await bookAndPay({ userId: 'u1', gymId: 5, date: booking.date, deps: d });

  assert.equal(result.code, 'no_saved_card');
  assert.equal(d.stripe.created.length, 0, 'no charge may be attempted');
});

test('the paid path reuses booking-actions and the Book button QR, not its own SQL', () => {
  const src = read('server/lib/checkout-actions.js');

  assert.ok(/require\(['"]\.\/booking-actions['"]\)/.test(src), 'must create the booking through booking-actions');
  assert.equal(/INSERT INTO[\s\S]{0,40}bookings/i.test(src), false, 'must not insert bookings itself');
  assert.ok(/generate2ScanQR/.test(src), 'must issue the same 2-scan QR as the Book button');
});

/* ── the login ────────────────────────────────────────────────────────────── */

test('a spoken password is refused and a code is offered instead', async () => {
  const result = await voiceLogin.sendCode({ contact: 'my password is hunter2' });

  assert.equal(result.ok, false);
  assert.match(result.message, /never take passwords/i);
});

test('a mobile number gets an SMS code and an email gets an emailed one', async () => {
  const sent = [];
  const twilio = async (pathPart, params) => {
    sent.push({ pathPart, params });
    return { ok: true, data: { status: 'pending' } };
  };

  const sms = await voiceLogin.sendCode({ contact: '07700 900123', deps: { twilio } });
  assert.equal(sms.channel, 'sms');
  assert.equal(sms.to, '+447700900123', 'a UK number must be normalised for Twilio');

  // Email no longer goes through Twilio: Verify answers it with
  // `60223 Delivery channel disabled: EMAIL`, so it sends via SendGrid instead.
  // See tests/email-login-code.test.js.
  process.env.SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || 'SG.test';
  const emailed = await voiceLogin.sendCode({
    contact: 'Sam@Example.COM',
    deps: { twilio, fetch: async () => ({ ok: true, status: 202, text: async () => '' }) },
  });
  assert.equal(emailed.channel, 'email');
  assert.equal(emailed.to, 'sam@example.com');
  assert.equal(sent.length, 1, 'only the SMS went to Twilio');
});

test('digits said out loud log the customer in on this session', async () => {
  const twilio = async () => ({ ok: true, data: { status: 'approved' } });
  const pool = {
    async query(sql) {
      if (/SELECT \* FROM public\.users/.test(sql)) return { rows: [{ id: 'u9', phone_number: '+447700900123' }] };
      return { rows: [] };
    },
  };
  const session = {};

  const result = await voiceLogin.verifyCode({
    contact: '07700900123',
    code: '4 2 1 1 0 9', // as a speech-to-text transcript actually arrives
    session,
    deps: { twilio, pool },
  });

  assert.equal(result.ok, true);
  assert.equal(session.userId, 'u9', 'the session must be created, same as a typed login');
});

test('a wrong code logs nobody in', async () => {
  const twilio = async () => ({ ok: false, data: { status: 'pending' } });
  const session = {};
  const result = await voiceLogin.verifyCode({ contact: '07700900123', code: '000000', session, deps: { twilio } });

  assert.equal(result.ok, false);
  assert.equal(session.userId, undefined);
});

test('Google, Apple and SSO are handed over as one tap, never attempted by voice', () => {
  for (const provider of ['google', 'apple', 'sso']) {
    const handoff = voiceLogin.handoffFor(provider);
    assert.equal(handoff.handoff, true);
    assert.match(handoff.message, /tap/i);
  }
  assert.equal(voiceLogin.handoffFor('facebook'), null);
});

/* ── the wiring ───────────────────────────────────────────────────────────── */

test('the Book agent lets a logged-out customer in far enough to log in', () => {
  const src = read('server/routes/book-agent.js');

  assert.ok(/optionalAuth/.test(src), 'a logged-out customer must reach the agent at all');
  assert.ok(/needsLogin\(call\.name\)/.test(src), 'anything that needs an account must still be gated');
  assert.ok(/req\.session\?\.userId/.test(src), 'a mid-conversation login must be picked up');
});

test('money tools need a login and login tools do not', () => {
  assert.equal(bookTools.needsLogin('book_and_pay'), true);
  assert.equal(bookTools.needsLogin('get_my_bookings'), true);
  assert.equal(bookTools.needsLogin('send_login_code'), false);
  assert.equal(bookTools.needsLogin('find_gyms'), false);
});
