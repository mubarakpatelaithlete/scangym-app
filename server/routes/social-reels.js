/**
 * Social Reels Integration — TikTok, YouTube Shorts & Instagram
 * ═══════════════════════════════════════════════════════════════
 * 
 * Pulls gym/fitness reels from social platforms into ScanGym's feed.
 * Benefits:
 *   - Fresh content keeps users engaged (higher CTA / time-on-app)
 *   - Creators get view credit (win-win, they'll want to be featured)
 *   - Zero content creation cost for ScanGym
 * 
 * Architecture:
 *   - Server-side fetching + caching (avoids CORS, rate limits)
 *   - Results cached in DB for 6 hours
 *   - Mixed into existing feed via reels-algorithm.js
 *   - Social reels open in native embed (views count for creator)
 * 
 * Supported platforms:
 *   1. YouTube Shorts — via YouTube Data API v3 (GCP key)
 *   2. TikTok — via oEmbed API (free, no auth)
 *   3. Instagram — via oEmbed (requires Meta app token, Phase 2)
 */

const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════
const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Same key works for YouTube
const CACHE_HOURS = 6;
const MAX_RESULTS_PER_QUERY = 15;

const YOUTUBE_SEARCH_QUERIES = [
  'gym day pass UK',
  'gym hopping UK',
  'gym tour London',
  'fitness motivation short',
  'day pass gym review',
  'budget gym UK',
  'gym walkthrough',
  'workout motivation gym',
  'gym first time',
  'gym newbie tips',
];

const TIKTOK_CURATED_URLS = [
  // Curated gym/fitness TikToks — add URLs here
  // These get embedded via oEmbed for maximum engagement
];

