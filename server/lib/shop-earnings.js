/**
 * How a Shop sale is split, in one place.
 *
 * Everything is integer pence. A 30% platform fee on £4.99 is 149.7p, and the
 * only question that matters is who gets the rounding: the creator does. The
 * two halves always add back to exactly what the customer paid — an invariant
 * the tests check with fuzzed amounts, because "close enough" here is money
 * that exists in one table and not the other.
 */
const PLATFORM_FEE_PERCENT = Number.parseInt(process.env.SHOP_PLATFORM_FEE_PERCENT || '30', 10);

const MIN_PRICE_PENCE = 100;      // £1.00 — below this Stripe's fee eats the sale
const MAX_PRICE_PENCE = 50000;    // £500 — a digital PDF priced above this is a mistake

function splitEarnings(amountPence, feePercent = PLATFORM_FEE_PERCENT) {
  const amount = Math.round(Number(amountPence) || 0);
  const percent = Math.min(Math.max(Number(feePercent) || 0, 0), 100);
  if (amount <= 0) return { platformFeePence: 0, creatorEarningsPence: 0 };
  const platformFeePence = Math.floor((amount * percent) / 100);
  return { platformFeePence, creatorEarningsPence: amount - platformFeePence };
}

/** Returns an error string, or null when the price is sane. */
function validatePrice(pricePence) {
  const value = Math.round(Number(pricePence));
  if (!Number.isFinite(value) || value < MIN_PRICE_PENCE) return 'Price must be at least £1.00';
  if (value > MAX_PRICE_PENCE) return 'Price cannot be more than £500.00';
  return null;
}

function formatPence(pence, currency = 'GBP') {
  const symbol = currency === 'USD' ? '$' : currency === 'EUR' ? '€' : '£';
  return symbol + (Math.round(Number(pence) || 0) / 100).toFixed(2);
}

module.exports = {
  splitEarnings,
  validatePrice,
  formatPence,
  PLATFORM_FEE_PERCENT,
  MIN_PRICE_PENCE,
  MAX_PRICE_PENCE,
};
