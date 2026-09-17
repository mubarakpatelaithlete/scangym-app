/**
 * What a creator can see and do about their ScanSquad bill.
 *
 * Create is postpaid: generate now, invoiced in the morning, charged when the
 * balance is worth charging. That only feels fair if the creator can see the
 * same numbers we are working from — what they owe, what their limit is, every
 * invoice, and every line behind it. So this router is deliberately read-heavy;
 * the one write a creator makes is saving a card, and that goes through the
 * existing /api/payment flow rather than being reimplemented here.
 *
 * Nothing here is admin. The daily run is triggered on a timer (lib/gen-billing
 * scheduleDaily) and, for operations, by POST /run with a shared secret.
 *
 * @see lib/gen-billing.js  the money
 * @see lib/gen-pricing.js  the prices
 */

const express = require('express');
const router = express.Router();

const pool = require('../middleware/db');
const { requireCreator } = require('../lib/gen-guard');
const billing = require('../lib/gen-billing');
const pricing = require('../lib/gen-pricing');
const budget = require('../lib/gen-budget');

function userIdOf(req) {
  return (req.user && (req.user.id || req.user.userId)) || (req.session && req.session.userId) || null;
}

/**
 * The billing line a Create sheet shows: card on file, what is owed, the limit,
 * and whether generation is currently paused.
 */
router.get('/status', requireCreator, async (req, res) => {
  const userId = userIdOf(req);
  try {
    const [state, unpaid, member] = await Promise.all([
      billing.stateFor(userId),
      billing.unpaidPenceFor(userId),
      budget.membershipFor(userId),
    ]);
    const tier = (member && member.tier) || 'starter';
    const cap = billing.capPenceFor(tier, (state && state.paid_invoices) || 0);
    res.json({
      hasCard: !!(state && state.mandate_pm_id) || !!(await billing.mandateFor(userId)),
      suspended: !!(state && state.suspended_at),
      suspendReason: (state && state.suspend_reason) || null,
      unpaidPence: unpaid,
      unpaid: pricing.money(unpaid),
      capPence: cap,
      cap: pricing.money(cap),
      tier,
      paidInvoices: (state && state.paid_invoices) || 0,
      thresholdPence: billing.THRESHOLD_PENCE,
      threshold: pricing.money(billing.THRESHOLD_PENCE),
      chargeAfterDays: billing.MAX_AGE_DAYS,
      suspendAfterDays: billing.SUSPEND_AFTER_DAYS,
      vatIncluded: pricing.vatRegistered(),
      /* Said plainly, because "postpaid" is not a thing most creators have met:
         no prepayment, invoiced daily, charged on a threshold. */
      terms: `No prepayment. You are invoiced every morning for what you generated, and charged to your saved card once the balance reaches ${pricing.money(billing.THRESHOLD_PENCE)} or after ${billing.MAX_AGE_DAYS} days. Miss payment ${billing.SUSPEND_AFTER_DAYS} days in a row and creating pauses until it clears.`,
    });
  } catch (e) {
    console.error('[SquadBilling] status failed:', e.message);
    res.status(500).json({ error: 'Could not read your billing status.' });
  }
});

/** Adopt the card the creator just saved through /api/payment/confirm-setup. */
router.post('/mandate', requireCreator, express.json({ limit: '4kb' }), async (req, res) => {
  const userId = userIdOf(req);
  const pmId = (req.body && req.body.paymentMethodId) || null;
  if (!pmId) {
    /* No id supplied: pick up whatever the Stripe customer already defaults to,
       which is the normal path after the existing card-setup sheet. */
    const found = await billing.mandateFor(userId);
    return found
      ? res.json({ ok: true, hasCard: true })
      : res.status(400).json({ error: 'No saved card found. Add a card first.', needsCard: true });
  }
  const ok = await billing.saveMandate(userId, pmId);
  res.status(ok ? 200 : 500).json(ok ? { ok: true, hasCard: true } : { error: 'Could not save that card.' });
});

