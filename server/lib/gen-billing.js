/**
 * Postpaid billing for ScanSquad Create.
 *
 * The shape of the deal: a creator saves a card, generates freely inside their
 * daily budget, and is invoiced the next morning. No prepaid packs, no balance
 * to top up. Two things make that safe rather than reckless:
 *
 *   1. A card mandate before the first render. Postpaid is credit, and the only
 *      thing that reliably collects credit is a saved card we may charge
 *      off-session — the same mechanism this app already uses for gym bookings.
 *      Identity checks deter a repeat abuser; they do not produce money.
 *   2. A cap on what may be owed at once. The daily generation budget is a
 *      spending limit, not a credit limit: without a cap, a brand-new creator
 *      can run £25 of renders on day one and vanish, and suspending them on day
 *      two recovers nothing. So the *unpaid* balance is capped by tier and
 *      grows with invoices actually paid.
 *
 * Why charge on a threshold instead of every morning: Stripe costs ~20p + 1.5%
 * per charge. A creator spending £1/day charged daily loses 20% of revenue to
 * fees — 40% of the margin. So invoices are issued daily (the creator sees
 * yesterday's spend every morning) and *charged* when the balance reaches
 * SQUAD_CHARGE_THRESHOLD_PENCE or the oldest invoice reaches
 * SQUAD_CHARGE_MAX_AGE_DAYS, whichever comes first. Same as Stripe's and Google
 * Ads' own billing.
 *
 * Suspension, per the founder's rule: a charge that fails is retried the next
 * day, and again the day after; unpaid two days running suspends generation.
 * It lifts itself the moment a payment clears — a suspension that needs a human
 * to undo is a support ticket, and this runs unattended.
 *
 * Everything here is best-effort about *reads* and strict about *money*: if the
 * database cannot answer whether a creator is suspended we let them generate
 * (a ledger blip must not become an outage), but a charge is only ever recorded
 * as paid when Stripe says succeeded.
 *
 * @see lib/gen-pricing.js         cost → price
 * @see routes/squad-billing.js    what the creator sees
 * @see migrations/20260917_squad_billing.sql
 */

const pool = require('../middleware/db');
const pricing = require('./gen-pricing');

const stripe = process.env.STRIPE_SECRET_KEY
  ? require('stripe')(process.env.STRIPE_SECRET_KEY)
  : null;

