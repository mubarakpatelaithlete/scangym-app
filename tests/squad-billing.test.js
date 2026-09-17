/**
 * ScanSquad postpaid billing: pricing, the good-standing gate, invoicing,
 * charging and suspension.
 *
 * The founder's model, decided 17 Sep 2026: a creator never prepays. They save
 * a card, generate inside a daily allowance, get an invoice each morning, and
 * are suspended if an invoice goes unpaid two days running.
 *
 * What these tests defend:
 *   * The number a creator sees is the *sell* price. The sheet used to render
 *     `estimateUsd * 0.79` — our supplier's charge to us — as the price, so
 *     every chip quoted a rate at which ScanGym earns nothing.
 *   * 2.0x is a 50% margin, taken on landed cost (FX, failed renders, CDN) and
 *     not on the raw provider price.
 *   * Postpaid cannot start without a card mandate and cannot exceed the unpaid
 *     cap. Those two are the entire risk of billing after the fact.
 *   * Charging waits for a threshold, because a 20p fee on a £1 charge is 40%
 *     of the margin.
 *   * Suspension happens at two days and lifts itself on payment — no human in
 *     either direction.
 *   * Money is integer pence end to end, and an unpriced model bills nothing
 *     rather than zero-pence something.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'lib');
const P = (f) => path.join(LIB, f);

/** Load a lib fresh, so module-level env reads (the multiplier) are re-evaluated. */
function fresh(file, vars = {}) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined || v === '') delete process.env[k];
    else process.env[k] = v;
  }
  for (const f of ['gen-pricing.js', 'gen-billing.js', 'gen-budget.js']) delete require.cache[P(f)];
  const mod = require(P(file));
  return {
    mod,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
      for (const f of ['gen-pricing.js', 'gen-billing.js', 'gen-budget.js']) delete require.cache[P(f)];
    },
  };
}

const VAT_ON = { SQUAD_VAT_NUMBER: 'GB402472727', SQUAD_TRADING_ADDRESS: '1 Test St, Leicester' };

/** A pg-like stub: match on a fragment of SQL, answer with rows. */
function fakeDb(handlers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      for (const [fragment, rows] of handlers) {
        if (sql.includes(fragment)) return { rows: typeof rows === 'function' ? rows(params) : rows };
      }
      return { rows: [] };
    },
  };
}

const STATE_SQL = 'INSERT INTO squad_billing';
const UNPAID_SQL = 'AS unpaid';
const MEMBER_SQL = 'creator_memberships';

// ── Pricing ──────────────────────────────────────────────────────────────────

test('2.0x on landed cost, VAT on top, integer pence', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', {
    ...VAT_ON,
    SQUAD_PRICE_MULTIPLIER: '2.0',
    SQUAD_LANDED_COST_FACTOR: '1.15',
    SQUAD_USD_GBP: '0.79',
    SQUAD_VAT_RATE: '0.2',
  });
  // A Kling 3.0 Pro clip cost us $1.34 on production on 17 Sep 2026.
  const r = pricing.retail(1.34);
  assert.equal(r.netPence, Math.ceil(1.34 * 1.15 * 2 * 0.79 * 100));
  assert.equal(r.vatPence, Math.round(r.netPence * 0.2));
  assert.equal(r.grossPence, r.netPence + r.vatPence);
  assert.ok(Number.isInteger(r.grossPence));
  restore();
});

test('the multiplier is a margin: 2.0x keeps half the net price', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', {
    SQUAD_PRICE_MULTIPLIER: '2.0',
    SQUAD_LANDED_COST_FACTOR: '1',
    SQUAD_USD_GBP: '1',
    SQUAD_VAT_NUMBER: '',
  });
  const r = pricing.retail(1); // £1 landed
  assert.equal(r.netPence, 200);
  assert.equal((r.netPence - 100) / r.netPence, 0.5); // 50%, not 100%
  restore();
});

test('1.5x would be a 33% margin — the number that is easy to get wrong', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', {
    SQUAD_PRICE_MULTIPLIER: '1.5',
    SQUAD_LANDED_COST_FACTOR: '1',
    SQUAD_USD_GBP: '1',
    SQUAD_VAT_NUMBER: '',
  });
  const r = pricing.retail(1);
  assert.equal(r.netPence, 150);
  assert.ok(Math.abs((r.netPence - 100) / r.netPence - 0.3333) < 0.001);
  restore();
});