/** Every priced render, newest first — the detail behind the number owed. */
router.get('/ledger', requireCreator, async (req, res) => {
  const userId = userIdOf(req);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 30));
  try {
    const r = await pool.query(
      `SELECT id, kind, model, prompt, status, created_at, invoice_id,
              retail_net_pence, retail_vat_pence, retail_gross_pence
         FROM squad_video_jobs
        WHERE user_id = $1::text AND retail_gross_pence IS NOT NULL
        ORDER BY created_at DESC LIMIT $2`,
      [String(userId), limit],
    );
    res.json({
      items: r.rows.map((j) => ({
        id: j.id,
        kind: j.kind,
        model: j.model,
        prompt: (j.prompt || '').slice(0, 80),
        status: j.status,
        at: j.created_at,
        invoiced: !!j.invoice_id,
        pricePence: j.retail_gross_pence,
        price: pricing.money(j.retail_gross_pence),
      })),
    });
  } catch (e) {
    console.error('[SquadBilling] ledger failed:', e.message);
    res.status(500).json({ error: 'Could not read your usage.' });
  }
});

/** The creator's invoices. */
router.get('/invoices', requireCreator, async (req, res) => {
  const userId = userIdOf(req);
  try {
    const r = await pool.query(
      `SELECT number, issued_on, line_count, net_pence, vat_pence, gross_pence,
              status, paid_at
         FROM squad_invoices WHERE user_id = $1::text
        ORDER BY issued_on DESC, id DESC LIMIT 24`,
      [String(userId)],
    );
    res.json({
      items: r.rows.map((i) => ({
        number: i.number,
        issuedOn: i.issued_on,
        lines: i.line_count,
        netPence: i.net_pence,
        vatPence: i.vat_pence,
        grossPence: i.gross_pence,
        total: pricing.money(i.gross_pence),
        status: i.status,
        paidAt: i.paid_at,
        url: `/api/squad-billing/invoices/${encodeURIComponent(i.number)}`,
      })),
      vatIncluded: pricing.vatRegistered(),
    });
  } catch (e) {
    console.error('[SquadBilling] invoices failed:', e.message);
    res.status(500).json({ error: 'Could not read your invoices.' });
  }
});

/** One invoice, as a printable VAT invoice. Only ever your own. */
router.get('/invoices/:number', requireCreator, async (req, res) => {
  const userId = userIdOf(req);
  try {
    const r = await pool.query(
      'SELECT * FROM squad_invoices WHERE number = $1 AND user_id = $2::text',
      [req.params.number, String(userId)],
    );
    const inv = r.rows[0];
    if (!inv) return res.status(404).json({ error: 'No such invoice.' });
    const lines = await billing.linesFor(inv.id);
    res.type('html').send(billing.invoiceHtml(inv, lines));
  } catch (e) {
    console.error('[SquadBilling] invoice render failed:', e.message);
    res.status(500).json({ error: 'Could not render that invoice.' });
  }
});

/**
 * Run the daily billing sweep now.
 *
 * Exists so the run can be triggered and verified from outside the app rather
 * than only at 07:00, and gated by a secret because it moves money. Without
 * SQUAD_BILLING_SECRET set it refuses rather than defaulting to open.
 */
router.post('/run', express.json(), async (req, res) => {
  const secret = process.env.SQUAD_BILLING_SECRET;
  const given = req.get('x-billing-secret') || (req.body && req.body.secret);
  if (!secret || given !== secret) return res.status(403).json({ error: 'Not allowed.' });
  const summary = await billing.runDailyBilling();
  res.json(summary);
});

/** Config health: is invoicing legally able to run yet? */
router.get('/health', (req, res) => {
  const ready = pricing.invoicingReady();
  res.json({
    ok: true,
    multiplier: pricing.MULTIPLIER,
    landedCostFactor: pricing.LANDED_FACTOR,
    vatRegistered: pricing.vatRegistered(),
    vatRate: pricing.vatRegistered() ? pricing.VAT_RATE : 0,
    invoicing: ready.ready ? 'ready' : 'blocked',
    missingConfig: ready.missing,
    thresholdPence: billing.THRESHOLD_PENCE,
    chargeAfterDays: billing.MAX_AGE_DAYS,
    suspendAfterDays: billing.SUSPEND_AFTER_DAYS,
    stripe: !!process.env.STRIPE_SECRET_KEY,
  });
});

module.exports = router;
