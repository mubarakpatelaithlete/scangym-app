/**
 * Creator Analytics — Phase 1 of ScanSquad Creator Empowerment.
 *
 * Surfaces data ALREADY captured by referrals.js, reels.js and creators.js
 * as creator-facing analytics (YouTube Studio / Instagram Pro style):
 *   - Earnings graph (daily / weekly / monthly series)
 *   - Per-gym click analytics (Linktree style)
 *   - Audience insights (channel, hour-of-day, day-of-week)
 *   - Per-reel analytics (views, avg watch %, completion)
 *
 * READ-ONLY: no new tables, no writes. All endpoints are public-by-handle,
 * matching the existing /api/referrals/earnings/:handle pattern.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;

function badHandle(res) {
  return res.status(400).json({ error: 'Invalid handle' });
}

/**
 * GET /api/creator-analytics/:handle/summary
 * Headline totals for the dashboard.
 */
router.get('/:handle/summary', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return badHandle(res);
  try {
    const totals = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'clicked' OR status = 'converted')::int AS clicks,
         COUNT(*) FILTER (WHERE status = 'converted')::int                       AS conversions,
         COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0)::int AS earnings_pence
       FROM creator_referrals WHERE creator_handle = $1`,
      [handle]
    );
    const page = await pool.query(
      `SELECT COALESCE(views, 0)::int AS page_views FROM creator_landing_pages WHERE slug = $1 LIMIT 1`,
      [handle]
    );
    const t = totals.rows[0] || { clicks: 0, conversions: 0, earnings_pence: 0 };
    res.json({
      handle,
      clicks: t.clicks,
      conversions: t.conversions,
      earningsPence: t.earnings_pence,
      pageViews: page.rows[0] ? page.rows[0].page_views : 0,
      conversionRate: t.clicks > 0 ? Math.round((t.conversions / t.clicks) * 1000) / 10 : 0,
    });
  } catch (err) {
    console.error('[CreatorAnalytics] summary error:', err.message);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

/**
 * GET /api/creator-analytics/:handle/series?bucket=day|week|month&days=30
 * Earnings + clicks + conversions time series (zero-filled).
 */
router.get('/:handle/series', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return badHandle(res);
  const bucket = ['day', 'week', 'month'].includes(req.query.bucket) ? req.query.bucket : 'day';
  let days = parseInt(req.query.days, 10) || (bucket === 'day' ? 30 : bucket === 'week' ? 84 : 365);
  days = Math.min(Math.max(days, 1), 730);
  try {
    const result = await pool.query(
      `WITH buckets AS (
         SELECT generate_series(
           date_trunc($2, NOW() - ($3 || ' days')::interval),
           date_trunc($2, NOW()),
           ('1 ' || $2)::interval
         ) AS bucket_start
       ),
       clicks AS (
         SELECT date_trunc($2, created_at) AS b, COUNT(*)::int AS clicks
         FROM creator_referrals
         WHERE creator_handle = $1 AND created_at >= NOW() - ($3 || ' days')::interval
         GROUP BY 1
       ),
       conv AS (
         SELECT date_trunc($2, COALESCE(converted_at, created_at)) AS b,
                COUNT(*)::int AS conversions,
                COALESCE(SUM(commission_pence), 0)::int AS earnings_pence
         FROM creator_referrals
         WHERE creator_handle = $1 AND status = 'converted'
           AND COALESCE(converted_at, created_at) >= NOW() - ($3 || ' days')::interval
         GROUP BY 1
       )
       SELECT to_char(buckets.bucket_start, 'YYYY-MM-DD') AS date,
              COALESCE(clicks.clicks, 0)        AS clicks,
              COALESCE(conv.conversions, 0)     AS conversions,
              COALESCE(conv.earnings_pence, 0)  AS earnings_pence
       FROM buckets
       LEFT JOIN clicks ON clicks.b = buckets.bucket_start
       LEFT JOIN conv   ON conv.b   = buckets.bucket_start
       ORDER BY buckets.bucket_start`,
      [handle, bucket, String(days)]
    );
    res.json({ handle, bucket, days, series: result.rows });
  } catch (err) {
    console.error('[CreatorAnalytics] series error:', err.message);
    res.status(500).json({ error: 'Failed to load series' });
  }
});

/**
 * GET /api/creator-analytics/:handle/gyms
 * Per-gym clicks, conversions and earnings. Gym names are recovered from
 * referral_events 'link_generated' metadata (best effort).
 */
router.get('/:handle/gyms', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return badHandle(res);
  try {
    const stats = await pool.query(
      `SELECT COALESCE(gym_id, 'direct') AS gym_id,
              COUNT(*)::int AS clicks,
              COUNT(*) FILTER (WHERE status = 'converted')::int AS conversions,
              COALESCE(SUM(commission_pence) FILTER (WHERE status = 'converted'), 0)::int AS earnings_pence
       FROM creator_referrals
       WHERE creator_handle = $1
       GROUP BY COALESCE(gym_id, 'direct')
       ORDER BY clicks DESC
       LIMIT 25`,
      [handle]
    );
    // Best-effort gym name lookup from link_generated events
    const names = {};
    try {
      const ev = await pool.query(
        `SELECT DISTINCT ON (metadata->>'gymId')
                metadata->>'gymId' AS gym_id, metadata->>'gymName' AS gym_name
         FROM referral_events
         WHERE creator_handle = $1 AND event_type = 'link_generated'
           AND metadata->>'gymId' IS NOT NULL
         ORDER BY metadata->>'gymId', created_at DESC
         LIMIT 200`,
        [handle]
      );
      for (const row of ev.rows) {
        if (row.gym_id && row.gym_name) names[row.gym_id] = row.gym_name;
      }
    } catch (e) { /* referral_events may not exist yet — names stay empty */ }

    res.json({
      handle,
      gyms: stats.rows.map(g => ({
        gymId: g.gym_id,
        gymName: g.gym_id === 'direct' ? 'Direct link (no gym)' : (names[g.gym_id] || g.gym_id),
        clicks: g.clicks,
        conversions: g.conversions,
        earningsPence: g.earnings_pence,
      })),
    });
  } catch (err) {
    console.error('[CreatorAnalytics] gyms error:', err.message);
    res.status(500).json({ error: 'Failed to load gym analytics' });
  }
});

/**
 * GET /api/creator-analytics/:handle/audience
 * Who's clicking: channel split, hour-of-day and day-of-week heat (Europe/London).
 */
router.get('/:handle/audience', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return badHandle(res);
  try {
    const [sources, hours, weekdays] = await Promise.all([
      pool.query(
        `SELECT COALESCE(NULLIF(source, ''), 'direct') AS source,
                COUNT(*)::int AS clicks,
                COUNT(*) FILTER (WHERE status = 'converted')::int AS conversions
         FROM creator_referrals WHERE creator_handle = $1
         GROUP BY 1 ORDER BY clicks DESC LIMIT 12`,
        [handle]
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Europe/London')::int AS hour,
                COUNT(*)::int AS clicks
         FROM creator_referrals WHERE creator_handle = $1
         GROUP BY 1 ORDER BY 1`,
        [handle]
      ),
      pool.query(
        `SELECT EXTRACT(ISODOW FROM created_at AT TIME ZONE 'Europe/London')::int AS dow,
                COUNT(*)::int AS clicks
         FROM creator_referrals WHERE creator_handle = $1
         GROUP BY 1 ORDER BY 1`,
        [handle]
      ),
    ]);
    const hourMap = new Array(24).fill(0);
    hours.rows.forEach(r => { if (r.hour >= 0 && r.hour < 24) hourMap[r.hour] = r.clicks; });
    const dowMap = new Array(7).fill(0);
    weekdays.rows.forEach(r => { if (r.dow >= 1 && r.dow <= 7) dowMap[r.dow - 1] = r.clicks; });
    res.json({ handle, sources: sources.rows, byHour: hourMap, byWeekday: dowMap });
  } catch (err) {
    console.error('[CreatorAnalytics] audience error:', err.message);
    res.status(500).json({ error: 'Failed to load audience insights' });
  }
});

