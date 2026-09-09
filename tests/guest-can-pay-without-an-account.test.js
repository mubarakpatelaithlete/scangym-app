'use strict';

/**
 * A visitor with a card can buy a pass.
 *
 * Every piece of this existed on the server for months and nothing could reach
 * it: /api/bookings/guest-create takes an email, /api/payment/create-intent
 * runs with no session, /api/payment/confirm-intent issues the QR and emails
 * the pass. The web app never called the first one, and the /checkout page's
 * Pay button — the one place that was one line from the finish line — opened
 * the sign-in sheet instead of taking the money. Two customer tests in a row
 * ended the same way: card in hand, nothing to tap.
 *
 * These tests pin the path, not the pixels: the three calls in order, the email
 * carried through all of them, the charged amount coming from the server rather
 * than from any arithmetic in the browser, and no sign-in sheet anywhere in it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { makeSandbox, tick } = require('./helpers/mini-dom');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const SRC = fs.readFileSync(path.join(PUB, 'guest-checkout.js'), 'utf8');
const APP = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');

const EMAIL = 'runner@example.com';

/** A fetch that answers the three guest endpoints and records every call. */
function fakeFetch(overrides = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', body });
    const reply = (data, ok = true, status = 200) => ({ ok, status, json: async () => data });
    if (url.startsWith('/api/bookings/guest-create')) {
      if (overrides.bookingFails) return reply({ error: 'Gym not found' }, false, 404);
      return reply({ success: true, booking: {
        id: 4242, gymName: 'Third Space Canary Wharf', bookingCode: 'SG-TEST-1',
        price: 4.49, currency: 'GBP', status: 'pending',
      } });
    }
    if (url.startsWith('/api/payment/create-intent')) {
      if (overrides.intentFails) return reply({ error: 'Payment not configured' }, false, 500);
      return reply({ success: true, clientSecret: 'pi_test_secret', amount: 4.49, gymName: 'Third Space Canary Wharf' });
    }
    if (url.startsWith('/api/payment/confirm-intent')) {
      return reply({ success: true,
        booking: { id: 4242, bookingCode: 'SG-TEST-1', price: 4.49, status: 'confirmed' },
        qr: { token: 'qr_tok', dataUrl: 'data:image/png;base64,AAA' } });
    }
    if (url.startsWith('/api/bookings/guest-lookup')) {
      return reply({ booking: { id: 99, gymId: 1, gymName: 'TGG Stockwell', price: 4.49,
        currency: 'GBP', currencySymbol: '\u00a3', email: EMAIL, status: 'pending' } });
    }
    if (url.startsWith('/api/auth/send-link')) return reply({ ok: true, channel: 'email' });
    return reply({}, false, 404);
  };
  fn.calls = calls;
  return fn;
}

/** A Stripe stand-in. No network, no keys, no charge. */
function fakeStripe({ declined = false } = {}) {
  const mounted = [];
  return () => ({
    elements: () => ({ create: () => ({ mount: (sel) => mounted.push(sel), on: () => {} }) }),
    confirmCardPayment: async (secret, opts) => {
      mounted.push('confirm:' + secret);
      if (declined) return { error: { message: 'Your card was declined.' } };
      return { paymentIntent: { id: 'pi_test_123', status: 'succeeded' }, _billing: opts };
    },
    _mounted: mounted,
  });
}

function boot(opts = {}) {
  const fetchImpl = fakeFetch(opts);
  const sheetOpens = [];
  const { sandbox, doc } = makeSandbox({
    extras: {
      fetch: fetchImpl,
      Stripe: fakeStripe(opts),
      _sgStripePublishableKey: 'pk_test_x',
      _sgShowAuthSheet: (m) => sheetOpens.push(m),
      sgToast: () => {},
    },
  });
  vm.runInNewContext(SRC, sandbox);
  return { sandbox, doc, fetchImpl, sheetOpens };
}

async function payThrough(container, sandbox, { email = EMAIL } = {}) {
  await sandbox.sgGuestCheckout.render(container, { gymId: 1, gymName: 'Third Space Canary Wharf', date: '2026-09-09' });
  await tick();
  container.querySelector('#sg-guest-email').value = email;
  await sandbox.document.getElementById('sg-guest-next').onclick();
  await tick();
  const pay = sandbox.document.getElementById('sg-guest-pay');
  if (pay && pay.onclick) { await pay.onclick(); await tick(); }
  return container;
}

test('email, card, pass — three calls, in order, no account', async () => {
  const { sandbox, doc, fetchImpl, sheetOpens } = boot();
  const container = doc.createElement('div');
  container.id = 'host';
  doc.body.appendChild(container);

  await payThrough(container, sandbox);

  const posts = fetchImpl.calls.filter((c) => c.method === 'POST').map((c) => c.url);
  assert.deepEqual(posts, [
    '/api/bookings/guest-create',
    '/api/payment/create-intent',
    '/api/payment/confirm-intent',
  ], 'the guest purchase did not follow the three-call path');

  assert.deepEqual(sheetOpens, [], 'guest checkout opened the sign-in sheet');
  assert.match(container.innerHTML, /You/, 'no confirmation was shown');
  assert.match(container.innerHTML, /data:image\/png/, 'the QR pass was not shown on screen');
  assert.match(container.innerHTML, new RegExp(EMAIL), 'the confirmation does not say where the pass went');
});