test('margin is taken on landed cost, not the provider list price', () => {
  const raw = fresh('gen-pricing.js', {
    SQUAD_PRICE_MULTIPLIER: '2', SQUAD_LANDED_COST_FACTOR: '1', SQUAD_USD_GBP: '1', SQUAD_VAT_NUMBER: '',
  });
  const rawNet = raw.mod.retail(1).netPence;
  raw.restore();
  const landed = fresh('gen-pricing.js', {
    SQUAD_PRICE_MULTIPLIER: '2', SQUAD_LANDED_COST_FACTOR: '1.15', SQUAD_USD_GBP: '1', SQUAD_VAT_NUMBER: '',
  });
  const landedNet = landed.mod.retail(1).netPence;
  landed.restore();
  assert.ok(landedNet > rawNet, 'the landed factor must move the price');
});

test('no VAT number means no VAT charged, and invoicing is blocked', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', {
    SQUAD_VAT_NUMBER: '', SQUAD_TRADING_ADDRESS: '',
  });
  assert.equal(pricing.vatRegistered(), false);
  assert.equal(pricing.retail(1).vatPence, 0);
  const ready = pricing.invoicingReady();
  assert.equal(ready.ready, false);
  assert.ok(ready.missing.includes('SQUAD_VAT_NUMBER'));
  assert.ok(ready.missing.includes('SQUAD_TRADING_ADDRESS'));
  restore();
});

test('a render can never be free by rounding, and an unpriced one is free not zero', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', VAT_ON);
  assert.ok(pricing.retail(0.0000001).netPence >= 1);
  assert.equal(pricing.retail(null), null);
  assert.equal(pricing.retail(0), null);
  assert.equal(pricing.quote(null).price, null);
  restore();
});

test('money() reads like a price tag', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', VAT_ON);
  assert.equal(pricing.money(7), '7p');
  assert.equal(pricing.money(370), '£3.70');
  restore();
});

test('the priced catalogue carries a price and never our cost', () => {
  const { mod: pricing, restore } = fresh('gen-pricing.js', VAT_ON);
  const rows = pricing.pricedCatalogue('video', { seconds: 8 });
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.ok(!('estimateUsd' in r), 'supplier cost must not leave the server');
    assert.ok(!('providerModel' in r));
    if (r.pricePence != null) assert.match(r.price, /^(£\d+\.\d\d|\d+p)$/);
  }
  restore();
});

// ── What the creator is shown ────────────────────────────────────────────────

test('a budget refusal quotes the retail price, never our cost', () => {
  const { mod: spend, restore } = fresh('gen-budget.js', VAT_ON);
  const pricing = require(P('gen-pricing.js'));
  const v = spend.verdict(
    { signedIn: true, degraded: false, remainingUsd: 0.1, dailyUsd: 0.6, spentUsd: 0.5 },
    1.34,
  );
  assert.equal(v.status, 402);
  assert.ok(v.body.error.includes(pricing.money(pricing.retail(1.34).grossPence)));
  assert.ok(!v.body.error.includes('£1.06'), 'that was the supplier price');
  restore();
});

test('annotate() swaps cost for price and keeps affordability working', () => {
  const { mod: spend, restore } = fresh('gen-budget.js', VAT_ON);
  const rows = spend.annotate(
    [{ id: 'kling-3.0-pro', label: 'Kling 3.0 Pro', estimateUsd: 1.34 },
      { id: 'gpt-5.6', label: 'ChatGPT 5.6', estimateUsd: null }],
    { signedIn: true, degraded: false, remainingUsd: 0.5 },
  );
  assert.ok(!('estimateUsd' in rows[0]));
  assert.ok(rows[0].pricePence > 0);
  assert.equal(rows[0].affordable, false); // $1.34 against $0.50 left
  assert.equal(rows[1].affordable, true);  // unpriced is always runnable
  assert.equal(rows[1].pricePence, null);
  restore();
});

test('the sheet shows the price from the server, not a cost times an FX guess', () => {
  const fs = require('node:fs');
  const sheet = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');
  assert.ok(!sheet.includes('m.estimateUsd * 0.79'), 'the wholesale price tag is gone');
  assert.ok(sheet.includes('m.price'), 'chips read the server price');
  assert.ok(sheet.includes('squad-billing/status'), 'the sheet knows the billing state');
  assert.ok(sheet.includes('needsCard'), 'a missing card is handled in the sheet');
});

// ── The good-standing gate ───────────────────────────────────────────────────

