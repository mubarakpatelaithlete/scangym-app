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
            file_size, blurhash, orientation, width, height, dopamine_tier
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
 */
router.get('/feed', async (req, res) => {
  try {
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 200, 200);
    const offset = parseInt(req.query.offset) || 0;
    const shuffle = req.query.shuffle !== 'false';
    const seed = parseInt(req.query.seed) || Math.floor(Math.random() * 2147483647);
    const includeUploads = req.query.include_uploads !== 'false';

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

    // 2b. Add auto-generated reels from manifest
    try {
      const autoManifestPath = path.join(__dirname, '..', 'uploads', 'auto-reels', 'manifest.json');
      const volumeManifestPath = '/data/uploads/auto-reels/manifest.json';
      const manifestPath = fs.existsSync(volumeManifestPath) ? volumeManifestPath : autoManifestPath;

      if (fs.existsSync(manifestPath)) {
        const autoManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
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
        const TEXT_PATTERNS = ['faketweet', 'hottake', 'identityhook', 'fact_'];
        if (TEXT_PATTERNS.some(p => key.includes(p))) return 5;

        // Use per-video dopamineTier if set, otherwise fall back to category map
        if (v.dopamineTier && v.dopamineTier >= 1 && v.dopamineTier <= 5) return v.dopamineTier;
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
      const rotationPattern = [1, 2, 1, 3, 2, 1, 3, 2, 4, 3];
      const ordered = [];
      const bucketIdx = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let lastCategory = '';
      let patternPos = 0;

      while (ordered.length < feed.length) {
        const preferredTier = rotationPattern[patternPos % rotationPattern.length];
        let placed = false;

        const tierOrder = [preferredTier, ...([1,2,3,4,5].filter(t => t !== preferredTier))];
        for (const tier of tierOrder) {
          const bucket = buckets[tier];
          if (!bucket) continue;
          let startIdx = bucketIdx[tier] || 0;
          for (let attempt = 0; attempt < bucket.length; attempt++) {
            const idx = (startIdx + attempt) % bucket.length;
            if (idx < startIdx && attempt > 0) break;
            const v = bucket[idx];
            if (!v || v._used) continue;
            const cat = (v.category || '').toLowerCase();
            if (cat === lastCategory && ordered.length > 0) continue;
            ordered.push(v);
            v._used = true;
            bucketIdx[tier] = idx + 1;
            lastCategory = cat;
            placed = true;
            break;
          }
          if (placed) break;
        }

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
        if (!placed) break;
        patternPos++;
      }

      for (const v of ordered) { delete v._used; }
      feed = ordered;
    }

    // 4b. Pin hero reel at position 0 (always show best visual first)
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

    const autoManifestPath = fs.existsSync('/data/uploads/auto-reels/manifest.json')
      ? '/data/uploads/auto-reels/manifest.json'
      : path.join(__dirname, '..', 'uploads', 'auto-reels', 'manifest.json');
    let autoVideos = [];
    try { autoVideos = JSON.parse(fs.readFileSync(autoManifestPath, 'utf8')).videos || []; } catch {}

    const cache = await runEnrichment(catalogVideos, autoVideos);
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
 * Receive view analytics from the frontend.
 * Body: { views: [{ id, cat, dur, pct, ts }] }
 */
router.post('/analytics', express.json(), async (req, res) => {
  try {
    const { views } = req.body;
    if (!Array.isArray(views) || views.length === 0) {
      return res.status(204).end();
    }

    const batch = views.slice(0, 50);
    const values = [];
    const placeholders = [];
    let idx = 1;
    for (const v of batch) {
      placeholders.push(`($${idx}, $${idx+1}, $${idx+2}, $${idx+3})`);
      values.push(
        String(v.id || '').slice(0, 50),
        String(v.cat || '').slice(0, 50),
        Math.min(Math.max(parseInt(v.dur) || 0, 0), 300000),
        Math.min(Math.max(parseInt(v.pct) || 0, 0), 100)
      );
      idx += 4;
    }

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

// M8 FIX: Poster generation now reads from DB catalog at startup
setTimeout(async () => {
  try {
    const catalog = await loadCatalogFromDB();
    generateAllPosters(catalog).catch(err => {
      console.error('[Posters] Background generation failed:', err.message);
    });
  } catch (err) {
    // Fallback to JSON if DB not ready yet
    try {
      const catalog = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', 'data', 'reels-videos.json'), 'utf8')
      );
      generateAllPosters(catalog).catch(() => {});
    } catch (e) {
      console.error('[Posters] Could not load catalog:', e.message);
    }
  }
}, 30000);

module.exports = router;
