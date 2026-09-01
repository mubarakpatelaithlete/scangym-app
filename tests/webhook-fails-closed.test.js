/**
 * A payment webhook that trusts an unsigned body is a free-gym-pass endpoint.
 *
 * `_stripeWebhookHandler` in server.js confirms a booking and mints its QR code
 * from the request body alone. It used to verify the Stripe signature only when
 * STRIPE_WEBHOOK_SECRET happened to be set, and fall back to
 * `JSON.parse(req.body)` when it was not. So one missing environment variable
 * silently turned an authenticated payment callback into an open write:
 *
 *   POST /api/payment/webhook
 *   {"type":"payment_intent.succeeded",
 *    "data":{"object":{"id":"pi_x","metadata":{"bookingId":123}}}}
 *
 * ...and booking 123 comes back confirmed, with a QR code, unpaid.
 *
 * These tests pin the fixed behaviour: no signing secret means no processing,
 * and the JSON.parse fallback never comes back.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'server.js'),
  'utf8'
);

// The handler body: from its declaration to the line that registers the routes.
function handlerSource() {
  const start = SERVER.indexOf('const _stripeWebhookHandler');
  assert.ok(start > -1, '_stripeWebhookHandler must exist in server.js');
  const end = SERVER.indexOf("app.post('/api/payment/webhook'", start);
  assert.ok(end > start, 'the webhook routes must be registered after the handler');
  return SERVER.slice(start, end);
}

test('a missing signing secret stops the handler before any event is read', () => {
  const src = handlerSource();

  const guard = /if\s*\(\s*!\s*STRIPE_WEBHOOK_SECRET\s*\)/.exec(src);
  assert.ok(guard, 'the handler must bail out when STRIPE_WEBHOOK_SECRET is unset');

  // The guard has to return, and it has to do so before the event is parsed —
  // a warning that falls through is not a guard.
  const after = src.slice(guard.index, src.indexOf('let event'));
  assert.match(
    after,
    /return\s+res\.status\(\s*5\d\d\s*\)/,
    'the unset-secret branch must return a 5xx, not carry on'
  );
});

test('the unsigned JSON.parse fallback is gone for good', () => {
  const src = handlerSource();
  assert.doesNotMatch(
    src,
    /JSON\.parse\s*\(\s*req\.body/,
    'webhook events must come from stripe.webhooks.constructEvent, never from JSON.parse(req.body)'
  );
});

test('every webhook event is signature-verified', () => {
  const src = handlerSource();
  assert.match(
    src,
    /stripe\.webhooks\.constructEvent\(\s*req\.body\s*,\s*sig\s*,\s*STRIPE_WEBHOOK_SECRET\s*\)/,
    'constructEvent must verify the raw body against the signing secret'
  );
  // Exactly one place builds an event: no second, softer path.
  const assignments = src.match(/event\s*=\s*/g) || [];
  assert.strictEqual(
    assignments.length,
    1,
    'there must be exactly one way an event object comes into existence'
  );
});

test('booking confirmation still only happens for payment_intent.succeeded', () => {
  const src = handlerSource();
  assert.match(src, /event\.type\s*===\s*'payment_intent\.succeeded'/);
  assert.match(src, /status\s*=\s*'confirmed'/);
});

test('a missing signing secret is reported by the self-check, not just refused', () => {
  const selfCheck = fs.readFileSync(
    path.join(__dirname, '..', 'server', 'lib', 'self-check.js'),
    'utf8'
  );
  assert.match(
    selfCheck,
    /stripe_webhook\s*:/,
    'self-check must run a stripe_webhook probe so /api/v2/health shows the gap'
  );
  assert.match(
    selfCheck,
    /STRIPE_WEBHOOK_SECRET/,
    'the probe must look at STRIPE_WEBHOOK_SECRET'
  );
});
