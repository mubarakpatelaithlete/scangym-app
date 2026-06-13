/**
 * Pricing API Routes — Clean Slate v4.0
 * ═════════════════════════════════════
 *
 * GET /api/pricing/prices      → All pass prices for a country
 * GET /api/pricing/gym-price   → Authoritative price for a specific gym (S4-C03 fix)
 *
 * Single source of truth: £4.49 GBP base, PPP + currency by gym country.
 */
const express = require('express');
const router = express.Router();
const pricing = require('../lib/pricing-engine');
const pool = require('../middleware/db');

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

/**
 * GET /api/pricing/gym-price
 * S4-C03 FIX: Authoritative gym-specific pricing endpoint.
 * Frontend checkout calls this to get the EXACT price the server will charge.
 * Eliminates frontend/backend price divergence.
 *
 * Query params:
 *   ?gymId=123       (required — database gym ID or placeId)
 *   ?placeId=ChIJ... (alternative — Google Places ID)
 *   ?passType=day    (optional — 'day' | '3day' | 'weekly' | 'monthly')
 *   ?referral=handle (optional — referral code for discount)
 */
router.get('/gym-price', async (req, res) => {
  try {
    const { gymId, placeId, passType, referral } = req.query;

    if (!gymId && !placeId) {
      return res.status(400).json({ error: 'gymId or placeId required' });
    }

    // Look up gym from DB
    let gymResult;
    if (gymId && !isNaN(parseInt(gymId))) {
      gymResult = await pool.query(
        'SELECT id, name, country, day_pass_price FROM gyms WHERE id = $1',
        [gymId]
      );
    } else if (placeId) {
      gymResult = await pool.query(
        'SELECT id, name, country, day_pass_price FROM gyms WHERE place_id = $1',
        [placeId]
      );
    } else {
      gymResult = await pool.query(
        'SELECT id, name, country, day_pass_price FROM gyms WHERE place_id = $1',
        [gymId]
      );
    }

    // Fallback to GB if gym not found (auto-created gyms)
    const gym = gymResult.rows[0] || { country: 'GB', day_pass_price: null };
    const cleanPassType = (passType || 'day').toLowerCase();

    // Calculate all pass prices using gym's country + owner price
    const passTypes = ['day', '3day', 'weekly', 'monthly'];
    const prices = {};
    for (const pt of passTypes) {
      prices[pt] = pricing.calculateGymPrice({
        gymDayPassPrice: gym.day_pass_price,
        countryCode: gym.country || 'GB',
        passType: pt,
      });
    }

    // S4-C11 FIX: Apply referral discount (15%) if referral code is active
    let referralDiscount = null;
    if (referral) {
      const REFERRAL_DISCOUNT_PERCENT = 15;
      const targetPrice = prices[cleanPassType] || prices.day;
      const discountAmount = parseFloat((targetPrice.amount * REFERRAL_DISCOUNT_PERCENT / 100).toFixed(2));
      const discountedAmount = parseFloat((targetPrice.amount - discountAmount).toFixed(2));
      referralDiscount = {
        code: referral,
        percent: REFERRAL_DISCOUNT_PERCENT,
        discountAmount,
        discountedPrice: discountedAmount,
        discountDisplay: `${targetPrice.symbol}${discountAmount.toFixed(2)}`,
        finalDisplay: `${targetPrice.symbol}${discountedAmount.toFixed(2)}`,
      };
    }

    const mainPrice = prices[cleanPassType] || prices.day;

    res.json({
      success: true,
      gymId: gym.id || null,
      location: {
        country: gym.country || 'GB',
        currency: mainPrice.currency,
        symbol: mainPrice.symbol,
      },
      prices: {
        day:     { amount: prices.day.amount,     display: prices.day.display,     stripeAmount: prices.day.stripeAmount },
        '3day':  { amount: prices['3day'].amount,  display: prices['3day'].display,  stripeAmount: prices['3day'].stripeAmount },
        weekly:  { amount: prices.weekly.amount,   display: prices.weekly.display,   stripeAmount: prices.weekly.stripeAmount },
        monthly: { amount: prices.monthly.amount,  display: prices.monthly.display,  stripeAmount: prices.monthly.stripeAmount },
      },
      referralDiscount,
    });
  } catch (err) {
    console.error('Gym price error:', err);
    res.status(500).json({ error: 'Failed to calculate gym price' });
  }
});

module.exports = router;