function num(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Charge once the unpaid balance reaches this, to keep card fees ~4% not ~20%. */
const THRESHOLD_PENCE = Math.round(num(process.env.SQUAD_CHARGE_THRESHOLD_PENCE, 500));

/** …or when the oldest open invoice gets this old, whichever comes first. */
const MAX_AGE_DAYS = Math.round(num(process.env.SQUAD_CHARGE_MAX_AGE_DAYS, 7));

/** Unpaid this many days in a row → generation suspended. */
const SUSPEND_AFTER_DAYS = Math.round(num(process.env.SQUAD_SUSPEND_AFTER_DAYS, 2));

/** How much a creator may owe at once, before payment history. */
const CAP_PENCE = {
  starter: Math.round(num(process.env.SQUAD_UNPAID_CAP_STARTER_PENCE, 1000)),
  rising: 2500,
  pro: 5000,
  legend: 10000,
};

/** Each paid invoice earns this much more headroom, up to the ceiling. */
const CAP_PER_PAID_PENCE = Math.round(num(process.env.SQUAD_UNPAID_CAP_PER_PAID_PENCE, 250));
const CAP_MAX_PENCE = Math.round(num(process.env.SQUAD_UNPAID_CAP_MAX_PENCE, 20000));

const CURRENCY = (process.env.SQUAD_BILLING_CURRENCY || 'gbp').toLowerCase();

function userIdOf(req) {
  return (req && req.user && (req.user.id || req.user.userId))
    || (req && req.session && req.session.userId)
    || null;
}

/** What a creator on this tier may owe, given how many invoices they have paid. */
function capPenceFor(tier, paidInvoices = 0) {
  const base = CAP_PENCE[tier] != null ? CAP_PENCE[tier] : CAP_PENCE.starter;
  return Math.min(CAP_MAX_PENCE, base + CAP_PER_PAID_PENCE * Math.max(0, paidInvoices));
}

/** The creator's billing row, created on first sight. Null when the DB is down. */
async function stateFor(userId, db = pool) {
  try {
    const r = await db.query(
      `INSERT INTO squad_billing (user_id) VALUES ($1::text)
       ON CONFLICT (user_id) DO UPDATE SET updated_at = NOW()
       RETURNING user_id, mandate_pm_id, mandate_at, paid_invoices, paid_gross_pence,
                 suspended_at, suspend_reason`,
      [String(userId)],
    );
    return r.rows[0] || null;
  } catch (e) {
    console.error('[SquadBilling] state lookup failed:', e.message);
    return null;
  }
}

/**
 * Everything unpaid: issued invoices plus renders not yet invoiced.
 *
 * Counting only invoices would let a creator generate all day against a cap
 * that updates once every morning, which is exactly the hole postpaid has to
 * close.
 */
async function unpaidPenceFor(userId, db = pool) {
  try {
    const r = await db.query(
      `SELECT
         COALESCE((SELECT SUM(gross_pence) FROM squad_invoices
                    WHERE user_id = $1::text AND status <> 'paid' AND status <> 'void'), 0)::bigint
         +
         COALESCE((SELECT SUM(retail_gross_pence) FROM squad_video_jobs
                    WHERE user_id = $1::text AND invoice_id IS NULL
                      AND retail_gross_pence IS NOT NULL), 0)::bigint
       AS unpaid`,
      [String(userId)],
    );
    return Number(r.rows[0].unpaid || 0);
  } catch (e) {
    console.error('[SquadBilling] unpaid lookup failed:', e.message);
    return null;
  }
}

/**
 * The saved card we may charge. Reads the billing row first; if the creator
 * saved a card through the normal checkout flow (payment.js writes it to the
 * Stripe customer, not here) we adopt that default once and remember it, so
 * the gate stays a single database read afterwards.
 */
async function mandateFor(userId, db = pool, deps = {}) {
  const state = deps.state !== undefined ? deps.state : await stateFor(userId, db);
  if (state && state.mandate_pm_id) return state.mandate_pm_id;

  const client = deps.stripe !== undefined ? deps.stripe : stripe;
  if (!client) return null;
  try {
    const u = await db.query('SELECT stripe_customer_id FROM users WHERE id::text = $1::text', [String(userId)]);
    const customerId = u.rows[0] && u.rows[0].stripe_customer_id;
    if (!customerId) return null;
    const customer = await client.customers.retrieve(customerId);
    const pm = customer && customer.invoice_settings && customer.invoice_settings.default_payment_method;
    if (!pm) return null;
    await saveMandate(userId, typeof pm === 'string' ? pm : pm.id, db);
    return typeof pm === 'string' ? pm : pm.id;
  } catch (e) {
    console.error('[SquadBilling] mandate lookup failed:', e.message);
    return null;
  }
}

async function saveMandate(userId, pmId, db = pool) {
  try {
    await db.query(
      `INSERT INTO squad_billing (user_id, mandate_pm_id, mandate_at)
       VALUES ($1::text, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET mandate_pm_id = EXCLUDED.mandate_pm_id,
             mandate_at = NOW(), updated_at = NOW()`,
      [String(userId), pmId],
    );
    return true;
  } catch (e) {
    console.error('[SquadBilling] could not save mandate:', e.message);
    return false;
  }
}

/**
 * May this creator generate right now, on billing grounds?
 *
 * Returns null to allow, or { status, body } to refuse with. Each refusal names
 * the one action that clears it — a creator who is told "payment required" and
 * nothing else will open a support conversation instead of adding a card.
 *
 * Deliberately independent of lib/gen-budget.js: that answers "can they afford
 * this render today", this answers "are they in good standing at all".
 */
async function gate(req, db = pool, deps = {}) {
  const userId = userIdOf(req);
  if (!userId) return null; // requireCreator owns the signed-out case

  const state = await stateFor(userId, db);
  if (state === null) {
    console.warn('[SquadBilling] allowing a generation without a billing check — ledger unreachable');
    return null;
  }

  if (state.suspended_at) {
    return {
      status: 403,
      body: {
        error: 'Generation is paused until your unpaid invoice is settled. Pay it and Create unlocks straight away.',
        suspended: true,
        needsPayment: true,
      },
    };
  }

  const mandate = await mandateFor(userId, db, { ...deps, state });
  if (!mandate) {
    return {
      status: 402,
      body: {
        error: 'Add a card to start creating. Nothing is charged now — you are invoiced for what you actually generate.',
        needsCard: true,
      },
    };
  }

  const unpaid = await unpaidPenceFor(userId, db);
  if (unpaid == null) return null; // same trade as above: a blip is not an outage

  const member = deps.membership !== undefined
    ? deps.membership
    : await require('./gen-budget').membershipFor(userId, db);
  const cap = capPenceFor((member && member.tier) || 'starter', state.paid_invoices);
  if (unpaid >= cap) {
    return {
      status: 402,
      body: {
        error: `You have ${pricing.money(unpaid)} owing, which is the limit for your account. Settle it and your limit rises with every invoice you pay.`,
        needsPayment: true,
        unpaidPence: unpaid,
        capPence: cap,
      },
    };
  }

  return null;
}

// ── The daily run ────────────────────────────────────────────────────────────

/**
 * Turn yesterday's uninvoiced renders into one invoice per creator.
 *
 * One invoice per creator per run, not per render: a creator making twelve
 * captions and an image should get one line-itemised bill, and twelve 1p
 * invoices would cost more to issue than they collect.
 */
async function buildInvoices(db = pool) {
  const ready = pricing.invoicingReady();
  if (!ready.ready) {
    console.warn(`[SquadBilling] not issuing invoices — missing ${ready.missing.join(', ')}`);
    return { issued: 0, blocked: ready.missing };
  }

  let users;
  try {
    users = await db.query(
      `SELECT user_id, COUNT(*)::int AS lines,
              SUM(retail_net_pence)::int   AS net,
              SUM(retail_vat_pence)::int   AS vat,
              SUM(retail_gross_pence)::int AS gross,
              MIN(created_at) AS period_start, MAX(created_at) AS period_end
         FROM squad_video_jobs
        WHERE invoice_id IS NULL AND retail_gross_pence IS NOT NULL
        GROUP BY user_id`,
    );
  } catch (e) {
    console.error('[SquadBilling] invoice build failed:', e.message);
    return { issued: 0, error: e.message };
  }

  const issued = [];
  for (const row of users.rows) {
    try {
      const seq = await db.query("SELECT nextval('squad_invoice_no_seq') AS n");
      const number = `SG-${new Date().getFullYear()}-${String(seq.rows[0].n).padStart(6, '0')}`;
      const inv = await db.query(
        `INSERT INTO squad_invoices
           (number, user_id, period_start, period_end, line_count,
            net_pence, vat_pence, gross_pence, vat_rate, vat_number)
         VALUES ($1, $2::text, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          number, row.user_id, row.period_start, row.period_end, row.lines,
          row.net, row.vat || 0, row.gross,
          pricing.vatRegistered() ? pricing.VAT_RATE : 0,
          pricing.vatNumber(),
        ],
      );
      /* Attach the lines only after the invoice exists: a crash between the
         two leaves the renders uninvoiced (billed tomorrow) rather than
         invisibly attached to an invoice nobody issued. */
      await db.query(
        `UPDATE squad_video_jobs SET invoice_id = $1
          WHERE user_id = $2::text AND invoice_id IS NULL AND retail_gross_pence IS NOT NULL`,
        [inv.rows[0].id, row.user_id],
      );
      issued.push(inv.rows[0]);
    } catch (e) {
      console.error(`[SquadBilling] could not issue invoice for ${row.user_id}:`, e.message);
    }
  }
  return { issued: issued.length, invoices: issued };
}

/** The lines behind an invoice, as a creator reads them. */
async function linesFor(invoiceId, db = pool) {
  try {
    const r = await db.query(
      `SELECT kind, model, prompt, created_at, retail_net_pence, retail_vat_pence, retail_gross_pence, status
         FROM squad_video_jobs WHERE invoice_id = $1 ORDER BY created_at`,
      [invoiceId],
    );
    return r.rows;
  } catch (e) {
    console.error('[SquadBilling] invoice lines lookup failed:', e.message);
    return [];
  }
}

/**
 * Charge an open invoice against the saved card, off-session.
 *
 * Off-session means the creator is not at the keyboard, so a card needing 3DS
 * fails here rather than prompting: that is recorded as a failed attempt and
 * retried, and after SUSPEND_AFTER_DAYS the account is suspended, which is what
 * gets the creator to come and re-authenticate.
 */
async function chargeInvoice(inv, db = pool, deps = {}) {
  const client = deps.stripe !== undefined ? deps.stripe : stripe;
  if (!client) return { ok: false, reason: 'no_stripe_key' };

  try {
    const u = await db.query(
      'SELECT stripe_customer_id, email FROM users WHERE id::text = $1::text',
      [String(inv.user_id)],
    );
    const customerId = u.rows[0] && u.rows[0].stripe_customer_id;
    const pmId = await mandateFor(inv.user_id, db, deps);
    if (!customerId || !pmId) {
      await db.query(
        `UPDATE squad_invoices SET status = 'failed', last_error = $2,
                charge_attempts = charge_attempts + 1, last_attempt_at = NOW()
          WHERE id = $1`,
        [inv.id, 'no saved card'],
      );
      return { ok: false, reason: 'no_mandate' };
    }

    const intent = await client.paymentIntents.create({
      amount: inv.gross_pence,
      currency: CURRENCY,
      customer: customerId,
      payment_method: pmId,
      off_session: true,
      confirm: true,
      description: `ScanSquad Create — invoice ${inv.number}`,
      metadata: { invoice: inv.number, userId: String(inv.user_id), squadBilling: 'true' },
      receipt_email: (u.rows[0] && u.rows[0].email) || undefined,
    });

    if (intent.status !== 'succeeded') {
      await db.query(
        `UPDATE squad_invoices SET status = 'failed', last_error = $2,
                charge_attempts = charge_attempts + 1, last_attempt_at = NOW(),
                stripe_payment_intent_id = $3
          WHERE id = $1`,
        [inv.id, `status ${intent.status}`, intent.id],
      );
      return { ok: false, reason: intent.status };
    }

    await db.query(
      `UPDATE squad_invoices SET status = 'paid', paid_at = NOW(),
              stripe_payment_intent_id = $2, last_error = NULL,
              charge_attempts = charge_attempts + 1, last_attempt_at = NOW()
        WHERE id = $1`,
      [inv.id, intent.id],
    );
    await db.query(
      `UPDATE squad_billing
          SET paid_invoices = paid_invoices + 1,
              paid_gross_pence = paid_gross_pence + $2,
              updated_at = NOW()
        WHERE user_id = $1::text`,
      [String(inv.user_id), inv.gross_pence],
    );
    await liftSuspensionIfClear(inv.user_id, db);
    return { ok: true, paymentIntent: intent.id };
  } catch (e) {
    console.error(`[SquadBilling] charge failed for ${inv.number}:`, e.message);
    try {
      await db.query(
        `UPDATE squad_invoices SET status = 'failed', last_error = $2,
                charge_attempts = charge_attempts + 1, last_attempt_at = NOW()
          WHERE id = $1`,
        [inv.id, e.message.slice(0, 300)],
      );
    } catch (_) { /* the charge already failed; the log is what matters */ }
    return { ok: false, reason: e.message };
  }
}

/** Charge every creator whose balance has hit the threshold, or gone stale. */
async function chargeDue(db = pool, deps = {}) {
  let due;
  try {
    due = await db.query(
      `SELECT user_id,
              SUM(gross_pence)::int AS owed,
              MIN(issued_on) AS oldest
         FROM squad_invoices
        WHERE status IN ('open', 'failed')
        GROUP BY user_id
       HAVING SUM(gross_pence) >= $1
           OR MIN(issued_on) <= CURRENT_DATE - $2::int`,
      [THRESHOLD_PENCE, MAX_AGE_DAYS],
    );
  } catch (e) {
    console.error('[SquadBilling] due lookup failed:', e.message);
    return { charged: 0, failed: 0, error: e.message };
  }

  let charged = 0;
  let failed = 0;
  for (const row of due.rows) {
    const open = await db.query(
      `SELECT * FROM squad_invoices WHERE user_id = $1::text AND status IN ('open','failed')
        ORDER BY issued_on`,
      [String(row.user_id)],
    );
    for (const inv of open.rows) {
      const r = await chargeInvoice(inv, db, deps);
      if (r.ok) charged += 1; else failed += 1;
    }
  }
  return { charged, failed };
}

/** Unpaid for SUSPEND_AFTER_DAYS running → generation off until they pay. */
async function suspendOverdue(db = pool) {
  try {
    const r = await db.query(
      `UPDATE squad_billing b
          SET suspended_at = NOW(), suspend_reason = 'unpaid invoice', updated_at = NOW()
        WHERE b.suspended_at IS NULL
          AND EXISTS (
            SELECT 1 FROM squad_invoices i
             WHERE i.user_id = b.user_id
               AND i.status IN ('open','failed')
               AND i.issued_on <= CURRENT_DATE - $1::int)
      RETURNING b.user_id`,
      [SUSPEND_AFTER_DAYS],
    );
    return { suspended: r.rows.length, users: r.rows.map((x) => x.user_id) };
  } catch (e) {
    console.error('[SquadBilling] suspension sweep failed:', e.message);
    return { suspended: 0, error: e.message };
  }
}

/** A suspension must undo itself the moment nothing is owed. */
async function liftSuspensionIfClear(userId, db = pool) {
  try {
    const r = await db.query(
      `UPDATE squad_billing
          SET suspended_at = NULL, suspend_reason = NULL, updated_at = NOW()
        WHERE user_id = $1::text AND suspended_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM squad_invoices
                           WHERE user_id = $1::text AND status IN ('open','failed'))
      RETURNING user_id`,
      [String(userId)],
    );
    return r.rows.length > 0;
  } catch (e) {
    console.error('[SquadBilling] could not lift suspension:', e.message);
    return false;
  }
}

/**
 * The whole morning run: issue, email, charge what is due, suspend what is
 * overdue. Safe to run twice — issuing finds nothing uninvoiced the second
 * time, and charging finds nothing open.
 */
async function runDailyBilling(db = pool, deps = {}) {
  const built = await buildInvoices(db);
  let emailed = 0;
  for (const inv of built.invoices || []) {
    if (await emailInvoice(inv, db, deps)) emailed += 1;
  }
  const charged = await chargeDue(db, deps);
  const suspended = await suspendOverdue(db);
  const summary = {
    issued: built.issued || 0,
    blocked: built.blocked,
    emailed,
    ...charged,
    suspended: suspended.suspended,
    at: new Date().toISOString(),
  };
  console.log('[SquadBilling] daily run:', JSON.stringify(summary));
  return summary;
}

/** Yesterday's spend, in the creator's inbox, every morning. */
async function emailInvoice(inv, db = pool, deps = {}) {
  const send = deps.sendMail || require('./mail-send').sendMail;
  try {
    const u = await db.query('SELECT email FROM users WHERE id::text = $1::text', [String(inv.user_id)]);
    const to = u.rows[0] && u.rows[0].email;
    if (!to) return false;
    const lines = await linesFor(inv.id, db);
    const html = invoiceHtml(inv, lines);
    const text = [
      `Invoice ${inv.number} — ${pricing.money(inv.gross_pence)}`,
      '',
      ...lines.map((l) => `${l.kind}${l.model ? ` (${l.model})` : ''} — ${pricing.money(l.retail_gross_pence)}`),
      '',
      `Net ${pricing.money(inv.net_pence)} + VAT ${pricing.money(inv.vat_pence)} = ${pricing.money(inv.gross_pence)}`,
      `Charged to your saved card once your balance reaches ${pricing.money(THRESHOLD_PENCE)} or after ${MAX_AGE_DAYS} days.`,
    ].join('\n');
    await send({ to, subject: `Your ScanSquad invoice ${inv.number} — ${pricing.money(inv.gross_pence)}`, text, html });
    await db.query('UPDATE squad_invoices SET emailed_at = NOW() WHERE id = $1', [inv.id]);
    return true;
  } catch (e) {
    console.error(`[SquadBilling] could not email ${inv.number}:`, e.message);
    return false;
  }
}

/**
 * A valid UK VAT invoice, as HTML (prints to PDF from any browser).
 *
 * HTML rather than a generated PDF on purpose: it emails inline, opens on a
 * phone, and prints to PDF when a creator needs a file for their accountant —
 * without adding a PDF toolchain to a server that does not otherwise need one.
 */
function invoiceHtml(inv, lines = []) {
  const row = (l) => `<tr>
      <td>${escapeHtml(l.kind || '')}${l.model ? ` <span class="muted">${escapeHtml(l.model)}</span>` : ''}</td>
      <td class="p">${escapeHtml((l.prompt || '').slice(0, 60))}</td>
      <td class="n">${pricing.money(l.retail_net_pence)}</td>
      <td class="n">${pricing.money(l.retail_gross_pence)}</td>
    </tr>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Invoice ${escapeHtml(inv.number)}</title>
<style>
 body{font:14px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;max-width:760px;margin:24px auto;padding:0 16px}
 h1{font-size:20px;margin:0 0 4px} .muted{color:#64748b;font-size:12px}
 table{width:100%;border-collapse:collapse;margin:18px 0}
 th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #e2e8f0;font-size:13px}
 .n{text-align:right;white-space:nowrap} .p{color:#475569}
 .tot{margin-left:auto;width:280px} .tot td{border:0;padding:4px 6px}
 .tot .big{font-weight:700;font-size:16px;border-top:2px solid #0f172a}
 .head{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
</style></head><body>
<div class="head">
  <div><h1>VAT invoice ${escapeHtml(inv.number)}</h1>
    <div class="muted">Issued ${new Date(inv.issued_on).toDateString()}</div></div>
  <div class="muted" style="text-align:right">
    <strong>ScanGym</strong><br>${escapeHtml(pricing.tradingAddress() || '').replace(/\n/g, '<br>')}<br>
    VAT ${escapeHtml(pricing.vatNumber() || '—')}</div>
</div>
<table><thead><tr><th>What</th><th>Prompt</th><th class="n">Net</th><th class="n">Total</th></tr></thead>
<tbody>${lines.map(row).join('')}</tbody></table>
<table class="tot">
  <tr><td>Net</td><td class="n">${pricing.money(inv.net_pence)}</td></tr>
  <tr><td>VAT @ ${Math.round((inv.vat_rate || 0) * 100)}%</td><td class="n">${pricing.money(inv.vat_pence)}</td></tr>
  <tr class="big"><td>Total</td><td class="n">${pricing.money(inv.gross_pence)}</td></tr>
</table>
<p class="muted">${inv.status === 'paid'
    ? 'Paid — thank you.'
    : `Charged to your saved card once your balance reaches ${pricing.money(THRESHOLD_PENCE)} or after ${MAX_AGE_DAYS} days. Prices include VAT.`}</p>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Run the billing sweep once a morning, in the founder's timezone.
 *
 * A wall-clock check on a coarse interval rather than a cron dependency: the
 * app already schedules its other background work this way, and the run is
 * idempotent, so the worst case of a missed or repeated tick is nothing.
 */
function scheduleDaily({ hour = Math.round(num(process.env.SQUAD_BILLING_HOUR, 7)), db = pool } = {}) {
  let lastRun = null;
  const tick = async () => {
    const now = new Date();
    const london = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/London' }));
    const day = london.toDateString();
    if (london.getHours() !== hour || lastRun === day) return;
    lastRun = day;
    try { await runDailyBilling(db); } catch (e) { console.error('[SquadBilling] daily run failed:', e.message); }
  };
  const timer = setInterval(tick, 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  gate,
  stateFor,
  unpaidPenceFor,
  capPenceFor,
  mandateFor,
  saveMandate,
  buildInvoices,
  linesFor,
  chargeInvoice,
  chargeDue,
  suspendOverdue,
  liftSuspensionIfClear,
  runDailyBilling,
  emailInvoice,
  invoiceHtml,
  scheduleDaily,
  THRESHOLD_PENCE,
  MAX_AGE_DAYS,
  SUSPEND_AFTER_DAYS,
};
