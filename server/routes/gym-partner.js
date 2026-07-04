/**
 * Gym Partner Routes (#86, #88, #89, #90, #95)
 * Claim wizard, 1-click toggle, open/close override, strikes, 24/7 filter
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// Auto-migration: ensure gyms table has partner columns
(async () => {
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claimed_by') THEN
          ALTER TABLE gyms ADD COLUMN claimed_by VARCHAR(255) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_name') THEN
          ALTER TABLE gyms ADD COLUMN owner_name VARCHAR(255) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_email') THEN
          ALTER TABLE gyms ADD COLUMN owner_email VARCHAR(255) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='owner_phone') THEN
          ALTER TABLE gyms ADD COLUMN owner_phone VARCHAR(50) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_url') THEN
          ALTER TABLE gyms ADD COLUMN claim_proof_url TEXT DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claimed_at') THEN
          ALTER TABLE gyms ADD COLUMN claimed_at TIMESTAMP DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_method') THEN
          ALTER TABLE gyms ADD COLUMN access_method VARCHAR(50) DEFAULT 'qr';
        END IF;
      END $$;
    `);
    console.log('[GymPartner] gyms table partner columns verified');
  } catch (err) {
    console.error('[GymPartner] Migration error:', err.message);
  }
})();

// ── #86: 3-Step Claim Wizard ──
// Step 1: Claim gym (basic info check)
router.post('/claim', authenticateUser, express.json(), async (req, res) => {
  try {
    let { gymId, placeId, ownerName, ownerEmail, ownerPhone, proofUrl } = req.body;
    if (!gymId && !placeId) return res.status(400).json({ error: 'gymId or placeId required' });

    // Accept a Google place_id (either via placeId, or a non-numeric gymId sent
    // by older clients) and resolve it to our internal gyms.id
    if (!gymId || !/^\d+$/.test(String(gymId))) {
      const pid = placeId || String(gymId || '');
      const dbm = pid.match(/^db-(\d+)$/);
      if (dbm) {
        gymId = parseInt(dbm[1], 10);
      } else {
        const found = await pool.query('SELECT id FROM gyms WHERE place_id = $1', [pid]).catch(() => ({ rows: [] }));
        if (!found.rows.length) {
          return res.status(404).json({ error: 'Gym not found — call /api/live/ensure-gym with the placeId first' });
        }
        gymId = found.rows[0].id;
      }
    } else {
      gymId = parseInt(String(gymId), 10);
    }

    // Check not already claimed
    const existing = await pool.query(
      'SELECT claimed_by FROM gyms WHERE id = $1', [gymId]
    ).catch(() => ({ rows: [{}] }));

    if (existing.rows[0]?.claimed_by) {
      return res.status(409).json({ error: 'This gym is already claimed' });
    }

    // Claim it
    await pool.query(
      `UPDATE gyms SET claimed_by = $1, 
       owner_name = COALESCE($2, owner_name),
       owner_email = COALESCE($3, owner_email),
       owner_phone = COALESCE($4, owner_phone),
       claim_proof_url = $5,
       claimed_at = NOW(),
       updated_at = NOW()
       WHERE id = $6`,
      [req.user.id, ownerName, ownerEmail, ownerPhone, proofUrl, gymId]
    ).catch(async () => {
      // Columns may not exist — fallback to basic claim
      await pool.query(
        'UPDATE gyms SET claimed_by = $1, updated_at = NOW() WHERE id = $2',
        [req.user.id, gymId]
      );
    });

    res.json({ success: true, step: 1, message: 'Gym claimed! Now set up your preferences.', gymId });
  } catch (err) {
    console.error('Claim error:', err.message);
    res.status(500).json({ error: 'Claim failed' });
  }
});

// Step 2: Set 24/7 + self-serve preferences
router.post('/claim/preferences', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, is24h, isSelfServe, hasStaff, accessMethod } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });

    await pool.query(
      `UPDATE gyms SET
        is_24h = COALESCE($1, is_24h),
        is_self_serve = COALESCE($2, is_self_serve),
        has_staff = COALESCE($3, has_staff),
        access_method = COALESCE($4, access_method),
        updated_at = NOW()
       WHERE id = $5 AND claimed_by::text = $6::text`,
      [is24h, isSelfServe, hasStaff, accessMethod || 'qr', gymId, req.user.id]
    ).catch(async () => {
      // Columns don't exist yet — store in JSON metadata
      await pool.query(
        `UPDATE gyms SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND claimed_by::text = $3::text`,
        [JSON.stringify({ is_24h: is24h, is_self_serve: isSelfServe, has_staff: hasStaff, access_method: accessMethod }), gymId, req.user.id]
      );
    });

    res.json({ success: true, step: 2, message: 'Preferences saved! Your gym is now live.' });
  } catch (err) {
    console.error('Preferences error:', err.message);
    res.status(500).json({ error: 'Could not save preferences' });
  }
});

// Step 3: Confirm & go live
router.post('/claim/confirm', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId } = req.body;
    await pool.query(
      `UPDATE gyms SET is_active = true, claim_status = 'confirmed', updated_at = NOW()
       WHERE id = $1 AND claimed_by::text = $2::text`,
      [gymId, req.user.id]
    ).catch(() => {});

    res.json({ success: true, step: 3, message: '🎉 Your gym is live on ScanGym!' });
  } catch (err) {
    res.status(500).json({ error: 'Confirmation failed' });
  }
});

// ── #88: Turn On/Off in 1 Click ──
router.patch('/toggle-active', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, isActive } = req.body;
    if (!gymId || typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'gymId and isActive (boolean) required' });
    }

    const result = await pool.query(
      `UPDATE gyms SET is_active = $1, updated_at = NOW()
       WHERE id = $2 AND claimed_by::text = $3::text
       RETURNING id, is_active`,
      [isActive, gymId, req.user.id]
    ).catch(() => ({ rows: [] }));

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Not your gym or gym not found' });
    }

    res.json({
      success: true,
      isActive,
      message: isActive ? 'Gym is now live on ScanGym ✅' : 'Gym paused — hidden from search results'
    });
  } catch (err) {
    console.error('Toggle error:', err.message);
    res.status(500).json({ error: 'Toggle failed' });
  }
});

// ── #89: Open/Close Override (manual hours) ──
router.patch('/hours-override', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, overrideStatus, customHours, reason } = req.body;
    // overrideStatus: 'open_now', 'closed_now', 'use_google_hours'
    // customHours: { monday: { open: '06:00', close: '22:00' }, ... }

    if (!gymId || !overrideStatus) {
      return res.status(400).json({ error: 'gymId and overrideStatus required' });
    }

    const allowed = ['open_now', 'closed_now', 'use_google_hours'];
    if (!allowed.includes(overrideStatus)) {
      return res.status(400).json({ error: 'overrideStatus must be: ' + allowed.join(', ') });
    }

    await pool.query(
      `UPDATE gyms SET
        hours_override = $1,
        custom_hours = COALESCE($2, custom_hours),
        hours_override_reason = $3,
        updated_at = NOW()
       WHERE id = $4 AND claimed_by::text = $5::text`,
      [overrideStatus, customHours ? JSON.stringify(customHours) : null, reason, gymId, req.user.id]
    ).catch(async () => {
      // Store in metadata if columns don't exist
      await pool.query(
        `UPDATE gyms SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND claimed_by::text = $3::text`,
        [JSON.stringify({ hours_override: overrideStatus, custom_hours: customHours, override_reason: reason }), gymId, req.user.id]
      );
    });

    const msgs = {
      open_now: 'Gym marked as OPEN — overriding Google hours',
      closed_now: 'Gym marked as CLOSED — visitors will see a closed notice',
      use_google_hours: 'Using Google Places hours (override removed)'
    };

    res.json({ success: true, status: overrideStatus, message: msgs[overrideStatus] });
  } catch (err) {
    console.error('Hours override error:', err.message);
    res.status(500).json({ error: 'Hours update failed' });
  }
});

// ── #90: 3 Strikes → Suspended ──
router.post('/report', express.json(), async (req, res) => {
  try {
    const { gymId, reason, details } = req.body;
    if (!gymId || !reason) {
      return res.status(400).json({ error: 'gymId and reason required' });
    }

    const validReasons = ['wrong_hours', 'wrong_pricing', 'closed_permanently', 'safety_issue', 'other'];
    if (!validReasons.includes(reason)) {
      return res.status(400).json({ error: 'Invalid reason. Use: ' + validReasons.join(', ') });
    }

    // Try to record strike
    try {
      await pool.query(
        `INSERT INTO gym_strikes (gym_id, reason, details, reported_by, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [gymId, reason, details || '', req.user?.id || 'anonymous']
      );
    } catch (e) {
      // Table might not exist — store in a simpler way
      console.log('gym_strikes table not available, logging report');
    }

    // Check strike count
    const strikes = await pool.query(
      'SELECT COUNT(*) as count FROM gym_strikes WHERE gym_id = $1',
      [gymId]
    ).catch(() => ({ rows: [{ count: 0 }] }));

    const strikeCount = parseInt(strikes.rows[0]?.count || 0);

    // Auto-suspend at 3 strikes
    if (strikeCount >= 3) {
      await pool.query(
        `UPDATE gyms SET is_active = false, suspension_reason = 'auto_3_strikes', suspended_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [gymId]
      ).catch(() => {});
    }

    res.json({
      success: true,
      strikes: strikeCount,
      suspended: strikeCount >= 3,
      message: strikeCount >= 3
        ? 'Gym suspended after 3 reports. Under review.'
        : `Report received (${strikeCount}/3 strikes). Thank you for helping keep ScanGym accurate.`
    });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: 'Report failed' });
  }
});

// ── #95: 24/7 & Self-Serve Gym Filters ──
router.get('/filter', async (req, res) => {
  try {
    const { is24h, isSelfServe, lat, lng, radius } = req.query;
    const conditions = ["status = 'active' OR is_active = true"];
    const params = [];
    let paramIdx = 1;

    if (is24h === 'true') {
      conditions.push(`(is_24h = true OR (metadata->>'is_24h')::boolean = true)`);
    }
    if (isSelfServe === 'true') {
      conditions.push(`(is_self_serve = true OR (metadata->>'is_self_serve')::boolean = true)`);
    }

    // Optional geo filter
    if (lat && lng) {
      const r = parseFloat(radius) || 10; // km
      conditions.push(`ST_DWithin(ST_MakePoint(longitude, latitude)::geography, ST_MakePoint($${paramIdx}, $${paramIdx + 1})::geography, $${paramIdx + 2})`);
      params.push(parseFloat(lng), parseFloat(lat), r * 1000);
      paramIdx += 3;
    }

    const query = `SELECT id, name, address, latitude, longitude, is_24h, is_self_serve, average_rating, total_reviews
                   FROM gyms WHERE ${conditions.join(' AND ')}
                   ORDER BY average_rating DESC NULLS LAST LIMIT 50`;

    const result = await pool.query(query, params).catch(() => ({ rows: [] }));

    res.json({ gyms: result.rows, total: result.rows.length });
  } catch (err) {
    console.error('Filter error:', err.message);
    res.status(500).json({ error: 'Filter failed', gyms: [] });
  }
});

module.exports = router;

// ── Gym Partner Earnings/Revenue Summary ──
router.get('/earnings', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find gyms claimed by this user
    const gyms = await pool.query(
      `SELECT id, name, is_active,
              COALESCE((day_pass_price * 100)::int, 0) as day_pass_price_pence
       FROM gyms WHERE claimed_by::text = $1::text
       ORDER BY name`, [userId]
    );
    
    if (!gyms.rows.length) {
      return res.json({
        success: true,
        totalRevenuePence: 0,
        totalBookings: 0,
        gyms: [],
        stripeConnected: false,
        message: 'No claimed gyms yet'
      });
    }
    
    const gymIds = gyms.rows.map(g => g.id);
    
    // Count bookings for these gyms
    let totalBookings = 0;
    let totalRevenuePence = 0;
    
    try {
      const bookingsRes = await pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM((total_amount * 100)::int), 0) as revenue
         FROM bookings WHERE gym_id = ANY($1) AND status IN ('confirmed', 'completed')`,
        [gymIds]
      );
      totalBookings = parseInt(bookingsRes.rows[0].count) || 0;
      totalRevenuePence = parseInt(bookingsRes.rows[0].revenue) || 0;
    } catch (e) {
      // bookings table might not exist yet
    }
    
    // Check if user has Stripe connected
    let stripeConnected = false;
    try {
      const stripeRes = await pool.query(
        `SELECT stripe_connect_id FROM users WHERE id = $1`, [userId]
      );
      stripeConnected = !!(stripeRes.rows[0]?.stripe_connect_id);
    } catch (e) {
      console.warn('[GymPartner] Failed to check Stripe Connect status:', e.message);
    }
    
    res.json({
      success: true,
      totalRevenuePence,
      totalBookings,
      gyms: gyms.rows.map(g => ({
        id: g.id,
        name: g.name,
        dayPassPricePence: g.day_pass_price_pence || 499,
        active: g.is_active !== false
      })),
      stripeConnected
    });
  } catch (err) {
    console.error('Gym earnings error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch earnings', detail: err.message });
  }
});

// ── Gym Partner Stripe Connect Setup ──
// Creates an Express Connected Account and returns an onboarding link
router.post('/stripe-connect', authenticateUser, express.json(), async (req, res) => {
  try {
    const userId = req.user.id;
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
    
    if (!stripe) {
      return res.status(503).json({ error: 'Payment service not configured. Please contact support.' });
    }
    
    // Verify user has claimed gyms
    const gyms = await pool.query(
      `SELECT id, name FROM gyms WHERE claimed_by::text = $1::text LIMIT 1`, [userId]
    ).catch(() => ({ rows: [] }));
    
    if (!gyms.rows.length) {
      return res.status(400).json({ error: 'You must claim a gym first' });
    }
    
    // Get user info
    const userRes = await pool.query(
      `SELECT email, full_name, stripe_connect_id FROM users WHERE id = $1`, [userId]
    );
    const user = userRes.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    let stripeAccountId = user.stripe_connect_id;
    
    // Create Custom connected account for embedded onboarding
    if (!stripeAccountId) {
      try {
        const account = await stripe.accounts.create({
          country: 'GB',
          email: user.email,
          capabilities: {
            transfers: { requested: true },
          },
          controller: {
            losses: { payments: 'application' },
            fees: { payer: 'application' },
            stripe_dashboard: { type: 'none' },
            requirement_collection: 'application',
          },
          metadata: {
            scangym_user_id: String(userId),
            gym_name: gyms.rows[0].name,
          },
        });
        stripeAccountId = account.id;
        
        // Save to DB
        await pool.query(
          `UPDATE users SET stripe_connect_id = $1 WHERE id = $2`,
          [stripeAccountId, userId]
        );
        console.log(`[StripeConnect] Created account ${stripeAccountId} for user ${userId}`);
      } catch (createErr) {
        console.error('[StripeConnect] Account creation failed:', createErr.message);
        return res.status(500).json({ error: 'Failed to create payout account. Please try again.' });
      }
    }
    
    // Check if onboarding is already complete
    try {
      const account = await stripe.accounts.retrieve(stripeAccountId);
      if (account.payouts_enabled) {
        return res.json({
          success: true,
          stripeConnected: true,
          onboardingComplete: true,
          message: 'Bank account connected and verified ✓',
        });
      }
    } catch (e) {
      console.warn('[StripeConnect] Account retrieve failed:', e.message);
    }
    
    // Create an Account Session for embedded onboarding component
    try {
      const accountSession = await stripe.accountSessions.create({
        account: stripeAccountId,
        components: {
          account_onboarding: { enabled: true },
        },
      });
      
      res.json({
        success: true,
        clientSecret: accountSession.client_secret,
        accountId: stripeAccountId,
        message: 'Complete your bank details to receive payouts',
      });
    } catch (sessionErr) {
      console.error('[StripeConnect] Account session creation failed:', sessionErr.message);
      return res.status(500).json({ error: 'Failed to start onboarding. Please try again.' });
    }
  } catch (err) {
    console.error('Gym Stripe Connect error:', err.message);
    res.status(500).json({ error: 'Stripe setup failed' });
  }
});

// ── Check Stripe Connect Status ──
router.get('/stripe-connect/status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
    
    const userRes = await pool.query(
      `SELECT stripe_connect_id FROM users WHERE id = $1`, [userId]
    );
    const connectId = userRes.rows[0]?.stripe_connect_id;
    
    if (!connectId || !stripe) {
      return res.json({ connected: false, onboardingComplete: false });
    }
    
    try {
      const account = await stripe.accounts.retrieve(connectId);
      return res.json({
        connected: true,
        onboardingComplete: account.charges_enabled && account.payouts_enabled,
        payoutsEnabled: account.payouts_enabled,
        chargesEnabled: account.charges_enabled,
        detailsSubmitted: account.details_submitted,
      });
    } catch (e) {
      return res.json({ connected: false, error: e.message });
    }
  } catch (err) {
    res.status(500).json({ error: 'Status check failed' });
  }
});

// ── Stripe Connect Webhook (for Express account updates) ──
router.post('/stripe-connect/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
  if (!stripe) return res.sendStatus(200);
  
  let event;
  try {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (endpointSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } else {
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('[StripeConnect] Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  // Handle account.updated events
  if (event.type === 'account.updated') {
    const account = event.data.object;
    console.log(`[StripeConnect] Account ${account.id} updated — charges:${account.charges_enabled} payouts:${account.payouts_enabled}`);
    
    if (account.charges_enabled && account.payouts_enabled) {
      // Mark user as fully onboarded
      try {
        await pool.query(
          `UPDATE users SET stripe_connect_verified = true WHERE stripe_connect_id = $1`,
          [account.id]
        );
        console.log(`[StripeConnect] ✅ Account ${account.id} fully verified`);
      } catch (e) {
        console.warn('[StripeConnect] DB update failed:', e.message);
      }
    }
  }
  
  res.sendStatus(200);
});


// ═══════════════════════════════════════════════════════════════════════════
//  PARTNER DASHBOARD — All-in-one data endpoint for partner/index.html
// ═══════════════════════════════════════════════════════════════════════════

router.get('/dashboard', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // 1. Get claimed gyms (use only guaranteed columns)
    const gymsRes = await pool.query(
      `SELECT id, name, address,
              COALESCE(latitude, lat, 0) as latitude,
              COALESCE(longitude, lng, 0) as longitude,
              day_pass_price, is_active, claimed_at
       FROM gyms WHERE claimed_by::text = $1::text ORDER BY name`,
      [userId]
    ).catch(() => ({ rows: [] }));

    if (!gymsRes.rows.length) {
      return res.json({
        success: true,
        hasGyms: false,
        message: 'No claimed gyms. Claim a gym first at /partner',
        gyms: [], today: {}, orders: [], earnings: {}, weeklyChart: []
      });
    }

    const gymIds = gymsRes.rows.map(g => g.id);
    const primaryGym = gymsRes.rows[0];

    // 2. Today's stats
    const todayStats = await pool.query(`
      SELECT
        COUNT(*) as total_bookings,
        COUNT(CASE WHEN status IN ('confirmed','completed') THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled,
        COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN total_amount END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN COALESCE((total_amount * 100)::int, 0) END), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1) AND DATE(created_at) = CURRENT_DATE
    `, [gymIds]).catch(() => ({
      rows: [{ total_bookings: 0, confirmed: 0, pending: 0, cancelled: 0, revenue: 0, revenue_pence: 0 }]
    }));

    const ts = todayStats.rows[0];
    const todayRevenue = parseFloat(ts.revenue) || (parseInt(ts.revenue_pence) / 100) || 0;

    // 3. Active check-ins (recent confirmed bookings today)
    const liveCheckins = await pool.query(`
      SELECT b.id, b.booking_code, b.qr_code, b.status, b.created_at,
             b.total_amount, COALESCE((b.total_amount * 100)::int, 0) as amount_pence_calc, b.booking_type as pass_type,
             COALESCE(b.user_name, u.email, 'Guest') as customer_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      WHERE b.gym_id = ANY($1)
        AND DATE(b.created_at) = CURRENT_DATE
        AND b.status IN ('confirmed', 'pending', 'completed')
      ORDER BY b.created_at DESC LIMIT 20
    `, [gymIds]).catch(err => {
      console.error('[Partner Checkins] Query failed:', err.message);
      return { rows: [] };
    });

    // 4. Weekly chart (last 7 days)
    const weeklyChart = await pool.query(`
      SELECT DATE(created_at) as day,
             COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND created_at > NOW() - INTERVAL '7 days'
        AND status IN ('confirmed','completed')
      GROUP BY DATE(created_at)
      ORDER BY day
    `, [gymIds]).catch(() => ({ rows: [] }));

    // 5. All orders (last 30 days)
    const orders = await pool.query(`
      SELECT b.id, b.booking_code, b.qr_code, b.status, b.created_at,
             b.total_amount, COALESCE((b.total_amount * 100)::int, 0) as amount_pence_calc, b.booking_type as pass_type,
             b.booking_date, b.start_time,
             COALESCE(b.user_name, u.email, 'Guest') as customer_name,
             g.name as gym_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      LEFT JOIN gyms g ON b.gym_id = g.id
      WHERE b.gym_id = ANY($1)
        AND b.created_at > NOW() - INTERVAL '30 days'
      ORDER BY b.created_at DESC LIMIT 100
    `, [gymIds]).catch(err => {
      console.error('[Partner Orders] Query failed:', err.message);
      return { rows: [] };
    });

    // 6. Earnings summary
    const earningsMonth = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND created_at > DATE_TRUNC('month', NOW())
        AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    const earningsWeek = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND created_at > DATE_TRUNC('week', NOW())
        AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    const earningsAll = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    // 7. Reviews
    const avgRating = await pool.query(`
      SELECT AVG(rating) as avg_rating, COUNT(*) as count
      FROM reviews WHERE gym_id = ANY($1)
    `, [gymIds]).catch(() => ({ rows: [{ avg_rating: null, count: 0 }] }));

    // 8. Unique visitors
    const unique = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as count FROM bookings WHERE gym_id = ANY($1)
    `, [gymIds]).catch(() => ({ rows: [{ count: 0 }] }));

    // Calculate revenue helper
    const calcRev = (row) => parseFloat(row.revenue) || (parseInt(row.revenue_pence) / 100) || 0;

    res.json({
      success: true,
      hasGyms: true,
      gyms: gymsRes.rows.map(g => ({
        id: g.id, name: g.name, address: g.address,
        dayPassPrice: g.day_pass_price || 5,
        isActive: g.is_active !== false && g.accepting_bookings !== false,
        rating: g.average_rating, reviews: g.total_reviews,
        is24h: g.is_24h, claimedAt: g.claimed_at
      })),
      today: {
        bookings: parseInt(ts.total_bookings) || 0,
        confirmed: parseInt(ts.confirmed) || 0,
        pending: parseInt(ts.pending) || 0,
        cancelled: parseInt(ts.cancelled) || 0,
        revenue: todayRevenue
      },
      liveCheckins: liveCheckins.rows.map(c => ({
        id: c.id, code: c.booking_code || c.qr_code,
        customer: c.customer_name,
        status: c.status,
        passType: c.pass_type || 'day',
        amount: parseFloat(c.total_amount) || 0,
        time: c.created_at
      })),
      weeklyChart: weeklyChart.rows.map(w => ({
        day: w.day,
        bookings: parseInt(w.bookings),
        revenue: calcRev(w)
      })),
      orders: orders.rows.map(o => ({
        id: o.id, code: o.booking_code || `#SG-${o.id}`,
        customer: o.customer_name,
        status: o.status,
        passType: o.pass_type || 'day',
        amount: parseFloat(o.total_amount) || 0,
        date: o.booking_date || o.created_at,
        time: o.start_time,
        gymName: o.gym_name
      })),
      earnings: {
        thisWeek: calcRev(earningsWeek.rows[0]),
        thisMonth: calcRev(earningsMonth.rows[0]),
        allTime: calcRev(earningsAll.rows[0]),
        weekBookings: parseInt(earningsWeek.rows[0].bookings) || 0,
        monthBookings: parseInt(earningsMonth.rows[0].bookings) || 0,
        allBookings: parseInt(earningsAll.rows[0].bookings) || 0
      },
      rating: {
        average: parseFloat(avgRating.rows[0].avg_rating) || 0,
        count: parseInt(avgRating.rows[0].count) || 0
      },
      uniqueVisitors: parseInt(unique.rows[0].count) || 0
    });
  } catch (err) {
    console.error('[Partner Dashboard] Error:', err.message);
    res.status(500).json({ error: 'Failed to load partner dashboard', detail: err.message });
  }
});

// ── Partner bookings for a specific gym ──
router.get('/bookings/:gymId', authenticateUser, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const userId = req.user.id;

    // Verify ownership
    const gym = await pool.query(
      'SELECT id FROM gyms WHERE id = $1 AND claimed_by::text = $2::text', [gymId, userId]
    ).catch(() => ({ rows: [] }));
    if (!gym.rows.length) return res.status(403).json({ error: 'Not your gym' });

    const { status, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = 'WHERE b.gym_id = $1';
    const params = [gymId];
    if (status && status !== 'all') {
      whereClause += ` AND b.status = $${params.length + 1}`;
      params.push(status);
    }

    const result = await pool.query(`
      SELECT b.*, COALESCE(b.user_name, u.email, 'Guest') as customer_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      ${whereClause}
      ORDER BY b.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, parseInt(limit), offset]).catch(() => ({ rows: [] }));

    const countRes = await pool.query(
      `SELECT COUNT(*) as total FROM bookings b ${whereClause}`, params
    ).catch(() => ({ rows: [{ total: 0 }] }));

    res.json({
      success: true,
      bookings: result.rows,
      total: parseInt(countRes.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ── Partner bookings (no gymId — auto-detect from claimed gyms) ──
router.get('/bookings', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const gyms = await pool.query(
      'SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]
    ).catch(() => ({ rows: [] }));
    if (!gyms.rows.length) return res.json({ bookings: [] });
    const gymIds = gyms.rows.map(g => g.id);

    const { period = 'today', page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let dateFilter = "AND DATE(b.created_at) = CURRENT_DATE";
    if (period === 'week') dateFilter = "AND b.created_at > DATE_TRUNC('week', NOW())";
    if (period === 'month') dateFilter = "AND b.created_at > DATE_TRUNC('month', NOW())";

    const result = await pool.query(`
      SELECT b.id, b.booking_code, b.status, b.created_at, b.booking_date,
             b.total_amount, COALESCE((b.total_amount * 100)::int, 0) as amount_pence_calc, b.booking_type as pass_type, b.start_time,
             COALESCE(b.user_name, u.email, 'Guest') as user_name,
             g.name as gym_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      LEFT JOIN gyms g ON b.gym_id = g.id
      WHERE b.gym_id = ANY($1) ${dateFilter}
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3
    `, [gymIds, parseInt(limit), offset]).catch(() => ({ rows: [] }));

    res.json({
      bookings: result.rows.map(b => ({
        id: b.id, code: b.booking_code,
        userName: b.user_name,
        date: b.booking_date || (b.created_at ? new Date(b.created_at).toLocaleDateString() : ''),
        time: b.start_time || (b.created_at ? new Date(b.created_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : ''),
        passType: b.pass_type || 'Day Pass',
        price: parseFloat(b.total_amount) || 0,
        status: b.status || 'pending',
        gymName: b.gym_name
      }))
    });
  } catch (err) {
    console.error('[Partner Bookings]', err.message);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ── Partner customers ──
router.get('/customers', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const gyms = await pool.query(
      'SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]
    ).catch(() => ({ rows: [] }));
    if (!gyms.rows.length) return res.json({ customers: [], reviews: [] });
    const gymIds = gyms.rows.map(g => g.id);

    // Unique customers
    const customers = await pool.query(`
      SELECT DISTINCT ON (b.user_id)
        b.user_id, COALESCE(b.user_name, u.email, 'Guest') as name,
        COUNT(*) OVER (PARTITION BY b.user_id) as visit_count,
        MAX(b.created_at) OVER (PARTITION BY b.user_id) as last_visit
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      WHERE b.gym_id = ANY($1) AND b.status IN ('confirmed','completed')
      ORDER BY b.user_id, b.created_at DESC
      LIMIT 50
    `, [gymIds]).catch(() => ({ rows: [] }));

    // Reviews
    const reviews = await pool.query(`
      SELECT r.rating, r.comment as text, r.created_at,
             COALESCE(u.email, 'User') as user_name
      FROM reviews r
      LEFT JOIN users u ON r.user_id::text = u.id::text
      WHERE r.gym_id = ANY($1)
      ORDER BY r.created_at DESC LIMIT 20
    `, [gymIds]).catch(() => ({ rows: [] }));

    res.json({
      customers: customers.rows.map(c => ({
        name: c.name,
        visits: parseInt(c.visit_count) || 1,
        lastVisit: c.last_visit ? new Date(c.last_visit).toLocaleDateString() : ''
      })),
      reviews: reviews.rows.map(r => ({
        userName: r.user_name,
        rating: r.rating || 5,
        text: r.text || '',
        date: r.created_at ? new Date(r.created_at).toLocaleDateString() : ''
      }))
    });
  } catch (err) {
    console.error('[Partner Customers]', err.message);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// ── R6-P06: Request payout ──
router.post('/request-payout', authenticateUser, express.json(), async (req, res) => {
  try {
    const userId = req.user.id;
    const stripe = process.env.STRIPE_SECRET_KEY ? require('stripe')(process.env.STRIPE_SECRET_KEY) : null;
    if (!stripe) return res.status(503).json({ error: 'Payment service not configured' });

    // Check Stripe Connect
    const userRes = await pool.query('SELECT stripe_connect_id FROM users WHERE id = $1', [userId]).catch(() => ({ rows: [] }));
    const connectId = userRes.rows[0]?.stripe_connect_id;
    if (!connectId) return res.status(400).json({ error: 'Connect your bank account first (Stripe Connect)' });

    // Calculate pending
    const gyms = await pool.query('SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]).catch(() => ({ rows: [] }));
    if (!gyms.rows.length) return res.json({ error: 'No claimed gyms found' });
    const gymIds = gyms.rows.map(g => g.id);
    const earnings = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) as revenue, COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
       FROM bookings WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')`, [gymIds]
    ).catch(() => ({ rows: [{ revenue: 0, revenue_pence: 0 }] }));
    const row = earnings.rows[0];
    const totalRevenue = parseFloat(row.revenue) || (parseInt(row.revenue_pence) / 100) || 0;
    const partnerShare = totalRevenue * 0.85;

    if (partnerShare < 1) return res.json({ error: 'Minimum payout is £1. Current balance: £' + partnerShare.toFixed(2) });

    // Create Stripe transfer
    try {
      const amountPence = Math.round(partnerShare * 100);
      await stripe.transfers.create({
        amount: amountPence,
        currency: 'gbp',
        destination: connectId,
        description: 'ScanGym partner payout',
        metadata: { scangym_user_id: String(userId) }
      });
      console.log(`[Payout] Transferred £${partnerShare.toFixed(2)} to ${connectId} for user ${userId}`);
      res.json({ success: true, amount: partnerShare.toFixed(2), message: 'Payout of £' + partnerShare.toFixed(2) + ' initiated' });
    } catch (transferErr) {
      console.error('[Payout] Transfer failed:', transferErr.message);
      res.json({ error: 'Transfer failed: ' + transferErr.message });
    }
  } catch (err) {
    console.error('[Payout] Request error:', err.message);
    res.status(500).json({ error: 'Payout request failed' });
  }
});

// ── R6-P07: Daily revenue for sparkline ──
router.get('/daily-revenue', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const gyms = await pool.query('SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]).catch(() => ({ rows: [] }));
    if (!gyms.rows.length) return res.json({ dailyRevenue: [] });
    const gymIds = gyms.rows.map(g => g.id);
    const result = await pool.query(`
      SELECT DATE(created_at) as date,
             COALESCE(SUM(total_amount), 0) as amount
      FROM bookings
      WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')
        AND created_at >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `, [gymIds]).catch(() => ({ rows: [] }));

    // Fill gaps for last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const found = result.rows.find(r => r.date && r.date.toISOString?.().slice(0, 10) === key);
      days.push({ date: key, amount: found ? parseFloat(found.amount) : 0 });
    }
    res.json({ dailyRevenue: days });
  } catch (err) {
    console.error('[DailyRevenue]', err.message);
    res.json({ dailyRevenue: [] });
  }
});

// ── Partner payouts ──
router.get('/payouts', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const gyms = await pool.query(
      'SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]
    ).catch(() => ({ rows: [] }));
    if (!gyms.rows.length) return res.json({ totalEarned: 0, pendingPayout: 0, payouts: [], stripeStatus: 'not_connected' });
    const gymIds = gyms.rows.map(g => g.id);

    // Total earnings
    const earnings = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    const row = earnings.rows[0];
    const totalRevenue = parseFloat(row.revenue) || (parseInt(row.revenue_pence) / 100) || 0;
    const partnerShare = totalRevenue * 0.85; // 85% share

    // Check Stripe Connect status
    let stripeStatus = 'not_connected';
    try {
      const stripeRes = await pool.query(
        'SELECT stripe_connect_id FROM users WHERE id = $1', [userId]
      );
      if (stripeRes.rows[0]?.stripe_connect_id) stripeStatus = 'connected';
    } catch (e) { /* column may not exist */ }

    res.json({
      totalEarned: partnerShare.toFixed(2),
      pendingPayout: partnerShare.toFixed(2),
      payouts: [],
      stripeStatus,
      bookingCount: parseInt(row.bookings) || 0,
      hasClaimed: true
    });
  } catch (err) {
    console.error('[Partner Payouts]', err.message);
    res.status(500).json({ error: 'Failed to fetch payouts' });
  }
});

