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

// H16 fix: Pool for DB lookups (owner price floor)
let pool;
try { pool = require('../middleware/db'); } catch(e) { pool = null; }

/**
 * C7 fix: Currency based on GYM's physical country, not visitor IP.
 * Supports 1.2M+ gyms across 99 countries.
 * Frontend passes ?gymCountry=GB (or US, JP, etc.) derived from gym address.
 */
function getGymGeo(req) {
  // Use the gym's country if provided, otherwise default to GB
  const gymCountry = (req.query?.gymCountry || req.query?.country || 'GB').toUpperCase();
  const city = req.query?.city || '';
  return { country: gymCountry, city };
}

/**
 * GET /api/pricing/prices
 * Returns all pass prices for the user's detected location.
 * 
 * Query params (optional overrides):
 *   ?country=IN&city=Mumbai&time=14:00&date=2026-06-03&gymId=123
 */
router.get('/prices', async (req, res) => {
  try {
    const geo = getGymGeo(req);
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

    // H16 fix: Respect owner-set price floor
    // If the gym owner has set a minimum day pass price, ensure PPP/dynamic
    // pricing never drops below it. Owner floor stored in pence in gym_pricing.
    let ownerFloorPence = 0;
    if (gymId && pool) {
      try {
        const r = await pool.query(
          'SELECT day_pass_pence FROM gym_pricing WHERE gym_id = $1',
          [gymId]
        );
        if (r.rows.length > 0 && r.rows[0].day_pass_pence) {
          ownerFloorPence = parseInt(r.rows[0].day_pass_pence) || 0;
        }
      } catch (e) { /* table may not exist yet — ignore */ }
    }

    // Clamp day pass price to owner floor (if set)
    if (ownerFloorPence > 0) {
      const floorAmount = ownerFloorPence / 100;
      const sym = prices.day.symbol || '£';
      if (prices.day.amount < floorAmount) {
        prices.day.amount = floorAmount;
        prices.day.display = sym + floorAmount.toFixed(2);
        prices.day.stripeAmount = ownerFloorPence;
      }
    }
    
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
