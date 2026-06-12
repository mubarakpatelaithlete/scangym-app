/**
 * Video Ingest Pipeline — M9 FIX
 *
 * Closes the gap between "video exists somewhere" and "video is in the app".
 * Before: manually download → manually upload to R2 → manually edit JSON
 * After:  POST a file (or URL) → automatic compress → R2 → catalog
 *
 * Endpoints:
 *   POST /api/reels/admin/ingest         — Upload video files directly
 *   POST /api/reels/admin/ingest-url     — Ingest from a public URL
 *   GET  /api/reels/admin/ingest/status  — Check pipeline health
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const multer = require('multer');
const pool = require('../middleware/db');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { compressVideo } = require('../lib/video-compress');
const { uploadToR2, existsInR2 } = require('../lib/r2-upload');
const { processVideoVariants } = require('../lib/video-variants');

// ═══════════════════════════════════════════════════════════
//  STORAGE SETUP
// ═══════════════════════════════════════════════════════════

// Temp directory for ingest processing
const INGEST_DIR = fs.existsSync('/data')
  ? '/data/ingest-temp'
  : path.join(__dirname, '..', 'uploads', 'ingest-temp');

if (!fs.existsSync(INGEST_DIR)) {
  fs.mkdirSync(INGEST_DIR, { recursive: true });
}

// Multer config for file uploads (max 500MB per file, max 10 files)
const upload = multer({
  dest: INGEST_DIR,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
    files: 10,
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  },
});

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Generate a clean CDN key from a video name.
 * e.g. "ScanGym-CMO-V39-UKCityAerial-Horizontal" → "ScanGym-CMO-V39-UKCityAerial-Horizontal"
 */
function makeCdnKey(name) {
  return name
    .replace(/\.[^.]+$/, '')              // Remove file extension
    .replace(/[^a-zA-Z0-9_-]/g, '_')      // Replace special chars with underscore
    .replace(/_+/g, '_')                   // Collapse multiple underscores
    .replace(/^_|_$/g, '')                 // Trim leading/trailing underscores
    .substring(0, 120);                    // Max length
}

/**
 * Download a file from a URL to a local path.
 */
