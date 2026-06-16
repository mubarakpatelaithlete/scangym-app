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

    // Variable reward (Skinner box): Random commission creates excitement
    // Amounts weighted toward lower values (more frequent small wins, rare big wins)
    const VARIABLE_COMMISSIONS = [100, 100, 125, 125, 125, 150, 150, 200, 250, 500]; // pence
    const commission = commissionPence || VARIABLE_COMMISSIONS[Math.floor(Math.random() * VARIABLE_COMMISSIONS.length)];

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
    const { period } = req.query; // #63: 'today', 'week', or 'all'
    if (!handle) return res.status(400).json({ error: 'handle required' });

    // #63: Build date filter based on period
    let dateFilter = '';
    if (period === 'today') {
      dateFilter = "AND cr.created_at >= CURRENT_DATE";
    } else if (period === 'week') {
      dateFilter = "AND cr.created_at >= CURRENT_DATE - INTERVAL '7 days'";
    }

    // Total stats (with optional period filter)
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'clicked') as total_clicks,
         COUNT(*) FILTER (WHERE status = 'converted') as total_conversions,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0) as total_earnings_pence
       FROM creator_referrals cr
       WHERE cr.creator_handle = $1 ${dateFilter}`,
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

    // #63: Daily clicks for sparkline (last 7 days)
    let dailyClicks = [];
    try {
      const daily = await pool.query(
        `SELECT DATE(created_at) as day, COUNT(*) as cnt
         FROM creator_referrals
         WHERE creator_handle = $1 AND created_at >= CURRENT_DATE - INTERVAL '6 days'
         GROUP BY DATE(created_at)
         ORDER BY day ASC`,
        [handle]
      );
      // Fill in missing days
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const found = daily.rows.find(r => r.day && r.day.toISOString().slice(0, 10) === ds);
        dailyClicks.push({ date: ds, count: found ? parseInt(found.cnt) : 0 });
      }
    } catch (e) {
      // Table may not have created_at — return empty
      dailyClicks = Array(7).fill(null).map((_, i) => {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        return { date: d.toISOString().slice(0, 10), count: 0 };
      });
    }

    // #56: Count signups (users who clicked and then registered)
    let totalSignups = 0;
    try {
      const signupRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM creator_referrals
         WHERE creator_handle = $1 AND status IN ('signed_up', 'converted')`,
        [handle]
      );
      totalSignups = parseInt(signupRes.rows[0]?.cnt || 0);
    } catch (e) {
      // Column may not exist
    }

    // #63: Downloads and shares from referral_events
    let totalDownloads = 0, totalShares = 0;
    try {
      const events = await pool.query(
        `SELECT event_type, COUNT(*) as cnt
         FROM referral_events
         WHERE creator_handle = $1 AND event_type IN ('asset_download', 'share')
         GROUP BY event_type`,
        [handle]
      );
      events.rows.forEach(r => {
        if (r.event_type === 'asset_download') totalDownloads = parseInt(r.cnt);
        if (r.event_type === 'share') totalShares = parseInt(r.cnt);
      });
    } catch (e) {
      // Table may not exist yet
    }

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
      totalSignups,
      totalDownloads,
      totalShares,
      dailyClicks,
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

// ═══════════════════════════════════════════════════════════════════
//  WITHDRAWAL / PAYOUT SYSTEM
//  Creators request payouts when they hit the minimum threshold (£5)
// ═══════════════════════════════════════════════════════════════════

