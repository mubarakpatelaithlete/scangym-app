const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { creditWallet } = require('../lib/wallet-credit');

// Ensure JSON body parsing for all referral POST routes
router.use(express.json());

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

    // ── Research 2 (Amazon Affiliate): Multi-channel tracking columns ──
    await pool.query(`ALTER TABLE creator_referrals ADD COLUMN IF NOT EXISTS source VARCHAR(50)`);
    await pool.query(`ALTER TABLE creator_referrals ADD COLUMN IF NOT EXISTS gym_id VARCHAR(100)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_creator_referrals_source ON creator_referrals(source)`);

    // ── Research 2 (Amazon Affiliate): Signup bounty tracking ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_bounties (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100) NOT NULL,
        bounty_type VARCHAR(50) NOT NULL DEFAULT 'signup',
        amount_pence INTEGER NOT NULL DEFAULT 100,
        user_id TEXT,
        status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        paid_at TIMESTAMPTZ
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_creator_bounties_handle ON creator_bounties(creator_handle)`);

    // ── Research 3 (Social Platforms): Gym saves/boards (Pinterest-style) ──
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_boards (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name VARCHAR(200) NOT NULL DEFAULT 'Saved Gyms',
        emoji VARCHAR(10) DEFAULT '💪',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gym_boards_user ON gym_boards(user_id)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_saves (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        gym_id VARCHAR(100) NOT NULL,
        gym_name VARCHAR(300),
        gym_photo_url TEXT,
        board_id INTEGER REFERENCES gym_boards(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, gym_id)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_gym_saves_user ON gym_saves(user_id)`);

    console.log('[Referrals] Tables ready (+ multi-channel, bounties, gym boards)');
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
    // Amazon-style: track source channel + gym-specific deep links
    const { creatorHandle, visitorSession, source, gymId } = req.body;
    if (!creatorHandle) {
      return res.status(400).json({ error: 'creatorHandle is required' });
    }

    // Validate source is a known channel (Amazon Tracking ID style)
    const validSources = ['tiktok','instagram','youtube','twitter','facebook','snapchat','pinterest','linkedin','whatsapp','blog','email','website','other'];
    const safeSource = source && validSources.includes(source.toLowerCase()) ? source.toLowerCase() : null;

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
      `INSERT INTO creator_referrals (creator_handle, creator_email, visitor_session, status, source, gym_id)
       VALUES ($1, $2, $3, 'clicked', $4, $5)
       RETURNING id`,
      [creatorHandle, creatorEmail, visitorSession || null, safeSource, gymId || null]
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
    // Try landing page slug first, then fall back to users.referral_handle
    try {
      const cmResult = await pool.query(
        `UPDATE creator_memberships
         SET total_earnings_pence = total_earnings_pence + $1,
             total_conversions = total_conversions + 1
         WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $2 LIMIT 1)`,
        [commission, creatorHandle]
      );
      // If no landing page matched, try users.referral_handle
      if (cmResult.rowCount === 0) {
        await pool.query(
          `UPDATE creator_memberships
           SET total_earnings_pence = total_earnings_pence + $1,
               total_conversions = total_conversions + 1
           WHERE user_id = (SELECT id::text FROM public.users WHERE LOWER(referral_handle) = LOWER($2) LIMIT 1)`,
          [commission, creatorHandle]
        );
      }
    } catch (e) {
      console.error('[Referrals] Failed to update creator earnings:', e.message);
    }

    console.log(`[Referrals] Commission credited: ${commission}p to ${creatorHandle} for booking ${bookingId}`);

    // ── Auto-credit commission to creator's ScanGym Wallet ──
    // Zero-friction payout: creators earn into their wallet automatically.
    // Wallet balance can be spent on free gym sessions or cashed out via Stripe Connect.
    let walletCredited = false;
    try {
      // Resolve the user behind the handle: Creator landing page slug first,
      // then fall back to users.referral_handle, then creator_referrals email.
      let creatorUserId = null;
      const creatorUser = await pool.query(
        'SELECT creator_user_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
        [creatorHandle]
      );
      if (creatorUser.rows.length > 0 && creatorUser.rows[0].creator_user_id) {
        creatorUserId = creatorUser.rows[0].creator_user_id;
      } else {
        const u = await pool.query(
          'SELECT id FROM public.users WHERE LOWER(referral_handle) = LOWER($1) LIMIT 1',
          [creatorHandle]
        );
        if (u.rows.length > 0 && u.rows[0].id) creatorUserId = u.rows[0].id;
      }
      // Last resort: match creator_referrals.creator_email → users.email
      if (!creatorUserId) {
        try {
          const emailMatch = await pool.query(
            `SELECT u.id FROM public.users u
             JOIN creator_referrals cr ON LOWER(cr.creator_email) = LOWER(u.email)
             WHERE cr.creator_handle = $1 AND cr.creator_email IS NOT NULL
             LIMIT 1`,
            [creatorHandle]
          );
          if (emailMatch.rows.length > 0) creatorUserId = emailMatch.rows[0].id;
        } catch (e) { /* ignore */ }
      }
      if (creatorUserId) {
        // Constraint-free upsert via shared helper (old ON CONFLICT version
        // silently failed when wallets.user_id lacks a UNIQUE constraint)
        const credited = await creditWallet(
          pool, creatorUserId, commission,
          `🎉 Creator commission: £${(commission / 100).toFixed(2)} from booking #${bookingId}`,
          'commission'
        );
        if (credited) {
          walletCredited = true;
          console.log(`[Referrals] Wallet auto-credited: £${(commission / 100).toFixed(2)} → "${creatorHandle}" (balance: £${(credited.balanceAfterPence / 100).toFixed(2)})`);
        }
      }
    } catch (walletErr) {
      console.error('[Referrals] Wallet auto-credit failed (non-blocking):', walletErr.message);
    }

    res.json({ success: true, commissionPence: commission, walletCredited });
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
//  GET /api/referrals/stats/:handle  (Alias for /earnings/:handle)
//  Frontend creator tab calls this path — proxy to earnings endpoint
// ─────────────────────────────────────────────────────────────────
router.get('/stats/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    // Fetch earnings
    const stats = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'clicked') as total_clicks,
         COUNT(*) FILTER (WHERE status = 'converted') as total_conversions,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0) as total_earnings_pence
       FROM creator_referrals WHERE creator_handle = $1`,
      [handle]
    );

    // Fetch balance
    const earned = await pool.query(
      `SELECT COALESCE(SUM(commission_pence), 0) as total_earned
       FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted'`,
      [handle]
    );
    const withdrawn = await pool.query(
      `SELECT COALESCE(SUM(amount_pence) FILTER (WHERE status IN ('approved','paid','pending')), 0) as total_used
       FROM creator_withdrawals WHERE creator_handle = $1`,
      [handle]
    ).catch(() => ({ rows: [{ total_used: 0 }] }));

    const s = stats.rows[0];
    const availablePence = parseInt(earned.rows[0].total_earned) - parseInt(withdrawn.rows[0].total_used || 0);

    // Return shape the frontend expects
    res.json({
      success: true,
      clicks: parseInt(s.total_clicks),
      conversions: parseInt(s.total_conversions),
      earnings_pence: parseInt(s.total_earnings_pence),
      available_pence: Math.max(0, availablePence),
    });
  } catch (err) {
    console.error('[Referrals] Stats error:', err.message);
    res.status(500).json({ error: 'Failed to load stats' });
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

const MINIMUM_WITHDRAWAL_PENCE = 100; // £1 minimum

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
    } catch (e) {
      console.warn('[Referrals] Failed to fetch creator email for withdrawal:', e.message);
    }

    // Create withdrawal request
    const detailsJson = JSON.stringify(paymentDetails || {});
    const result = await pool.query(
      `INSERT INTO creator_withdrawals
         (creator_handle, creator_email, amount_pence, payment_method, payment_details, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'pending')
       RETURNING *`,
      [creatorHandle, email, requestAmount, paymentMethod || 'bank_transfer', detailsJson]
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
    console.error('[Withdrawals] Request error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to request withdrawal', detail: err.message });
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
    const { adminNotes, autoExecute } = req.body;

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
    } catch (e) {
      console.warn('[Referrals] Failed to update withdrawn total:', e.message);
    }

    // Research 1: Auto-execute Stripe Connect payout if requested
    let payoutResult = null;
    if (autoExecute !== false) {
      try {
        const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
        if (stripe) {
          const creator = await pool.query(
            `SELECT stripe_connect_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1`,
            [w.creator_handle]
          );
          if (creator.rows.length && creator.rows[0].stripe_connect_id) {
            const transfer = await stripe.transfers.create({
              amount: w.amount_pence,
              currency: 'gbp',
              destination: creator.rows[0].stripe_connect_id,
              description: `ScanGym creator payout - ${w.creator_handle}`,
              metadata: { withdrawal_id: String(w.id), creator_handle: w.creator_handle },
            });
            await pool.query(
              `UPDATE creator_withdrawals SET status = 'paid', admin_notes = $1 WHERE id = $2`,
              [`Auto-paid via Stripe: ${transfer.id}`, w.id]
            );
            payoutResult = { transferId: transfer.id, status: 'paid' };
            console.log(`[Payout] Auto-executed: ${transfer.id} → ${w.creator_handle}`);
          }
        }
      } catch (payErr) {
        console.log(`[Payout] Auto-execute skipped (${payErr.message}) — marked as approved only`);
        payoutResult = { error: payErr.message, status: 'approved_manual' };
      }
    }

    console.log(`[Withdrawals] Approved: £${(w.amount_pence/100).toFixed(2)} for ${w.creator_handle}`);
    res.json({ success: true, withdrawal: w, payout: payoutResult });
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
      return res.status(500).json({ error: 'Payment service not configured' });
    }

    // Find creator by handle
    const creator = await pool.query(
      'SELECT * FROM creator_landing_pages WHERE slug = $1 LIMIT 1',
      [creatorHandle]
    );

    // FIX: creator_landing_pages only covers Creator-program accounts.
    // Every user has users.referral_handle — fall back so "Connect Stripe"
    // works for regular affiliates too (two-handle-system gotcha).
    let isCreatorRow = creator.rows.length > 0;
    let userRow = null;
    if (!isCreatorRow) {
      const ur = await pool.query(
        'SELECT id, email, stripe_connect_id FROM users WHERE referral_handle = $1 LIMIT 1',
        [creatorHandle]
      ).catch(() => ({ rows: [] }));
      userRow = ur.rows[0] || null;
      if (!userRow) return res.status(404).json({ error: 'Creator not found' });
    }

    const c = isCreatorRow ? creator.rows[0] : userRow;
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
        if (isCreatorRow) {
          await pool.query(
            'UPDATE creator_landing_pages SET stripe_connect_id = $1 WHERE slug = $2',
            [stripeAccountId, creatorHandle]
          );
        } else {
          await pool.query(
            'UPDATE users SET stripe_connect_id = $1 WHERE id = $2',
            [stripeAccountId, userRow.id]
          );
        }
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
    res.status(500).json({ error: 'Payout setup failed' });
  }
});