test('no saved card refuses with needsCard, before any render is bought', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = fakeDb([
    [STATE_SQL, [{ user_id: 'u1', mandate_pm_id: null, paid_invoices: 0, suspended_at: null }]],
    ['stripe_customer_id', [{ stripe_customer_id: null }]],
  ]);
  const v = await billing.gate({ user: { id: 'u1' } }, db, { stripe: null });
  assert.equal(v.status, 402);
  assert.equal(v.body.needsCard, true);
  restore();
});

test('a suspended creator is refused and told what clears it', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = fakeDb([
    [STATE_SQL, [{ user_id: 'u1', mandate_pm_id: 'pm_1', paid_invoices: 3, suspended_at: new Date() }]],
  ]);
  const v = await billing.gate({ user: { id: 'u1' } }, db, { stripe: null });
  assert.equal(v.status, 403);
  assert.equal(v.body.suspended, true);
  assert.match(v.body.error, /pay/i);
  restore();
});

test('over the unpaid cap refuses — postpaid is credit, and credit has a limit', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = fakeDb([
    [STATE_SQL, [{ user_id: 'u1', mandate_pm_id: 'pm_1', paid_invoices: 0, suspended_at: null }]],
    [UNPAID_SQL, [{ unpaid: 5000 }]], // £50 owed
    [MEMBER_SQL, [{ tier: 'starter', conversions: 0, referrals: 0 }]],
  ]);
  const v = await billing.gate({ user: { id: 'u1' } }, db, { stripe: null });
  assert.equal(v.status, 402);
  assert.equal(v.body.needsPayment, true);
  assert.equal(v.body.capPence, billing.capPenceFor('starter', 0));
  restore();
});

test('the unpaid balance counts renders not yet invoiced, not just invoices', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = fakeDb([[UNPAID_SQL, [{ unpaid: 42 }]]]);
  assert.equal(await billing.unpaidPenceFor('u1', db), 42);
  const sql = db.calls[0].sql;
  assert.ok(sql.includes('squad_invoices'));
  assert.ok(sql.includes('invoice_id IS NULL'), 'uninvoiced renders count too');
  restore();
});

test('a creator in good standing is allowed through', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = fakeDb([
    [STATE_SQL, [{ user_id: 'u1', mandate_pm_id: 'pm_1', paid_invoices: 2, suspended_at: null }]],
    [UNPAID_SQL, [{ unpaid: 120 }]],
    [MEMBER_SQL, [{ tier: 'starter', conversions: 0, referrals: 0 }]],
  ]);
  assert.equal(await billing.gate({ user: { id: 'u1' } }, db, { stripe: null }), null);
  restore();
});

test('a database blip allows generation rather than taking Create down', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = { async query() { throw new Error('no db'); } };
  assert.equal(await billing.gate({ user: { id: 'u1' } }, db, { stripe: null }), null);
  restore();
});

test('a signed-out caller is left to the login gate, not the billing gate', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  assert.equal(await billing.gate({}, fakeDb(), { stripe: null }), null);
  restore();
});

test('the cap grows with invoices actually paid, up to a ceiling', () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  assert.equal(billing.capPenceFor('starter', 0), 1000);   // £10 for a stranger
  assert.equal(billing.capPenceFor('starter', 4), 2000);   // history earns headroom
  assert.ok(billing.capPenceFor('legend', 0) > billing.capPenceFor('starter', 0));
  assert.ok(billing.capPenceFor('legend', 10000) <= 20000);
  restore();
});

// ── Invoicing ────────────────────────────────────────────────────────────────

test('nothing is invoiced without a VAT number and a trading address', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', {
    SQUAD_VAT_NUMBER: '', SQUAD_TRADING_ADDRESS: '',
  });
  const db = fakeDb();
  const r = await billing.buildInvoices(db);
  assert.equal(r.issued, 0);
  assert.ok(r.blocked.includes('SQUAD_VAT_NUMBER'));
  assert.equal(db.calls.length, 0, 'it must not even look at the ledger');
  restore();
});

