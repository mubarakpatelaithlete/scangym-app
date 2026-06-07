/**
 * Pricing API Routes
 * ═════════════════
 * 
 * GET  /api/pricing/prices   → Get all pass prices for user's location
 * GET  /api/pricing/surge    → Get current surge status for a gym
 * 
 * Used by the frontend to display localized, dynamic prices.
 */
const express = require('express');
const router = express.Router();
const pricing = require('../lib/pricing-engine');
const surge = require('../lib/surge-pricing');

/**
 * Extract geo from request (same as payment.js)
 */
function getGeoFromRequest(req) {
  // UK-only launch: all gyms are in the UK, Stripe account is GBP.
  // Always return GB to ensure prices display in £. When expanding
  // internationally, revisit this to use geo-detection again.
  // Priority: query params > Cloudflare headers > geoip > default GB
  if (req.query?.country) return { country: req.query.country.toUpperCase(), city: req.query.city || '' };
  const cfCountry = req.headers['cf-ipcountry'];
  const cfCity = req.headers['cf-ipcity'];
  if (cfCountry && cfCountry !== 'XX') return { country: cfCountry.toUpperCase(), city: cfCity || '' };
  // Default to GB for UK-only launch (geoip can misdetect VPN/proxy users)
  return { country: 'GB', city: '' };
}

/**
 * GET /api/pricing/prices
 * Returns all pass prices for the user's detected location.
 * 
 * Query params (optional overrides):
 *   ?country=IN&city=Mumbai&time=14:00&date=2026-06-03&gymId=123
 */
router.get('/prices', (req, res) => {
  try {
    const geo = getGeoFromRequest(req);
    const gymId = req.query.gymId;
    const demandFactor = gymId ? surge.getDemandFactor(gymId) : 1.0;
    
    const params = {
      countryCode: geo.country,
      city: geo.city,
      time: req.query.time || null,
      date: req.query.date || null,
      demandFactor,
    };
    
    const prices = pricing.getAllPassPrices(params);
    const surgeDisplay = surge.getSurgeDisplay(demandFactor);
    
    res.json({
      success: true,
      location: {
        country: geo.country,
        city: geo.city,
        currency: prices.day.currency,
        symbol: prices.day.symbol,
      },
      surge: surgeDisplay,
      prices: {
        day: {
          amount: prices.day.amount,
          display: prices.day.display,
          stripeAmount: prices.day.stripeAmount,
        },
        '3day': {
          amount: prices['3day'].amount,
          display: prices['3day'].display,
          stripeAmount: prices['3day'].stripeAmount,
        },
        weekly: {
          amount: prices.weekly.amount,
          display: prices.weekly.display,
          stripeAmount: prices.weekly.stripeAmount,
        },
        monthly: {
          amount: prices.monthly.amount,
          display: prices.monthly.display,
          stripeAmount: prices.monthly.stripeAmount,
        },
      },
    });
  } catch (err) {
    console.error('Pricing error:', err);
    res.status(500).json({ error: 'Failed to calculate prices' });
  }
});

/**
 * GET /api/pricing/surge?gymId=123
 * Returns current surge status for a specific gym.
 */
router.get('/surge', (req, res) => {
  const { gymId } = req.query;
  if (!gymId) return res.status(400).json({ error: 'gymId required' });
  
  const factor = surge.getDemandFactor(gymId);
  res.json({
    success: true,
    gymId,
    ...surge.getSurgeDisplay(factor),
  });
});

module.exports = router;