// ─── R7-A07: Activity feed ───
router.get('/activity/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });
    const activities = [];
    try {
      const events = await pool.query(
        `SELECT event_type as type, metadata, created_at FROM referral_events WHERE creator_handle = $1 ORDER BY created_at DESC LIMIT 20`, [handle]);
      events.rows.forEach(e => {
        let desc = e.type === 'click' ? 'Someone clicked your link' : e.type === 'link_generated' ? 'Affiliate link generated' : e.type === 'signup' ? 'New user signed up via your link' : (e.type || '').replace(/_/g, ' ');
        activities.push({ type: e.type, description: desc, created_at: e.created_at });
      });
    } catch (e) { console.warn('[Activity]', e.message); }
    try {
      const conv = await pool.query(
        `SELECT commission_pence, created_at FROM creator_referrals WHERE creator_handle = $1 AND status = 'converted' ORDER BY created_at DESC LIMIT 10`, [handle]);
      conv.rows.forEach(c => activities.push({ type: 'conversion', description: '\u00a3' + (c.commission_pence / 100).toFixed(2) + ' earned from booking', created_at: c.created_at }));
    } catch (e) { console.warn('[Activity]', e.message); }
    try {
      const bounties = await pool.query(
        `SELECT amount_pence, created_at FROM creator_bounties WHERE creator_handle = $1 ORDER BY created_at DESC LIMIT 5`, [handle]);
      bounties.rows.forEach(b => activities.push({ type: 'bounty', description: '\u00a3' + (b.amount_pence / 100).toFixed(2) + ' signup bounty', created_at: b.created_at }));
    } catch (e) { console.warn('[Activity]', e.message); }
    activities.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    let hasPayoutMethod = false;
    try {
      const lp = await pool.query('SELECT stripe_connect_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1', [handle]);
      if (lp.rows.length > 0 && lp.rows[0].stripe_connect_id) hasPayoutMethod = true;
    } catch (e) {}
    res.json({ activities: activities.slice(0, 15), hasPayoutMethod, total: activities.length });
  } catch (err) {
    console.error('[Activity]', err.message);
    res.json({ activities: [], hasPayoutMethod: false, total: 0 });
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

// ─── Update creator payout method (from auth sheet step 2) ───
router.post('/update-payout', async (req, res) => {
  try {
    const { creatorHandle, paymentMethod, paymentDetails } = req.body;
    if (!creatorHandle) return res.status(400).json({ error: 'Missing creator handle' });

    try {
      // Update or insert creator payout preferences
      await pool.query(
        `INSERT INTO creator_withdrawals (creator_handle, payment_method, payment_details, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (creator_handle) DO UPDATE SET
           payment_method = EXCLUDED.payment_method,
           payment_details = EXCLUDED.payment_details`,
        [creatorHandle, paymentMethod || 'paypal', JSON.stringify(paymentDetails || {})]
      );
    } catch (dbErr) {
      // Table might not exist — log and still succeed
      console.log(`[Payout] DB update failed (table may not exist): ${dbErr.message}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Payout] Update error:', err.message);
    res.json({ success: true }); // Don't block auth flow
  }
});

// ═══════════════════════════════════════════════════════════════════
//  RESEARCH 2: Amazon-Level Affiliate Features
//  Multi-channel analytics, signup bounties, gym deep links
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/channels/:handle
//  Per-channel analytics (Amazon Tracking ID style)
//  Shows which platform (TikTok, IG, YouTube) drives most bookings
// ─────────────────────────────────────────────────────────────────
router.get('/channels/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    if (!handle) return res.status(400).json({ error: 'handle required' });

    const channels = await pool.query(
      `SELECT
         COALESCE(source, 'direct') as channel,
         COUNT(*) as total_clicks,
         COUNT(*) FILTER (WHERE status = 'converted') as conversions,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0) as earnings_pence
       FROM creator_referrals
       WHERE creator_handle = $1
       GROUP BY COALESCE(source, 'direct')
       ORDER BY total_clicks DESC`,
      [handle]
    );

    // Per-gym breakdown (Amazon Product-level tracking)
    const gyms = await pool.query(
      `SELECT
         gym_id,
         COUNT(*) as clicks,
         COUNT(*) FILTER (WHERE status = 'converted') as bookings,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0) as earnings_pence
       FROM creator_referrals
       WHERE creator_handle = $1 AND gym_id IS NOT NULL
       GROUP BY gym_id
       ORDER BY bookings DESC
       LIMIT 20`,
      [handle]
    );

    res.json({
      success: true,
      channels: channels.rows.map(c => ({
        channel: c.channel,
        clicks: parseInt(c.total_clicks),
        conversions: parseInt(c.conversions),
        conversionRate: parseInt(c.total_clicks) > 0
          ? ((parseInt(c.conversions) / parseInt(c.total_clicks)) * 100).toFixed(1) + '%'
          : '0.0%',
        earnings: '£' + (parseInt(c.earnings_pence) / 100).toFixed(2),
        earningsPence: parseInt(c.earnings_pence),
      })),
      topGyms: gyms.rows.map(g => ({
        gymId: g.gym_id,
        clicks: parseInt(g.clicks),
        bookings: parseInt(g.bookings),
        earnings: '£' + (parseInt(g.earnings_pence) / 100).toFixed(2),
      })),
    });
  } catch (err) {
    console.error('[Referrals] Channels error:', err.message);
    res.status(500).json({ error: 'Failed to fetch channel analytics' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/bounty
//  Signup bounty: credit £1 to creator when a referred user signs up
//  (Amazon pays $3 for Prime trial, $5-$15 for Audible — we pay £1 per signup)
// ─────────────────────────────────────────────────────────────────
const SIGNUP_BOUNTY_PENCE = 100; // £1.00 per new user signup

router.post('/bounty', async (req, res) => {
  try {
    const { creatorHandle, userId, bountyType } = req.body;
    if (!creatorHandle || !userId) {
      return res.status(400).json({ error: 'creatorHandle and userId required' });
    }

    // Prevent duplicate bounties for same user
    const existing = await pool.query(
      `SELECT id FROM creator_bounties WHERE creator_handle = $1 AND user_id = $2 AND bounty_type = $3`,
      [creatorHandle, userId, bountyType || 'signup']
    );
    if (existing.rows.length > 0) {
      return res.json({ success: true, duplicate: true, message: 'Bounty already credited' });
    }

    // Credit the bounty
    await pool.query(
      `INSERT INTO creator_bounties (creator_handle, bounty_type, amount_pence, user_id, status)
       VALUES ($1, $2, $3, $4, 'credited')`,
      [creatorHandle, bountyType || 'signup', SIGNUP_BOUNTY_PENCE, userId]
    );

    // Update creator earnings
    try {
      await pool.query(
        `UPDATE creator_memberships SET total_earnings_pence = total_earnings_pence + $1
         WHERE user_id = (SELECT creator_user_id FROM creator_landing_pages WHERE slug = $2 LIMIT 1)`,
        [SIGNUP_BOUNTY_PENCE, creatorHandle]
      );
    } catch (e) {
      console.warn('[Referrals] Failed to update creator earnings for bounty:', e.message);
    }

    console.log(`[Bounty] £${(SIGNUP_BOUNTY_PENCE/100).toFixed(2)} signup bounty → ${creatorHandle} (user: ${userId})`);
    res.json({ success: true, bountyPence: SIGNUP_BOUNTY_PENCE });
  } catch (err) {
    console.error('[Bounty] Error:', err.message);
    res.status(500).json({ error: 'Failed to credit bounty' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/referrals/bounties/:handle
//  Returns bounty history + totals for creator dashboard
// ─────────────────────────────────────────────────────────────────
router.get('/bounties/:handle', async (req, res) => {
  try {
    const { handle } = req.params;
    const totals = await pool.query(
      `SELECT
         COUNT(*) as total_bounties,
         COALESCE(SUM(amount_pence), 0) as total_pence
       FROM creator_bounties
       WHERE creator_handle = $1 AND status = 'credited'`,
      [handle]
    );
    const recent = await pool.query(
      `SELECT bounty_type, amount_pence, created_at
       FROM creator_bounties
       WHERE creator_handle = $1
       ORDER BY created_at DESC LIMIT 20`,
      [handle]
    );
    res.json({
      success: true,
      totalBounties: parseInt(totals.rows[0].total_bounties),
      totalEarningsPence: parseInt(totals.rows[0].total_pence),
      recent: recent.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bounties' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/generate-link
//  Amazon SiteStripe-style: Generate affiliate deep link for any gym
// ─────────────────────────────────────────────────────────────────
router.post('/generate-link', async (req, res) => {
  try {
    const { creatorHandle, gymId, gymName, source } = req.body;
    if (!creatorHandle) return res.status(400).json({ error: 'creatorHandle required' });

    const baseUrl = 'https://scangym.com';
    const params = [`ref=${encodeURIComponent(creatorHandle)}`];
    if (source) params.push(`src=${encodeURIComponent(source)}`);

    let link;
    if (gymId) {
      // Deep link to specific gym (Amazon Product Link style)
      link = `${baseUrl}/gym/${gymId}?${params.join('&')}`;
    } else {
      // General creator link (Amazon Storefront style)
      link = `${baseUrl}/r/${encodeURIComponent(creatorHandle)}${source ? '?src=' + encodeURIComponent(source) : ''}`;
    }

    // Log link generation for analytics
    try {
      await pool.query(
        `INSERT INTO referral_events (creator_handle, event_type, metadata, created_at)
         VALUES ($1, 'link_generated', $2, NOW())`,
        [creatorHandle, JSON.stringify({ gymId, gymName, source, link })]
      );
    } catch (e) {
      console.warn('[Referrals] Failed to log link generation event:', e.message);
    }

    res.json({
      success: true,
      link,
      shortLink: link, // Future: add URL shortener
      gymId: gymId || null,
      gymName: gymName || null,
      source: source || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate link' });
  }
});


// ═══════════════════════════════════════════════════════════════════
//  RESEARCH 1: Stripe Connect Auto-Payouts
//  When admin approves withdrawal, auto-execute via Stripe Connect
// ═══════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────
//  POST /api/referrals/admin/withdrawals/:id/execute-payout
//  Auto-execute payout via Stripe Connect (replaces manual bank transfer)
// ─────────────────────────────────────────────────────────────────
router.post('/admin/withdrawals/:id/execute-payout', async (req, res) => {
  try {
    const { id } = req.params;

    const stripe = process.env.STRIPE_SECRET_KEY
      ? require('stripe')(process.env.STRIPE_SECRET_KEY)
      : null;
    if (!stripe) return res.status(500).json({ error: 'Payment service not configured' });

    // Get withdrawal details
    const w = await pool.query(
      `SELECT * FROM creator_withdrawals WHERE id = $1 AND status = 'approved'`,
      [id]
    );
    if (w.rows.length === 0) {
      return res.status(404).json({ error: 'Withdrawal not found or not approved' });
    }
    const withdrawal = w.rows[0];

    // Find creator's Stripe Connect account
    const creator = await pool.query(
      `SELECT stripe_connect_id FROM creator_landing_pages WHERE slug = $1 LIMIT 1`,
      [withdrawal.creator_handle]
    );
    if (!creator.rows.length || !creator.rows[0].stripe_connect_id) {
      return res.status(400).json({
        error: 'Creator has no Stripe Connect account. Ask them to connect at /creator-earnings',
        needsOnboarding: true,
      });
    }

    const stripeAccountId = creator.rows[0].stripe_connect_id;

    // Execute Stripe transfer to connected account
    const transfer = await stripe.transfers.create({
      amount: withdrawal.amount_pence,
      currency: 'gbp',
      destination: stripeAccountId,
      description: `ScanGym creator payout - ${withdrawal.creator_handle}`,
      metadata: {
        withdrawal_id: String(withdrawal.id),
        creator_handle: withdrawal.creator_handle,
      },
    });

    // Update withdrawal status to 'paid'
    await pool.query(
      `UPDATE creator_withdrawals
       SET status = 'paid', admin_notes = $1, processed_at = NOW()
       WHERE id = $2`,
      [`Stripe Transfer: ${transfer.id}`, id]
    );

    console.log(`[Payout] Stripe transfer ${transfer.id}: £${(withdrawal.amount_pence/100).toFixed(2)} → ${withdrawal.creator_handle}`);

    res.json({
      success: true,
      transferId: transfer.id,
      amount: '£' + (withdrawal.amount_pence / 100).toFixed(2),
      destination: stripeAccountId,
    });
  } catch (err) {
    console.error('[Payout] Execute error:', err.message);
    console.error('[referrals] payout failed:', err.message); res.status(500).json({ error: 'Payout failed. Please contact support.' });
  }
});


// ═══════════════════════════════════════════════════════════════════
//  RESEARCH 3: Social Platform Features — Gym Boards (Pinterest)
//  Save gyms to collections, organize favorites
// ═══════════════════════════════════════════════════════════════════

// ─── POST /api/referrals/gyms/save — Save/unsave a gym ───
router.post('/gyms/save', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Sign in to save gyms' });
    }
    const { gymId, gymName, gymPhotoUrl, boardId } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });

    // Toggle: if already saved, unsave
    const existing = await pool.query(
      'SELECT id FROM gym_saves WHERE user_id = $1 AND gym_id = $2',
      [req.session.userId, gymId]
    );

    if (existing.rows.length > 0) {
      await pool.query('DELETE FROM gym_saves WHERE user_id = $1 AND gym_id = $2', [req.session.userId, gymId]);
      return res.json({ success: true, saved: false, message: 'Gym removed from saved' });
    }

    // Ensure user has a default board
    let targetBoard = boardId;
    if (!targetBoard) {
      const defaultBoard = await pool.query(
        `SELECT id FROM gym_boards WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [req.session.userId]
      );
      if (defaultBoard.rows.length === 0) {
        const newBoard = await pool.query(
          `INSERT INTO gym_boards (user_id, name, emoji) VALUES ($1, 'Saved Gyms', '💪') RETURNING id`,
          [req.session.userId]
        );
        targetBoard = newBoard.rows[0].id;
      } else {
        targetBoard = defaultBoard.rows[0].id;
      }
    }

    await pool.query(
      `INSERT INTO gym_saves (user_id, gym_id, gym_name, gym_photo_url, board_id)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id, gym_id) DO NOTHING`,
      [req.session.userId, gymId, gymName || null, gymPhotoUrl || null, targetBoard]
    );

    res.json({ success: true, saved: true, message: 'Gym saved!' });
  } catch (err) {
    console.error('[GymSave] Error:', err.message);
    res.status(500).json({ error: 'Failed to save gym' });
  }
});

