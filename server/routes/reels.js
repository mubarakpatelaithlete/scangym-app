/**
 * Reels Feed API — Dynamic video feed from database
 *
 * M8 FIX: Migrated from static reels-videos.json to a video_catalog DB table.
 * The JSON file is kept as a seed source — on first boot the table is created
 * and populated from it. After that, all CRUD goes through the database so
 * videos can be added/removed without code deploys.
 *
 * Endpoints:
 *   GET  /api/reels/feed              — Combined feed (catalog + approved uploads)
 *   GET  /api/reels/video/:id         — Stream an uploaded video file
 *   GET  /api/reels/categories        — List available categories
 *   GET  /api/reels/admin/pending     — List pending uploads
 *   PATCH /api/reels/admin/review/:id — Approve/reject uploads
 *   POST /api/reels/admin/enrich      — Trigger video enrichment
 *   POST /api/reels/analytics         — Receive view analytics
 *   GET  /api/reels/cdn-proxy/:cdnKey — Proxy R2 CDN videos
 *   GET  /api/reels/poster/:cdnKey    — Serve poster frames
 *   POST /api/reels/admin/catalog     — Add videos to catalog (NEW)
 *   DELETE /api/reels/admin/catalog/:id — Remove video from catalog (NEW)
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pool = require('../middleware/db');
const { authenticateUser, requireAdmin } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════
//  M10 UPGRADE: TikTok/Instagram-grade feed algorithm
//  Replaces static category-based tier rotation with dynamic
//  engagement-driven ranking. See lib/reels-algorithm.js for details.
// ═══════════════════════════════════════════════════════════
const {
  initPerformanceTables,
  rankFeed,
  processAnalytics,
  startBackgroundJobs,
} = require('../lib/reels-algorithm');

// ═══════════════════════════════════════════════════════════
//  M8 FIX: DATABASE CATALOG — replaces static JSON file
// ═══════════════════════════════════════════════════════════

/**
 * Ensure the video_catalog table exists and seed from JSON if empty.
 * Runs once at startup — idempotent, safe to call multiple times.
 */
async function initCatalog() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_catalog (
        id            SERIAL PRIMARY KEY,
        name          TEXT NOT NULL,
        category      VARCHAR(100) NOT NULL DEFAULT 'General',
        source        VARCHAR(50) NOT NULL DEFAULT 'cdn',
        url           TEXT,
        thumb         TEXT,
        cdn_key       VARCHAR(200) UNIQUE,
        drive_id      VARCHAR(200),
        file_size     INTEGER,
        blurhash      TEXT,
        orientation   VARCHAR(20) DEFAULT 'vertical',
        width         INTEGER DEFAULT 720,
        height        INTEGER DEFAULT 1280,
        dopamine_tier INTEGER DEFAULT 3,
        active        BOOLEAN DEFAULT true,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Seed from JSON if table is empty (first deploy only)
    const countResult = await pool.query('SELECT COUNT(*) FROM video_catalog');
    const count = parseInt(countResult.rows[0].count);

    if (count === 0) {
      const STATIC_VIDEOS_PATH = path.join(__dirname, '..', 'data', 'reels-videos.json');
      let seedVideos = [];
      try {
        seedVideos = JSON.parse(fs.readFileSync(STATIC_VIDEOS_PATH, 'utf8'));
      } catch (err) {
        console.error('Reels: No seed file found, starting with empty catalog:', err.message);
        return;
      }

      // Batch insert all seed videos
      if (seedVideos.length > 0) {
        const values = [];
        const placeholders = [];
        let idx = 1;
        for (const v of seedVideos) {
          placeholders.push(
            `($${idx}, $${idx+1}, $${idx+2}, $${idx+3}, $${idx+4}, $${idx+5}, $${idx+6}, $${idx+7}, $${idx+8}, $${idx+9}, $${idx+10})`
          );
          values.push(
            v.name || 'Untitled',
            v.category || 'General',
            v.source || 'cdn',
            v.url || null,
            v.thumb || null,
            v.cdnKey || null,
            v.driveId || null,
            v.fileSize || null,
            v.blurhash || null,
            v.orientation || 'vertical',
            v.dopamineTier || 3
          );
          idx += 11;
        }
        await pool.query(
          `INSERT INTO video_catalog (name, category, source, url, thumb, cdn_key, drive_id, file_size, blurhash, orientation, dopamine_tier)
           VALUES ${placeholders.join(', ')}`,
          values
        );
        console.log(`Reels: Seeded ${seedVideos.length} videos from JSON → database`);
      }
    } else {
      console.log(`Reels: video_catalog has ${count} videos (database-driven)`);
    }
  } catch (err) {
    console.error('Reels: Failed to init catalog table:', err.message);
  }
}