test('one invoice per creator, numbered from a sequence, lines attached after', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const db = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (sql.includes('GROUP BY user_id')) {
        return {
          rows: [{
            user_id: 'u1', lines: 3, net: 300, vat: 60, gross: 360,
            period_start: new Date(), period_end: new Date(),
          }],
        };
      }
      if (sql.includes('nextval')) return { rows: [{ n: 1042 }] };
      if (sql.includes('INSERT INTO squad_invoices')) {
        return { rows: [{ id: 7, number: params[0], user_id: 'u1', net_pence: 300, vat_pence: 60, gross_pence: 360 }] };
      }
      return { rows: [] };
    },
  };
  const r = await billing.buildInvoices(db);
  assert.equal(r.issued, 1);
  assert.match(r.invoices[0].number, /^SG-\d{4}-001042$/);
  const insertAt = db.calls.findIndex((c) => c.sql.includes('INSERT INTO squad_invoices'));
  const attachAt = db.calls.findIndex((c) => c.sql.includes('SET invoice_id'));
  assert.ok(insertAt >= 0 && attachAt > insertAt, 'lines are attached only after the invoice exists');
  restore();
});

test('the invoice reads as a VAT invoice: our number, the split, the total', () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const pricing = require(P('gen-pricing.js'));
  const html = billing.invoiceHtml(
    {
      number: 'SG-2026-001042', issued_on: '2026-09-17', net_pence: 300, vat_pence: 60,
      gross_pence: 360, vat_rate: 0.2, status: 'open',
    },
    [{ kind: 'video', model: 'kling-3.0-pro', prompt: 'gym reel', retail_net_pence: 244, retail_gross_pence: 293 }],
  );
  assert.ok(html.includes('SG-2026-001042'));
  assert.ok(html.includes('GB402472727'));
  assert.ok(html.includes('1 Test St, Leicester'));
  assert.ok(html.includes(pricing.money(360)));
  assert.ok(html.includes('VAT @ 20%'));
  restore();
});

test('a prompt cannot inject markup into an invoice', () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const html = billing.invoiceHtml(
    { number: 'SG-1', issued_on: '2026-09-17', net_pence: 1, vat_pence: 0, gross_pence: 1, vat_rate: 0.2 },
    [{ kind: 'text', model: 'gpt-5.6', prompt: '<script>alert(1)</script>', retail_net_pence: 1, retail_gross_pence: 1 }],
  );
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  restore();
});

// ── Charging and suspension ──────────────────────────────────────────────────

test('charging waits for a threshold or an age — not every single day', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', {
    ...VAT_ON, SQUAD_CHARGE_THRESHOLD_PENCE: '500', SQUAD_CHARGE_MAX_AGE_DAYS: '7',
  });
  const db = fakeDb();
  const r = await billing.chargeDue(db, { stripe: null });
  assert.equal(r.charged, 0);
  const { sql, params } = db.calls[0];
  assert.ok(sql.includes('HAVING SUM(gross_pence) >= $1'));
  assert.ok(sql.includes('MIN(issued_on) <= CURRENT_DATE - $2::int'));
  assert.deepEqual(params, [500, 7]);
  restore();
});

test('a successful charge marks paid, credits history and lifts suspension', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('SELECT stripe_customer_id, email')) {
        return { rows: [{ stripe_customer_id: 'cus_1', email: 'c@example.com' }] };
      }
      if (sql.includes(STATE_SQL)) return { rows: [{ user_id: 'u1', mandate_pm_id: 'pm_1', paid_invoices: 0 }] };
      return { rows: [] };
    },
  };
  let args = null;
  const stripeStub = {
    paymentIntents: { create: async (a) => { args = a; return { id: 'pi_1', status: 'succeeded' }; } },
  };
  const r = await billing.chargeInvoice(
    { id: 7, number: 'SG-1', user_id: 'u1', gross_pence: 360 }, db, { stripe: stripeStub },
  );
  assert.equal(r.ok, true);
  assert.equal(args.amount, 360);
  assert.equal(args.off_session, true);
  assert.equal(args.confirm, true);
  assert.equal(args.payment_method, 'pm_1');
  assert.ok(seen.some((s) => s.includes("status = 'paid'")));
  assert.ok(seen.some((s) => s.includes('paid_invoices = paid_invoices + 1')));
  assert.ok(seen.some((s) => s.includes('suspended_at = NULL')));
  restore();
});

test('a declined card is recorded as failed, not silently forgotten', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (sql.includes('SELECT stripe_customer_id, email')) return { rows: [{ stripe_customer_id: 'cus_1' }] };
      if (sql.includes(STATE_SQL)) return { rows: [{ user_id: 'u1', mandate_pm_id: 'pm_1' }] };
      return { rows: [] };
    },
  };
  const stripeStub = { paymentIntents: { create: async () => { throw new Error('card_declined'); } } };
  const r = await billing.chargeInvoice(
    { id: 7, number: 'SG-1', user_id: 'u1', gross_pence: 360 }, db, { stripe: stripeStub },
  );
  assert.equal(r.ok, false);
  assert.ok(seen.some((s) => s.includes("status = 'failed'") && s.includes('charge_attempts')));
  restore();
});