/**
 * GET /api/creator-analytics/:handle/reels
 * Per-reel analytics for this creator's UGC uploads. Feed ids are
 * 'upload_<id>' (see reels.js), which is how reel_views attributes them.
 */
router.get('/:handle/reels', async (req, res) => {
  const { handle } = req.params;
  if (!HANDLE_RE.test(handle)) return badHandle(res);
  try {
    let uploads;
    try {
      uploads = await pool.query(
        `SELECT id, caption, category, status, created_at, COALESCE(is_pinned, false) AS is_pinned
         FROM creator_uploads WHERE creator_handle = $1
         ORDER BY COALESCE(is_pinned, false) DESC, created_at DESC LIMIT 50`,
        [handle]
      );
    } catch (e) {
      // is_pinned column may not exist yet
      uploads = await pool.query(
        `SELECT id, caption, category, status, created_at, false AS is_pinned
         FROM creator_uploads WHERE creator_handle = $1
         ORDER BY created_at DESC LIMIT 50`,
        [handle]
      );
    }
    let statsByVideo = {};
    if (uploads.rows.length > 0) {
      const videoIds = uploads.rows.map(u => `upload_${u.id}`);
      try {
        const stats = await pool.query(
          `SELECT video_id,
                  COUNT(*)::int AS views,
                  COALESCE(AVG(watch_percent), 0)::int AS avg_watch_percent,
                  COUNT(*) FILTER (WHERE watch_percent >= 90)::int AS completions
           FROM reel_views
           WHERE video_id = ANY($1)
           GROUP BY video_id`,
          [videoIds]
        );
        stats.rows.forEach(s => { statsByVideo[s.video_id] = s; });
      } catch (e) { /* reel_views may not exist yet */ }
    }
    res.json({
      handle,
      reels: uploads.rows.map(u => {
        const s = statsByVideo[`upload_${u.id}`] || {};
        return {
          id: u.id,
          caption: u.caption || '(no caption)',
          category: u.category,
          status: u.status,
          createdAt: u.created_at,
          isPinned: !!u.is_pinned,
          views: s.views || 0,
          avgWatchPercent: s.avg_watch_percent || 0,
          completions: s.completions || 0,
        };
      }),
    });
  } catch (err) {
    console.error('[CreatorAnalytics] reels error:', err.message);
    res.status(500).json({ error: 'Failed to load reel analytics' });
  }
});

module.exports = router;
