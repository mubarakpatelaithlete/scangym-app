/**
 * Admin Dashboard API — Enhanced metrics
 * 
 * GET /api/stats/admin-dashboard
 * Returns: total registrations, active users, activity levels,
 *          cohort retention, revenue breakdown, NPS
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

// Ensure session auth
function authenticateUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = { id: req.session.userId };
  next();
}

// Safe interval helper
function safeInterval(period) {
  const map = { 'today': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': '10 years' };
  return map[period] || '30 days';
}

// ────────────────────────────────────────────────────────
// GET /api/stats/admin-dashboard?period=30d
// ────────────────────────────────────────────────────────
router.get('/admin-dashboard', authenticateUser, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const interval = safeInterval(period);
    const result = {};

    // ═══ 1. TOTAL REGISTRATIONS ═══
    try {
      // All time total
      const totalAll = await pool.query('SELECT COUNT(*) FROM users');
      // In period
      const totalPeriod = await pool.query(
        `SELECT COUNT(*) FROM users WHERE created_at > NOW() - INTERVAL '${interval}'`
      );
      // Daily registration trend
      const regTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM users
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY DATE_TRUNC('day', created_at)::date
        ORDER BY date
      `);
      // Growth rate: compare current period vs previous period
      const prevPeriod = await pool.query(
        `SELECT COUNT(*) FROM users 
         WHERE created_at > NOW() - INTERVAL '${interval}' * 2
         AND created_at <= NOW() - INTERVAL '${interval}'`
      );
      const cur = parseInt(totalPeriod.rows[0].count);
      const prev = parseInt(prevPeriod.rows[0].count);
      const growthPct = prev > 0 ? (((cur - prev) / prev) * 100).toFixed(1) : cur > 0 ? '100.0' : '0.0';

      result.registrations = {
        total: parseInt(totalAll.rows[0].count),
        inPeriod: cur,
        previousPeriod: prev,
        growthPercent: parseFloat(growthPct),
        trend: regTrend.rows.map(r => ({ date: r.date, count: parseInt(r.count) })),
      };
    } catch (e) {
      console.warn('[AdminDash] Registrations error:', e.message);
      result.registrations = { total: 0, inPeriod: 0, previousPeriod: 0, growthPercent: 0, trend: [] };
    }

    // ═══ 2. ACTIVE USERS ═══
    // "Active" = made at least one booking OR analytics event in the period
    try {
      // Users who booked
      const bookers = await pool.query(
        `SELECT COUNT(DISTINCT user_id) FROM bookings WHERE created_at > NOW() - INTERVAL '${interval}'`
      );
      // Users who visited (analytics events with a user reference or unique IPs)
      const visitors = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) FROM analytics_events WHERE created_at > NOW() - INTERVAL '${interval}'`
      );
      // DAU (today)
      const dau = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) FROM analytics_events WHERE created_at > CURRENT_DATE`
      );
      // WAU (7 days)
      const wau = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) FROM analytics_events WHERE created_at > NOW() - INTERVAL '7 days'`
      );
      // MAU (30 days)
      const mau = await pool.query(
        `SELECT COUNT(DISTINCT ip_address) FROM analytics_events WHERE created_at > NOW() - INTERVAL '30 days'`
      );

      result.activeUsers = {
        bookedInPeriod: parseInt(bookers.rows[0].count),
        visitorsInPeriod: parseInt(visitors.rows[0].count),
        dau: parseInt(dau.rows[0].count),
        wau: parseInt(wau.rows[0].count),
        mau: parseInt(mau.rows[0].count),
        stickiness: parseInt(mau.rows[0].count) > 0
          ? parseFloat(((parseInt(dau.rows[0].count) / parseInt(mau.rows[0].count)) * 100).toFixed(1))
          : 0,
      };
    } catch (e) {
      console.warn('[AdminDash] Active users error:', e.message);
      result.activeUsers = { bookedInPeriod: 0, visitorsInPeriod: 0, dau: 0, wau: 0, mau: 0, stickiness: 0 };
    }

    // ═══ 3. ACTIVITY LEVELS ═══
    // Bookings per day, peak hours, most popular gyms
    try {
      // Bookings per day trend
      const bookingTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM bookings
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY DATE_TRUNC('day', created_at)::date
        ORDER BY date
      `);
      // Peak hours (hour of day in UTC)
      const peakHours = await pool.query(`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
        FROM bookings
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY count DESC LIMIT 5
      `);
      // Top gyms by bookings
      const topGyms = await pool.query(`
        SELECT g.name, COUNT(b.id) as bookings
        FROM bookings b JOIN gyms g ON b.gym_id = g.id
        WHERE b.created_at > NOW() - INTERVAL '${interval}'
        GROUP BY g.name ORDER BY bookings DESC LIMIT 5
      `);
      // Page views trend
      const pvTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY DATE_TRUNC('day', created_at)::date
        ORDER BY date
      `);

      result.activityLevels = {
        bookingTrend: bookingTrend.rows.map(r => ({ date: r.date, count: parseInt(r.count) })),
        peakHours: peakHours.rows.map(r => ({ hour: parseInt(r.hour), count: parseInt(r.count) })),
        topGyms: topGyms.rows.map(r => ({ name: r.name, bookings: parseInt(r.bookings) })),
        pageViewTrend: pvTrend.rows.map(r => ({ date: r.date, count: parseInt(r.count) })),
        totalBookingsInPeriod: bookingTrend.rows.reduce((s, r) => s + parseInt(r.count), 0),
        totalPageViewsInPeriod: pvTrend.rows.reduce((s, r) => s + parseInt(r.count), 0),
      };
    } catch (e) {
      console.warn('[AdminDash] Activity levels error:', e.message);
      result.activityLevels = { bookingTrend: [], peakHours: [], topGyms: [], pageViewTrend: [], totalBookingsInPeriod: 0, totalPageViewsInPeriod: 0 };
    }

    // ═══ 4. COHORT RETENTION ═══
    // Weekly cohorts: what % of users who signed up in week X came back in weeks X+1, X+2, etc.
    try {
      const cohorts = await pool.query(`
        WITH user_cohorts AS (
          SELECT id as user_id,
                 DATE_TRUNC('week', created_at)::date as cohort_week
          FROM users
          WHERE created_at > NOW() - INTERVAL '${interval}'
        ),
        user_activity AS (
          SELECT DISTINCT b.user_id,
                 DATE_TRUNC('week', b.created_at)::date as activity_week
          FROM bookings b
          WHERE b.created_at > NOW() - INTERVAL '${interval}'
        )
        SELECT uc.cohort_week,
               COUNT(DISTINCT uc.user_id) as cohort_size,
               COUNT(DISTINCT ua.user_id) as returned,
               EXTRACT(WEEK FROM ua.activity_week - uc.cohort_week) as week_offset
        FROM user_cohorts uc
        LEFT JOIN user_activity ua ON uc.user_id::text = ua.user_id::text
          AND ua.activity_week >= uc.cohort_week
        GROUP BY uc.cohort_week, week_offset
        ORDER BY uc.cohort_week, week_offset
      `);

      // Build cohort table: { cohort_week, size, retention: [week0%, week1%, ...] }
      const cohortMap = {};
      for (const row of cohorts.rows) {
        const cw = row.cohort_week;
        if (!cohortMap[cw]) cohortMap[cw] = { cohort_week: cw, size: parseInt(row.cohort_size), weeks: {} };
        if (row.week_offset !== null) {
          cohortMap[cw].weeks[parseInt(row.week_offset)] = parseInt(row.returned);
        }
      }

      result.cohortRetention = Object.values(cohortMap).map(c => ({
        cohort_week: c.cohort_week,
        size: c.size,
        retention: Object.entries(c.weeks).map(([wk, ret]) => ({
          week: parseInt(wk),
          returned: ret,
          percent: c.size > 0 ? parseFloat(((ret / c.size) * 100).toFixed(1)) : 0,
        })).sort((a, b) => a.week - b.week),
      })).slice(-8); // last 8 cohorts
    } catch (e) {
      console.warn('[AdminDash] Cohort retention error:', e.message);
      result.cohortRetention = [];
    }

    // ═══ 5. REVENUE ═══
    try {
      // Total revenue all time
      const allRev = await pool.query(`
        SELECT COALESCE(SUM(g.day_pass_price), 0) as total
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
      `);
      // Revenue in period
      const periodRev = await pool.query(`
        SELECT COALESCE(SUM(g.day_pass_price), 0) as total
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
        AND b.created_at > NOW() - INTERVAL '${interval}'
      `);
      // Revenue trend (daily)
      const revTrend = await pool.query(`
        SELECT DATE_TRUNC('day', b.created_at)::date as date,
               COALESCE(SUM(g.day_pass_price), 0) as revenue,
               COUNT(b.id) as bookings
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
        AND b.created_at > NOW() - INTERVAL '${interval}'
        GROUP BY DATE_TRUNC('day', b.created_at)::date
        ORDER BY date
      `);
      // Previous period revenue for comparison
      const prevRev = await pool.query(`
        SELECT COALESCE(SUM(g.day_pass_price), 0) as total
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
        AND b.created_at > NOW() - INTERVAL '${interval}' * 2
        AND b.created_at <= NOW() - INTERVAL '${interval}'
      `);

      const totalAll = parseFloat(allRev.rows[0].total);
      const totalPeriod = parseFloat(periodRev.rows[0].total);
      const totalPrev = parseFloat(prevRev.rows[0].total);
      const revGrowth = totalPrev > 0 ? (((totalPeriod - totalPrev) / totalPrev) * 100).toFixed(1) : totalPeriod > 0 ? '100.0' : '0.0';

      result.revenue = {
        totalAllTime: totalAll,
        totalAllTimeFormatted: '£' + totalAll.toFixed(2),
        inPeriod: totalPeriod,
        inPeriodFormatted: '£' + totalPeriod.toFixed(2),
        previousPeriod: totalPrev,
        growthPercent: parseFloat(revGrowth),
        scanGymShare: parseFloat((totalPeriod * 0.25).toFixed(2)),
        gymOwnerShare: parseFloat((totalPeriod * 0.75).toFixed(2)),
        trend: revTrend.rows.map(r => ({
          date: r.date,
          revenue: parseFloat(r.revenue),
          bookings: parseInt(r.bookings),
        })),
      };
    } catch (e) {
      console.warn('[AdminDash] Revenue error:', e.message);
      result.revenue = { totalAllTime: 0, totalAllTimeFormatted: '£0.00', inPeriod: 0, inPeriodFormatted: '£0.00', previousPeriod: 0, growthPercent: 0, scanGymShare: 0, gymOwnerShare: 0, trend: [] };
    }

    // ═══ 6. NET PROMOTER SCORE (NPS) ═══
    // Check if nps_responses table exists; if not, return placeholder
    try {
      // Try to query the table
      const npsData = await pool.query(`
        SELECT score, COUNT(*) as cnt
        FROM nps_responses
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY score ORDER BY score
      `);

      let promoters = 0, passives = 0, detractors = 0, total = 0;
      for (const row of npsData.rows) {
        const score = parseInt(row.score);
        const cnt = parseInt(row.cnt);
        total += cnt;
        if (score >= 9) promoters += cnt;
        else if (score >= 7) passives += cnt;
        else detractors += cnt;
      }

      const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;

      result.nps = {
        score: nps,
        totalResponses: total,
        promoters,
        passives,
        detractors,
        promoterPercent: total > 0 ? parseFloat(((promoters / total) * 100).toFixed(1)) : 0,
        detractorPercent: total > 0 ? parseFloat(((detractors / total) * 100).toFixed(1)) : 0,
        distribution: npsData.rows.map(r => ({ score: parseInt(r.score), count: parseInt(r.cnt) })),
      };
    } catch (e) {
      // Table doesn't exist yet — create it and return placeholder
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS nps_responses (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255),
            score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
            feedback TEXT,
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        console.log('[AdminDash] Created nps_responses table');
      } catch (ce) {
        console.warn('[AdminDash] Could not create nps_responses table:', ce.message);
      }
      result.nps = {
        score: null,
        totalResponses: 0,
        promoters: 0,
        passives: 0,
        detractors: 0,
        promoterPercent: 0,
        detractorPercent: 0,
        distribution: [],
        note: 'NPS collection not yet started — add survey to post-booking flow',
      };
    }

    result.period = period;
    result.generatedAt = new Date().toISOString();
    res.json(result);
  } catch (err) {
    console.error('[AdminDash] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate admin dashboard' });
  }
});

// POST /api/stats/nps — Submit an NPS response
router.post('/nps', authenticateUser, async (req, res) => {
  try {
    const { score, feedback } = req.body;
    if (score === undefined || score < 0 || score > 10) {
      return res.status(400).json({ error: 'Score must be 0-10' });
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS nps_responses (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255),
        score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
        feedback TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(
      'INSERT INTO nps_responses (user_id, score, feedback) VALUES ($1, $2, $3)',
      [req.user.id, score, feedback || null]
    );
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    console.error('[NPS] Error:', err.message);
    res.status(500).json({ error: 'Failed to save NPS response' });
  }
});

module.exports = router;