test('no Stripe key means no charge is invented', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const r = await billing.chargeInvoice({ id: 1, number: 'SG-1', user_id: 'u1', gross_pence: 100 },
    fakeDb(), { stripe: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_stripe_key');
  restore();
});

test('two days unpaid suspends; nothing owed lifts it again', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', { ...VAT_ON, SQUAD_SUSPEND_AFTER_DAYS: '2' });
  const db = fakeDb([
    ['SET suspended_at = NOW()', [{ user_id: 'u1' }]],
    ['suspended_at = NULL', [{ user_id: 'u1' }]],
  ]);
  const s = await billing.suspendOverdue(db);
  assert.equal(s.suspended, 1);
  assert.deepEqual(db.calls[0].params, [2]);
  assert.ok(db.calls[0].sql.includes("i.status IN ('open','failed')"));

  assert.equal(await billing.liftSuspensionIfClear('u1', db), true);
  assert.ok(db.calls[1].sql.includes('NOT EXISTS'));
  restore();
});

test('the daily run is idempotent and reports what it did', async () => {
  const { mod: billing, restore } = fresh('gen-billing.js', VAT_ON);
  const summary = await billing.runDailyBilling(fakeDb(), { stripe: null, sendMail: async () => {} });
  assert.equal(summary.issued, 0);
  assert.equal(summary.emailed, 0);
  assert.equal(summary.charged, 0);
  assert.equal(summary.suspended, 0);
  restore();
});

// ── Wiring ───────────────────────────────────────────────────────────────────

for (const name of ['squad-text', 'squad-image', 'squad-audio', 'squad-music', 'squad-video']) {
  test(`${name} POST /generate requires a billable creator`, () => {
    const router = require(path.join(ROOT, 'server', 'routes', `${name}.js`));
    const layer = router.stack.find((l) => l.route && l.route.path === '/generate' && l.route.methods.post);
    assert.ok(layer, 'the generate route must exist');
    assert.ok(
      layer.route.stack.some((h) => h.name === 'requireBillable'),
      'spending must pass the login + billing gate',
    );
  });
}

test('reads stay open — a visitor can still see prices, modes and templates', () => {
  const router = require(path.join(ROOT, 'server', 'routes', 'squad-create.js'));
  const open = router.stack.filter((l) => l.route && ['/templates', '/modes', '/budget'].includes(l.route.path));
  assert.ok(open.length > 0);
  for (const l of open) {
    assert.ok(!l.route.stack.some((h) => h.name === 'requireBillable'));
  }
});

test('the billing routes exist, and the ops trigger is not open by default', async () => {
  const router = require(path.join(ROOT, 'server', 'routes', 'squad-billing.js'));
  const paths = router.stack.filter((l) => l.route).map((l) => l.route.path);
  for (const p of ['/status', '/ledger', '/invoices', '/invoices/:number', '/run', '/health']) {
    assert.ok(paths.includes(p), `missing ${p}`);
  }
  // POST /run with no SQUAD_BILLING_SECRET set must refuse rather than run.
  const layer = router.stack.find((l) => l.route && l.route.path === '/run');
  const handler = layer.route.stack[layer.route.stack.length - 1].handle;
  const saved = process.env.SQUAD_BILLING_SECRET;
  delete process.env.SQUAD_BILLING_SECRET;
  let status = null;
  await handler({ get: () => 'anything', body: {} }, {
    status(s) { status = s; return this; },
    json() { return this; },
  });
  assert.equal(status, 403);
  if (saved !== undefined) process.env.SQUAD_BILLING_SECRET = saved;
});

test('every priced render stores what the creator owes, alongside what it cost us', () => {
  const fs = require('node:fs');
  const jobs = fs.readFileSync(P('gen-jobs.js'), 'utf8');
  assert.ok(jobs.includes('retail_net_pence'));
  assert.ok(jobs.includes('retail_gross_pence'));
  assert.ok(jobs.includes("require('./gen-pricing')"));
  const sql = fs.readFileSync(path.join(ROOT, 'migrations', '20260917_squad_billing.sql'), 'utf8');
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS retail_gross_pence'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS squad_invoices'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS squad_billing'));
  assert.ok(sql.includes('CREATE SEQUENCE IF NOT EXISTS squad_invoice_no_seq'));
});
