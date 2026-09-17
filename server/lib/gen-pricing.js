/**
 * What a creator pays for a generation.
 *
 * Until now the Create sheet showed the creator our *wholesale* cost converted
 * to sterling (`estimateUsd * 0.79` in squad-create.js). That is the number we
 * are billed, not the number we sell at, so every chip in the sheet quoted a
 * price at which ScanGym makes exactly nothing — and printed our supplier
 * pricing on a customer's screen. This module is the only place that turns a
 * cost into a price, and every surface reads it from here.
 *
 * The three adjustments, in the order they apply:
 *
 *   1. Landed cost. The provider's list price is not what a render costs us:
 *      the card is billed in USD (~2–3% FX spread), a failed render is still
 *      invoiced, and the result is stored and served from R2/CDN. So cost is
 *      grossed up by SQUAD_LANDED_COST_FACTOR before any margin is taken.
 *      Multiplying margin over the raw provider price is the classic reseller
 *      mistake: at 2.0x it quietly turns a 50% margin into ~43%.
 *   2. Margin. SQUAD_PRICE_MULTIPLIER, default 2.0 — a 2x multiplier is a 50%
 *      margin (price 2, cost 1, keep 1 of 2). 1.5x would be a 33% margin, not
 *      50%, which is worth writing down because it is the number people mean
 *      to choose and rarely do.
 *   3. VAT. AIthlete is UK VAT-registered and creators generally are not, so
 *      they cannot reclaim it: the price they see must already include it.
 *      Prices are therefore published gross, with the net/VAT split kept for
 *      the invoice. Set SQUAD_VAT_NUMBER to switch VAT on; with no number
 *      there is nothing to charge VAT under, and none is added.
 *
 * Everything is integer pence from here on. Floating-point pounds are how
 * ledgers stop reconciling, and a price that rounds down to £0.00 would be a
 * render given away.
 *
 * @see lib/gen-models.js   estimateUsd() — the cost side
 * @see lib/gen-billing.js  what happens to the price after it is quoted
 */

const models = require('./gen-models');

function num(v, dflt) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

/** Provider list price → what the render actually costs us. */
const LANDED_FACTOR = num(process.env.SQUAD_LANDED_COST_FACTOR, 1.15);

/** Margin multiplier on landed cost. 2.0 = 50% margin. */
const MULTIPLIER = num(process.env.SQUAD_PRICE_MULTIPLIER, 2.0);

/** UK standard rate, overridable for a rate change rather than a deploy. */
const VAT_RATE = num(process.env.SQUAD_VAT_RATE, 0.2);

/** USD→GBP. A rate, not a truth: reconcile against the card statement. */
const USD_GBP = num(process.env.SQUAD_USD_GBP, 0.79);

/** Nothing sells for nothing: the floor for a priced render. */
const MIN_NET_PENCE = 1;

/**
 * VAT is only charged when there is a registration number to charge it under.
 * Also what the invoice template keys off — an invoice claiming VAT without a
 * VAT number is not a valid VAT invoice.
 */
function vatNumber() {
  return (process.env.SQUAD_VAT_NUMBER || '').trim() || null;
}

function tradingAddress() {
  return (process.env.SQUAD_TRADING_ADDRESS || '').trim() || null;
}

function vatRegistered() {
  return !!vatNumber();
}

/** Can we legally issue an invoice yet? Missing details are a config problem. */
function invoicingReady() {
  const missing = [];
  if (!vatNumber()) missing.push('SQUAD_VAT_NUMBER');
  if (!tradingAddress()) missing.push('SQUAD_TRADING_ADDRESS');
  return { ready: missing.length === 0, missing };
}

/**
 * Cost in USD → the price a creator pays, in pence.
 *
 * @param {number|null} costUsd  models.estimateUsd(), null when unpriced
 * @returns {{netPence, vatPence, grossPence}|null} null when there is nothing
 *          to charge — callers must treat null as "free", never as zero-priced,
 *          because an unpriced model is the house writer, not a giveaway.
 */
function retail(costUsd) {
  if (costUsd == null || !(costUsd > 0)) return null;
  const netPence = Math.max(
    MIN_NET_PENCE,
    Math.ceil(costUsd * LANDED_FACTOR * MULTIPLIER * USD_GBP * 100),
  );
  const vatPence = vatRegistered() ? Math.round(netPence * VAT_RATE) : 0;
  return { netPence, vatPence, grossPence: netPence + vatPence };
}

/** "£3.70", "7p" — the way a price reads on a chip. */
function money(pence) {
  if (pence == null) return null;
  const p = Math.round(pence);
  return p < 100 ? `${p}p` : `£${(p / 100).toFixed(2)}`;
}

/**
 * The price for a model + units, ready to put on a chip or in a confirm line.
 * Returns nulls (not zeros) for an unpriced model.
 */
function quote(model, units = {}) {
  const costUsd = models.estimateUsd(model, units);
  const r = retail(costUsd);
  if (!r) return { costUsd, netPence: null, vatPence: null, grossPence: null, price: null };
  return {
    costUsd,
    ...r,
    price: money(r.grossPence),
    vatIncluded: vatRegistered(),
  };
}

/**
 * The catalogue as a customer may see it: retail price attached, cost stripped.
 *
 * Deliberately drops `estimateUsd`. Leaving it on the row is how our supplier
 * pricing ended up rendered in a creator's browser in the first place, and any
 * client that wants a number now gets the one we sell at.
 */
function pricedCatalogue(kind, units = {}) {
  return models.catalogueFor(kind, units).map((row) => {
    const r = retail(row.estimateUsd);
    const { estimateUsd, ...rest } = row;
    return {
      ...rest,
      pricePence: r ? r.grossPence : null,
      priceNetPence: r ? r.netPence : null,
      price: r ? money(r.grossPence) : null,
      vatIncluded: r ? vatRegistered() : false,
    };
  });
}

module.exports = {
  retail,
  quote,
  money,
  pricedCatalogue,
  vatNumber,
  tradingAddress,
  vatRegistered,
  invoicingReady,
  MULTIPLIER,
  LANDED_FACTOR,
  VAT_RATE,
  USD_GBP,
};
