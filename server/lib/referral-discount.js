/**
 * Shared referral discount logic.
 * Consolidates the 15% referral discount calculation duplicated
 * across booking.js and payment.js routes.
 */

const REFERRAL_DISCOUNT_PERCENT = 15;
const MINIMUM_PRICE = 0.50;

/**
 * Apply referral discount to a price if a referral code is present.
 *
 * @param {number} price - Original price (in major currency units, e.g. pounds)
 * @param {string|null|undefined} referralCode - The referral/creator code
 * @param {object} [opts] - Optional config
 * @param {string} [opts.currencySymbol='£'] - Currency symbol for logging
 * @param {string} [opts.context='Booking'] - Label for console log
 * @returns {{ price: number, appliedDiscount: object|null }}
 */
function applyReferralDiscount(price, referralCode, opts = {}) {
  if (!referralCode) {
    return { price, appliedDiscount: null };
  }

  const { currencySymbol = '£', context = 'Booking' } = opts;
  const discountAmount = parseFloat((price * REFERRAL_DISCOUNT_PERCENT / 100).toFixed(2));
  const discountedPrice = parseFloat(Math.max(price - discountAmount, MINIMUM_PRICE).toFixed(2));
  const appliedDiscount = {
    percent: REFERRAL_DISCOUNT_PERCENT,
    saved: discountAmount,
    code: referralCode,
  };

  console.log(
    `[${context}] Referral discount: ${REFERRAL_DISCOUNT_PERCENT}% off → ` +
    `${currencySymbol}${discountedPrice} (saved ${currencySymbol}${discountAmount}) via "${referralCode}"`
  );

  return { price: discountedPrice, appliedDiscount };
}

module.exports = {
  REFERRAL_DISCOUNT_PERCENT,
  MINIMUM_PRICE,
  applyReferralDiscount,
};
