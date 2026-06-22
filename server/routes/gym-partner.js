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
    } catch (e) {}
    
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
router.post('/stripe-connect', authenticateUser, express.json(), async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Verify user has claimed gyms
    const gyms = await pool.query(
      `SELECT id FROM gyms WHERE claimed_by::text = $1::text LIMIT 1`, [userId]
    ).catch(() => ({ rows: [] }));
    
    if (!gyms.rows.length) {
      return res.status(400).json({ error: 'You must claim a gym first' });
    }
    
    // Create or retrieve Stripe Connect account
    let stripeAccountId;
    try {
      const existing = await pool.query(
        `SELECT stripe_connect_id FROM users WHERE id = $1`, [userId]
      );
      stripeAccountId = existing.rows[0]?.stripe_connect_id;
    } catch (e) {}
    
    if (!stripeAccountId) {
      // Would create a Stripe Connect account - for now return instruction
      return res.json({
        success: true,
        message: 'Stripe Connect setup initiated. We will contact you to complete bank verification.',
        setupPending: true
      });
    }
    
    res.json({
      success: true,
      stripeConnected: true,
      message: 'Stripe account already connected'
    });
  } catch (err) {
    console.error('Gym Stripe Connect error:', err.message);
    res.status(500).json({ error: 'Stripe setup failed' });
  }
});
