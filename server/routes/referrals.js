const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

// ═══════════════════════════════════════════════════════════════════
//  REFERRAL + COMMISSION PIPELINE
//  End-to-end: track affiliate clicks → apply discount → credit commission
// ═══════════════════════════════════════════════════════════════════

// Ensure tables exist on startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_referrals (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        creator_email VARCHAR(200),
        visitor_session VARCHAR(200),
        booking_id INTEGER,
        commission_pence INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'clicked',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        converted_at TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_referrals_handle
      ON creator_referrals(creator_handle)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_referrals_status
      ON creator_referrals(status)
    `);
    // Add referral_code column to bookings if it doesn't exist
    await pool.query(`
      ALTER TABLE public.bookings
      ADD COLUMN IF NOT EXISTS referral_code VARCHAR(100)
    `);
    console.log('[Referrals] Tables ready');
  } catch (err) {
    console.error('[Referrals] Table init error:', err.message);
  }
})();

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/track
//  Records when someone clicks an affiliate link (scangym.com/r/handle)
// ─────────────────────────────────────────────────────────────────
router.post('/track', async (req, res) => {
  try {
    const { creatorHandle, visitorSession } = req.body;
    if (!creatorHandle) {
      return res.status(400).json({ error: 'creatorHandle is required' });
    }

    // Look up creator email from creator_memberships via landing pages
    let creatorEmail = null;
    try {
      const lp = await pool.query(
        `SELECT cm.user_id, lp.creator_name
         FROM creator_landing_pages lp
         JOIN creator_memberships cm ON lp.creator_user_id = cm.user_id
         WHERE lp.slug = $1 LIMIT 1`,
        [creatorHandle]
      );
      if (lp.rows.length > 0) {
        // Try to get email from users table
        const user = await pool.query('SELECT email FROM public.users WHERE id = $1', [lp.rows[0].user_id]);
        if (user.rows.length > 0) creatorEmail = user.rows[0].email;
      }
    } catch (e) {
      // Non-critical — we can track without email
    }

    const result = await pool.query(
      `INSERT INTO creator_referrals (creator_handle, creator_email, visitor_session, status)
       VALUES ($1, $2, $3, 'clicked')
       RETURNING id`,
      [creatorHandle, creatorEmail, visitorSession || null]
    );

    // Increment total_referrals on creator_memberships
    try {
      await pool.query(
        `UPDATE creator_memberships SET total_referrals = total_referrals + 1
         WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1)`,
        [creatorHandle]
      );
    } catch (e) {
      // Non-critical
    }

    res.json({ success: true, referralId: result.rows[0].id });
  } catch (err) {
    console.error('[Referrals] Track error:', err.message);
    res.status(500).json({ error: 'Failed to track referral' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/convert
//  Credits commission to creator when a referred booking is paid.
//  Called from payment.js confirm-intent after Stripe payment succeeds.
// ─────────────────────────────────────────────────────────────────
router.post('/convert', async (req, res) => {
  try {
    const { creatorHandle, bookingId, commissionPence } = req.body;
    if (!creatorHandle || !bookingId) {
      return res.status(400).json({ error: 'creatorHandle and bookingId required' });
    }

    const commission = commissionPence || 125; // Default £1.25 = 125 pence

    // Update the most recent 'clicked' referral for this creator to 'converted'
    const updated = await pool.query(
      `UPDATE creator_referrals
       SET status = 'converted', booking_id = $1, commission_pence = $2, converted_at = NOW()
       WHERE id = (
         SELECT id FROM creator_referrals
         WHERE creator_handle = $3 AND status = 'clicked'
         ORDER BY created_at DESC LIMIT 1
       )
       RETURNING id`,
      [bookingId, commission, creatorHandle]
    );

    if (updated.rows.length === 0) {
      // No matching click found — create a direct conversion record
      await pool.query(
        `INSERT INTO creator_referrals (creator_handle, booking_id, commission_pence, status, converted_at)
         VALUES ($1, $2, $3, 'converted', NOW())`,
        [creatorHandle, bookingId, commission]
      );
    }

    // Update creator_memberships totals
    try {
      await pool.query(
        `UPDATE creator_memberships
         SET total_earnings_pence = total_earnings_pence + $1,
             total_conversions = total_conversions + 1
         WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $2 LIMIT 1)`,
        [commission, creatorHandle]
      );
    } catch (e) {
      console.error('[Referrals] Failed to update creator earnings:', e.message);
    }

    console.log(`[Referrals] Commission credited: ${commission}p to ${creatorHandle} for booking ${bookingId}`);
    res.json({ success: true, commissionPence: commission });
  } catch (err) {
    console.error('[Referrals] Convert error:', err.message);
    res.status(500).json({ error: 'Failed to credit commission' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/earnings/:handle
//  Returns creator's earnings data for the dashboard
// ─────────────────────────────────────────────────────────────────
router.get('/earnings/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    // Total stats
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'clicked') as total_clicks,
         COUNT(*) FILTER (WHERE status = 'converted') as total_conversions,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0) as total_earnings_pence
       FROM creator_referrals
       WHERE creator_handle = $1`,
      [handle]
    );

    // Recent conversions (last 20)
    const recent = await pool.query(
      `SELECT cr.booking_id, cr.commission_pence, cr.converted_at,
              b.gym_id, g.name as gym_name
       FROM creator_referrals cr
       LEFT JOIN public.bookings b ON cr.booking_id = b.id
       LEFT JOIN public.gyms g ON b.gym_id = g.id
       WHERE cr.creator_handle = $1 AND cr.status = 'converted'
       ORDER BY cr.converted_at DESC LIMIT 20`,
      [handle]
    );

    const s = stats.rows[0];
    const conversionRate = parseInt(s.total_clicks) > 0
      ? ((parseInt(s.total_conversions) / parseInt(s.total_clicks)) * 100).toFixed(1)
      : '0.0';

    res.json({
      success: true,
      handle,
      totalClicks: parseInt(s.total_clicks),
      totalConversions: parseInt(s.total_conversions),
      totalEarningsPence: parseInt(s.total_earnings_pence),
      totalEarnings: (parseInt(s.total_earnings_pence) / 100).toFixed(2),
      conversionRate,
      recentConversions: recent.rows.map(r => ({
        bookingId: r.booking_id,
        commissionPence: r.commission_pence,
        commission: (r.commission_pence / 100).toFixed(2),
        convertedAt: r.converted_at,
        gymName: r.gym_name || 'Gym',
      })),
    });
  } catch (err) {
    console.error('[Referrals] Earnings error:', err.message);
    res.status(500).json({ error: 'Failed to load earnings' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/discount/:handle
//  Validates a referral code and returns discount info
// ─────────────────────────────────────────────────────────────────
router.get('/discount/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    // Check if creator exists
    const creator = await pool.query(
      `SELECT lp.slug, lp.creator_name, cm.tier
       FROM creator_landing_pages lp
       JOIN creator_memberships cm ON lp.creator_user_id = cm.user_id
       WHERE lp.slug = $1 AND lp.is_active = true LIMIT 1`,
      [handle]
    );

    if (creator.rows.length === 0) {
      return res.json({ valid: false, discountPence: 0 });
    }

    res.json({
      valid: true,
      discountPence: 200, // £2 discount
      discountDisplay: '£2.00',
      creatorName: creator.rows[0].creator_name,
      creatorTier: creator.rows[0].tier,
    });
  } catch (err) {
    console.error('[Referrals] Discount error:', err.message);
    res.status(500).json({ error: 'Failed to validate discount' });
  }
});

module.exports = router;
