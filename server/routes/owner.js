/**
 * Task 22: Gym Owner 1-Click Price Setting — CORRECTED
 * Task 12: CORRECTED — "Remove per session price completely, only 24-hour day pass.
 *           QR code works only 2 times: one for going in, one for going out.
 *           Then expires if scanned 2 times, like JD Gym."
 * Task 7: BNPL info
 *
 * Pricing model is FIXED to 24hr day pass only. No per-session option.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// Ensure pricing table — CORRECTED: 24hr model only
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_pricing (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        pricing_model VARCHAR(30) DEFAULT '24hr_day_pass',
        day_pass_pence INTEGER NOT NULL DEFAULT 500,
        weekly_pass_pence INTEGER,
        monthly_pass_pence INTEGER,
        peak_multiplier DECIMAL DEFAULT 1.0,
        off_peak_discount_pct INTEGER DEFAULT 0,
        student_discount_pct INTEGER DEFAULT 0,
        first_visit_discount_pct INTEGER DEFAULT 50,
        bnpl_enabled BOOLEAN DEFAULT false,
        wallet_accepted BOOLEAN DEFAULT true,
        currency VARCHAR(3) DEFAULT 'GBP',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(gym_id)
      )
    `);
    console.log('Gym pricing table ready (24hr model only)');
  } catch (err) {
    console.error('Pricing table creation error:', err.message);
  }
})();

// Verify ownership middleware
async function verifyOwner(req, res, next) {
  try {
    const gymId = parseInt(req.params.gymId || req.body.gymId);
    if (!gymId) return res.status(400).json({ error: 'gymId is required' });
    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text', [gymId, req.user.id]);
    if (gym.rows.length === 0) return res.status(403).json({ error: 'You do not own this gym' });
    req.gym = gym.rows[0];
    req.gymId = gymId;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Ownership check failed' });
  }
}

router.use(authenticateUser);

// GET /api/owner/gyms
router.get('/gyms', async (req, res) => {
  try {
    // Use text cast to handle UUID vs integer type mismatch on claimed_by column
    const result = await pool.query('SELECT * FROM gyms WHERE claimed_by::text = $1::text', [req.user.id]);
    res.json({ gyms: result.rows });
  } catch (err) {
    // If claimed_by column doesn't exist or any other issue, return empty array
    console.error('Owner gyms error:', err.message);
    res.json({ gyms: [] });
  }
});

// GET /api/owner/pricing/:gymId
router.get('/pricing/:gymId', verifyOwner, async (req, res) => {
  try {
    let pricing = await pool.query('SELECT * FROM gym_pricing WHERE gym_id = $1', [req.gymId]);
    if (pricing.rows.length === 0) {
      return res.json({
        pricing: {
          gymId: req.gymId,
          pricingModel: '24hr_day_pass',
          dayPassPrice: req.gym.day_pass_price || 5.00,
          weeklyPassPrice: null,
          monthlyPassPrice: null,
          peakMultiplier: 1.0,
          offPeakDiscountPct: 0,
          studentDiscountPct: 0,
          firstVisitDiscountPct: 50,
          bnplEnabled: false,
          walletAccepted: true,
          currency: 'GBP',
        },
        isDefault: true,
        note: 'CORRECTION: Per-session pricing removed. All gyms use 24-hour day pass only. QR code allows entry scan + exit scan (2 scans max, like JD Gym).',
      });
    }
    const p = pricing.rows[0];
    res.json({
      pricing: {
        gymId: p.gym_id,
        pricingModel: '24hr_day_pass',
        dayPassPrice: p.day_pass_pence ? p.day_pass_pence / 100 : null,
        weeklyPassPrice: p.weekly_pass_pence ? p.weekly_pass_pence / 100 : null,
        monthlyPassPrice: p.monthly_pass_pence ? p.monthly_pass_pence / 100 : null,
        peakMultiplier: parseFloat(p.peak_multiplier),
        offPeakDiscountPct: p.off_peak_discount_pct,
        studentDiscountPct: p.student_discount_pct,
        firstVisitDiscountPct: p.first_visit_discount_pct,
        bnplEnabled: p.bnpl_enabled,
        walletAccepted: p.wallet_accepted,
        currency: p.currency,
      },
      isDefault: false,
      qrPolicy: {
        maxScans: 2,
        scanTypes: ['entry', 'exit'],
        expiresAfter: '2 scans or 24 hours (whichever comes first)',
        model: 'JD Gym style',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pricing' });
  }
});

// PUT /api/owner/pricing/:gymId — 1-Click Price Setting (24hr ONLY)
router.put('/pricing/:gymId', verifyOwner, async (req, res) => {
  try {
    const {
      dayPassPrice, weeklyPassPrice, monthlyPassPrice,
      peakMultiplier, offPeakDiscountPct, studentDiscountPct, firstVisitDiscountPct,
      bnplEnabled, walletAccepted
    } = req.body;

    if (!dayPassPrice || dayPassPrice <= 0) {
      return res.status(400).json({ error: 'dayPassPrice is required and must be positive' });
    }

    // CORRECTION: Force 24hr model — no per-session option
    const result = await pool.query(`
      INSERT INTO gym_pricing (
        gym_id, pricing_model, day_pass_pence, weekly_pass_pence, monthly_pass_pence,
        peak_multiplier, off_peak_discount_pct, student_discount_pct, first_visit_discount_pct,
        bnpl_enabled, wallet_accepted, updated_at
      ) VALUES ($1, '24hr_day_pass', $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (gym_id) DO UPDATE SET
        pricing_model = '24hr_day_pass',
        day_pass_pence = $2,
        weekly_pass_pence = $3,
        monthly_pass_pence = $4,
        peak_multiplier = COALESCE($5, gym_pricing.peak_multiplier),
        off_peak_discount_pct = COALESCE($6, gym_pricing.off_peak_discount_pct),
        student_discount_pct = COALESCE($7, gym_pricing.student_discount_pct),
        first_visit_discount_pct = COALESCE($8, gym_pricing.first_visit_discount_pct),
        bnpl_enabled = COALESCE($9, gym_pricing.bnpl_enabled),
        wallet_accepted = COALESCE($10, gym_pricing.wallet_accepted),
        updated_at = NOW()
      RETURNING *
    `, [
      req.gymId,
      Math.round(dayPassPrice * 100),
      weeklyPassPrice ? Math.round(weeklyPassPrice * 100) : null,
      monthlyPassPrice ? Math.round(monthlyPassPrice * 100) : null,
      peakMultiplier || 1.0,
      offPeakDiscountPct || 0,
      studentDiscountPct || 0,
      firstVisitDiscountPct != null ? firstVisitDiscountPct : 50,
      bnplEnabled || false,
      walletAccepted != null ? walletAccepted : true,
    ]);

    // Update main gyms table
    await pool.query('UPDATE gyms SET day_pass_price = $1, updated_at = NOW() WHERE id = $2', [dayPassPrice, req.gymId]);

    res.json({
      success: true,
      message: '24-hour day pass price updated!',
      pricing: result.rows[0],
      qrPolicy: {
        maxScans: 2,
        scanTypes: ['entry', 'exit'],
        note: 'QR code expires after 2 scans (entry + exit) or 24 hours',
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update pricing' });
  }
});

// POST /api/owner/pricing/:gymId/quick — Quick price templates (24hr ONLY)
router.post('/pricing/:gymId/quick', verifyOwner, async (req, res) => {
  try {
    const { template } = req.body;
    // CORRECTED: All templates are 24hr day pass only
    const templates = {
      budget: { dayPassPrice: 5, firstVisitDiscount: 50, description: '£5/24hr day pass — Budget-friendly, high-volume gyms' },
      standard: { dayPassPrice: 10, firstVisitDiscount: 30, description: '£10/24hr day pass — Standard community gyms' },
      premium: { dayPassPrice: 15, firstVisitDiscount: 20, description: '£15/24hr day pass — Premium facilities' },
      boutique: { dayPassPrice: 25, firstVisitDiscount: 25, description: '£25/24hr day pass — Boutique/specialist studios' },
    };

    const t = templates[template];
    if (!t) {
      return res.status(400).json({
        error: 'Invalid template',
        available: Object.keys(templates),
        descriptions: Object.fromEntries(Object.entries(templates).map(([k, v]) => [k, v.description])),
        note: 'All templates use 24-hour day pass pricing. Per-session pricing has been removed.',
      });
    }

    await pool.query(`
      INSERT INTO gym_pricing (gym_id, pricing_model, day_pass_pence, first_visit_discount_pct, updated_at)
      VALUES ($1, '24hr_day_pass', $2, $3, NOW())
      ON CONFLICT (gym_id) DO UPDATE SET
        pricing_model = '24hr_day_pass', day_pass_pence = $2, first_visit_discount_pct = $3, updated_at = NOW()
    `, [req.gymId, t.dayPassPrice * 100, t.firstVisitDiscount]);

    await pool.query('UPDATE gyms SET day_pass_price = $1, updated_at = NOW() WHERE id = $2',
      [t.dayPassPrice, req.gymId]);

    res.json({
      success: true,
      message: `Applied "${template}" pricing — £${t.dayPassPrice} per 24hr day pass`,
      pricing: { pricingModel: '24hr_day_pass', dayPassPrice: t.dayPassPrice, firstVisitDiscount: t.firstVisitDiscount },
      qrPolicy: { maxScans: 2, model: 'JD Gym style: entry scan + exit scan, then QR expires' },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to apply template' });
  }
});

// GET /api/owner/bnpl-info — Task 7: BNPL info
router.get('/bnpl-info', async (req, res) => {
  res.json({
    pricingModel: '24hr_day_pass',
    note: 'Per-session pricing removed. All bookings are 24-hour day passes with 2-scan QR (entry + exit).',
    bnplProviders: [
      {
        name: 'Klarna',
        description: 'Pay in 3 interest-free instalments',
        minAmount: 10,
        maxAmount: 500,
        status: 'coming_soon',
        integrationUrl: 'https://www.klarna.com/uk/business/',
      },
      {
        name: 'Clearpay',
        description: 'Pay in 4 fortnightly payments',
        minAmount: 10,
        maxAmount: 600,
        status: 'coming_soon',
        integrationUrl: 'https://www.clearpay.co.uk/for-retailers',
      },
    ],
    walletPayment: {
      name: 'ScanGym Wallet',
      description: 'Pre-loaded credits with bonus top-ups (10-15% extra)',
      status: 'active',
      endpoint: '/api/wallet',
    },
  });
});

// ═══ PHASE 4: Open/Close Toggle ═══
// POST /api/owner/toggle/:gymId — Toggle gym open/closed for bookings
router.post('/toggle/:gymId', verifyOwner, async (req, res) => {
  try {
    const { isOpen } = req.body;
    if (typeof isOpen !== 'boolean') return res.status(400).json({ error: 'isOpen (boolean) required' });

    await pool.query(
      'UPDATE gyms SET is_accepting_bookings = $1, updated_at = NOW() WHERE id = $2',
      [isOpen, req.gymId]
    );

    // Track toggle history for 3-strike system
    await pool.query(`
      INSERT INTO gym_toggle_log (gym_id, owner_id, action, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [req.gymId, req.user.id, isOpen ? 'opened' : 'closed']).catch(() => {});

    // Check 3-strike: count closures in last 30 days
    const strikes = await pool.query(`
      SELECT COUNT(*) as close_count FROM gym_toggle_log
      WHERE gym_id = $1 AND action = 'closed' AND created_at > NOW() - INTERVAL '30 days'
    `, [req.gymId]).catch(() => ({ rows: [{ close_count: 0 }] }));

    const closeCount = parseInt(strikes.rows[0]?.close_count || 0);
    let warning = null;
    if (closeCount >= 3) {
      warning = 'Warning: Your gym has been closed ' + closeCount + ' times this month. Frequent closures may affect your ranking.';
    }

    res.json({ success: true, isOpen, warning, closuresThisMonth: closeCount });
  } catch (err) {
    console.error('Toggle error:', err.message);
    res.status(500).json({ error: 'Failed to toggle gym status' });
  }
});

// ═══ PHASE 4: Price Limits (Amazon-style) ═══
// PUT /api/owner/price-limits/:gymId — Set price floor and ceiling
router.put('/price-limits/:gymId', verifyOwner, async (req, res) => {
  try {
    const { dayPassPence } = req.body;
    // Amazon-style guardrails: ScanGym sets min £3 and max £25 for day passes
    const MIN_PRICE = 300; // £3.00 in pence
    const MAX_PRICE = 2500; // £25.00 in pence

    if (!dayPassPence || dayPassPence < MIN_PRICE || dayPassPence > MAX_PRICE) {
      return res.status(400).json({
        error: `Price must be between £${(MIN_PRICE/100).toFixed(2)} and £${(MAX_PRICE/100).toFixed(2)}`,
        min: MIN_PRICE,
        max: MAX_PRICE
      });
    }

    await pool.query(
      'UPDATE gym_pricing SET day_pass_pence = $1, updated_at = NOW() WHERE gym_id = $2',
      [dayPassPence, req.gymId]
    );

    res.json({ success: true, price: (dayPassPence / 100).toFixed(2), currency: 'GBP' });
  } catch (err) {
    console.error('Price update error:', err.message);
    res.status(500).json({ error: 'Failed to update price' });
  }
});

// Create toggle log table
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_toggle_log (
        id SERIAL PRIMARY KEY,
        gym_id INTEGER NOT NULL,
        owner_id VARCHAR(255) NOT NULL,
        action VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
  } catch (err) { /* table may already exist */ }
})();

module.exports = router;
