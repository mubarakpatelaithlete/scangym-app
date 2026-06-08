/**
 * Reels Feed API — Dynamic video feed combining static catalog + creator uploads
 *
 * Replaces the hardcoded 441-video array that was baked into the React bundle.
 * Now the feed is API-driven so creator uploads appear after approval.
 *
 * Endpoints:
 *   GET /api/reels/feed         — Combined feed (static + approved uploads)
 *   GET /api/reels/video/:id    — Stream an uploaded video file
 *   GET /api/reels/categories   — List available categories
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../middleware/db');

// Load static video catalog (extracted from the original React bundle)
const STATIC_VIDEOS_PATH = path.join(__dirname, '..', 'data', 'reels-videos.json');
let staticVideos = [];
try {
  staticVideos = JSON.parse(fs.readFileSync(STATIC_VIDEOS_PATH, 'utf8'));
  console.log(`Reels: Loaded ${staticVideos.length} static videos from catalog`);
} catch (err) {
  console.error('Reels: Failed to load static video catalog:', err.message);
}

// Load enrichment cache (auto-filled metadata: fileSize, blurhash, orientation, etc.)
let enrichmentCache = {};
try {
  const { loadCache, applyCachedMetadata } = require('../lib/video-enrichment');
  enrichmentCache = loadCache();
  if (Object.keys(enrichmentCache).length > 0) {
    applyCachedMetadata(staticVideos, enrichmentCache);
    console.log(`Reels: Applied ${Object.keys(enrichmentCache).length} cached metadata entries`);
  }
} catch (e) {
  // Enrichment module optional — catalog may already have metadata baked in
}

/**
 * GET /api/reels/feed
 * Returns the combined video feed: static catalog + approved creator uploads.
 * Query params:
 *   - category: filter by category (optional)
 *   - limit: max videos to return (default 200, max 200)
 *   - offset: pagination offset (default 0)
 *   - shuffle: "true" to randomize order (default true)
 *   - seed: numeric seed for deterministic shuffle (auto-generated if omitted)
 *   - include_uploads: "true" to include approved creator uploads (default true)
 */