// Run at module load (non-blocking)
initCatalog();
initPerformanceTables();
startBackgroundJobs();

// Load enrichment cache (auto-filled metadata: fileSize, blurhash, orientation, etc.)
let enrichmentCache = {};
try {
  const { loadCache } = require('../lib/video-enrichment');
  enrichmentCache = loadCache();
  if (Object.keys(enrichmentCache).length > 0) {
    console.log(`Reels: Loaded ${Object.keys(enrichmentCache).length} enrichment cache entries`);
  }
} catch (e) {
  // Enrichment module optional
}

/**
 * Load catalog videos from the database.
 * Returns array of video objects matching the old JSON shape for backward compat.
 */
async function loadCatalogFromDB() {
  const result = await pool.query(
    `SELECT id, name, category, source, url, thumb, cdn_key, drive_id,
            file_size, blurhash, orientation, width, height, dopamine_tier, duration
     FROM video_catalog
     WHERE active = true
     ORDER BY id ASC`
  );
  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    category: row.category,
    source: row.source,
    url: row.url,
    thumb: row.thumb,
    cdnKey: row.cdn_key,
    driveId: row.drive_id,
    fileSize: row.file_size,
    blurhash: row.blurhash,
    orientation: row.orientation,
    width: row.width || 720,
    height: row.height || 1280,
    dopamineTier: row.dopamine_tier || 3,
    duration: row.duration || null,
  }));
}

/**
 * GET /api/reels/feed
 * Returns the combined video feed: DB catalog + approved creator uploads.
 * Query params:
 *   - category: filter by category (optional)
 *   - limit: max videos to return (default 200, max 200)
 *   - offset: pagination offset (default 0)
 *   - shuffle: "true" to randomize order (default true)
 *   - seed: numeric seed for deterministic shuffle (auto-generated if omitted)
 *   - include_uploads: "true" to include approved creator uploads (default true)
 *   - session_id: session identifier for within-session adaptation (optional)
 */