// ─── GET /api/referrals/gyms/saved — Get saved gyms (with boards) ───
router.get('/gyms/saved', async (req, res) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: 'Sign in to see saved gyms' });
    }

    const boards = await pool.query(
      `SELECT b.*, COUNT(gs.id) as gym_count
       FROM gym_boards b
       LEFT JOIN gym_saves gs ON gs.board_id = b.id
       WHERE b.user_id = $1
       GROUP BY b.id
       ORDER BY b.created_at ASC`,
      [req.session.userId]
    );

    const saves = await pool.query(
      `SELECT gs.*, b.name as board_name, b.emoji as board_emoji
       FROM gym_saves gs
       LEFT JOIN gym_boards b ON gs.board_id = b.id
       WHERE gs.user_id = $1
       ORDER BY gs.created_at DESC`,
      [req.session.userId]
    );

    res.json({
      success: true,
      boards: boards.rows,
      savedGyms: saves.rows,
      totalSaved: saves.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch saved gyms' });
  }
});

// ─── POST /api/referrals/gyms/boards — Create a new board ───
router.post('/gyms/boards', async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Sign in first' });
    const { name, emoji } = req.body;
    if (!name) return res.status(400).json({ error: 'Board name required' });

    const result = await pool.query(
      `INSERT INTO gym_boards (user_id, name, emoji) VALUES ($1, $2, $3) RETURNING *`,
      [req.session.userId, name.slice(0, 200), emoji || '💪']
    );
    res.json({ success: true, board: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create board' });
  }
});

// ─── GET /api/referrals/gyms/is-saved/:gymId — Check if gym is saved ───
router.get('/gyms/is-saved/:gymId', async (req, res) => {
  try {
    if (!req.session?.userId) return res.json({ saved: false });
    const result = await pool.query(
      'SELECT id FROM gym_saves WHERE user_id = $1 AND gym_id = $2',
      [req.session.userId, req.params.gymId]
    );
    res.json({ saved: result.rows.length > 0 });
  } catch (err) {
    res.json({ saved: false });
  }
});


module.exports = router;