router.get('/feed', async (req, res) => {
  try {
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 200, 200);
    const offset = parseInt(req.query.offset) || 0;
    const shuffle = req.query.shuffle !== 'false';
    const seed = parseInt(req.query.seed) || Math.floor(Math.random() * 2147483647);
    const includeUploads = req.query.include_uploads !== 'false';

    // 1. Start with static videos
    let feed = staticVideos.map(v => ({
      ...v,
      type: 'static',
    }));

    // 2. Add approved creator uploads
    if (includeUploads) {
      try {
        const uploadsResult = await pool.query(
          `SELECT id, creator_handle, creator_name, caption, category,
                  affiliate_link, file_name, file_size, status, created_at
           FROM creator_uploads
           WHERE status = 'approved'
           ORDER BY created_at DESC`
        );

        const uploads = uploadsResult.rows.map(u => ({
          id: `upload_${u.id}`,
          name: u.caption || u.file_name || 'Creator Upload',
          category: u.category || 'Creator',
          source: 'upload',
          url: `/api/reels/video/${u.id}`,
          thumb: null,
          type: 'upload',
          creator: {
            handle: u.creator_handle,
            name: u.creator_name,
            affiliateLink: u.affiliate_link,
          },
          uploadedAt: u.created_at,
        }));

        // Interleave uploads at the front of the feed
        feed = [...uploads, ...feed];
      } catch (dbErr) {
        console.error('Reels: Failed to fetch uploads:', dbErr.message);
        // Continue with static videos only
      }
    }

    // 2b. Add auto-generated reels from manifest
    try {
      const autoManifestPath = require('path').join(__dirname, '..', 'uploads', 'auto-reels', 'manifest.json');
      const volumeManifestPath = '/data/uploads/auto-reels/manifest.json';
      const manifestPath = require('fs').existsSync(volumeManifestPath) ? volumeManifestPath : autoManifestPath;

      if (require('fs').existsSync(manifestPath)) {
        const autoManifest = JSON.parse(require('fs').readFileSync(manifestPath, 'utf8'));
        if (autoManifest.videos && autoManifest.videos.length > 0) {
          const autoVideos = autoManifest.videos.map(v => ({
            ...v,
            type: 'auto-generated',
          }));
          // Interleave auto-generated reels: 1 auto reel per 5 regular reels
          const autoInterval = 5;
          let autoIdx = 0;
          for (let i = autoInterval; i < feed.length && autoIdx < autoVideos.length; i += autoInterval + 1) {
            feed.splice(i, 0, autoVideos[autoIdx++]);
          }
          // Append any remaining auto reels
          while (autoIdx < autoVideos.length) {
            feed.push(autoVideos[autoIdx++]);
          }
        }
      }
    } catch (autoErr) {
      // Auto-reels are optional, don't break the feed
      console.error('Auto-reels merge failed:', autoErr.message);
    }

    // 2c. Apply enrichment cache to any feed entries still missing metadata
    if (Object.keys(enrichmentCache).length > 0) {
      try {
        const { applyCachedMetadata } = require('../lib/video-enrichment');
        applyCachedMetadata(feed, enrichmentCache);
      } catch {}
    }

    // 3. Filter by category if requested
    if (category) {
      feed = feed.filter(v =>
        v.category.toLowerCase() === category.toLowerCase()
      );
    }

    // 4. Dopamine-optimised ordering
    // Neuroscience: the brain needs novelty between each reel to maintain the
    // reward-seeking loop. Pattern: Shock → Viral → Convert → Relate → Shock.
    // Never two similar categories in a row (habituation kills dopamine).
    //
    // Tier 1 (max dopamine): Don't Join A Gym, Viral, Price Compare
    // Tier 2 (strong):       TikTok-Reels AI, Influencer, Creator uploads
    // Tier 3 (filler):       Promo, CMO Content, AI Cinematic, General, etc.
    if (shuffle) {
      // Simple mulberry32 PRNG seeded from query param
      let s = seed | 0;
      const rand = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };

      // Assign dopamine tier to each video
      const TIER_MAP = {
        "don't join a gym": 1,
        "viral":            1,
        "price compare":    1,
        "tiktok-reels ai":  2,
        "influencer":       2,
        "creator":          2,
        "promo":            3,
        "city promo":       3,
        "ready-to-post":    3,
        "cmo content":      4,
        "ai cinematic":     4,
        "general":          4,
        "youtube ai":       4,
        "ugc videos":       5,
        "auto-reel":        5,
      };

      function getTier(v) {
        const cat = (v.category || '').toLowerCase();
        const key = (v.cdnKey || '').toLowerCase();

        // Deprioritize text-on-black / overlay reels regardless of category
        // These look terrible in a visual feed (just text on solid backgrounds)
        const TEXT_PATTERNS = ['faketweet', 'hottake', 'identityhook', 'fact_'];
        if (TEXT_PATTERNS.some(p => key.includes(p))) return 5;

        return TIER_MAP[cat] || 3;
      }

      // Bucket videos by tier, shuffle within each bucket
      const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      for (const v of feed) {
        const t = getTier(v);
        buckets[t] = buckets[t] || [];
        buckets[t].push(v);
      }
      // Shuffle each bucket
      for (const tier of Object.values(buckets)) {
        for (let i = tier.length - 1; i > 0; i--) {
          const j = Math.floor(rand() * (i + 1));
          [tier[i], tier[j]] = [tier[j], tier[i]];
        }
      }

      // Interleave: dopamine rotation pattern
      // Every 5 slots: Tier1, Tier2, Tier1, Tier3, Tier2 — then repeat
      // This ensures max-dopamine content leads, with variety between each
      const rotationPattern = [1, 2, 1, 3, 2, 1, 3, 2, 4, 3];
      const ordered = [];
      const bucketIdx = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let lastCategory = '';
      let patternPos = 0;

      while (ordered.length < feed.length) {
        // Try the preferred tier from the rotation pattern
        const preferredTier = rotationPattern[patternPos % rotationPattern.length];
        let placed = false;

        // Try preferred tier first, then adjacent tiers
        const tierOrder = [preferredTier, ...([1,2,3,4,5].filter(t => t !== preferredTier))];
        for (const tier of tierOrder) {
          const bucket = buckets[tier];
          if (!bucket) continue;
          // Find a video from this tier that isn't the same category as last
          let startIdx = bucketIdx[tier] || 0;
          for (let attempt = 0; attempt < bucket.length; attempt++) {
            const idx = (startIdx + attempt) % bucket.length;
            if (idx < startIdx && attempt > 0) break; // wrapped around
            const v = bucket[idx];
            if (!v || v._used) continue;
            const cat = (v.category || '').toLowerCase();
            if (cat === lastCategory && ordered.length > 0) continue; // no same category twice
            // Place this video
            ordered.push(v);
            v._used = true;
            bucketIdx[tier] = idx + 1;
            lastCategory = cat;
            placed = true;
            break;
          }
          if (placed) break;
        }

        // Fallback: place any unused video
        if (!placed) {
          for (const tier of [1,2,3,4,5]) {
            const bucket = buckets[tier];
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
              if (!bucket[i]._used) {
                ordered.push(bucket[i]);
                bucket[i]._used = true;
                placed = true;
                break;
              }
            }
            if (placed) break;
          }
        }
        if (!placed) break; // All videos placed
        patternPos++;
      }

      // Clean up temp flag
      for (const v of ordered) { delete v._used; }
      feed = ordered;
    }

    // 4b. Pin hero reel at position 0 (always show best visual first)
    // Visually engaging action videos > text-based or static content
    const HERO_REEL_KEYS = ['tiktok_gym_hopping', '01_gym_entry_vertical', '09_before_after_gym_hopper'];
    if (offset === 0 && feed.length > 0) {
      for (const heroKey of HERO_REEL_KEYS) {
        const heroIdx = feed.findIndex(v => v.cdnKey === heroKey);
        if (heroIdx > 0) {
          const [hero] = feed.splice(heroIdx, 1);
          feed.unshift(hero);
          break;
        }
      }
    }

    // 5. Paginate
    const total = feed.length;
    feed = feed.slice(offset, offset + limit);

    // Cache feed for 5 min (CDN) / 2 min (browser) — shuffled feeds are still fresh enough
    res.set('Cache-Control', 'public, max-age=120, s-maxage=300');
    res.json({
      videos: feed,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
      seed,
      categories: [...new Set(staticVideos.map(v => v.category))].sort(),
    });
  } catch (err) {
    console.error('Reels feed error:', err);
    res.status(500).json({ error: 'Failed to load reels feed' });
  }
});

