/**
 * What a creator is allowed to spend on generation today.
 *
 * The problem this replaces. Create was open to anyone with the URL and capped
 * at "5 videos a day" per IP. Five clips is a meaningless unit: five Grok
 * Imagine clips cost us about $0.20 and five Seedance 2.5 clips cost $18.90 —
 * the same cap, a hundred times the bill — and an anonymous caller only had to
 * change IP to get another five. Verified on production on 2026-09-17: a
 * signed-out request rendered a $3.78 clip.
 *
 * So the unit is money, not clips, and it is attached to a creator rather than
 * to a network address. Two rules, both of which a creator can read off the
 * sheet before they tap Generate:
 *
 *   1. Signed in to generate. The route middleware enforces it
 *      (lib/gen-guard.js); this module prices what the signed-in creator may
 *      do. That also means their creations land in an account instead of a
 *      URL they lose when the tab closes.
 *   2. The budget grows with what they earn us. Every tier gets a floor, and
 *      every booking they have driven adds to it. A creator who has sent us
 *      nothing gets the cheap models; a creator who fills gyms gets Veo. We
 *      only spend real money on people who make it back, which is what makes
 *      the feature safe to leave switched on.
 *
 * Nothing here is a hard vendor gate: expensive models are not hidden, they
 * are simply unaffordable until the budget covers them, so the ladder is
 * visible and worth climbing. One mechanism, priced in the same dollars we are
 * billed in.
 *
 * @see routes/squad-create.js  GET /budget — what the sheet shows
 * @see lib/gen-guard.js        the login gate on every /generate
 */

const pool = require('../middleware/db');

/**
 * Daily floor by creator tier (USD). Tiers are creator_memberships.tier, the
 * same ladder the Creator dashboard shows: starter → rising → pro → legend.
 *
 * The starter floor is deliberately small but not zero: a new creator must be
 * able to try every cheap model in the sheet (a caption is $0.002, an image
 * $0.04, a Grok Imagine clip $0.10) and still not be able to burn a premium
 * render before they have driven a single booking.
 */
const TIER_FLOOR_USD = {
  starter: 0.6,
  rising: 3,
  pro: 10,
  legend: 25,
};

/** What one booking a creator has driven adds to their daily budget. */
const PER_CONVERSION_USD = num(process.env.SQUAD_BUDGET_PER_CONVERSION_USD, 0.25);

/** Nobody generates more than this in a day, whatever their numbers say. */
const MAX_DAILY_USD = num(process.env.SQUAD_DAILY_BUDGET_MAX_USD, 25);

/** Override the starter floor without a deploy, e.g. for a promo weekend. */
const STARTER_FLOOR_USD = num(process.env.SQUAD_STARTER_BUDGET_USD, TIER_FLOOR_USD.starter);