function downloadFile(url, destPath, maxSizeMB = 500) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const maxBytes = maxSizeMB * 1024 * 1024;

    const request = mod.get(url, { timeout: 120000 }, (res) => {
      // Follow redirects (up to 5)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        request.destroy();
        return downloadFile(res.headers.location, destPath, maxSizeMB)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode !== 200) {
        request.destroy();
        return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      }

      const contentLength = parseInt(res.headers['content-length'] || '0');
      if (contentLength > maxBytes) {
        request.destroy();
        return reject(new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(0)}MB exceeds ${maxSizeMB}MB limit`));
      }

      const ws = fs.createWriteStream(destPath);
      let downloaded = 0;

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (downloaded > maxBytes) {
          request.destroy();
          ws.destroy();
          reject(new Error(`Download exceeded ${maxSizeMB}MB limit`));
        }
      });

      res.pipe(ws);
      ws.on('finish', () => resolve({ size: downloaded, contentType: res.headers['content-type'] }));
      ws.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timed out (120s)'));
    });
  });
}

/**
 * Process a single video through the pipeline:
 * 1. Compress (if needed)
 * 2. Upload to R2
 * 3. Add to catalog DB
 * Returns the catalog entry.
 */
async function processVideo(inputPath, originalName, options = {}) {
  const {
    category = 'General',
    name = null,
    dopamineTier = 3,
    skipCompress = false,
    skipExisting = true,
  } = options;

  const videoName = name || originalName.replace(/\.[^.]+$/, '');
  const cdnKey = makeCdnKey(videoName);
  const r2Key = `videos/${cdnKey}.mp4`;

  // Check if already in R2
  if (skipExisting) {
    try {
      const exists = await existsInR2(r2Key);
      if (exists) {
        console.log(`Ingest: Skipping ${cdnKey} — already in R2`);
        return { skipped: true, cdnKey, reason: 'Already in R2' };
      }
    } catch (e) {
      // R2 check failed, continue with upload
    }
  }

  let processedPath = inputPath;
  let compressed = false;

  // Step 1: Compress
  if (!skipCompress) {
    try {
      const result = await compressVideo(inputPath);
      if (result.compressed) {
        processedPath = inputPath; // compressVideo replaces in-place
        compressed = true;
        console.log(`Ingest: Compressed ${videoName} — saved ${result.savedMB}MB`);
      }
    } catch (err) {
      console.error(`Ingest: Compression failed for ${videoName} (non-fatal):`, err.message);
      // Continue with uncompressed file
    }
  }

  // Step 2: Upload to R2
  const uploadResult = await uploadToR2(processedPath, r2Key);

  // Step 3: Add to catalog DB
  const dbResult = await pool.query(
    `INSERT INTO video_catalog (name, category, source, url, cdn_key, file_size, orientation, dopamine_tier)
     VALUES ($1, $2, 'cdn', $3, $4, $5, 'vertical', $6)
     ON CONFLICT (cdn_key) DO UPDATE SET
       name = EXCLUDED.name,
       category = EXCLUDED.category,
       file_size = EXCLUDED.file_size,
       active = true
     RETURNING id, name, cdn_key`,
    [videoName, category, uploadResult.url, cdnKey, uploadResult.size, dopamineTier]
  );

  const entry = dbResult.rows[0];

  // Step 4: Generate multi-resolution variants (adaptive bitrate)
  // Runs in background after response — downloads from R2 (file-safe even after temp cleanup),
  // encodes 360p/480p/720p/1080p variants, uploads back to R2.
  processVideoVariants({ id: entry.id, cdnKey, url: uploadResult.url })
    .then(result => {
      if (!result.skipped && result.variants.length > 0) {
        console.log(`Ingest: Generated ${result.variants.length} quality variants for ${cdnKey}`);
      }
    })
    .catch(err => {
      console.error(`Ingest: Variant encoding failed for ${cdnKey} (non-fatal):`, err.message);
    });

  return {
    skipped: false,
    compressed,
    id: entry.id,
    name: entry.name,
    cdnKey: entry.cdn_key,
    r2Key,
    size: uploadResult.size,
    sizeMB: (uploadResult.size / 1024 / 1024).toFixed(1),
    url: uploadResult.url,
  };
}

// ═══════════════════════════════════════════════════════════
//  ENDPOINTS
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/reels/admin/ingest
 * Upload one or more video files directly.
 *
 * Form data:
 *   - videos: file(s) (multipart)
 *   - category: string (default: "General")
 *   - dopamine_tier: number (default: 3)
 *   - skip_compress: "true" to skip compression
 *
 * Example:
 *   curl -X POST https://scangym.com/api/reels/admin/ingest \
 *     -H "Authorization: Bearer TOKEN" \
 *     -F "videos=@video1.mp4" \
 *     -F "videos=@video2.mp4" \
 *     -F "category=AI Cinematic"
 */
router.post('/', authenticateUser, requireAdmin, upload.array('videos', 10), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'No video files uploaded. Use form field "videos".' });
  }

  const category = req.body.category || 'General';
  const dopamineTier = parseInt(req.body.dopamine_tier) || 3;
  const skipCompress = req.body.skip_compress === 'true';

  const results = [];
  const errors = [];

  for (const file of files) {
    try {
      const result = await processVideo(file.path, file.originalname, {
        category,
        dopamineTier,
        skipCompress,
      });
      results.push(result);
    } catch (err) {
      console.error(`Ingest error for ${file.originalname}:`, err.message);
      errors.push({ file: file.originalname, error: err.message });
    } finally {
      // Clean up temp file
      try { fs.unlinkSync(file.path); } catch {}
    }
  }

  const added = results.filter(r => !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  res.json({
    success: true,
    message: `Pipeline complete: ${added} added, ${skipped} skipped, ${errors.length} failed`,
    added,
    skipped,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * POST /api/reels/admin/ingest-url
 * Ingest videos from public URLs (e.g. Google Drive direct download links).
 *
 * Body (JSON):
 *   {
 *     "videos": [
 *       { "url": "https://...", "name": "My Video", "category": "Promo" },
 *       ...
 *     ],
 *     "category": "General",          // default category
 *     "dopamine_tier": 3,             // default tier
 *     "skip_compress": false
 *   }
 *
 * For Google Drive files, use the direct download URL format:
 *   https://drive.google.com/uc?export=download&id=FILE_ID
 */
router.post('/ingest-url', authenticateUser, requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
  const { videos, category: defaultCategory, dopamine_tier, skip_compress } = req.body;

  if (!Array.isArray(videos) || videos.length === 0) {
    return res.status(400).json({
      error: 'Provide { videos: [{ url, name?, category? }] }',
      example: {
        videos: [
          { url: 'https://drive.google.com/uc?export=download&id=FILE_ID', name: 'My Video', category: 'Promo' }
        ]
      }
    });
  }

  if (videos.length > 50) {
    return res.status(400).json({ error: 'Max 50 videos per request' });
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (!v.url) {
      errors.push({ index: i, error: 'Missing url' });
      continue;
    }

    const tempPath = path.join(INGEST_DIR, `url_${crypto.randomBytes(8).toString('hex')}.mp4`);

    try {
      // Download
      console.log(`Ingest [${i + 1}/${videos.length}]: Downloading ${(v.name || v.url).substring(0, 60)}...`);
      await downloadFile(v.url, tempPath);

      // Process
      const result = await processVideo(tempPath, v.name || `video_${i}`, {
        category: v.category || defaultCategory || 'General',
        name: v.name,
        dopamineTier: v.dopamine_tier || dopamine_tier || 3,
        skipCompress: skip_compress || false,
      });

      results.push(result);
      console.log(`Ingest [${i + 1}/${videos.length}]: ${result.skipped ? 'Skipped' : 'Done'} — ${v.name || 'video_' + i}`);
    } catch (err) {
      console.error(`Ingest [${i + 1}/${videos.length}] error:`, err.message);
      errors.push({ index: i, name: v.name, error: err.message });
    } finally {
      try { fs.unlinkSync(tempPath); } catch {}
    }
  }

  const added = results.filter(r => !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;

  res.json({
    success: true,
    message: `Pipeline complete: ${added} added, ${skipped} skipped, ${errors.length} failed`,
    added,
    skipped,
    failed: errors.length,
    results,
    errors: errors.length > 0 ? errors : undefined,
  });
});

/**
 * GET /api/reels/admin/ingest/status
 * Health check for the pipeline.
 */
router.get('/status', authenticateUser, requireAdmin, async (req, res) => {
  const checks = {
    database: false,
    r2: false,
    ffmpeg: false,
    diskSpace: null,
  };

  // Check database
  try {
    const result = await pool.query('SELECT COUNT(*) FROM video_catalog WHERE active = true');
    checks.database = true;
    checks.catalogCount = parseInt(result.rows[0].count);
  } catch (e) {
    checks.databaseError = e.message;
  }

  // Check R2
  try {
    const { getR2Client } = require('../lib/r2-upload');
    getR2Client(); // Will throw if env vars missing
    checks.r2 = true;
  } catch (e) {
    checks.r2Error = e.message;
  }

  // Check ffmpeg
  try {
    const { execSync } = require('child_process');
    execSync('which ffmpeg', { stdio: 'pipe' });
    checks.ffmpeg = true;
  } catch {
    checks.ffmpegError = 'ffmpeg not found in PATH';
  }

  // Check temp disk space
  try {
    const { execSync } = require('child_process');
    const df = execSync(`df -h ${INGEST_DIR} | tail -1`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString();
    checks.diskSpace = df.trim();
  } catch {}

  const healthy = checks.database && checks.r2 && checks.ffmpeg;
  res.status(healthy ? 200 : 503).json({
    healthy,
    ...checks,
    ingestDir: INGEST_DIR,
  });
});

module.exports = router;