/**
 * GET /api/reels/video/:id
 * Stream an uploaded video file by its creator_uploads.id
 * Supports range requests for video seeking.
 */
router.get('/video/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Look up the upload in the database
    const result = await pool.query(
      'SELECT file_path, file_name FROM creator_uploads WHERE id = $1 AND status = $2',
      [id, 'approved']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found or not approved' });
    }

    const { file_path: filePath, file_name: fileName } = result.rows[0];

    // Check file exists (try persistent volume first, then original path)
    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
      // Try Railway persistent volume path
      const basename = path.basename(filePath);
      const volumePath = path.join('/data/uploads', basename);
      if (fs.existsSync(volumePath)) {
        resolvedPath = volumePath;
      } else {
        return res.status(404).json({ error: 'Video file not found on disk' });
      }
    }

    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const ext = path.extname(fileName || resolvedPath).toLowerCase();
    const mimeType = ext === '.webm' ? 'video/webm' : ext === '.mov' ? 'video/quicktime' : 'video/mp4';

    // Support range requests for video seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=604800',
      });
      fs.createReadStream(resolvedPath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=604800',
      });
      fs.createReadStream(resolvedPath).pipe(res);
    }
  } catch (err) {
    console.error('Video stream error:', err);
    res.status(500).json({ error: 'Failed to stream video' });
  }
});

