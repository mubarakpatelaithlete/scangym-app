const test = require('node:test');
const assert = require('node:assert');
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://x:y@127.0.0.1:1/none';
const billing = require('../server/lib/gen-billing');

function fakeDb() {
  const calls = [];
  return { calls, query: async (sql, params) => {
    calls.push({ sql, params });
    if (/FROM users/.test(sql)) return { rows: [{ stripe_customer_id: 'cus_1', email: 'a@b.c' }] };
    return { rows: [], rowCount: 1 };
  } };
}
const inv = (id, p) => ({ id, user_id: 'u1', number: 'SG-' + id, gross_pence: p });

test('Task 151: two 16p invoices are charged as ONE 32p payment', async () => {
  const db = fakeDb(); const intents = [];
  const stripe = { paymentIntents: { create: async (o) => { intents.push(o); return { id: 'pi_1', status: 'succeeded' }; } } };
  const r = await billing.chargeInvoices([inv(1, 16), inv(2, 16)], db, { stripe, state: { mandate_pm_id: 'pm_1' } });
  assert.equal(r.ok, true);
  assert.equal(intents.length, 1);
  assert.equal(intents[0].amount, 32);
  const paid = db.calls.find((c) => /status = 'paid'/.test(c.sql));
  assert.deepEqual(paid.params[0], [1, 2]);
});

test('Task 151: under 30p nothing is charged or failed, and Create unlocks', async () => {
  const db = fakeDb(); let called = 0;
  const stripe = { paymentIntents: { create: async () => { called++; return { status: 'succeeded' }; } } };
  const r = await billing.chargeInvoices([inv(3, 12), inv(4, 8)], db, { stripe, state: { mandate_pm_id: 'pm_1' } });
  assert.equal(r.deferred, true);
  assert.equal(called, 0);
  assert.ok(db.calls.some((c) => /suspended_at = NULL/.test(c.sql)));
  assert.ok(!db.calls.some((c) => /status = 'failed'/.test(c.sql)));
});