// ═══════════════════════════════════════════════════════════
//  DB SETUP
// ═══════════════════════════════════════════════════════════
async function initSocialReelsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_reels (
        id              SERIAL PRIMARY KEY,
        platform        VARCHAR(20) NOT NULL,
        external_id     VARCHAR(200) UNIQUE NOT NULL,
        title           TEXT,
        author_name     VARCHAR(200),
        author_url      TEXT,
        thumbnail_url   TEXT,
        embed_html      TEXT,
        video_url       TEXT,
        view_count      INTEGER DEFAULT 0,
        like_count      INTEGER DEFAULT 0,
        duration_sec    INTEGER,
        search_query    VARCHAR(200),
        category        VARCHAR(100) DEFAULT 'Social',
        is_approved     BOOLEAN DEFAULT true,
        is_hidden       BOOLEAN DEFAULT false,
        fetched_at      TIMESTAMPTZ DEFAULT NOW(),
        created_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS social_reels_cache (
        query_key       VARCHAR(200) PRIMARY KEY,
        result_count    INTEGER DEFAULT 0,
        last_fetched    TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Clear stale cache entries that have 0 results (from failed API calls)
    await pool.query("DELETE FROM social_reels_cache WHERE result_count = 0");
    
    console.log('[social-reels] Tables ready');
  } catch (err) {
    console.error('[social-reels] Table init error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  YOUTUBE SHORTS — Search & Cache
// ═══════════════════════════════════════════════════════════
async function fetchYouTubeShorts(query, maxResults = MAX_RESULTS_PER_QUERY) {
  if (!GOOGLE_API_KEY) {
    console.warn('[social-reels] No GOOGLE_MAPS_API_KEY — skipping YouTube fetch');
    return [];
  }
  
  try {
    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      videoDuration: 'short',        // Only shorts (< 4 min)
      videoDefinition: 'high',       // HD only
      maxResults: String(maxResults),
      order: 'relevance',
      safeSearch: 'strict',
      relevanceLanguage: 'en',
      key: GOOGLE_API_KEY,
    });
    
    const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
    if (!res.ok) {
      console.error(`[social-reels] YouTube API error ${res.status}:`, await res.text());
      return [];
    }
    
    const data = await res.json();
    
    return (data.items || []).map(item => ({
      platform: 'youtube',
      external_id: `yt_${item.id.videoId}`,
      title: item.snippet.title,
      author_name: item.snippet.channelTitle,
      author_url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
      thumbnail_url: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.medium?.url,
      video_url: `https://www.youtube.com/shorts/${item.id.videoId}`,
      embed_html: `<iframe src="https://www.youtube.com/embed/${item.id.videoId}?autoplay=1&loop=1&mute=1&controls=0&playsinline=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:100%;position:absolute;top:0;left:0;"></iframe>`,
      search_query: query,
      category: 'YouTube Shorts',
    }));
  } catch (err) {
    console.error('[social-reels] YouTube fetch error:', err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
//  TIKTOK — oEmbed (free, no auth)
// ═══════════════════════════════════════════════════════════
async function fetchTikTokEmbed(url) {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return null;
    
    const data = await res.json();
    
    return {
      platform: 'tiktok',
      external_id: `tt_${url.split('/').pop().split('?')[0]}`,
      title: data.title || '',
      author_name: data.author_name || '',
      author_url: data.author_url || '',
      thumbnail_url: data.thumbnail_url || '',
      video_url: url,
      embed_html: data.html || '',
      category: 'TikTok',
    };
  } catch (err) {
    console.error('[social-reels] TikTok oEmbed error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
//  CACHE CHECK — Only re-fetch after CACHE_HOURS
// ═══════════════════════════════════════════════════════════
async function isCacheStale(queryKey) {
  try {
    const { rows } = await pool.query(
      'SELECT last_fetched FROM social_reels_cache WHERE query_key = $1',
      [queryKey]
    );
    if (!rows.length) return true;
    
    const age = (Date.now() - new Date(rows[0].last_fetched).getTime()) / 3600000;
    return age > CACHE_HOURS;
  } catch {
    return true;
  }
}

async function updateCache(queryKey, count) {
  try {
    await pool.query(`
      INSERT INTO social_reels_cache (query_key, result_count, last_fetched)
      VALUES ($1, $2, NOW())
      ON CONFLICT (query_key) DO UPDATE SET result_count = $2, last_fetched = NOW()
    `, [queryKey, count]);
  } catch (err) {
    console.error('[social-reels] Cache update error:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  UPSERT social reels to DB
// ═══════════════════════════════════════════════════════════
async function upsertSocialReel(reel) {
  try {
    await pool.query(`
      INSERT INTO social_reels (platform, external_id, title, author_name, author_url, thumbnail_url, embed_html, video_url, search_query, category)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (external_id) DO UPDATE SET
        title = EXCLUDED.title,
        thumbnail_url = EXCLUDED.thumbnail_url,
        embed_html = EXCLUDED.embed_html,
        fetched_at = NOW()
    `, [reel.platform, reel.external_id, reel.title, reel.author_name, reel.author_url, reel.thumbnail_url, reel.embed_html, reel.video_url, reel.search_query, reel.category]);
  } catch (err) {
    // Ignore duplicates, log others
    if (!err.message.includes('duplicate')) {
      console.error('[social-reels] Upsert error:', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  BACKGROUND REFRESH — runs on interval
// ═══════════════════════════════════════════════════════════
async function refreshSocialReels() {
  console.log('[social-reels] Starting background refresh...');
  let total = 0;
  
  // YouTube Shorts
  for (const query of YOUTUBE_SEARCH_QUERIES) {
    const cacheKey = `youtube:${query}`;
    if (await isCacheStale(cacheKey)) {
      const results = await fetchYouTubeShorts(query);
      for (const reel of results) {
        await upsertSocialReel(reel);
        total++;
      }
      await updateCache(cacheKey, results.length);
      // Rate limit: wait 1s between queries
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  
  // TikTok curated
  for (const url of TIKTOK_CURATED_URLS) {
    const cacheKey = `tiktok:${url}`;
    if (await isCacheStale(cacheKey)) {
      const reel = await fetchTikTokEmbed(url);
      if (reel) {
        await upsertSocialReel(reel);
        total++;
      }
      await updateCache(cacheKey, reel ? 1 : 0);
    }
  }
  
  console.log(`[social-reels] Refresh complete — ${total} reels processed`);
}

// ═══════════════════════════════════════════════════════════
//  API ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * GET /api/social-reels/feed
 * Returns social reels mixed for the main feed
 */
router.get('/feed', async (req, res) => {
  try {
    const { platform, category, limit = 20, offset = 0 } = req.query;
    
    let query = `
      SELECT id, platform, external_id, title, author_name, author_url,
             thumbnail_url, embed_html, video_url, view_count, like_count,
             category, created_at
      FROM social_reels
      WHERE is_approved = true AND is_hidden = false
    `;
    const params = [];
    let paramIdx = 1;
    
    if (platform) {
      query += ` AND platform = $${paramIdx++}`;
      params.push(platform);
    }
    if (category) {
      query += ` AND category = $${paramIdx++}`;
      params.push(category);
    }
    
    query += ` ORDER BY fetched_at DESC, view_count DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`;
    params.push(Number(limit), Number(offset));
    
    const { rows } = await pool.query(query, params);
    
    res.json({
      reels: rows,
      total: rows.length,
      hasMore: rows.length >= Number(limit),
    });
  } catch (err) {
    console.error('[social-reels] Feed error:', err.message);
    res.status(500).json({ error: 'Failed to load social reels' });
  }
});

/**
 * GET /api/social-reels/platforms
 * Returns available platforms and counts
 */
router.get('/platforms', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT platform, category, COUNT(*) as count
      FROM social_reels WHERE is_approved = true AND is_hidden = false
      GROUP BY platform, category ORDER BY count DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to load platforms' });
  }
});

/**
 * POST /api/social-reels/refresh
 * Admin: Trigger a manual refresh of social reels
 */
router.post('/refresh', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_IMPORT_SECRET) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  // Run refresh in background
  refreshSocialReels().catch(err => console.error('[social-reels] Refresh failed:', err));
  res.json({ status: 'refresh_started' });
});

/**
 * POST /api/social-reels/add-tiktok
 * Admin: Add a TikTok URL to the feed
 */
router.post('/add-tiktok', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_IMPORT_SECRET) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const { url } = req.body;
  if (!url || !url.includes('tiktok.com')) {
    return res.status(400).json({ error: 'Invalid TikTok URL' });
  }
  
  const reel = await fetchTikTokEmbed(url);
  if (!reel) {
    return res.status(400).json({ error: 'Could not fetch TikTok data' });
  }
  
  await upsertSocialReel(reel);
  res.json({ status: 'added', reel });
});

/**
 * POST /api/social-reels/add-youtube
 * Admin: Add a YouTube Shorts URL to the feed
 */
router.post('/add-youtube', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_IMPORT_SECRET) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  const { url } = req.body;
  if (!url || (!url.includes('youtube.com') && !url.includes('youtu.be'))) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }
  
  // Extract video ID
  let videoId;
  if (url.includes('shorts/')) videoId = url.split('shorts/')[1].split('?')[0];
  else if (url.includes('v=')) videoId = url.split('v=')[1].split('&')[0];
  else if (url.includes('youtu.be/')) videoId = url.split('youtu.be/')[1].split('?')[0];
  
  if (!videoId) {
    return res.status(400).json({ error: 'Could not extract video ID' });
  }
  
  const reel = {
    platform: 'youtube',
    external_id: `yt_${videoId}`,
    title: req.body.title || '',
    author_name: req.body.author || '',
    author_url: '',
    thumbnail_url: `https://i.ytimg.com/vi/${videoId}/hq720.jpg`,
    video_url: `https://www.youtube.com/shorts/${videoId}`,
    embed_html: `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&loop=1&mute=1&controls=0&playsinline=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:100%;position:absolute;top:0;left:0;"></iframe>`,
    search_query: 'manual',
    category: 'YouTube Shorts',
  };
  
  await upsertSocialReel(reel);
  res.json({ status: 'added', reel });
});

/**
 * PATCH /api/social-reels/:id/hide
 * Admin: Hide a social reel
 */
router.patch('/:id/hide', async (req, res) => {
  const adminSecret = req.headers['x-admin-secret'];
  if (adminSecret !== process.env.ADMIN_IMPORT_SECRET) {
    return res.status(403).json({ error: 'Not authorized' });
  }
  
  await pool.query('UPDATE social_reels SET is_hidden = true WHERE id = $1', [req.params.id]);
  res.json({ status: 'hidden' });
});

/**
 * POST /api/social-reels/analytics
 * Track view/engagement for social reels
 */
router.post('/analytics', async (req, res) => {
  const { external_id, event } = req.body;
  if (!external_id || !event) return res.status(400).json({ error: 'Missing fields' });
  
  try {
    if (event === 'view') {
      await pool.query('UPDATE social_reels SET view_count = view_count + 1 WHERE external_id = $1', [external_id]);
    } else if (event === 'like') {
      await pool.query('UPDATE social_reels SET like_count = like_count + 1 WHERE external_id = $1', [external_id]);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  INIT & EXPORT
// ═══════════════════════════════════════════════════════════
initSocialReelsTable().then(() => {
  // Initial fetch after 30s delay (let server start first)
  setTimeout(() => refreshSocialReels(), 30000);
  
  // Refresh every 6 hours
  setInterval(() => refreshSocialReels(), CACHE_HOURS * 3600000);
});

module.exports = router;
