/**
 * ScanGym Reels — TikTok/Instagram-Grade Feed Algorithm
 * ═══════════════════════════════════════════════════════
 *
 * Research-backed ranking system modelled on how TikTok and Instagram
 * actually decide what to show next. Replaces the old static
 * dopamine-tier rotation with a dynamic, data-driven approach.
 *
 * KEY PRINCIPLES (from TikTok / Instagram algorithm research):
 * ─────────────────────────────────────────────────────────────
 * 1. WATCH TIME + COMPLETION RATE is the #1 signal (both platforms)
 * 2. ENGAGEMENT SCORING: shares > saves > comments > likes
 *    (Instagram weights DM shares highest of all)
 * 3. NEGATIVE SIGNALS: early skips (<2s), swipe-aways count against
 * 4. VARIABLE REWARDS: the "slot machine" effect — never predictable,
 *    mix high-impact and surprise content to keep the dopamine loop alive
 * 5. EXPLORE / EXPLOIT: 80% proven performers, 20% underexposed content
 *    to discover the next hit (TikTok's cold-start strategy)
 * 6. RECENCY BOOST: newer content gets an initial lift
 * 7. DIVERSITY: never two same categories back-to-back (habituation kills dopamine)
 * 8. SESSION MEMORY: adapt within a session — if user watches gym-tour
 *    reels to the end, serve more of those; if they skip price-compare, serve fewer
 * 9. DYNAMIC TIERS: tiers come from real data, not hardcoded category maps
 * 10. COLD START: new videos get a guaranteed minimum exposure window
 *
 * HOW IT WORKS (mirrors TikTok's 2-stage architecture):
 * ─────────────────────────────────────────────────────────
 * Stage 1 — CANDIDATE SCORING: Every video gets a composite score
 *           from engagement data, recency, and explore bonuses.
 * Stage 2 — FEED ASSEMBLY: Candidates are interleaved using a
 *           diversity-enforced, variable-reward pattern.
 *
 * Since ScanGym users are anonymous (no login), we track:
 *   - Aggregate video performance (server-side, all users)
 *   - Session-level preferences (client-side session ID)
 */

const pool = require('../middleware/db');

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════

// Minimum views before a video's stats are considered reliable
const COLD_START_THRESHOLD = 30;

// What fraction of the feed should be "explore" (underexposed) content
// TikTok uses ~10-20% — we use 15% to balance discovery vs retention
const EXPLORE_RATIO = 0.15;

// Recency boost: videos created in the last N days get a score multiplier
const RECENCY_WINDOW_DAYS = 14;
const RECENCY_MULTIPLIER = 1.3;

// Weight of each engagement signal (modelled on Instagram Reels research)
// Instagram says: shares/sends > saves > comments > likes > watch time
const SIGNAL_WEIGHTS = {
  completionRate:  0.35,  // % of video watched (TikTok's #1 signal)
  avgWatchTime:    0.20,  // absolute watch duration in seconds
  shareRate:       0.20,  // shares per view (Instagram's #1 signal for Reels)
  saveRate:        0.10,  // saves per view
  likeRate:        0.10,  // likes per view
  skipPenalty:     0.05,  // penalty for early skips (<2s)
};

// Diversity: max consecutive videos from the same category
const MAX_SAME_CATEGORY = 1;

// Variable reward pattern inspired by slot-machine psychology:
// "Win" (high-tier) → "Near-miss" (mid-tier) → "Win" → "Surprise" (explore)
// This keeps the brain in anticipation mode (dopamine = anticipation, not pleasure)
const REWARD_PATTERN = [
  'top',      // Hook them — best performer
  'strong',   // Keep momentum
  'top',      // Another hit — reinforces "this feed is good"
  'mid',      // Slight dip — creates contrast for next hit
  'strong',   // Recovery — feels like a reward after the dip
  'explore',  // Surprise / novelty — triggers curiosity dopamine
  'top',      // Deliver on the curiosity
  'strong',   // Sustain
  'mid',      // Breathing room
  'explore',  // Another surprise — variable interval reinforcement
];

// ═══════════════════════════════════════════════════════════
//  DATABASE: Performance tracking tables
// ═══════════════════════════════════════════════════════════

/**
 * Create the video_performance table that aggregates engagement data.
 * This is the "brain" of the algorithm — it learns from real user behaviour.
 * Called once at startup (idempotent).
 */