test('the email reaches the booking, the intent and the receipt', async () => {
  const { sandbox, doc, fetchImpl } = boot();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  await payThrough(container, sandbox);

  const byUrl = (u) => fetchImpl.calls.find((c) => c.url === u).body;
  assert.equal(byUrl('/api/bookings/guest-create').email, EMAIL);
  assert.equal(byUrl('/api/payment/create-intent').email, EMAIL, 'Stripe would send the receipt nowhere');
  assert.equal(byUrl('/api/payment/confirm-intent').email, EMAIL, 'the pass email would have no recipient');
});

test('the amount charged is the amount the server named', async () => {
  /* The browser must never do pass arithmetic: that is how a 3-day pass got
     sold at the day price. The button text comes from guest-create's reply. */
  const { sandbox, doc } = boot();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  await sandbox.sgGuestCheckout.render(container, { gymId: 1, date: '2026-09-09' });
  container.querySelector('#sg-guest-email').value = EMAIL;
  await sandbox.document.getElementById('sg-guest-next').onclick();
  await tick();
  assert.match(container.innerHTML, /\u00a34\.49/, 'the pay step does not show the server price');
  assert.doesNotMatch(container.innerHTML, /NaN|undefined/, 'the price rendered as junk');
});

test('a bad email never reaches the server', async () => {
  const { sandbox, doc, fetchImpl } = boot();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  await sandbox.sgGuestCheckout.render(container, { gymId: 1 });
  container.querySelector('#sg-guest-email').value = 'not-an-email';
  await sandbox.document.getElementById('sg-guest-next').onclick();
  await tick();
  assert.equal(fetchImpl.calls.filter((c) => c.method === 'POST').length, 0, 'we tried to book with a broken email');
  const err = sandbox.document.getElementById('sg-guest-err');
  assert.match(err.textContent, /email/i, 'the visitor was not told why nothing happened');
  assert.equal(err.style.display, 'block', 'the message was written but kept hidden');
});

test('a declined card says so and does not claim a pass', async () => {
  const { sandbox, doc } = boot({ declined: true });
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  await payThrough(container, sandbox);
  assert.match(sandbox.document.getElementById('sg-guest-err').textContent, /declined/i, 'a declined card was silent');
  assert.doesNotMatch(container.innerHTML, /data:image\/png/, 'a QR pass was shown for a payment that failed');
  assert.equal(sandbox.document.getElementById('sg-guest-pay').disabled, false, 'the Pay button stayed dead after a decline');
});

test('if the booking cannot be held, we say so before asking for a card', async () => {
  const { sandbox, doc, fetchImpl } = boot({ bookingFails: true });
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  await payThrough(container, sandbox);
  assert.equal(fetchImpl.calls.some((c) => c.url === '/api/payment/create-intent'), false,
    'we asked Stripe for money for a booking that does not exist');
  assert.match(sandbox.document.getElementById('sg-guest-err').textContent, /could not|not found/i, 'the failure was silent');
});

test('the /checkout page pays the booking it was given', async () => {
  const { sandbox, doc, fetchImpl } = boot();
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const ok = await sandbox.sgGuestCheckout.payForExistingBooking(99, 'SG-CODE-9', container);
  assert.equal(ok, true, 'the checkout page could not render a pay step');
  await sandbox.document.getElementById('sg-guest-pay').onclick();
  await tick();
  const posts = fetchImpl.calls.filter((c) => c.method === 'POST').map((c) => c.url);
  assert.deepEqual(posts, ['/api/payment/create-intent', '/api/payment/confirm-intent'],
    'the existing booking was re-created instead of paid');
  assert.equal(fetchImpl.calls.find((c) => c.url === '/api/payment/create-intent').body.bookingId, 99);
});

test('the /checkout Pay button no longer ends at the sign-in sheet', () => {
  const fn = APP.slice(APP.indexOf('window._checkoutPayBooking='), APP.indexOf('function InfoPage'));
  assert.ok(fn.length > 100, 'could not find _checkoutPayBooking');
  assert.match(fn, /sgGuestCheckout\.payForExistingBooking/, 'the guest branch does not take payment');
  const guestBranch = fn.slice(fn.indexOf('sgGuestCheckout'));
  assert.ok(guestBranch.indexOf('payForExistingBooking') < guestBranch.indexOf('_sgShowAuthSheet'),
    'sign-in is still tried before payment');
});

test('the sign-in sheet offers the guest path and an email fallback', () => {
  const step = APP.slice(APP.indexOf('function _renderAuthStep'), APP.indexOf('// ── Step 1b: OTP Code ──'));
  assert.ok(step.length > 100, 'could not find _renderAuthStep');
  assert.match(step, /_sgAuthGuestCheckout/, 'the sheet does not offer guest checkout');
  assert.match(step, /_sgAuthEmailLink/, 'the sheet does not offer an email sign-in link');
  assert.match(APP, /window\._sgAuthSendLink\s*=/, 'nothing calls /api/auth/send-link');
  assert.match(APP, /'\/api\/auth\/send-link'/, 'the email link endpoint is not wired up');
});

test('the shell loads guest-checkout.js', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.match(html, /src="\/guest-checkout\.js"/, 'index.html does not load guest-checkout.js');
});