/**
 * GET /api/reels/categories
 * Returns all available video categories with counts.
 */
router.get('/categories', async (req, res) => {
  try {
    const catCounts = {};
    for (const v of staticVideos) {
      catCounts[v.category] = (catCounts[v.category] || 0) + 1;
    }

    // Add upload categories
    try {
      const uploadCats = await pool.query(
        `SELECT category, COUNT(*) as count FROM creator_uploads
         WHERE status = 'approved' GROUP BY category`
      );
      for (const row of uploadCats.rows) {
        const cat = row.category || 'Creator';
        catCounts[cat] = (catCounts[cat] || 0) + parseInt(row.count);
      }
    } catch (e) {}

    const categories = Object.entries(catCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ categories, total: categories.reduce((s, c) => s + c.count, 0) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

/**
 * GET /api/reels/admin/pending
 * List pending uploads for admin review.
 */
router.get('/admin/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, creator_handle, creator_name, creator_email, caption, category,
              affiliate_link, file_name, file_size, status, created_at
       FROM creator_uploads
       WHERE status = 'pending'
       ORDER BY created_at ASC`
    );
    res.json({ uploads: result.rows, total: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pending uploads' });
  }
});

/**
 * PATCH /api/reels/admin/review/:id
 * Approve or reject a pending upload.
 * Body: { action: "approve" | "reject" }
 */
router.patch('/admin/review/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Action must be "approve" or "reject"' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const result = await pool.query(
      `UPDATE creator_uploads SET status = $1 WHERE id = $2 RETURNING *`,
      [newStatus, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }

    res.json({ success: true, upload: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to review upload' });
  }
});

/**
 * GET /api/reels/cdn-proxy/:cdnKey
 * PERF FIX #1: Proxy R2 CDN videos with proper CORS + cache headers.
 *
 * Problem: R2 bucket returns cf-cache-status: DYNAMIC and no CORS headers,
 * so Cloudflare edge doesn't cache and SW cors-mode fetches fail.
 *
 * Solution: Proxy through Railway with proper headers. Railway's edge CDN
 * (hikari) caches the response using s-maxage, and the CORS headers let
 * the service worker cache successfully too.
 *
 * For the permanent fix, configure R2 CORS rules in Cloudflare dashboard:
 *   - Allowed Origins: https://scangym.com, https://www.scangym.com
 *   - Allowed Methods: GET, HEAD
 *   - Allowed Headers: Range
 *   - Max Age: 86400
 * And add a Cache Rule for cdn.scangym.com/* with Edge TTL 30 days.
 */
const https = require('https');

router.get('/cdn-proxy/:cdnKey', (req, res) => {
  const cdnKey = req.params.cdnKey.replace(/[^a-zA-Z0-9_-]/g, '');
  const cdnUrl = `https://cdn.scangym.com/videos/${cdnKey}.mp4`;

  // CORS + aggressive cache headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000'); // 7d browser, 30d CDN
  res.setHeader('Vary', 'Range');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Forward range header for video seeking
  const headers = {};
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  https.get(cdnUrl, { headers }, (upstream) => {
    // Forward status and relevant headers
    const fwdHeaders = {
      'Content-Type': upstream.headers['content-type'] || 'video/mp4',
      'Accept-Ranges': 'bytes',
    };
    if (upstream.headers['content-length']) {
      fwdHeaders['Content-Length'] = upstream.headers['content-length'];
    }
    if (upstream.headers['content-range']) {
      fwdHeaders['Content-Range'] = upstream.headers['content-range'];
    }

    res.writeHead(upstream.statusCode, { ...fwdHeaders });
    upstream.pipe(res);
  }).on('error', (err) => {
    console.error('CDN proxy error:', err.message);
    res.status(502).json({ error: 'CDN fetch failed' });
  });
});

/**
 * POST /api/reels/admin/enrich
 * Manually trigger video enrichment (fills missing metadata).
 * Returns enrichment results.
 */
router.post('/admin/enrich', async (req, res) => {
  try {
    const { runEnrichment, loadCache } = require('../lib/video-enrichment');

    const autoManifestPath = require('fs').existsSync('/data/uploads/auto-reels/manifest.json')
      ? '/data/uploads/auto-reels/manifest.json'
      : require('path').join(__dirname, '..', 'uploads', 'auto-reels', 'manifest.json');
    let autoVideos = [];
    try { autoVideos = JSON.parse(require('fs').readFileSync(autoManifestPath, 'utf8')).videos || []; } catch {}

    const cache = await runEnrichment(staticVideos, autoVideos);
    enrichmentCache = cache; // update in-memory cache

    res.json({
      success: true,
      cached: Object.keys(cache).length,
      message: 'Enrichment complete. Metadata cache updated.',
    });
  } catch (err) {
    console.error('Manual enrichment error:', err);
    res.status(500).json({ error: 'Enrichment failed: ' + err.message });
  }
});

/**
 * POST /api/reels/analytics
 * Receive view analytics from the frontend.
 * Stores in DB for feed ranking improvements.
 * Body: { views: [{ id, cat, dur, pct, ts }] }
 */
router.post('/analytics', express.json(), async (req, res) => {
  try {
    const { views } = req.body;
    if (!Array.isArray(views) || views.length === 0) {
      return res.status(204).end();
    }

    // Batch insert — max 50 views per request to prevent abuse
    const batch = views.slice(0, 50);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const v of batch) {
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
      values.push(
        String(v.id || '').slice(0, 50),
        String(v.cat || '').slice(0, 50),
        Math.min(Math.max(parseInt(v.dur) || 0, 0), 300000), // max 5min
        Math.min(Math.max(parseInt(v.pct) || 0, 0), 100)
      );
      idx += 4;
    }

    // Create table if not exists (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reel_views (
        id SERIAL PRIMARY KEY,
        video_id VARCHAR(50),
        category VARCHAR(50),
        duration_ms INTEGER,
        watch_percent INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(
      `INSERT INTO reel_views (video_id, category, duration_ms, watch_percent)
       VALUES ${placeholders.join(', ')}`,
      values
    );

    res.status(204).end();
  } catch (err) {
    // Analytics should never break the UX — swallow errors
    console.error('Analytics error:', err.message);
    res.status(204).end();
  }
});

// ═══════════════════════════════════════════════════════════
//  POSTER FRAME ENDPOINT + STARTUP GENERATION
// ═══════════════════════════════════════════════════════════

const { getPosterPath, generateAllPosters, POSTER_DIR } = require('../lib/poster-gen');

/**
 * GET /api/reels/poster/:cdnKey
 * Serves a pre-generated poster JPEG for a video.
 * Returns 404 if poster not yet generated.
 */
router.get('/poster/:cdnKey', (req, res) => {
  const cdnKey = req.params.cdnKey.replace(/\.jpg$/, '');
  const posterPath = getPosterPath(cdnKey);
  if (!posterPath) {
    return res.status(404).json({ error: 'Poster not generated yet' });
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800'); // 1d browser, 7d CDN
  res.sendFile(posterPath);
});

// Start poster generation in background after server starts
// (non-blocking — doesn't slow down boot)
setTimeout(() => {
  try {
    const catalog = JSON.parse(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', 'data', 'reels-videos.json'), 'utf8'
      )
    );
    generateAllPosters(catalog).catch(err => {
      console.error('[Posters] Background generation failed:', err.message);
    });
  } catch (err) {
    console.error('[Posters] Could not load catalog:', err.message);
  }
}, 5000); // Start 5s after boot to let the server warm up first

module.exports = router;
