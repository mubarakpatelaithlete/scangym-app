/**
 * Pricing API Routes — Clean Slate v4.0
 * ═════════════════════════════════════
 *
 * GET /api/pricing/prices  → All pass prices for a gym's country
 *
 * Single source of truth: £4.49 GBP base, PPP + currency by gym country.
 */
const express = require('express');
const router = express.Router();
const pricing = require('../lib/pricing-engine');

/**
 * GET /api/pricing/prices
 *
 * Query params:
 *   ?country=GB   (gym's country — default GB)
 *   ?gymCountry=IN (alias — frontend may send this)
 */
router.get('/prices', (req, res) => {
  try {
    const countryCode = (
      req.query.gymCountry || req.query.country || 'GB'
    ).toUpperCase();

    const prices = pricing.getAllPassPrices({ countryCode });

    res.json({
      success: true,
      location: {
        country: countryCode,
        currency: prices.day.currency,
        symbol: prices.day.symbol,
      },
      prices: {
        day:     { amount: prices.day.amount,     display: prices.day.display,     stripeAmount: prices.day.stripeAmount },
        '3day':  { amount: prices['3day'].amount,  display: prices['3day'].display,  stripeAmount: prices['3day'].stripeAmount },
        weekly:  { amount: prices.weekly.amount,   display: prices.weekly.display,   stripeAmount: prices.weekly.stripeAmount },
        monthly: { amount: prices.monthly.amount,  display: prices.monthly.display,  stripeAmount: prices.monthly.stripeAmount },
      },
    });
  } catch (err) {
    console.error('Pricing error:', err);
    res.status(500).json({ error: 'Failed to calculate prices' });
  }
});

module.exports = router;
