const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const wise = require('../server/lib/wise-payout');

test('Task 26: UK bank detection and stable per-request UUID', () => {
  assert.ok(wise.isUkBank({ accountName: 'A B', sortCode: '123456', accountNumber: '12345678' }));
  assert.ok(!wise.isUkBank({ accountName: 'A B', iban: 'GB00' }));
  assert.strictEqual(wise.uuidFor(11), wise.uuidFor(11));
  assert.match(wise.uuidFor(11), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('Task 26: withdraw pays UK bank via Wise and the sheet leads with bank', () => {
  const W = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'wallet.js'), 'utf8');
  assert.match(W, /wise\.payUkBank/);
  const F = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'wallet-withdraw.js'), 'utf8');
  assert.ok(!F.includes("opt('stripe'"), 'Stripe Connect sign-up still offered');
  assert.match(F, /window\._sgWMType='bank'/);
});
