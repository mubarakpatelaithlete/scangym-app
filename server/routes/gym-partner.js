/**
 * Gym Partner Routes (#86, #88, #89, #90, #95)
 * Claim wizard, 1-click toggle, open/close override, strikes, 24/7 filter
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

function authenticateUser(req, res, next) {
  if (!req.user?.id) return res.status(401).json({ error: 'Login required' });
  next();
}

// ── #86: 3-Step Claim Wizard ──
// Step 1: Claim gym (basic info check)
router.post('/claim', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, ownerName, ownerEmail, ownerPhone, proofUrl } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId required' });

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
      `SELECT id, name, day_pass_price_pence, accepting_bookings
       FROM gyms WHERE claimed_by::text = $1::text
       ORDER BY name`, [userId]
    ).catch(() => ({ rows: [] }));
    
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
        `SELECT COUNT(*) as count, COALESCE(SUM(amount_pence), 0) as revenue
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
        active: g.accepting_bookings !== false
      })),
      stripeConnected
    });
  } catch (err) {
    console.error('Gym earnings error:', err.message);
    res.status(500).json({ error: 'Failed to fetch earnings' });
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
    
    // Create Express account if none exists
    if (!stripeAccountId) {
      try {
        const account = await stripe.accounts.create({
          type: 'express',
          country: 'GB',
          email: user.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
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
      if (account.charges_enabled && account.payouts_enabled) {
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
    
    // Create onboarding link
    const BASE = process.env.BASE_URL || 'https://scangym.com';
    try {
      const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${BASE}/partner?stripe=refresh`,
        return_url: `${BASE}/partner?stripe=success`,
        type: 'account_onboarding',
      });
      
      res.json({
        success: true,
        onboardingUrl: accountLink.url,
        message: 'Complete your bank details to receive payouts',
      });
    } catch (linkErr) {
      console.error('[StripeConnect] Account link creation failed:', linkErr.message);
      return res.status(500).json({ error: 'Failed to generate onboarding link. Please try again.' });
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

    // 1. Get claimed gyms
    const gymsRes = await pool.query(
      `SELECT id, name, address, latitude, longitude, day_pass_price,
              is_active, claimed_at, average_rating, total_reviews,
              accepting_bookings, is_24h
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
        COALESCE(SUM(CASE WHEN status IN ('confirmed','completed') THEN COALESCE(amount_pence,0) END), 0) as revenue_pence
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
             b.total_amount, b.amount_pence, b.pass_type, b.booking_type,
             COALESCE(b.user_name, u.name, u.email, 'Guest') as customer_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      WHERE b.gym_id = ANY($1)
        AND DATE(b.created_at) = CURRENT_DATE
        AND b.status IN ('confirmed', 'pending', 'completed')
      ORDER BY b.created_at DESC LIMIT 20
    `, [gymIds]).catch(() => ({ rows: [] }));

    // 4. Weekly chart (last 7 days)
    const weeklyChart = await pool.query(`
      SELECT DATE(created_at) as day,
             COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM(amount_pence), 0) as revenue_pence
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
             b.total_amount, b.amount_pence, b.pass_type, b.booking_type,
             b.booking_date, b.start_time,
             COALESCE(b.user_name, u.name, u.email, 'Guest') as customer_name,
             g.name as gym_name
      FROM bookings b
      LEFT JOIN users u ON b.user_id::text = u.id::text
      LEFT JOIN gyms g ON b.gym_id = g.id
      WHERE b.gym_id = ANY($1)
        AND b.created_at > NOW() - INTERVAL '30 days'
      ORDER BY b.created_at DESC LIMIT 100
    `, [gymIds]).catch(() => ({ rows: [] }));

    // 6. Earnings summary
    const earningsMonth = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM(amount_pence), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND created_at > DATE_TRUNC('month', NOW())
        AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    const earningsWeek = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM(amount_pence), 0) as revenue_pence
      FROM bookings
      WHERE gym_id = ANY($1)
        AND created_at > DATE_TRUNC('week', NOW())
        AND status IN ('confirmed','completed')
    `, [gymIds]).catch(() => ({ rows: [{ bookings: 0, revenue: 0, revenue_pence: 0 }] }));

    const earningsAll = await pool.query(`
      SELECT COUNT(*) as bookings,
             COALESCE(SUM(total_amount), 0) as revenue,
             COALESCE(SUM(amount_pence), 0) as revenue_pence
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
        amount: parseFloat(c.total_amount) || (parseInt(c.amount_pence) / 100) || 0,
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
        amount: parseFloat(o.total_amount) || (parseInt(o.amount_pence) / 100) || 0,
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
      SELECT b.*, COALESCE(b.user_name, u.name, u.email, 'Guest') as customer_name
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
             b.total_amount, b.amount_pence, b.pass_type, b.start_time,
             COALESCE(b.user_name, u.name, u.email, 'Guest') as user_name,
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
        price: parseFloat(b.total_amount) || (parseInt(b.amount_pence) / 100) || 0,
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
        b.user_id, COALESCE(b.user_name, u.name, u.email, 'Guest') as name,
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
             COALESCE(u.name, u.email, 'User') as user_name
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
             COALESCE(SUM(amount_pence), 0) as revenue_pence
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
      pendingPayout: partnerShare.toFixed(2), // All earnings are pending until payout system is built
      payouts: [], // No payout history yet — will be populated when Stripe payouts are set up
      stripeStatus,
      bookingCount: parseInt(row.bookings) || 0
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
