/**
 * Every route that mints, moves, or approves money must be gated.
 *
 * Found in a static review (2026-09-13):
 *   - POST /api/wallet/topup credited balance from a bare amount, no charge
 *   - POST /api/wallet/reward let any signed-in user mint up to £50
 *   - POST /api/referrals/withdraw + /admin/withdrawals/* had no auth at all
 *   - the Stripe Connect webhook skipped signature checks when the header
 *     was missing
 *   - POST /api/payment/confirm-intent accepted any succeeded intent for any
 *     booking id, and attributed commission to the globally newest click
 *   - GET /api/stats/ceo needed a session, not an admin
 *
 * These tests read the route sources and pin the fixed shape.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = path.join(__dirname, '..', 'server', 'routes');
const read = (f) => fs.readFileSync(path.join(ROUTES, f), 'utf8');

function handlerSource(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start > -1, `${marker} must exist`);
  const next = src.indexOf('\nrouter.', start + marker.length);
  return src.slice(start, next === -1 ? undefined : next);
}

test('wallet top-up charges Stripe before crediting balance', () => {
  const src = read('wallet.js');
  const topup = handlerSource(src, "router.post('/topup'");
  assert.match(topup, /stripe\.paymentIntents\.create/, 'top-up must create a PaymentIntent');
  const charge = topup.indexOf('stripe.paymentIntents.create');
  const credit = topup.indexOf('UPDATE wallets SET balance_pence');
  assert.ok(credit > charge, 'the wallet must only be credited after the charge');
  assert.match(topup, /intent\.status !== 'succeeded'/, 'a non-succeeded intent must not credit');
});

test('wallet reward is admin-only', () => {
  const src = read('wallet.js');
  assert.match(src, /router\.post\('\/reward',\s*requireAdmin/, '/reward must be behind requireAdmin');
});

test('referral withdraw, payout details and Stripe Connect require the caller to own the handle', () => {
  const src = read('referrals.js');
  for (const route of ['/withdraw', '/update-payout', '/stripe-connect']) {
    assert.match(
      src,
      new RegExp(`router\\.post\\('${route}',\\s*\\.\\.\\.requireOwnCreatorHandle`),
      `${route} must use requireOwnCreatorHandle`
    );
  }
  assert.match(src, /authenticateUser/, 'ownership check must authenticate first');
});

test('referral admin withdrawal routes require an admin', () => {
  const src = read('referrals.js');
  const admin = src.match(/router\.(get|post)\('\/admin\/withdrawals[^']*',\s*([^\n]*)/g) || [];
  assert.ok(admin.length >= 4, 'expected the four /admin/withdrawals routes');
  for (const line of admin) {
    assert.match(line, /requireAdminUser/, `${line.slice(0, 60)} must be admin-gated`);
  }
});

test('Stripe Connect webhook fails closed', () => {
  const src = read('gym-partner.js');
  const hook = handlerSource(src, "router.post('/stripe-connect/webhook'");
  assert.doesNotMatch(hook, /JSON\.parse\s*\(\s*req\.body/, 'no unsigned JSON.parse fallback');
  assert.match(hook, /if\s*\(\s*!endpointSecret\s*\)[\s\S]*?return res\.status\(503\)/, 'unset secret must 503');
  assert.match(hook, /if\s*\(\s*!sig\s*\)[\s\S]*?return res\.status\(400\)/, 'missing signature must 400');
});

test('confirm-intent binds the intent to the booking and never guesses a referrer', () => {
  const src = read('payment.js');
  const confirm = handlerSource(src, "router.post('/confirm-intent'");
  assert.match(confirm, /intent\.metadata\?\.bookingId[^\n]*!==\s*String\(bookingId\)/, 'metadata.bookingId must match');
  assert.match(confirm, /amount_received/, 'charged amount must be checked against the booking');
  assert.doesNotMatch(
    confirm,
    /WHERE status = 'clicked' AND created_at > NOW\(\)[\s\S]*ORDER BY created_at DESC LIMIT 1/,
    'the "newest click anywhere" commission fallback must be gone'
  );
});

test('the CEO stats JSON is admin-only', () => {
  const src = read('stats.js');
  assert.match(src, /router\.get\('\/ceo',\s*authenticateUser,\s*requireAdmin/, '/ceo must chain requireAdmin');
});