async function initPerformanceTables() {
  try {
    // Aggregated performance scores per video (updated periodically)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_performance (
        video_id        VARCHAR(50) PRIMARY KEY,
        total_views     INTEGER DEFAULT 0,
        avg_watch_pct   REAL DEFAULT 0,
        avg_watch_ms    REAL DEFAULT 0,
        completion_rate REAL DEFAULT 0,
        skip_rate       REAL DEFAULT 0,
        like_count      INTEGER DEFAULT 0,
        share_count     INTEGER DEFAULT 0,
        save_count      INTEGER DEFAULT 0,
        engagement_score REAL DEFAULT 0.5,
        last_updated    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Session-level signals for within-session adaptation
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reel_interactions (
        id          SERIAL PRIMARY KEY,
        session_id  VARCHAR(64),
        video_id    VARCHAR(50),
        action      VARCHAR(20),
        watch_ms    INTEGER DEFAULT 0,
        watch_pct   INTEGER DEFAULT 0,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Index for fast session lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reel_interactions_session
      ON reel_interactions (session_id, created_at DESC)
    `);

    // Index for performance aggregation
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_reel_views_video
      ON reel_views (video_id)
    `);

    console.log('Algorithm: Performance tables ready');
  } catch (err) {
    console.error('Algorithm: Failed to init performance tables:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  STAGE 1: CANDIDATE SCORING
// ═══════════════════════════════════════════════════════════

/**
 * Load engagement scores for all active videos.
 * Returns a Map of videoId → { score, views, completionRate, ... }
 *
 * This mirrors TikTok's "fine ranking" stage — scoring each candidate
 * based on predicted engagement probability.
 */
async function loadPerformanceScores() {
  const scores = new Map();

  try {
    const result = await pool.query(`
      SELECT video_id, total_views, avg_watch_pct, avg_watch_ms,
             completion_rate, skip_rate, like_count, share_count,
             save_count, engagement_score
      FROM video_performance
    `);

    for (const row of result.rows) {
      scores.set(String(row.video_id), {
        views:          row.total_views || 0,
        avgWatchPct:    row.avg_watch_pct || 0,
        avgWatchMs:     row.avg_watch_ms || 0,
        completionRate: row.completion_rate || 0,
        skipRate:       row.skip_rate || 0,
        likeCount:      row.like_count || 0,
        shareCount:     row.share_count || 0,
        saveCount:      row.save_count || 0,
        score:          row.engagement_score || 0.5,
      });
    }
  } catch (err) {
    console.error('Algorithm: Could not load performance scores:', err.message);
  }

  return scores;
}

/**
 * Compute engagement score for a single video.
 *
 * The formula normalises each signal to 0–1 and applies the
 * research-backed weights defined in SIGNAL_WEIGHTS.
 *
 * completion_rate × 0.35  — TikTok's strongest signal
 * avg_watch_time  × 0.20  — absolute engagement depth
 * share_rate      × 0.20  — Instagram Reels' strongest signal
 * save_rate       × 0.10  — intent to revisit
 * like_rate       × 0.10  — general approval
 * skip_penalty    × 0.05  — early exit punishment
 */
function computeEngagementScore(perf) {
  if (!perf || perf.views < 1) return 0.5; // Neutral score for untracked videos

  const views = Math.max(perf.views, 1);

  // Normalise each signal to 0–1
  const completionNorm = Math.min(perf.completionRate / 100, 1);
  const watchNorm      = Math.min(perf.avgWatchMs / 30000, 1); // 30s = max
  const shareNorm      = Math.min((perf.shareCount / views) * 20, 1); // 5% share rate = 1.0
  const saveNorm       = Math.min((perf.saveCount / views) * 10, 1);  // 10% save rate = 1.0
  const likeNorm       = Math.min((perf.likeCount / views) * 5, 1);   // 20% like rate = 1.0
  const skipPenalty     = Math.min(perf.skipRate / 100, 1);

  const score =
    (SIGNAL_WEIGHTS.completionRate * completionNorm) +
    (SIGNAL_WEIGHTS.avgWatchTime   * watchNorm) +
    (SIGNAL_WEIGHTS.shareRate      * shareNorm) +
    (SIGNAL_WEIGHTS.saveRate       * saveNorm) +
    (SIGNAL_WEIGHTS.likeRate       * likeNorm) -
    (SIGNAL_WEIGHTS.skipPenalty    * skipPenalty);

  // Clamp to 0–1
  return Math.max(0, Math.min(1, score));
}

/**
 * Score every video in the feed and split into tiers.
 *
 * Returns { top: [...], strong: [...], mid: [...], explore: [...] }
 *
 * - top:     score ≥ 0.65 (proven winners — high completion, shares)
 * - strong:  score ≥ 0.40 (solid performers)
 * - mid:     score ≥ 0.20 (average content)
 * - explore: score < 0.20 OR views < COLD_START_THRESHOLD (needs exposure)
 *
 * This replaces the old static TIER_MAP that assigned tiers by category name.
 * Now tiers are EARNED based on actual user behaviour — just like TikTok.
 */
function scoreAndBucketVideos(feed, performanceMap, rand) {
  const buckets = { top: [], strong: [], mid: [], explore: [] };

  for (const video of feed) {
    const videoId = String(video.id);
    const perf = performanceMap.get(videoId);

    let score;
    let isExplore = false;

    if (!perf || perf.views < COLD_START_THRESHOLD) {
      // COLD START: TikTok gives every new video a small audience to test it.
      // We do the same — new/underexposed videos go into the explore bucket
      // with a slightly randomised score so they get varied placement.
      score = 0.4 + (rand() * 0.2); // Random 0.4–0.6 (gives fair chance)
      isExplore = true;
    } else {
      score = computeEngagementScore(perf);
    }

    // RECENCY BOOST: Newer content gets a multiplier (both platforms favour fresh content)
    if (video.created_at || video.createdAt) {
      const createdAt = new Date(video.created_at || video.createdAt);
      const ageInDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (ageInDays <= RECENCY_WINDOW_DAYS) {
        score *= RECENCY_MULTIPLIER;
      }
    }

    // Per-video dopamineTier override: if explicitly set to 1, force into top
    if (video.dopamineTier === 1 && !isExplore) {
      score = Math.max(score, 0.65);
    }

    // Deprioritize text-on-black / low-quality content (negative signal)
    const key = (video.cdnKey || '').toLowerCase();
    const TEXT_PATTERNS = ['faketweet', 'hottake', 'identityhook', 'fact_'];
    if (TEXT_PATTERNS.some(p => key.includes(p))) {
      score *= 0.5;
    }

    video._score = Math.min(score, 1);
    video._isExplore = isExplore;

    // Assign to tier bucket
    if (isExplore) {
      buckets.explore.push(video);
    } else if (score >= 0.65) {
      buckets.top.push(video);
    } else if (score >= 0.40) {
      buckets.strong.push(video);
    } else {
      buckets.mid.push(video);
    }
  }

  // Sort each bucket by score descending, then shuffle slightly
  // (TikTok doesn't just show #1 then #2 — there's controlled randomness)
  for (const tier of Object.values(buckets)) {
    tier.sort((a, b) => b._score - a._score);
    // Soft shuffle: swap adjacent items with 30% probability (adds unpredictability)
    for (let i = 0; i < tier.length - 1; i++) {
      if (rand() < 0.3) {
        [tier[i], tier[i + 1]] = [tier[i + 1], tier[i]];
      }
    }
  }

  return buckets;
}

// ═══════════════════════════════════════════════════════════
//  STAGE 2: FEED ASSEMBLY (Diversity + Variable Rewards)
// ═══════════════════════════════════════════════════════════

/**
 * Assemble the final feed using the variable-reward pattern.
 *
 * This is the "slot machine" effect that keeps users scrolling:
 * - Most reels are "wins" (high-quality, top/strong tier)
 * - Some are "near-misses" (mid tier — creates contrast)
 * - Sprinkled "surprises" (explore — triggers curiosity)
 * - NEVER two same categories back-to-back (prevents habituation)
 *
 * The pattern mirrors what TikTok's research calls "variable interval
 * reinforcement" — the most addictive reward schedule in psychology.
 */
function assembleFeed(buckets, feedLength, rand, sessionPrefs) {
  const result = [];
  const bucketIdx = { top: 0, strong: 0, mid: 0, explore: 0 };
  let lastCategory = '';
  let lastLastCategory = ''; // Track 2 back for better diversity
  let patternPos = 0;

  // Fallback order when preferred tier is empty
  const FALLBACK = {
    top:     ['strong', 'mid', 'explore'],
    strong:  ['top', 'mid', 'explore'],
    mid:     ['strong', 'top', 'explore'],
    explore: ['mid', 'strong', 'top'],
  };

  while (result.length < feedLength) {
    const slot = REWARD_PATTERN[patternPos % REWARD_PATTERN.length];
    let placed = false;

    // Try preferred tier first, then fallbacks
    const tryOrder = [slot, ...(FALLBACK[slot] || [])];

    for (const tierName of tryOrder) {
      const tier = buckets[tierName];
      if (!tier) continue;

      // Scan for a video that doesn't repeat the category
      let startIdx = bucketIdx[tierName] || 0;
      for (let attempt = 0; attempt < tier.length; attempt++) {
        const idx = startIdx + attempt;
        if (idx >= tier.length) break;

        const video = tier[idx];
        if (!video || video._placed) continue;

        const cat = (video.category || '').toLowerCase();

        // DIVERSITY CHECK: TikTok never shows same type twice in a row
        if (cat === lastCategory && result.length > 0) continue;

        // Extra diversity: avoid same category as 2 positions ago too (50% chance)
        if (cat === lastLastCategory && result.length > 1 && rand() < 0.5) continue;

        // SESSION PREFERENCE BOOST: If user engaged with this category in session,
        // slightly prefer it (mirrors TikTok's real-time interest adaptation)
        if (sessionPrefs && sessionPrefs.liked && sessionPrefs.liked.has(cat)) {
          // Good — this category is liked, proceed
        } else if (sessionPrefs && sessionPrefs.skipped && sessionPrefs.skipped.has(cat)) {
          // User skipped this category recently — 40% chance to skip in feed too
          if (rand() < 0.4) continue;
        }

        // Place the video
        result.push(video);
        video._placed = true;
        bucketIdx[tierName] = idx + 1;
        lastLastCategory = lastCategory;
        lastCategory = cat;
        placed = true;
        break;
      }
      if (placed) break;
    }

    // G3 FIX: Safety valve — if diversity rules blocked all options, drain ALL
    // remaining unplaced videos so the total always matches the input count.
    if (!placed) {
      for (const tierName of ['top', 'strong', 'mid', 'explore']) {
        const tier = buckets[tierName];
        if (!tier) continue;
        for (let i = 0; i < tier.length; i++) {
          if (!tier[i]._placed) {
            result.push(tier[i]);
            tier[i]._placed = true;
            lastLastCategory = lastCategory;
            lastCategory = (tier[i].category || '').toLowerCase();
            placed = true;
          }
        }
      }
    }

    if (!placed) break; // Truly all videos placed
    patternPos++;
  }

  // Clean up internal flags
  for (const v of result) {
    delete v._score;
    delete v._isExplore;
    delete v._placed;
  }

  return result;
}

// ═══════════════════════════════════════════════════════════
//  SESSION PREFERENCES (within-session adaptation)
// ═══════════════════════════════════════════════════════════

/**
 * Load what this session's user has engaged with / skipped.
 * Returns { liked: Set<category>, skipped: Set<category> }
 *
 * TikTok adapts in REAL TIME within a session. If you watch 3 cooking
 * videos to the end, the 4th one appears faster. If you skip sports,
 * fewer sports appear. We replicate this with session tracking.
 */
async function loadSessionPreferences(sessionId) {
  if (!sessionId) return null;

  try {
    const result = await pool.query(`
      SELECT video_id, action, watch_pct
      FROM reel_interactions
      WHERE session_id = $1
        AND created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
      LIMIT 50
    `, [sessionId]);

    if (result.rows.length === 0) return null;

    const liked = new Set();
    const skipped = new Set();

    // We need to look up video categories
    const videoIds = [...new Set(result.rows.map(r => r.video_id))];
    let catMap = {};
    try {
      const catResult = await pool.query(
        `SELECT id::text, category FROM video_catalog WHERE id::text = ANY($1)`,
        [videoIds]
      );
      for (const row of catResult.rows) {
        catMap[row.id] = (row.category || '').toLowerCase();
      }
    } catch (e) {}

    for (const row of result.rows) {
      const cat = catMap[row.video_id];
      if (!cat) continue;

      if (row.action === 'skip' || (row.watch_pct !== null && row.watch_pct < 15)) {
        skipped.add(cat);
      } else if (row.action === 'like' || row.action === 'share' ||
                 row.action === 'save' || (row.watch_pct !== null && row.watch_pct > 70)) {
        liked.add(cat);
        skipped.delete(cat); // If they liked AND skipped, liked wins
      }
    }

    return { liked, skipped };
  } catch (err) {
    console.error('Algorithm: Session prefs error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  PERFORMANCE AGGREGATION (background job)
// ═══════════════════════════════════════════════════════════

/**
 * Aggregate raw reel_views into video_performance scores.
 * Should be called periodically (e.g. every 5 minutes via setInterval).
 *
 * This is the "learning" step — the algorithm gets smarter over time
 * as more users watch reels and their engagement data feeds back.
 */
async function aggregatePerformance() {
  try {
    await pool.query(`
      INSERT INTO video_performance (
        video_id, total_views, avg_watch_pct, avg_watch_ms,
        completion_rate, skip_rate, engagement_score, last_updated
      )
      SELECT
        video_id,
        COUNT(*)                                      AS total_views,
        AVG(watch_percent)                            AS avg_watch_pct,
        AVG(duration_ms)                              AS avg_watch_ms,
        AVG(CASE WHEN watch_percent >= 80 THEN 1.0 ELSE 0.0 END) * 100
                                                      AS completion_rate,
        AVG(CASE WHEN duration_ms < 2000 AND watch_percent < 15 THEN 1.0 ELSE 0.0 END) * 100
                                                      AS skip_rate,
        0.5                                           AS engagement_score,
        NOW()                                         AS last_updated
      FROM reel_views
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY video_id
      ON CONFLICT (video_id) DO UPDATE SET
        total_views     = EXCLUDED.total_views,
        avg_watch_pct   = EXCLUDED.avg_watch_pct,
        avg_watch_ms    = EXCLUDED.avg_watch_ms,
        completion_rate = EXCLUDED.completion_rate,
        skip_rate       = EXCLUDED.skip_rate,
        last_updated    = NOW()
    `);

    // Now compute the composite engagement_score for each video
    const rows = await pool.query('SELECT * FROM video_performance');
    for (const row of rows.rows) {
      const score = computeEngagementScore({
        views:          row.total_views,
        completionRate: row.completion_rate,
        avgWatchMs:     row.avg_watch_ms,
        shareCount:     row.share_count || 0,
        saveCount:      row.save_count || 0,
        likeCount:      row.like_count || 0,
        skipRate:       row.skip_rate,
      });
      await pool.query(
        'UPDATE video_performance SET engagement_score = $1 WHERE video_id = $2',
        [score, row.video_id]
      );
    }

    console.log(`Algorithm: Aggregated performance for ${rows.rows.length} videos`);
  } catch (err) {
    console.error('Algorithm: Aggregation failed:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  MAIN ENTRY: rankFeed()
// ═══════════════════════════════════════════════════════════

/**
 * The main ranking function. Takes a flat array of videos and returns
 * them ordered using the full TikTok/Instagram-grade algorithm.
 *
 * @param {Array} feed - Array of video objects
 * @param {Object} options
 * @param {number} options.seed - PRNG seed for reproducible shuffle
 * @param {string} options.sessionId - Session ID for within-session adaptation
 * @param {number} options.offset - Pagination offset
 * @returns {Promise<Array>} Ranked feed
 */
async function rankFeed(feed, { seed = 0, sessionId = null, offset = 0 } = {}) {
  // Deterministic PRNG (same as before — mulberry32)
  let s = seed | 0;
  const rand = () => {
    s |= 0; s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };

  // Load real performance data from database
  const [performanceMap, sessionPrefs] = await Promise.all([
    loadPerformanceScores(),
    loadSessionPreferences(sessionId),
  ]);

  // Stage 1: Score every video and bucket into tiers
  const buckets = scoreAndBucketVideos(feed, performanceMap, rand);

  // Stage 2: Assemble feed with variable-reward pattern + diversity
  const ranked = assembleFeed(buckets, feed.length, rand, sessionPrefs);

  // Pin hero reel at position 0 on first page (just like TikTok's curated first video)
  if (offset === 0 && ranked.length > 0) {
    const HERO_KEYS = ['tiktok_gym_hopping', '01_gym_entry_vertical', '09_before_after_gym_hopper'];
    for (const heroKey of HERO_KEYS) {
      const heroIdx = ranked.findIndex(v => v.cdnKey === heroKey);
      if (heroIdx > 0) {
        const [hero] = ranked.splice(heroIdx, 1);
        ranked.unshift(hero);
        break;
      }
    }
  }

  return ranked;
}

// ═══════════════════════════════════════════════════════════
//  ENHANCED ANALYTICS ENDPOINT HANDLER
// ═══════════════════════════════════════════════════════════

/**
 * Process enhanced analytics events from the frontend.
 * Handles: view, skip, like, share, save, complete
 *
 * The frontend should send:
 * {
 *   session_id: "abc123",
 *   events: [
 *     { video_id: "42", action: "view", watch_ms: 15000, watch_pct: 85 },
 *     { video_id: "42", action: "like" },
 *     { video_id: "17", action: "skip", watch_ms: 800, watch_pct: 5 },
 *   ]
 * }
 */
async function processAnalytics(sessionId, events) {
  if (!Array.isArray(events) || events.length === 0) return;

  const batch = events.slice(0, 50); // Cap at 50 per request

  // 1. Insert into reel_views (backward compat with existing table)
  const viewEvents = batch.filter(e => e.action === 'view' || e.action === 'skip' || e.action === 'complete');
  if (viewEvents.length > 0) {
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const e of viewEvents) {
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
      values.push(
        String(e.video_id || '').slice(0, 50),
        String(e.category || '').slice(0, 50),
        Math.min(Math.max(parseInt(e.watch_ms) || 0, 0), 300000),
        Math.min(Math.max(parseInt(e.watch_pct) || 0, 0), 100)
      );
      idx += 4;
    }
    try {
      await pool.query(
        `INSERT INTO reel_views (video_id, category, duration_ms, watch_percent)
         VALUES ${placeholders.join(', ')}`,
        values
      );
    } catch (err) {
      console.error('Analytics: reel_views insert failed:', err.message);
    }
  }

  // 2. Insert into reel_interactions (new — session-level tracking)
  if (sessionId) {
    const values2 = [];
    const placeholders2 = [];
    let idx2 = 1;
    for (const e of batch) {
      placeholders2.push(`($${idx2}, $${idx2+1}, $${idx2+2}, $${idx2+3}, $${idx2+4})`);
      values2.push(
        sessionId.slice(0, 64),
        String(e.video_id || '').slice(0, 50),
        String(e.action || 'view').slice(0, 20),
        Math.min(Math.max(parseInt(e.watch_ms) || 0, 0), 300000),
        Math.min(Math.max(parseInt(e.watch_pct) || 0, 0), 100)
      );
      idx2 += 5;
    }
    try {
      await pool.query(
        `INSERT INTO reel_interactions (session_id, video_id, action, watch_ms, watch_pct)
         VALUES ${placeholders2.join(', ')}`,
        values2
      );
    } catch (err) {
      console.error('Analytics: reel_interactions insert failed:', err.message);
    }
  }

  // 3. Update engagement counters in video_performance (real-time)
  for (const e of batch) {
    if (['like', 'share', 'save'].includes(e.action)) {
      const col = e.action === 'like' ? 'like_count'
               : e.action === 'share' ? 'share_count'
               : 'save_count';
      try {
        await pool.query(`
          INSERT INTO video_performance (video_id, ${col})
          VALUES ($1, 1)
          ON CONFLICT (video_id) DO UPDATE
          SET ${col} = video_performance.${col} + 1,
              last_updated = NOW()
        `, [String(e.video_id)]);
      } catch (err) {
        // Non-fatal
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  STARTUP + BACKGROUND JOBS
// ═══════════════════════════════════════════════════════════

// Aggregate performance every 5 minutes
let aggregationInterval = null;
function startBackgroundJobs() {
  // Initial aggregation after 30s (let the server warm up)
  setTimeout(() => aggregatePerformance(), 30000);

  // Then every 5 minutes
  aggregationInterval = setInterval(() => aggregatePerformance(), 5 * 60 * 1000);

  console.log('Algorithm: Background aggregation started (every 5 min)');
}

function stopBackgroundJobs() {
  if (aggregationInterval) {
    clearInterval(aggregationInterval);
    aggregationInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════

module.exports = {
  initPerformanceTables,
  rankFeed,
  processAnalytics,
  aggregatePerformance,
  startBackgroundJobs,
  stopBackgroundJobs,
  loadPerformanceScores,
  // Expose for testing
  computeEngagementScore,
  scoreAndBucketVideos,
  assembleFeed,
  SIGNAL_WEIGHTS,
  REWARD_PATTERN,
};
