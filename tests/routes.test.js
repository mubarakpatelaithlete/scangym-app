/**
 * The route map must stay unambiguous: one prefix per concern, no two routers
 * claiming the same path, and no deleted route quietly coming back.
 */
const { test } = require('node:test');
const assert = require('node:assert');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const load = (p) => require('../server/' + p);
const routesOf = (router) =>
  router.stack.filter((l) => l.route).map((l) => Object.keys(l.route.methods)[0].toUpperCase() + ' ' + l.route.path);

function assertNoCollision(prefix, aName, bName) {
  const a = routesOf(load('routes/' + aName));
  const b = routesOf(load('routes/' + bName));
  const bPaths = b.map((x) => x.split(' ')[1]);
  const clash = a.map((x) => x.split(' ')[1]).filter((p) => bPaths.includes(p));
  assert.deepEqual(clash, [], `${aName} and ${bName} both answer ${clash.join(', ')} on ${prefix}`);
  return { a, b };
}

test('/api/payment: payment.js and payments-extended.js cannot collide', () => {
  const { a, b } = assertNoCollision('/api/payment', 'payment', 'payments-extended');
  assert.ok(a.length > 10, 'payment.js lost its routes');
  assert.ok(b.length > 5, 'payments-extended.js lost its routes');
});

test('/api/payment: the deleted routes are gone', () => {
  const paths = routesOf(load('routes/payment')).map((x) => x.split(' ')[1]);
  for (const gone of ['/setup-intent', '/confirm-card', '/admin-add-card']) {
    assert.ok(!paths.includes(gone), `${gone} is back in payment.js`);
  }
  for (const kept of ['/setup-card', '/confirm-setup', '/saved-cards', '/set-default-card']) {
    assert.ok(paths.includes(kept), `${kept} is missing — the one card path is broken`);
  }
});

test('/api/pricing and /api/stats double mounts stay collision-free', () => {
  assertNoCollision('/api/pricing', 'pricing', 'pricing-extended');
  assertNoCollision('/api/stats', 'stats', 'admin-dashboard');
});

test('the extended payment methods are reachable on the one prefix', () => {
  const paths = routesOf(load('routes/payments-extended')).map((x) => x.split(' ')[1]);
  for (const p of ['/paypal/connect', '/wallet-token', '/gift-card/redeem', '/bnpl/check']) {
    assert.ok(paths.includes(p), `${p} disappeared`);
  }
});