function num(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

function userIdOf(req) {
  return (req && req.user && (req.user.id || req.user.userId)) || (req && req.session && req.session.userId) || null;
}

function floorFor(tier) {
  if (tier === 'starter' || !tier) return STARTER_FLOOR_USD;
  return TIER_FLOOR_USD[tier] != null ? TIER_FLOOR_USD[tier] : STARTER_FLOOR_USD;
}

/**
 * The creator's standing with us: tier and bookings driven.
 * Returns null when the database cannot answer — see `degraded` in budgetFor.
 */
async function membershipFor(userId, db = pool) {
  try {
    const r = await db.query(
      `SELECT tier, COALESCE(total_referrals, 0)::int AS referrals,
              COALESCE(total_conversions, 0)::int AS conversions
         FROM creator_memberships
        WHERE user_id::text = $1::text
        LIMIT 1`,
      [String(userId)],
    );
    if (!r.rows.length) return { tier: 'starter', referrals: 0, conversions: 0, member: false };
    return { ...r.rows[0], tier: r.rows[0].tier || 'starter', member: true };
  } catch (e) {
    console.error('[SquadBudget] membership lookup failed:', e.message);
    return null;
  }
}

/**
 * What we have already been billed for this creator today, across every mode.
 * cost_usd is the quote taken at submit time, which is what we pay whether or
 * not the creator liked the result — a failed render still costs us.
 */
async function spentTodayUsd(userId, db = pool) {
  try {
    const r = await db.query(
      `SELECT COALESCE(SUM(cost_usd), 0)::float AS spent
         FROM squad_video_jobs
        WHERE user_id = $1 AND created_at >= date_trunc('day', NOW())`,
      [String(userId)],
    );
    return round(r.rows[0].spent || 0);
  } catch (e) {
    console.error('[SquadBudget] spend lookup failed:', e.message);
    return null;
  }
}

/**
 * Today's budget for whoever is on this request.
 *
 * `degraded: true` means the database could not answer. Callers then allow the
 * generation: refusing to work because the ledger is unreachable would turn a
 * database blip into a customer-facing outage, and the per-mode daily counts
 * in lib/gen-jobs.js still cap the damage. This is the same trade the rest of
 * the Create plumbing makes, on purpose.
 *
 * @returns {{signedIn, tier, conversions, dailyUsd, spentUsd, remainingUsd, degraded}}
 */
async function budgetFor(req, db = pool) {
  const userId = userIdOf(req);
  if (!userId) {
    return {
      signedIn: false,
      tier: null,
      conversions: 0,
      dailyUsd: 0,
      spentUsd: 0,
      remainingUsd: 0,
      degraded: false,
    };
  }

  const [member, spent] = await Promise.all([membershipFor(userId, db), spentTodayUsd(userId, db)]);
  const degraded = member === null || spent === null;
  const tier = (member && member.tier) || 'starter';
  const conversions = (member && member.conversions) || 0;
  const dailyUsd = round(Math.min(MAX_DAILY_USD, floorFor(tier) + PER_CONVERSION_USD * conversions));
  const spentUsd = spent || 0;

  const remainingUsd = round(Math.max(0, dailyUsd - spentUsd));
  return {
    signedIn: true,
    tier,
    conversions,
    dailyUsd,
    spentUsd,
    remainingUsd,
    /* The same allowance in the currency and at the prices the creator sees, so
       "£1.10 a clip" and "your allowance" are comparable numbers rather than one
       retail and one wholesale. */
    daily: money(dailyUsd),
    remaining: money(remainingUsd),
    degraded,
  };
}

/**
 * May this generation go ahead?
 *
 * @param budget      from budgetFor()
 * @param estimateUsd models.estimateUsd() for the chosen model, null when free
 * @returns null to allow, or { status, body } to refuse with
 */
function verdict(budget, estimateUsd) {
  /* An unpriced model is the house writer or a free path: nothing to charge
     against a budget, and refusing it would break the one mode every creator
     starts with. */
  if (estimateUsd == null || estimateUsd <= 0) return null;

  if (!budget.signedIn) {
    return {
      status: 401,
      body: {
        error: 'Sign in to create — it keeps your creations, and your earnings, on your account.',
        needsLogin: true,
      },
    };
  }

  /* Ledger unreachable: allow, and say so in the logs rather than to the
     creator. The daily per-mode counts are still in force. */
  if (budget.degraded) {
    console.warn('[SquadBudget] allowing a generation without a spend check — ledger unreachable');
    return null;
  }

  if (estimateUsd > budget.remainingUsd) {
    return {
      status: 402,
      body: {
        error: budget.spentUsd > 0
          ? `That model costs ${money(estimateUsd)} and you have ${money(budget.remainingUsd)} of today's credit left. Pick a cheaper model, or come back tomorrow.`
          : `That model costs ${money(estimateUsd)}, above your ${money(budget.dailyUsd)} daily credit. Every booking you drive adds ${money(PER_CONVERSION_USD)} to it — or pick one of the models you can run now.`,
        needsBudget: true,
        estimateUsd,
        budget,
      },
    };
  }
  return null;
}

/**
 * A number a creator can act on: the *price*, not our cost.
 *
 * This used to be `usd * 0.79`, i.e. the supplier's charge to us, printed in a
 * refusal message to the customer. Budgets are still reckoned in the dollars we
 * are billed in — that is what protects the business — but anything a creator
 * reads has to be what they would pay. @see lib/gen-pricing.js
 */
function money(usd) {
  const priced = require('./gen-pricing').retail(usd);
  return priced ? require('./gen-pricing').money(priced.grossPence) : 'nothing';
}

/**
 * Tag a catalogue with what this creator can actually run right now.
 *
 * The sheet keeps every model on screen and dims the ones out of reach, with
 * the reason attached: a hidden model teaches a creator nothing, an unaffordable
 * one tells them exactly what climbing a tier buys.
 */
function annotate(catalogue, budget) {
  const pricing = require('./gen-pricing');
  return (catalogue || []).map((m) => {
    const priced = m.estimateUsd != null && m.estimateUsd > 0;
    const affordable = !priced || budget.degraded || (budget.signedIn && m.estimateUsd <= budget.remainingUsd);
    /* The row leaves the server with a retail price and without our cost. The
       sheet used to receive estimateUsd and render it as the price (`* 0.79`),
       which quoted the creator our wholesale rate — a price at which ScanGym
       earns nothing, and a leak of supplier pricing into a browser. */
    const retail = pricing.retail(m.estimateUsd);
    const { estimateUsd, ...row } = m;
    return {
      ...row,
      pricePence: retail ? retail.grossPence : null,
      price: retail ? pricing.money(retail.grossPence) : null,
      vatIncluded: retail ? pricing.vatRegistered() : false,
      affordable,
      lockedReason: affordable ? null : (budget.signedIn ? 'budget' : 'sign_in'),
    };
  });
}

module.exports = {
  budgetFor,
  verdict,
  annotate,
  spentTodayUsd,
  membershipFor,
  TIER_FLOOR_USD,
  PER_CONVERSION_USD,
  MAX_DAILY_USD,
  _internals: { floorFor, money, userIdOf },
};
