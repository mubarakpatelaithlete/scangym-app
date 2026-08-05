/**
 * Admin Dashboard API — Enhanced metrics (v3: REAL data fixes)
 *
 * GET /api/stats/admin-dashboard
 * Returns: total registrations, active users, activity levels,
 *          cohort retention, revenue breakdown, NPS
 *
 * v3 fixes (see PR fix/admin-dashboard-real-metrics):
 *  - Cohort retention SQL was invalid (EXTRACT(WEEK FROM integer)) -> always empty
 *  - Revenue used gyms.day_pass_price (current list price) instead of the
 *    actual charged amount (bookings.amount_pence). Google Places bookings
 *    (gym_id NULL) contributed GBP 0.
 *  - DAU/WAU/MAU counted raw distinct IPs incl. bots, health checks and the
 *    admin dashboard's own 60s polling
 *  - "Page Views" counted every analytics row incl. all API calls
 *  - Booking counts included pending/cancelled/failed rows
 *  - Errors were silently swallowed and rendered as 0 (looked fake) ->
 *    now each section carries an _error flag the UI can surface
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

// ── Startup migrations (idempotent) ──

// ── Auth: session + optional admin allowlist ──
// Set ADMIN_USER_IDS (comma-separated users.id UUIDs) to lock this down.
// Without it, any authenticated user can view (legacy behaviour, warned).
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

function authenticateAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (ADMIN_USER_IDS.length > 0 && !ADMIN_USER_IDS.includes(String(req.session.userId))) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  if (ADMIN_USER_IDS.length === 0) {
    console.warn('[AdminDash] ADMIN_USER_IDS not set — dashboard visible to ANY logged-in user');
  }
  req.user = { id: req.session.userId };
  next();
}

function authenticateUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = { id: req.session.userId };
  next();
}

// Safe interval helper (whitelist — period is interpolated into SQL)
function safeInterval(period) {
  const map = { 'today': '1 day', '7d': '7 days', '30d': '30 days', '90d': '90 days', 'all': '10 years' };
  return map[period] || '30 days';
}

// Statuses that represent a real, paid/valid booking
const VALID_BOOKING_STATUSES = `('confirmed','completed','active','paid','converted')`;

// Filters to keep analytics-based metrics honest
const BOT_UA_FILTER = `(user_agent IS NOT NULL AND user_agent !~* '(bot|crawler|spider|slurp|headless|monitor|pingdom|uptimerobot|statuscake|curl|wget|python-requests|python-urllib|axios|go-http-client|okhttp|java/|libwww)')`;
const NOISE_PATH_FILTER = `path NOT IN ('/health','/api/v2/health') AND path NOT LIKE '/api/stats/admin%'`;
// Identity: authenticated user id when known, else IP + UA prefix (better than raw IP behind NAT)
const IDENTITY_EXPR = `COALESCE(user_id::text, COALESCE(ip_address,'?') || '|' || LEFT(COALESCE(user_agent,''), 40))`;

// Approximate FX -> GBP for headline revenue when charges were made in other currencies.
// Detailed per-currency breakdown is always returned unconverted in revenue.byCurrency.
const FX_TO_GBP = { gbp: 1, usd: 0.79, eur: 0.86, cad: 0.57, aud: 0.51, nzd: 0.47, inr: 0.0094, pkr: 0.0028, bdt: 0.0066, aed: 0.215, sar: 0.21, zar: 0.043, ngn: 0.0005, try: 0.024, pln: 0.20, sek: 0.074, nok: 0.073, dkk: 0.115, chf: 0.88, jpy: 0.0053, sgd: 0.58, hkd: 0.10, myr: 0.17, thb: 0.022, idr: 0.000049, php: 0.014, vnd: 0.000031, brl: 0.145, mxn: 0.042, egp: 0.016, kes: 0.0061, mad: 0.079 };

// ────────────────────────────────────────────────────────
// GET /api/stats/admin-dashboard?period=30d
// ────────────────────────────────────────────────────────
router.get('/admin-dashboard', authenticateAdmin, async (req, res) => {
  try {
    const { period = '30d' } = req.query;
    const interval = safeInterval(period);
    const result = {};

    // ═══ 1. TOTAL REGISTRATIONS ═══
    try {
      const totalAll = await pool.query('SELECT COUNT(*) FROM public.users');
      const totalPeriod = await pool.query(
        `SELECT COUNT(*) FROM public.users WHERE created_at > NOW() - INTERVAL '${interval}'`
      );
      const regTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM public.users
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY 1 ORDER BY 1
      `);
      const prevPeriod = await pool.query(
        `SELECT COUNT(*) FROM public.users
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
      result.registrations = { total: 0, inPeriod: 0, previousPeriod: 0, growthPercent: 0, trend: [], _error: e.message };
    }

    // ═══ 2. ACTIVE USERS ═══
    // Identity-based (user_id when authenticated, else IP+UA), bots/health/admin-polling excluded
    try {
      const base = `FROM analytics_events WHERE ${BOT_UA_FILTER} AND ${NOISE_PATH_FILTER}`;
      const bookers = await pool.query(
        `SELECT COUNT(DISTINCT user_id) FROM bookings
         WHERE created_at > NOW() - INTERVAL '${interval}' AND status IN ${VALID_BOOKING_STATUSES}`
      );
      const visitors = await pool.query(
        `SELECT COUNT(DISTINCT ${IDENTITY_EXPR}) ${base} AND created_at > NOW() - INTERVAL '${interval}'`
      );
      const dau = await pool.query(
        `SELECT COUNT(DISTINCT ${IDENTITY_EXPR}) ${base} AND created_at > CURRENT_DATE`
      );
      const wau = await pool.query(
        `SELECT COUNT(DISTINCT ${IDENTITY_EXPR}) ${base} AND created_at > NOW() - INTERVAL '7 days'`
      );
      const mau = await pool.query(
        `SELECT COUNT(DISTINCT ${IDENTITY_EXPR}) ${base} AND created_at > NOW() - INTERVAL '30 days'`
      );
      const authActives = await pool.query(
        `SELECT COUNT(DISTINCT user_id) ${base} AND user_id IS NOT NULL AND created_at > NOW() - INTERVAL '${interval}'`
      );

      const dauN = parseInt(dau.rows[0].count);
      const mauN = parseInt(mau.rows[0].count);
      result.activeUsers = {
        bookedInPeriod: parseInt(bookers.rows[0].count),
        visitorsInPeriod: parseInt(visitors.rows[0].count),
        authenticatedInPeriod: parseInt(authActives.rows[0].count),
        dau: dauN,
        wau: parseInt(wau.rows[0].count),
        mau: mauN,
        stickiness: mauN > 0 ? parseFloat(((dauN / mauN) * 100).toFixed(1)) : 0,
      };
    } catch (e) {
      console.warn('[AdminDash] Active users error:', e.message);
      result.activeUsers = { bookedInPeriod: 0, visitorsInPeriod: 0, authenticatedInPeriod: 0, dau: 0, wau: 0, mau: 0, stickiness: 0, _error: e.message };
    }

    // ═══ 3. ACTIVITY LEVELS ═══
    try {
      const bookingTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM bookings
        WHERE created_at > NOW() - INTERVAL '${interval}' AND status IN ${VALID_BOOKING_STATUSES}
        GROUP BY 1 ORDER BY 1
      `);
      // Peak hours in UK local time (was UTC)
      const peakHours = await pool.query(`
        SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/London') as hour, COUNT(*) as count
        FROM bookings
        WHERE created_at > NOW() - INTERVAL '${interval}' AND status IN ${VALID_BOOKING_STATUSES}
        GROUP BY 1 ORDER BY count DESC LIMIT 5
      `);
      const topGyms = await pool.query(`
        SELECT COALESCE(g.name, b.gym_name, 'Unknown gym') as name, COUNT(b.id) as bookings
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.created_at > NOW() - INTERVAL '${interval}' AND b.status IN ${VALID_BOOKING_STATUSES}
        GROUP BY 1 ORDER BY bookings DESC LIMIT 5
      `);
      // Real page views only (was: every analytics row incl. API calls)
      const pvTrend = await pool.query(`
        SELECT DATE_TRUNC('day', created_at)::date as date, COUNT(*) as count
        FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
          AND event_type = 'page_view' AND ${BOT_UA_FILTER} AND ${NOISE_PATH_FILTER}
        GROUP BY 1 ORDER BY 1
      `);
      const apiCalls = await pool.query(`
        SELECT COUNT(*) FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
          AND event_type = 'api_call' AND ${BOT_UA_FILTER} AND ${NOISE_PATH_FILTER}
      `);

      result.activityLevels = {
        bookingTrend: bookingTrend.rows.map(r => ({ date: r.date, count: parseInt(r.count) })),
        peakHours: peakHours.rows.map(r => ({ hour: parseInt(r.hour), count: parseInt(r.count) })),
        topGyms: topGyms.rows.map(r => ({ name: r.name, bookings: parseInt(r.bookings) })),
        pageViewTrend: pvTrend.rows.map(r => ({ date: r.date, count: parseInt(r.count) })),
        totalBookingsInPeriod: bookingTrend.rows.reduce((s, r) => s + parseInt(r.count), 0),
        totalPageViewsInPeriod: pvTrend.rows.reduce((s, r) => s + parseInt(r.count), 0),
        totalApiCallsInPeriod: parseInt(apiCalls.rows[0].count),
      };
    } catch (e) {
      console.warn('[AdminDash] Activity levels error:', e.message);
      result.activityLevels = { bookingTrend: [], peakHours: [], topGyms: [], pageViewTrend: [], totalBookingsInPeriod: 0, totalPageViewsInPeriod: 0, totalApiCallsInPeriod: 0, _error: e.message };
    }

    // ═══ 4. COHORT RETENTION ═══
    // Weekly cohorts over the last 8 weeks. Activity = valid booking OR any
    // authenticated event. (Old SQL used EXTRACT(WEEK FROM date-date) which is
    // a Postgres type error, so this section ALWAYS returned empty.)
    try {
      const cohorts = await pool.query(`
        WITH cohort_users AS (
          SELECT id::text AS user_id, DATE_TRUNC('week', created_at)::date AS cohort_week
          FROM public.users
          WHERE created_at > NOW() - INTERVAL '8 weeks'
        ),
        cohort_sizes AS (
          SELECT cohort_week, COUNT(*) AS cohort_size
          FROM cohort_users GROUP BY cohort_week
        ),
        activity AS (
          SELECT user_id::text AS user_id, DATE_TRUNC('week', created_at)::date AS activity_week
          FROM bookings
          WHERE created_at > NOW() - INTERVAL '16 weeks' AND status IN ${VALID_BOOKING_STATUSES} AND user_id IS NOT NULL
          UNION
          SELECT user_id::text, DATE_TRUNC('week', created_at)::date
          FROM analytics_events
          WHERE created_at > NOW() - INTERVAL '16 weeks' AND user_id IS NOT NULL
        ),
        retention AS (
          SELECT cu.cohort_week,
                 ((a.activity_week - cu.cohort_week) / 7)::int AS week_offset,
                 COUNT(DISTINCT cu.user_id) AS returned
          FROM cohort_users cu
          JOIN activity a ON a.user_id = cu.user_id AND a.activity_week >= cu.cohort_week
          GROUP BY cu.cohort_week, week_offset
        )
        SELECT cs.cohort_week, cs.cohort_size, r.week_offset, r.returned
        FROM cohort_sizes cs
        LEFT JOIN retention r ON r.cohort_week = cs.cohort_week
        ORDER BY cs.cohort_week, r.week_offset
      `);

      const cohortMap = {};
      for (const row of cohorts.rows) {
        const cw = row.cohort_week;
        if (!cohortMap[cw]) cohortMap[cw] = { cohort_week: cw, size: parseInt(row.cohort_size), weeks: {} };
        if (row.week_offset !== null && row.week_offset >= 0) {
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
      })).slice(-8);
    } catch (e) {
      console.warn('[AdminDash] Cohort retention error:', e.message);
      result.cohortRetention = [];
      result.cohortRetentionError = e.message;
    }

    // ═══ 5. REVENUE ═══
    // Actual charged amounts (bookings.amount_pence, minor units) — NOT the
    // gym's current list price. Legacy rows without amount fall back to
    // day_pass_price. Non-GBP charges are converted with approximate FX for
    // the headline and reported per-currency in byCurrency.
    try {
      // Bookings are written by two flows with different amount columns:
      //  - confirm-sca flow:  amount_pence (minor units, actual Stripe charge)
      //  - quick/cash/free:   total_amount (major units, charged price)
      // Fall back to gym list price only for legacy rows missing both.
      const revCase = `
        CASE WHEN b.amount_pence IS NOT NULL THEN b.amount_pence / 100.0
             WHEN b.total_amount IS NOT NULL THEN b.total_amount
             ELSE COALESCE(g.day_pass_price, 0) END`;
      const curExpr = `LOWER(COALESCE(b.currency, g.currency, 'gbp'))`;

      const sumByCurrency = async (where) => {
        const q = await pool.query(`
          SELECT ${curExpr} AS currency, COALESCE(SUM(${revCase}), 0) AS total, COUNT(b.id) AS bookings
          FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
          WHERE b.status IN ${VALID_BOOKING_STATUSES} ${where}
          GROUP BY 1
        `);
        return q.rows.map(r => ({ currency: r.currency, total: parseFloat(r.total), bookings: parseInt(r.bookings) }));
      };
      const toGBP = (rows) => rows.reduce((s, r) => s + r.total * (FX_TO_GBP[r.currency] !== undefined ? FX_TO_GBP[r.currency] : 1), 0);

      const allRows = await sumByCurrency('');
      const periodRows = await sumByCurrency(`AND b.created_at > NOW() - INTERVAL '${interval}'`);
      const prevRows = await sumByCurrency(`AND b.created_at > NOW() - INTERVAL '${interval}' * 2 AND b.created_at <= NOW() - INTERVAL '${interval}'`);

      const revTrend = await pool.query(`
        SELECT DATE_TRUNC('day', b.created_at)::date AS date,
               COALESCE(SUM((${revCase}) * COALESCE(fx.rate, 1)), 0) AS revenue,
               COUNT(b.id) AS bookings
        FROM bookings b
        LEFT JOIN gyms g ON b.gym_id = g.id
        LEFT JOIN (VALUES ${Object.entries(FX_TO_GBP).map(([c, r]) => `('${c}', ${r})`).join(',')}) AS fx(currency, rate)
          ON fx.currency = ${curExpr}
        WHERE b.status IN ${VALID_BOOKING_STATUSES}
          AND b.created_at > NOW() - INTERVAL '${interval}'
        GROUP BY 1 ORDER BY 1
      `);

      const totalAll = toGBP(allRows);
      const totalPeriod = toGBP(periodRows);
      const totalPrev = toGBP(prevRows);
      const revGrowth = totalPrev > 0 ? (((totalPeriod - totalPrev) / totalPrev) * 100).toFixed(1) : totalPeriod > 0 ? '100.0' : '0.0';
      const nonGbp = periodRows.filter(r => r.currency !== 'gbp' && r.total > 0);

      result.revenue = {
        totalAllTime: parseFloat(totalAll.toFixed(2)),
        totalAllTimeFormatted: '£' + totalAll.toFixed(2),
        inPeriod: parseFloat(totalPeriod.toFixed(2)),
        inPeriodFormatted: '£' + totalPeriod.toFixed(2),
        previousPeriod: parseFloat(totalPrev.toFixed(2)),
        growthPercent: parseFloat(revGrowth),
        scanGymShare: parseFloat((totalPeriod * 0.25).toFixed(2)),
        gymOwnerShare: parseFloat((totalPeriod * 0.75).toFixed(2)),
        byCurrency: periodRows,
        fxNote: nonGbp.length ? 'Headline converted to GBP with approximate FX; see byCurrency for exact per-currency totals' : null,
        source: 'bookings.amount_pence (actual charges); legacy rows without amount use gym list price',
        trend: revTrend.rows.map(r => ({
          date: r.date,
          revenue: parseFloat(parseFloat(r.revenue).toFixed(2)),
          bookings: parseInt(r.bookings),
        })),
      };
    } catch (e) {
      console.warn('[AdminDash] Revenue error:', e.message);
      result.revenue = { totalAllTime: 0, totalAllTimeFormatted: '£0.00', inPeriod: 0, inPeriodFormatted: '£0.00', previousPeriod: 0, growthPercent: 0, scanGymShare: 0, gymOwnerShare: 0, byCurrency: [], trend: [], _error: e.message };
    }

    // ═══ 6. NET PROMOTER SCORE (NPS) ═══
    try {
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
        promoters, passives, detractors,
        promoterPercent: total > 0 ? parseFloat(((promoters / total) * 100).toFixed(1)) : 0,
        detractorPercent: total > 0 ? parseFloat(((detractors / total) * 100).toFixed(1)) : 0,
        distribution: npsData.rows.map(r => ({ score: parseInt(r.score), count: parseInt(r.cnt) })),
        note: total === 0 ? 'No responses yet — in-app NPS survey shows after a completed booking' : null,
      };
    } catch (e) {
      console.warn('[AdminDash] NPS error:', e.message);
      result.nps = { score: null, totalResponses: 0, promoters: 0, passives: 0, detractors: 0, promoterPercent: 0, detractorPercent: 0, distribution: [], _error: e.message };
    }

    result.period = period;
    result.generatedAt = new Date().toISOString();
    res.set('Cache-Control', 'no-store');
    res.json(result);
  } catch (err) {
    console.error('[AdminDash] Error:', err.message);
    res.status(500).json({ error: 'Failed to generate admin dashboard' });
  }
});

// POST /api/stats/nps — Submit an NPS response (one per user per 90 days)
router.post('/nps', authenticateUser, async (req, res) => {
  try {
    const { score, feedback } = req.body;
    if (score === undefined || score === null || isNaN(parseInt(score)) || score < 0 || score > 10) {
      return res.status(400).json({ error: 'Score must be 0-10' });
    }
    const recent = await pool.query(
      `SELECT id FROM nps_responses WHERE user_id = $1 AND created_at > NOW() - INTERVAL '90 days' LIMIT 1`,
      [String(req.user.id)]
    );
    if (recent.rows.length > 0) {
      return res.json({ success: true, message: 'Already recorded recently' });
    }
    await pool.query(
      'INSERT INTO nps_responses (user_id, score, feedback) VALUES ($1, $2, $3)',
      [String(req.user.id), parseInt(score), (feedback || '').slice(0, 2000) || null]
    );
    res.json({ success: true, message: 'Thank you for your feedback!' });
  } catch (err) {
    console.error('[NPS] Error:', err.message);
    res.status(500).json({ error: 'Failed to save NPS response' });
  }
});

module.exports = router;