router.get('/feed', async (req, res) => {
  try {
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 200, 200);
    const offset = parseInt(req.query.offset) || 0;
    const shuffle = req.query.shuffle !== 'false';
    const seed = parseInt(req.query.seed) || Math.floor(Math.random() * 2147483647);
    const includeUploads = req.query.include_uploads !== 'false';
    // M10 UPGRADE: Session ID for within-session adaptation (TikTok-style)
    const sessionId = req.query.session_id || req.headers['x-session-id'] || null;

    // 1. M8 FIX: Load catalog from database instead of static JSON
    let catalogVideos;
    try {
      catalogVideos = await loadCatalogFromDB();
    } catch (dbErr) {
      console.error('Reels: DB catalog read failed, falling back to JSON:', dbErr.message);
      // Fallback: read from JSON if DB is unavailable (resilience)
      try {
        const STATIC_VIDEOS_PATH = path.join(__dirname, '..', 'data', 'reels-videos.json');
        catalogVideos = JSON.parse(fs.readFileSync(STATIC_VIDEOS_PATH, 'utf8'));
      } catch { catalogVideos = []; }
    }

    let feed = catalogVideos.map(v => ({
      ...v,
      type: 'catalog',
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
        // Continue with catalog videos only
      }
    }

    // 2b. Apply enrichment cache to any feed entries still missing metadata
    if (Object.keys(enrichmentCache).length > 0) {
      try {
        const { applyCachedMetadata } = require('../lib/video-enrichment');
        applyCachedMetadata(feed, enrichmentCache);
      } catch {}
    }

    // 2c. M11 FIX: Inject poster URLs for videos that have generated posters
    for (const v of feed) {
      if (!v.posterUrl && v.cdnKey) {
        const posterFile = getPosterPath(v.cdnKey);
        if (posterFile) {
          v.posterUrl = `/api/reels/poster/${v.cdnKey}`;
        }
      }
    }

    // 3. Filter by category if requested
    if (category) {
      feed = feed.filter(v =>
        v.category.toLowerCase() === category.toLowerCase()
      );
    }

    // 4. M10 UPGRADE: TikTok/Instagram-grade dynamic ranking
    // Replaces the old static dopamine-tier rotation with a data-driven algorithm:
    //   - Videos earn their tier from real engagement data (watch time, completion, shares)
    //   - Variable reward pattern (slot machine psychology) instead of fixed rotation
    //   - Session-level adaptation (feeds what the user is engaging with)
    //   - Cold start for new videos (guaranteed explore exposure)
    //   - Background aggregation every 5 min (the algorithm learns over time)
    // See lib/reels-algorithm.js for full documentation.
    // G3 FIX: Capture the true total BEFORE ranking, so the count is always
    // consistent regardless of algorithm behaviour.
    const total = feed.length;

    if (shuffle) {
      feed = await rankFeed(feed, { seed, sessionId, offset });
    }

    // 5. Paginate
    feed = feed.slice(offset, offset + limit);

    // Build categories from the catalog videos we already loaded
    const allCats = [...new Set(catalogVideos.map(v => v.category))].sort();

    // Cache feed for 5 min (CDN) / 2 min (browser)
    res.set('Cache-Control', 'public, max-age=120, s-maxage=300');
    res.json({
      videos: feed,
      total,
      offset,
      limit,
      hasMore: offset + limit < total,
      seed,
      categories: allCats,
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

    const result = await pool.query(
      'SELECT file_path, file_name FROM creator_uploads WHERE id = $1 AND status = $2',
      [id, 'approved']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found or not approved' });
    }

    const { file_path: filePath, file_name: fileName } = result.rows[0];

    let resolvedPath = filePath;
    if (!fs.existsSync(resolvedPath)) {
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
 * M8 FIX: Now reads from database instead of in-memory array.
 */
router.get('/categories', async (req, res) => {
  try {
    // Get catalog categories from DB
    const catResult = await pool.query(
      `SELECT category, COUNT(*) as count FROM video_catalog
       WHERE active = true GROUP BY category ORDER BY count DESC`
    );
    const catCounts = {};
    for (const row of catResult.rows) {
      catCounts[row.category] = parseInt(row.count);
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
 * POST /api/reels/admin/catalog
 * M8 FIX (NEW): Add one or more videos to the catalog via API.
 * No more editing JSON files — just POST here.
 * Body: { videos: [{ name, category, cdnKey, url, ... }] }
 */
router.post('/admin/catalog', authenticateUser, requireAdmin, express.json(), async (req, res) => {
  try {
    const { videos } = req.body;
    if (!Array.isArray(videos) || videos.length === 0) {
      return res.status(400).json({ error: 'Provide { videos: [...] } array' });
    }

    const inserted = [];
    for (const v of videos) {
      if (!v.name) continue;
      const result = await pool.query(
        `INSERT INTO video_catalog (name, category, source, url, thumb, cdn_key, drive_id, file_size, blurhash, orientation, dopamine_tier)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (cdn_key) DO UPDATE SET
           name = EXCLUDED.name, category = EXCLUDED.category, url = EXCLUDED.url,
           file_size = COALESCE(EXCLUDED.file_size, video_catalog.file_size),
           active = true
         RETURNING id, name, cdn_key`,
        [
          v.name,
          v.category || 'General',
          v.source || 'cdn',
          v.url || null,
          v.thumb || null,
          v.cdnKey || v.cdn_key || null,
          v.driveId || v.drive_id || null,
          v.fileSize || v.file_size || null,
          v.blurhash || null,
          v.orientation || 'vertical',
          v.dopamineTier || v.dopamine_tier || 3,
        ]
      );
      if (result.rows[0]) inserted.push(result.rows[0]);
    }

    res.json({
      success: true,
      added: inserted.length,
      videos: inserted,
      message: `Added ${inserted.length} video(s) to catalog`,
    });
  } catch (err) {
    console.error('Catalog add error:', err);
    res.status(500).json({ error: 'Failed to add videos: ' + err.message });
  }
});

/**
 * DELETE /api/reels/admin/catalog/:id
 * M8 FIX (NEW): Soft-delete a video from the catalog (sets active=false).
 */
router.delete('/admin/catalog/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'UPDATE video_catalog SET active = false WHERE id = $1 RETURNING id, name',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Video not found' });
    }
    res.json({ success: true, removed: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove video' });
  }
});

/**
 * GET /api/reels/admin/pending
 * List pending uploads for admin review.
 */
router.get('/admin/pending', authenticateUser, requireAdmin, async (req, res) => {
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
router.patch('/admin/review/:id', authenticateUser, requireAdmin, async (req, res) => {
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
 * Proxy R2 CDN videos with proper CORS + cache headers.
 */
const https = require('https');

router.get('/cdn-proxy/:cdnKey', (req, res) => {
  const cdnKey = req.params.cdnKey.replace(/[^a-zA-Z0-9_-]/g, '');
  const cdnUrl = `https://cdn.scangym.com/videos/${cdnKey}.mp4`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
  res.setHeader('Cache-Control', 'public, max-age=604800, s-maxage=2592000');
  res.setHeader('Vary', 'Range');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const headers = {};
  if (req.headers.range) {
    headers.Range = req.headers.range;
  }

  https.get(cdnUrl, { headers }, (upstream) => {
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
 * M8 FIX: Now enriches from DB catalog instead of in-memory array.
 */
router.post('/admin/enrich', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { runEnrichment, loadCache } = require('../lib/video-enrichment');

    // Load current catalog from DB for enrichment
    const catalogVideos = await loadCatalogFromDB();

    const cache = await runEnrichment(catalogVideos);
    enrichmentCache = cache;

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
 * M10 UPGRADE: Enhanced analytics — tracks views, skips, likes, shares, saves.
 * Supports both old format { views: [...] } and new { session_id, events: [...] }
 *
 * The reel_views table is still created here for backward compat, but the new
 * algorithm also writes to video_performance and reel_interactions tables
 * (see lib/reels-algorithm.js).
 */
router.post('/analytics', express.json(), async (req, res) => {
  try {
    const sessionId = req.body.session_id || req.headers['x-session-id'] || null;
    const events = req.body.events || req.body.views || [];

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(204).end();
    }

    // Ensure reel_views table exists (backward compat — first-time setup)
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

    // Normalise old format { id, cat, dur, pct } to new format { video_id, action, ... }
    const normalised = events.map(e => ({
      video_id:  e.video_id || e.id,
      category:  e.category || e.cat,
      action:    e.action || 'view',
      watch_ms:  e.watch_ms || e.dur || 0,
      watch_pct: e.watch_pct || e.pct || 0,
    }));

    // Process through the algorithm's enhanced analytics pipeline
    await processAnalytics(sessionId, normalised);

    res.status(204).end();
  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(204).end(); // Never break the client
  }
});

// ═══════════════════════════════════════════════════════════
//  POSTER FRAME ENDPOINT + STARTUP GENERATION
// ═══════════════════════════════════════════════════════════

const { getPosterPath, generateAllPosters, POSTER_DIR } = require('../lib/poster-gen');

/**
 * GET /api/reels/poster/:cdnKey
 * Serves a pre-generated poster JPEG for a video.
 */
router.get('/poster/:cdnKey', (req, res) => {
  const cdnKey = req.params.cdnKey.replace(/\.jpg$/, '');
  const posterPath = getPosterPath(cdnKey);
  if (!posterPath) {
    return res.status(404).json({ error: 'Poster not generated yet' });
  }
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
  res.sendFile(posterPath);
});

// ═══════════════════════════════════════════════════════════
//  M11 FIX: Combined startup pipeline — enrichment + posters
//  Runs 30s after startup to let DB stabilize. Uses R2 API
//  directly (bypasses CDN block). Writes metadata back to DB.
// ═══════════════════════════════════════════════════════════
setTimeout(async () => {
  try {
    const catalog = await loadCatalogFromDB();
    console.log(`[Startup Pipeline] ${catalog.length} videos in catalog`);

    // Phase 1: Enrichment (fills fileSize, blurhash, orientation, duration)
    try {
      const { runEnrichment, loadCache } = require('../lib/video-enrichment');
      const cache = await runEnrichment(catalog);
      enrichmentCache = cache;

      // Write enriched metadata back to DB for persistence
      for (const video of catalog) {
        const key = String(video.id || video.cdnKey || video.url);
        const cached = cache[key];
        if (!cached) continue;

        const updates = [];
        const values = [];
        let idx = 1;

        if (cached.fileSize && !video.fileSize) { updates.push(`file_size = $${idx++}`); values.push(cached.fileSize); }
        if (cached.blurhash && !video.blurhash) { updates.push(`blurhash = $${idx++}`); values.push(cached.blurhash); }
        if (cached.orientation && !video.orientation) { updates.push(`orientation = $${idx++}`); values.push(cached.orientation); }
        if (cached.width && (!video.width || video.width === 720)) { updates.push(`width = $${idx++}`); values.push(cached.width); }
        if (cached.height && (!video.height || video.height === 1280)) { updates.push(`height = $${idx++}`); values.push(cached.height); }
        if (cached.duration && !video.duration) { updates.push(`duration = $${idx++}`); values.push(cached.duration); }

        if (updates.length > 0 && video.id) {
          values.push(video.id);
          await pool.query(
            `UPDATE video_catalog SET ${updates.join(', ')} WHERE id = $${idx}`,
            values
          ).catch(() => {});
        }
      }
      console.log('[Startup Pipeline] Enrichment complete, DB updated');
    } catch (err) {
      console.error('[Startup Pipeline] Enrichment error:', err.message);
    }

    // Phase 2: Poster generation (extracts first frame as JPEG via R2)
    try {
      await generateAllPosters(catalog);
    } catch (err) {
      console.error('[Startup Pipeline] Poster generation error:', err.message);
    }

    console.log('[Startup Pipeline] Complete ✅');
  } catch (err) {
    console.error('[Startup Pipeline] Failed to load catalog:', err.message);
  }
}, 30000);

module.exports = router;