// Create withdrawals table on startup
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_withdrawals (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        creator_email VARCHAR(200),
        amount_pence INTEGER NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'bank_transfer',
        payment_details JSONB DEFAULT '{}',
        status VARCHAR(30) DEFAULT 'pending',
        admin_notes TEXT,
        requested_at TIMESTAMPTZ DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        rejected_at TIMESTAMPTZ
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_withdrawals_handle
      ON creator_withdrawals(creator_handle)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_creator_withdrawals_status
      ON creator_withdrawals(status)
    `);
    // Add withdrawn_pence to creator_memberships if not present
    await pool.query(`
      ALTER TABLE creator_memberships
      ADD COLUMN IF NOT EXISTS total_withdrawn_pence INTEGER DEFAULT 0
    `);
    console.log('[Withdrawals] Tables ready');
  } catch (err) {
    console.error('[Withdrawals] Table init error:', err.message);
  }
})();

const MINIMUM_WITHDRAWAL_PENCE = 500; // £5 minimum

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/balance/:handle
//  Returns available balance (earned - withdrawn - pending)
// ─────────────────────────────────────────────────────────────────
router.get('/balance/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    // Total earned from referrals
    const earned = await pool.query(
      `SELECT COALESCE(SUM(commission_pence), 0) as total_earned
       FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
      [handle]
    );
    const totalEarnedPence = parseInt(earned.rows[0].total_earned);

    // Total withdrawn (approved) + pending
    const withdrawn = await pool.query(
      `SELECT
         COALESCE(SUM(amount_pence) FILTER (WHERE status = 'approved' OR status = 'paid'), 0) as total_withdrawn,
         COALESCE(SUM(amount_pence) FILTER (WHERE status = 'pending'), 0) as total_pending
       FROM creator_withdrawals WHERE creator_handle = $1`,
      [handle]
    );
    const totalWithdrawnPence = parseInt(withdrawn.rows[0].total_withdrawn);
    const totalPendingPence = parseInt(withdrawn.rows[0].total_pending);
    const availablePence = totalEarnedPence - totalWithdrawnPence - totalPendingPence;

    res.json({
      success: true,
      totalEarnedPence,
      totalWithdrawnPence,
      totalPendingPence,
      availablePence,
      availableDisplay: '£' + (availablePence / 100).toFixed(2),
      canWithdraw: availablePence >= MINIMUM_WITHDRAWAL_PENCE,
      minimumPence: MINIMUM_WITHDRAWAL_PENCE,
      minimumDisplay: '£' + (MINIMUM_WITHDRAWAL_PENCE / 100).toFixed(2),
    });
  } catch (err) {
    console.error('[Withdrawals] Balance error:', err.message);
    res.status(500).json({ error: 'Failed to get balance' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/withdraw
//  Creator requests a withdrawal
// ─────────────────────────────────────────────────────────────────
router.post('/withdraw', async (req, res) => {
  try {
    const { creatorHandle, amountPence, paymentMethod, paymentDetails } = req.body;
    if (!creatorHandle) return res.status(400).json({ error: 'creatorHandle required' });

    // Check available balance
    const earned = await pool.query(
      `SELECT COALESCE(SUM(commission_pence), 0) as total_earned
       FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
      [creatorHandle]
    );
    const withdrawn = await pool.query(
      `SELECT COALESCE(SUM(amount_pence) FILTER (WHERE status IN ('approved','paid','pending')), 0) as total_used
       FROM creator_withdrawals WHERE creator_handle = $1`,
      [creatorHandle]
    );
    const available = parseInt(earned.rows[0].total_earned) - parseInt(withdrawn.rows[0].total_used);
    const requestAmount = amountPence || available;

    if (requestAmount < MINIMUM_WITHDRAWAL_PENCE) {
      return res.status(400).json({
        error: `Minimum withdrawal is £${(MINIMUM_WITHDRAWAL_PENCE/100).toFixed(2)}. Available: £${(available/100).toFixed(2)}`,
        availablePence: available,
        minimumPence: MINIMUM_WITHDRAWAL_PENCE,
      });
    }
    if (requestAmount > available) {
      return res.status(400).json({
        error: `Insufficient balance. Available: £${(available/100).toFixed(2)}`,
        availablePence: available,
      });
    }

    // Look up creator email
    let email = null;
    try {
      const lp = await pool.query(
        `SELECT cm.user_id FROM creator_landing_pages lp
         JOIN creator_memberships cm ON lp.creator_user_id = cm.user_id
         WHERE lp.slug = $1 LIMIT 1`,
        [creatorHandle]
      );
      if (lp.rows.length > 0) {
        const user = await pool.query('SELECT email FROM public.users WHERE id = $1', [lp.rows[0].user_id]);
        if (user.rows.length > 0) email = user.rows[0].email;
      }
    } catch (e) {}

    // Create withdrawal request
    const result = await pool.query(
      `INSERT INTO creator_withdrawals
         (creator_handle, creator_email, amount_pence, payment_method, payment_details, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING *`,
      [creatorHandle, email, requestAmount, paymentMethod || 'bank_transfer', JSON.stringify(paymentDetails || {})]
    );

    console.log(`[Withdrawals] New request: £${(requestAmount/100).toFixed(2)} by ${creatorHandle}`);

    res.json({
      success: true,
      withdrawal: {
        id: result.rows[0].id,
        amountPence: requestAmount,
        amountDisplay: '£' + (requestAmount / 100).toFixed(2),
        status: 'pending',
        requestedAt: result.rows[0].requested_at,
      },
    });
  } catch (err) {
    console.error('[Withdrawals] Request error:', err.message);
    res.status(500).json({ error: 'Failed to request withdrawal' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/withdrawals/:handle
//  Returns withdrawal history for a creator
// ─────────────────────────────────────────────────────────────────
router.get('/withdrawals/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    const result = await pool.query(
      `SELECT id, amount_pence, payment_method, status, requested_at, processed_at
       FROM creator_withdrawals
       WHERE creator_handle = $1
       ORDER BY requested_at DESC LIMIT 50`,
      [handle]
    );

    res.json({
      success: true,
      withdrawals: result.rows.map(w => ({
        id: w.id,
        amountPence: w.amount_pence,
        amountDisplay: '£' + (w.amount_pence / 100).toFixed(2),
        method: w.payment_method,
        status: w.status,
        requestedAt: w.requested_at,
        processedAt: w.processed_at,
      })),
    });
  } catch (err) {
    console.error('[Withdrawals] History error:', err.message);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  Admin: GET /api/referrals/admin/withdrawals
//  Lists all pending withdrawal requests (for admin dashboard)
// ─────────────────────────────────────────────────────────────────
router.get('/admin/withdrawals', async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? `WHERE status = $1` : '';
    const params = status ? [status] : [];

    const result = await pool.query(
      `SELECT id, creator_handle, creator_email, amount_pence, payment_method,
              payment_details, status, requested_at, processed_at
       FROM creator_withdrawals
       ${filter}
       ORDER BY requested_at DESC LIMIT 100`,
      params
    );

    res.json({
      success: true,
      withdrawals: result.rows.map(w => ({
        id: w.id,
        handle: w.creator_handle,
        email: w.creator_email,
        amountPence: w.amount_pence,
        amountDisplay: '£' + (w.amount_pence / 100).toFixed(2),
        method: w.payment_method,
        details: w.payment_details,
        status: w.status,
        requestedAt: w.requested_at,
        processedAt: w.processed_at,
      })),
    });
  } catch (err) {
    console.error('[Withdrawals] Admin list error:', err.message);
    res.status(500).json({ error: 'Failed to load withdrawals' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  Admin: POST /api/referrals/admin/withdrawals/:id/approve
//  Approve a withdrawal request
// ─────────────────────────────────────────────────────────────────
router.post('/admin/withdrawals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body;

    const result = await pool.query(
      `UPDATE creator_withdrawals
       SET status = 'approved', admin_notes = $1, processed_at = NOW()
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [adminNotes || 'Approved', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or already processed' });
    }

    // Update creator_memberships withdrawn total
    const w = result.rows[0];
    try {
      await pool.query(
        `UPDATE creator_memberships
         SET total_withdrawn_pence = total_withdrawn_pence + $1
         WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $2 LIMIT 1)`,
        [w.amount_pence, w.creator_handle]
      );
    } catch (e) {}

    console.log(`[Withdrawals] Approved: £${(w.amount_pence/100).toFixed(2)} for ${w.creator_handle}`);
    res.json({ success: true, withdrawal: w });
  } catch (err) {
    console.error('[Withdrawals] Approve error:', err.message);
    res.status(500).json({ error: 'Failed to approve withdrawal' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  Admin: POST /api/referrals/admin/withdrawals/:id/reject
// ─────────────────────────────────────────────────────────────────
router.post('/admin/withdrawals/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await pool.query(
      `UPDATE creator_withdrawals
       SET status = 'rejected', admin_notes = $1, rejected_at = NOW()
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [reason || 'Rejected', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or already processed' });
    }

    console.log(`[Withdrawals] Rejected: #${id} for ${result.rows[0].creator_handle}`);
    res.json({ success: true });
  } catch (err) {
    console.error('[Withdrawals] Reject error:', err.message);
    res.status(500).json({ error: 'Failed to reject withdrawal' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/stripe-connect
//  Create Stripe Connect Express account for creator payouts
// ─────────────────────────────────────────────────────────────────
router.post('/stripe-connect', async (req, res) => {
  try {
    const { creatorHandle } = req.body;
    if (!creatorHandle) return res.status(400).json({ error: 'Missing creatorHandle' });

    const stripe = process.env.STRIPE_SECRET_KEY
      ? require('stripe')(process.env.STRIPE_SECRET_KEY)
      : null;

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe not configured' });
    }

    // Find creator by handle
    const creator = await pool.query(
      'SELECT * FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
      [creatorHandle]
    );

    if (creator.rows.length === 0) {
      return res.status(404).json({ error: 'Creator not found' });
    }

    const c = creator.rows[0];
    let stripeAccountId = c.stripe_connect_id;

    // Create Connect Express account if not exists
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: c.email || undefined,
        capabilities: {
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: {
          creatorHandle: creatorHandle,
          source: 'scangym_creator'
        }
      });
      stripeAccountId = account.id;

      // Save to DB (add column if needed, or store in metadata)
      try {
        await pool.query(
          'UPDATE creator_landing_pages SET stripe_connect_id = $1 WHERE slug = $2',
          [stripeAccountId, creatorHandle]
        );
      } catch (e) {
        // Column might not exist yet — store in localStorage as fallback
        console.log('[StripeConnect] Could not save to DB (column may not exist):', e.message);
      }
    }

    // Create onboarding link
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${req.protocol}://${req.get('host')}/creator-earnings?stripe_refresh=1`,
      return_url: `${req.protocol}://${req.get('host')}/creator-earnings?stripe_connected=1`,
      type: 'account_onboarding',
    });

    console.log(`[StripeConnect] Onboarding link created for ${creatorHandle}: ${stripeAccountId}`);
    res.json({ success: true, onboardingUrl: accountLink.url, accountId: stripeAccountId });
  } catch (err) {
    console.error('[StripeConnect] Error:', err.message);
    res.status(500).json({ error: 'Stripe Connect setup failed', detail: err.message });
  }
});

// ─── #59 Associate referral with logged-in user ───
router.post('/associate', async (req, res) => {
  try {
    const { referrerHandle, userId, userName } = req.body;
    if (!referrerHandle || !userId) return res.status(400).json({ error: 'Missing referrer or user' });

    console.log(`[Referral] Associating: ${userId} (${userName || 'anon'}) was referred by ${referrerHandle}`);

    try {
      await pool.query(
        `INSERT INTO referral_events (creator_handle, event_type, metadata, created_at)
         VALUES ($1, 'signup', $2, NOW())
         ON CONFLICT DO NOTHING`,
        [referrerHandle, JSON.stringify({ userId, userName: userName || '' })]
      );
    } catch (dbErr) {
      // Table may not exist yet — log the referral anyway
      console.log(`[Referral] DB insert failed (table may not exist): ${dbErr.message}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Referral] Associate error:', err.message);
    res.json({ success: true }); // Don't block login flow
  }
});

// ─── #58 Track asset download for affiliate analytics ───
router.post('/track-download', async (req, res) => {
  try {
    const { handle, asset } = req.body;
    if (!handle) return res.status(400).json({ error: 'Missing creator handle' });
    
    // Log the download event (insert into referral_events or just log)
    try {
      await pool.query(
        `INSERT INTO referral_events (creator_handle, event_type, metadata, created_at)
         VALUES ($1, 'asset_download', $2, NOW())`,
        [handle, JSON.stringify({ asset: asset || 'unknown' })]
      );
    } catch (dbErr) {
      // Table might not exist yet — log and continue
      console.log(`[Download] Tracked: ${handle} downloaded ${asset || 'asset'} (DB: ${dbErr.message})`);
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('[Download] Error:', err.message);
    res.json({ success: true }); // Don't block downloads on tracking errors
  }
});

module.exports = router;
