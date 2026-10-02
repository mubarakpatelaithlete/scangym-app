/**
 * Create Batch 1 (Tasks 151, 152, 157): the trust fixes.
 *
 *   * 151: a suspended creator was told "Pay it and Create unlocks" with
 *     nothing to press, next to "£2.78 allowance left". Now the refusal names
 *     the declined amount, there is a Pay now endpoint, and the footer stops
 *     quoting an allowance that is not what is blocking them.
 *   * 152: a failed reference upload was a 1.5s toast behind the sheet. The
 *     chip now shows Uploading… and the error inline, with a real thumbnail.
 *   * 157: provider errors ("generateAudio isn't supported… Gemini API
 *     documentation") are translated, and the price sits on the Generate button.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SHEET = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
const ROUTE = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'squad-billing.js'), 'utf8');

function fakeDb(handlers = []) {
  return {
    async query(sql) {
      for (const [fragment, rows] of handlers) if (sql.includes(fragment)) return { rows: typeof rows === 'function' ? rows() : rows };
      return { rows: [] };
    },
  };
}

test('151: a suspended refusal names the declined amount and invoice', async () => {
  const billing = require('../server/lib/gen-billing');
  const db = fakeDb([
    ['INSERT INTO squad_billing', [{ user_id: 'u1', mandate_pm_id: 'pm_1', paid_invoices: 1, suspended_at: new Date() }]],
    ['SET suspended_at = NULL', []],
    ["status = 'failed'\n", []],
    ['AS pence', [{ pence: 335, n: 1, number: 'SQ-000042' }]],
  ]);
  const v = await billing.gate({ user: { id: 'u1' } }, db, { stripe: null });
  assert.equal(v.status, 403);
  assert.equal(v.body.suspended, true);
  assert.equal(v.body.overduePence, 335);
  assert.match(v.body.error, /declined/i);
  assert.match(v.body.error, /SQ-000042/);
  assert.match(v.body.error, /Pay now/);
});

test('151: Pay now retries every open or failed invoice and reports the result', async () => {
  const billing = require('../server/lib/gen-billing');
  const db = fakeDb([
    ["status IN ('open','failed')", [{ id: 1, user_id: 'u1', gross_pence: 335, number: 'SQ-1' }]],
    ['stripe_customer_id', [{ stripe_customer_id: null }]],
    ['INSERT INTO squad_billing', [{ user_id: 'u1', mandate_pm_id: null, paid_invoices: 0, suspended_at: new Date() }]],
  ]);
  const r = await billing.payOverdue('u1', db, { stripe: null });
  assert.equal(r.failed, 1);
  assert.equal(r.paid, 0);
  assert.equal(r.suspended, true);
});

test('151: the route, the button and the footer', () => {
  assert.match(ROUTE, /router\.post\('\/pay'/);
  assert.match(SHEET, /\/api\/squad-billing\/pay/);
  assert.match(SHEET, /function showPayNow/);
  assert.match(SHEET, /card payment declined/, 'footer names the real reason');
});

test('152: the reference chip shows upload state, errors inline and a real thumbnail', () => {
  assert.match(SHEET, /__busy/);
  assert.match(SHEET, /sv-ref-err/);
  assert.match(SHEET, /width:44px;height:44px/);
  assert.match(SHEET, /function toJpeg/);
});

test('157: raw provider errors are translated before a customer sees them', () => {
  const m = SHEET.match(/function friendlyError\(m\) \{[\s\S]*?\n  \}/);
  assert.ok(m, 'friendlyError exists');
  const friendlyError = new Function(m[0] + '; return friendlyError;')();
  const out = friendlyError("`generateAudio` isn't supported by this model. Please remove it or refer to the Gemini API documentation for supported usage.");
  assert.ok(!/generateAudio|Gemini API|documentation/.test(out), out);
  assert.match(out, /not charged/);
  assert.equal(friendlyError('Prompt is empty'), 'Prompt is empty');
});

test('157: the price is on the Generate button', () => {
  assert.match(SHEET, /gb\.textContent = mode\.gen \+/);
});