// ── Update gym capacity ──
router.patch('/capacity', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, maxCapacity } = req.body;
    if (!gymId || !maxCapacity) return res.status(400).json({ error: 'gymId and maxCapacity required' });

    await pool.query(
      `UPDATE gyms SET max_capacity = $1, updated_at = NOW()
       WHERE id = $2 AND claimed_by::text = $3::text`,
      [maxCapacity, gymId, req.user.id]
    ).catch(async () => {
      await pool.query(
        `UPDATE gyms SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb, updated_at = NOW()
         WHERE id = $2 AND claimed_by::text = $3::text`,
        [JSON.stringify({ max_capacity: maxCapacity }), gymId, req.user.id]
      );
    });

    res.json({ success: true, maxCapacity });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update capacity' });
  }
});

// ═══════════════════════════════════════════════════════════════════
//  Ownership verification (Zomato-style)
//  OTP is sent to the gym's *publicly registered* phone number —
//  only someone at the business can read the code back.
//  Fallback: document proof (claim_proof_url) reviewed by support.
// ═══════════════════════════════════════════════════════════════════
const OWN_TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const OWN_TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const OWN_TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// Auto-migration: ownership columns
(async () => {
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='ownership_verified') THEN
          ALTER TABLE gyms ADD COLUMN ownership_verified BOOLEAN DEFAULT false;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='ownership_verified_at') THEN
          ALTER TABLE gyms ADD COLUMN ownership_verified_at TIMESTAMP DEFAULT NULL;
        END IF;
      END $$;
    `);
  } catch (err) {
    console.error('[Ownership] Migration error:', err.message);
  }
})();

function normalizeUkPhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/[\s()-]/g, '');
  if (p.startsWith('+')) return p;
  if (p.startsWith('00')) return '+' + p.slice(2);
  if (p.startsWith('0')) return '+44' + p.slice(1);
  return '+' + p;
}
function maskPhone(p) {
  if (!p || p.length < 6) return '•••';
  return p.slice(0, 3) + ' ••• ••' + p.slice(-3);
}

// POST /claim/send-otp — text a code to the gym's registered business number
router.post('/claim/send-otp', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, channel } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });

    // Validate channel — Twilio Verify supports 'sms' and 'whatsapp'
    const validChannels = ['sms', 'whatsapp'];
    const sendChannel = validChannels.includes(channel) ? channel : 'sms';

    const gym = await pool.query(
      `SELECT id, name, phone, owner_phone, claimed_by, ownership_verified FROM gyms WHERE id = $1`, [gymId]
    );
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];
    if (g.claimed_by && String(g.claimed_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'This gym is claimed by another account' });
    }
    if (g.ownership_verified) return res.json({ success: true, alreadyVerified: true });

    const bizPhone = normalizeUkPhone(g.phone || g.owner_phone);
    if (!bizPhone) {
      // No registered number on file — fall back to document proof
      return res.json({
        success: false,
        fallback: 'document',
        message: 'No registered business number on file for this gym. Upload proof of ownership instead (utility bill, lease, or business registration).',
      });
    }
    if (!OWN_TWILIO_SID || !OWN_TWILIO_TOKEN || !OWN_TWILIO_VERIFY_SID) {
      return res.status(500).json({ error: 'SMS service not configured' });
    }

    const url = `https://verify.twilio.com/v2/Services/${OWN_TWILIO_VERIFY_SID}/Verifications`;
    const params = new URLSearchParams({ To: bizPhone, Channel: sendChannel });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${OWN_TWILIO_SID}:${OWN_TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error(`[Ownership] Twilio ${sendChannel} send error:`, data.message);
      // If WhatsApp fails, suggest trying SMS instead
      if (sendChannel === 'whatsapp') {
        return res.json({
          success: false,
          fallback: 'sms',
          message: 'WhatsApp delivery failed — try SMS instead, or upload proof of ownership.',
        });
      }
      return res.json({
        success: false,
        fallback: 'document',
        message: 'Could not text the registered number. Upload proof of ownership instead.',
      });
    }

    const channelLabel = sendChannel === 'whatsapp' ? 'WhatsApp message' : 'SMS';
    res.json({
      success: true,
      channel: sendChannel,
      maskedPhone: maskPhone(bizPhone),
      message: `${channelLabel} sent to the gym's registered number ${maskPhone(bizPhone)}`,
    });
  } catch (err) {
    console.error('[Ownership] send-otp error:', err.message);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// POST /claim/verify-otp — confirm the code, mark ownership verified
router.post('/claim/verify-otp', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, code } = req.body;
    if (!gymId || !code) return res.status(400).json({ error: 'gymId and code required' });

    const gym = await pool.query(
      `SELECT id, phone, owner_phone, claimed_by FROM gyms WHERE id = $1`, [gymId]
    );
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    const g = gym.rows[0];
    if (g.claimed_by && String(g.claimed_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'This gym is claimed by another account' });
    }
    const bizPhone = normalizeUkPhone(g.phone || g.owner_phone);
    if (!bizPhone) return res.status(400).json({ error: 'No registered number on file' });

    const url = `https://verify.twilio.com/v2/Services/${OWN_TWILIO_VERIFY_SID}/VerificationCheck`;
    const params = new URLSearchParams({ To: bizPhone, Code: code });
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${OWN_TWILIO_SID}:${OWN_TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'approved') {
      return res.status(400).json({ error: 'Invalid or expired code' });
    }

    await pool.query(
      `UPDATE gyms SET ownership_verified = true, ownership_verified_at = NOW(),
       claimed_by = COALESCE(claimed_by, $1), claim_status = 'verified', updated_at = NOW()
       WHERE id = $2`,
      [req.user.id, gymId]
    ).catch(async () => {
      await pool.query(
        `UPDATE gyms SET ownership_verified = true, ownership_verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [gymId]
      );
    });

    res.json({ success: true, message: '✅ Ownership verified — Verified badge unlocked!' });
  } catch (err) {
    console.error('[Ownership] verify-otp error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// GET /claim/verification-status?gymId= — is this gym ownership-verified?
router.get('/claim/verification-status', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.query;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });
    const gym = await pool.query(
      `SELECT ownership_verified, phone, owner_phone, claim_status FROM gyms WHERE id = $1`, [gymId]
    );
    if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
    res.json({
      verified: gym.rows[0].ownership_verified === true,
      hasRegisteredPhone: !!(gym.rows[0].phone || gym.rows[0].owner_phone),
      proofSubmitted: gym.rows[0].claim_status === 'proof_submitted',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ═══════════════════════════════════════════════════════════════
// Ownership proof fallback — upload a utility bill, lease,
// business registration (photo/PDF) or a short video inside the gym.
// Used when the OTP-to-registered-number path isn't possible.
// ═══════════════════════════════════════════════════════════════
const multerProof = require('multer');
const pathProof = require('path');
const fsProof = require('fs');
const cryptoProof = require('crypto');

const PROOF_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data/uploads/ownership-proofs'
  : pathProof.join(__dirname, '..', 'uploads', 'ownership-proofs');

const proofStorage = multerProof.diskStorage({
  destination: (req, file, cb) => {
    if (!fsProof.existsSync(PROOF_DIR)) fsProof.mkdirSync(PROOF_DIR, { recursive: true });
    cb(null, PROOF_DIR);
  },
  filename: (req, file, cb) => {
    const hash = cryptoProof.randomBytes(8).toString('hex');
    const ext = pathProof.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `own_${Date.now()}_${hash}${ext}`);
  },
});

const proofUpload = multerProof({
  storage: proofStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB (allows a short video)
  fileFilter: (req, file, cb) => {
    const allowed = /^(image\/(jpeg|jpg|png|webp|heic)|video\/(mp4|quicktime|webm|mov)|application\/pdf)$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images, PDFs and short videos are allowed'));
  },
});

// Auto-migration: proof columns
(async () => {
  try {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_status') THEN
          ALTER TABLE gyms ADD COLUMN claim_status VARCHAR(50) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_type') THEN
          ALTER TABLE gyms ADD COLUMN claim_proof_type VARCHAR(20) DEFAULT NULL;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='claim_proof_at') THEN
          ALTER TABLE gyms ADD COLUMN claim_proof_at TIMESTAMP DEFAULT NULL;
        END IF;
      END $$;
    `);
    console.log('[Ownership] proof columns verified');
  } catch (err) {
    console.error('[Ownership] proof migration error:', err.message);
  }
})();

// POST /claim/upload-proof — multipart form, field name "proof"
router.post('/claim/upload-proof', authenticateUser, (req, res) => {
  proofUpload.single('proof')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'Upload failed' });
    }
    try {
      const gymId = req.body.gymId;
      if (!gymId) return res.status(400).json({ error: 'gymId required' });
      if (!req.file) return res.status(400).json({ error: 'No file received' });

      const gym = await pool.query(
        `SELECT id, claimed_by, ownership_verified FROM gyms WHERE id = $1`, [gymId]
      );
      if (!gym.rows.length) return res.status(404).json({ error: 'Gym not found' });
      const g = gym.rows[0];
      if (g.claimed_by && String(g.claimed_by) !== String(req.user.id)) {
        return res.status(403).json({ error: 'This gym is claimed by another account' });
      }
      if (g.ownership_verified) return res.json({ success: true, alreadyVerified: true });

      const proofType = /^video\//i.test(req.file.mimetype) ? 'video'
        : req.file.mimetype === 'application/pdf' ? 'pdf' : 'photo';
      const localPath = req.file.path;

      await pool.query(
        `UPDATE gyms SET claim_proof_url = $1, claim_proof_type = $2, claim_proof_at = NOW(),
           claim_status = 'proof_submitted', claimed_by = COALESCE(claimed_by, $3), updated_at = NOW()
         WHERE id = $4`,
        [localPath, proofType, req.user.id, gymId]
      );

      // Background R2 upload (non-blocking; keeps local path as fallback)
      (async () => {
        try {
          const { uploadToR2 } = require('../lib/r2-upload');
          const r2Key = `ownership-proofs/${gymId}/${pathProof.basename(localPath)}`;
          const result = await uploadToR2(localPath, r2Key, { contentType: req.file.mimetype });
          if (result && result.url) {
            await pool.query('UPDATE gyms SET claim_proof_url = $1 WHERE id = $2', [result.url, gymId]);
          }
        } catch (e) {
          console.log('[Ownership] R2 proof upload skipped:', e.message);
        }
      })();

      res.json({
        success: true,
        status: 'proof_submitted',
        message: 'Proof received — we review within 24 hours and mark you as verified owner.',
      });
    } catch (err) {
      console.error('[Ownership] upload-proof error:', err.message);
      res.status(500).json({ error: 'Failed to save proof' });
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Round 2 — Withdraw methods + bank-transfer payout fallback
// Saved payout method per user (bank / paypal / stripe_connect) and
// a withdrawal-request queue for users without Stripe Connect.
// ═══════════════════════════════════════════════════════════════
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payout_methods (
        user_id TEXT PRIMARY KEY,
        method VARCHAR(30) NOT NULL,
        details JSONB DEFAULT '{}'::jsonb,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS payout_requests (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        role VARCHAR(20) DEFAULT 'partner',
        amount_pence INTEGER NOT NULL,
        method VARCHAR(30),
        details JSONB DEFAULT '{}'::jsonb,
        status VARCHAR(20) DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW(),
        processed_at TIMESTAMP
      );
    `);
    console.log('[Payouts] payout_methods / payout_requests tables verified');
  } catch (err) {
    console.error('[Payouts] migration error:', err.message);
  }
})();

function maskAccount(details) {
  const d = details || {};
  if (d.accountNumber) return { type: 'bank', accountName: d.accountName || '', last4: String(d.accountNumber).slice(-4) };
  if (d.iban) return { type: 'bank_international', accountName: d.accountName || '', last4: String(d.iban).slice(-4), swift: d.swift || '' };
  if (d.paypalEmail) {
    const [u, dom] = String(d.paypalEmail).split('@');
    return { type: 'paypal', email: (u || '').slice(0, 2) + '•••@' + (dom || '') };
  }
  return { type: 'other' };
}

// GET /api/gym-partner/payout-method — masked saved method
router.get('/payout-method', authenticateUser, async (req, res) => {
  try {
    const r = await pool.query('SELECT method, details FROM payout_methods WHERE user_id = $1', [String(req.user.id)]);
    if (!r.rows.length) return res.json({ method: null });
    res.json({ method: r.rows[0].method, summary: maskAccount(r.rows[0].details) });
  } catch (err) {
    console.error('[Payouts] get method error:', err.message);
    res.status(500).json({ error: 'Failed to load payout method' });
  }
});

// POST /api/gym-partner/payout-method — save/replace method
router.post('/payout-method', authenticateUser, express.json(), async (req, res) => {
  try {
    const { method, details } = req.body;
    if (!['bank', 'paypal', 'stripe_connect'].includes(method)) {
      return res.status(400).json({ error: 'method must be bank, paypal or stripe_connect' });
    }
    const d = details || {};
    if (method === 'bank') {
      if (!d.accountName) return res.status(400).json({ error: 'Account holder name required' });
      if (d.iban || d.swift) {
        // International: any bank worldwide via IBAN/account number + SWIFT/BIC
        const iban = String(d.iban || '').replace(/\s+/g, '').toUpperCase();
        const swift = String(d.swift || '').replace(/\s+/g, '').toUpperCase();
        if (iban.length < 8) return res.status(400).json({ error: 'IBAN or account number required' });
        if (swift.length < 8 || swift.length > 11) return res.status(400).json({ error: 'SWIFT / BIC code must be 8-11 characters' });
        d.iban = iban; d.swift = swift;
        delete d.sortCode; delete d.accountNumber;
      } else {
        const sort = String(d.sortCode || '').replace(/[^0-9]/g, '');
        const acct = String(d.accountNumber || '').replace(/[^0-9]/g, '');
        if (sort.length !== 6 || acct.length !== 8) {
          return res.status(400).json({ error: 'UK bank details need a 6-digit sort code and 8-digit account number' });
        }
        d.sortCode = sort; d.accountNumber = acct;
      }
    }
    if (method === 'paypal' && !(d.paypalEmail || '').includes('@')) {
      return res.status(400).json({ error: 'Valid PayPal email required' });
    }
    await pool.query(
      `INSERT INTO payout_methods (user_id, method, details, updated_at)
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT (user_id) DO UPDATE SET method = $2, details = $3::jsonb, updated_at = NOW()`,
      [String(req.user.id), method, JSON.stringify(d)]
    );
    res.json({ success: true, method, summary: maskAccount(d) });
  } catch (err) {
    console.error('[Payouts] save method error:', err.message);
    res.status(500).json({ error: 'Failed to save payout method' });
  }
});

// POST /api/gym-partner/withdraw-request — bank/paypal payout fallback
// Used when Stripe Connect isn't set up. Creates a pending request
// that is paid manually, and never double-counts earlier requests.
router.post('/withdraw-request', authenticateUser, express.json(), async (req, res) => {
  try {
    const userId = String(req.user.id);
    const role = req.body.role === 'creator' ? 'creator' : 'partner';

    // Saved method required
    const m = await pool.query('SELECT method, details FROM payout_methods WHERE user_id = $1', [userId]);
    if (!m.rows.length) return res.status(400).json({ error: 'Add a withdraw method first' });

    // Available balance
    let availablePence = 0;
    if (role === 'partner') {
      const gyms = await pool.query('SELECT id FROM gyms WHERE claimed_by::text = $1::text', [userId]).catch(() => ({ rows: [] }));
      if (gyms.rows.length) {
        const gymIds = gyms.rows.map(g => g.id);
        const earn = await pool.query(
          `SELECT COALESCE(SUM((total_amount * 100)::int), 0) as revenue_pence
           FROM bookings WHERE gym_id = ANY($1) AND status IN ('confirmed','completed')`, [gymIds]
        ).catch(() => ({ rows: [{ revenue_pence: 0 }] }));
        availablePence = Math.floor(parseInt(earn.rows[0].revenue_pence || 0) * 0.85);
      }
    } else {
      // Creator: 25% commission balance from referrals system
      const handle = req.body.creatorHandle;
      if (handle) {
        const earned = await pool.query(
          `SELECT COALESCE(SUM(commission_pence), 0) as total FROM creator_referrals
           WHERE creator_handle = $1 AND status = 'converted'`, [handle]
        ).catch(() => ({ rows: [{ total: 0 }] }));
        availablePence = parseInt(earned.rows[0].total || 0);
      }
    }
    // Minus previous non-rejected requests
    const prev = await pool.query(
      `SELECT COALESCE(SUM(amount_pence), 0) as used FROM payout_requests
       WHERE user_id = $1 AND status IN ('pending','approved','paid')`, [userId]
    );
    availablePence -= parseInt(prev.rows[0].used || 0);

    let amountPence = req.body.amountPence ? parseInt(req.body.amountPence)
      : req.body.amount ? Math.round(parseFloat(req.body.amount) * 100)
      : availablePence;
    if (!amountPence || amountPence < 100) {
      return res.status(400).json({ error: `Minimum withdrawal is £1.00. Available: £${(Math.max(availablePence, 0) / 100).toFixed(2)}` });
    }
    if (amountPence > availablePence) {
      return res.status(400).json({ error: `Insufficient balance. Available: £${(Math.max(availablePence, 0) / 100).toFixed(2)}` });
    }

    const r = await pool.query(
      `INSERT INTO payout_requests (user_id, role, amount_pence, method, details, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id, requested_at`,
      [userId, role, amountPence, m.rows[0].method, JSON.stringify(m.rows[0].details || {})]
    );
    console.log(`[Payouts] Withdrawal request #${r.rows[0].id}: £${(amountPence / 100).toFixed(2)} (${role}) by user ${userId}`);
    res.json({
      success: true,
      requestId: r.rows[0].id,
      amount: (amountPence / 100).toFixed(2),
      message: `Withdrawal of £${(amountPence / 100).toFixed(2)} requested — funds arrive in 2-5 business days.`,
    });
  } catch (err) {
    console.error('[Payouts] withdraw-request error:', err.message);
    res.status(500).json({ error: 'Withdrawal request failed' });
  }
});

// GET /api/gym-partner/withdraw-requests — history for the signed-in user
router.get('/withdraw-requests', authenticateUser, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, role, amount_pence, method, status, requested_at
       FROM payout_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20`, [String(req.user.id)]
    );
    res.json({ requests: r.rows.map(x => ({
      id: x.id, role: x.role, amount: (x.amount_pence / 100).toFixed(2),
      method: x.method, status: x.status, date: x.requested_at,
    })) });
  } catch (err) {
    res.json({ requests: [] });
  }
});
