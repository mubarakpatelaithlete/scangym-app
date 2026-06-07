/**
 * Video Enrichment — Permanent auto-enrichment pipeline
 * 
 * On server startup, scans the static video catalog and auto-generated reels
 * for any entries missing metadata (fileSize, blurhash, orientation, width, height).
 * 
 * Enriched data is cached in /data/reels-metadata-cache.json (persistent volume)
 * so it survives redeploys. The feed endpoint merges cached metadata into responses.
 * 
 * Requires: ffmpeg (added to Dockerfile), sharp, blurhash
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { execSync } = require('child_process');

// Lazy-load optional deps (installed in package.json)
let sharp, blurhashEncode;
try { sharp = require('sharp'); } catch(e) { console.warn('video-enrichment: sharp not available'); }
try { blurhashEncode = require('blurhash').encode; } catch(e) { console.warn('video-enrichment: blurhash not available'); }

const CACHE_PATH = '/data/reels-metadata-cache.json';
const FALLBACK_CACHE_PATH = path.join(__dirname, '..', 'data', 'reels-metadata-cache.json');
const TEMP_DIR = '/tmp/video-enrichment';

/**
 * Load the metadata cache from persistent volume (or fallback path).
 */
function loadCache() {
  const cachePath = fs.existsSync(CACHE_PATH) ? CACHE_PATH
    : fs.existsSync(FALLBACK_CACHE_PATH) ? FALLBACK_CACHE_PATH : null;
  if (cachePath) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      console.warn('video-enrichment: cache parse error, starting fresh');
    }
  }
  return {};
}

/**
 * Save the metadata cache.
 */
function saveCache(cache) {
  const cachePath = fs.existsSync('/data') ? CACHE_PATH : FALLBACK_CACHE_PATH;
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('video-enrichment: failed to save cache:', e.message);
  }
}

/**
 * HTTP HEAD request to get Content-Length.
 */
function getFileSize(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
      const len = res.headers['content-length'];
      resolve(len ? parseInt(len) : null);
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

/**
 * Download a range of bytes from a URL.
 */
function downloadRange(url, outputPath, bytes = 3 * 1024 * 1024) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { Range: `bytes=0-${bytes - 1}` },
      timeout: 30000,
    }, (res) => {
      const ws = fs.createWriteStream(outputPath);
      res.pipe(ws);
      ws.on('finish', () => resolve(true));
      ws.on('error', () => resolve(false));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Check if ffmpeg is available.
 */
let _ffmpegAvailable = null;
function hasFfmpeg() {
  if (_ffmpegAvailable === null) {
    try {
      execSync('which ffmpeg', { stdio: 'pipe' });
      _ffmpegAvailable = true;
    } catch {
      _ffmpegAvailable = false;
    }
  }
  return _ffmpegAvailable;
}

/**
 * Extract first frame from a video file using ffmpeg → PNG.
 */
function extractFrame(videoPath, framePath) {
  try {
    execSync(
      `ffmpeg -y -i "${videoPath}" -vframes 1 -f image2 "${framePath}" 2>/dev/null`,
      { timeout: 15000, stdio: 'pipe' }
    );
    return fs.existsSync(framePath) && fs.statSync(framePath).size > 100;
  } catch {
    return false;
  }
}

/**
 * Generate blurhash from an image file using sharp + blurhash.
 */
async function generateBlurhash(imagePath) {
  if (!sharp || !blurhashEncode) return null;
  try {
    const { data, info } = await sharp(imagePath)
      .resize(32, 32, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    
    return blurhashEncode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch (e) {
    return null;
  }
}

/**
 * Get video dimensions from ffprobe.
 */
function getVideoDimensions(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${videoPath}" 2>/dev/null`,
      { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    const [w, h] = out.split(',').map(Number);
    if (w > 0 && h > 0) return { width: w, height: h };
  } catch {}
  return null;
}

/**
 * Enrich a single video entry. Returns metadata object or null.
 */
async function enrichVideo(video, index) {
  const url = video.url;
  if (!url) return null;

  const meta = {};

  // 1. File size via HEAD
  if (!video.fileSize) {
    const size = await getFileSize(url);
    if (size) meta.fileSize = size;
  }

  // 2. Blurhash + dimensions via ffmpeg + sharp
  if ((!video.blurhash || !video.width) && hasFfmpeg()) {
    const tmpVideo = path.join(TEMP_DIR, `enrich_${index}.mp4`);
    const tmpFrame = path.join(TEMP_DIR, `enrich_${index}.png`);

    try {
      const downloaded = await downloadRange(url, tmpVideo);
      if (downloaded) {
        // Get dimensions
        if (!video.width) {
          const dims = getVideoDimensions(tmpVideo);
          if (dims) {
            meta.width = dims.width;
            meta.height = dims.height;
            meta.orientation = dims.width > dims.height * 1.2 ? 'horizontal'
              : dims.height > dims.width * 1.2 ? 'vertical' : 'square';
          }
        }

        // Generate blurhash
        if (!video.blurhash) {
          const extracted = extractFrame(tmpVideo, tmpFrame);
          if (extracted) {
            const bh = await generateBlurhash(tmpFrame);
            if (bh) meta.blurhash = bh;
          }
        }
      }
    } finally {
      try { fs.unlinkSync(tmpVideo); } catch {}
      try { fs.unlinkSync(tmpFrame); } catch {}
    }
  }

  // 3. Orientation from existing dimensions or filename hints
  if (!video.orientation && !meta.orientation) {
    if (video.width && video.height) {
      meta.orientation = video.width > video.height * 1.2 ? 'horizontal'
        : video.height > video.width * 1.2 ? 'vertical' : 'square';
    } else {
      const hint = ((video.cdnKey || '') + ' ' + (video.name || '')).toLowerCase();
      if (hint.includes('horizontal') || hint.includes('16x9')) meta.orientation = 'horizontal';
      else if (hint.includes('vertical')) meta.orientation = 'vertical';
    }
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Main enrichment runner. Call on server startup.
 * Scans videos, enriches missing metadata, caches results.
 */
async function runEnrichment(staticVideos, autoVideos = []) {
  console.log('video-enrichment: starting...');
  
  // Ensure temp dir
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  // Load existing cache
  const cache = loadCache();
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  const allVideos = [
    ...staticVideos.map(v => ({ ...v, _source: 'static' })),
    ...autoVideos.map(v => ({ ...v, _source: 'auto' })),
  ];

  for (let i = 0; i < allVideos.length; i++) {
    const video = allVideos[i];
    const cacheKey = String(video.id || video.cdnKey || video.url);
    
    // Merge cached data into video for checking
    const merged = { ...video, ...(cache[cacheKey] || {}) };
    
    // Skip if already fully enriched
    if (merged.fileSize && merged.blurhash && merged.orientation && merged.width) {
      // Update cache if video had it but cache didn't
      if (!cache[cacheKey]) {
        cache[cacheKey] = {
          fileSize: merged.fileSize,
          blurhash: merged.blurhash,
          orientation: merged.orientation,
          width: merged.width,
          height: merged.height,
        };
      }
      skipped++;
      continue;
    }

    try {
      const meta = await enrichVideo(merged, i);
      if (meta) {
        cache[cacheKey] = { ...(cache[cacheKey] || {}), ...meta };
        enriched++;
        console.log(`  ✓ [${i + 1}/${allVideos.length}] ${(video.name || cacheKey).substring(0, 40)}`);
      } else {
        skipped++;
      }
    } catch (e) {
      failed++;
      console.error(`  ✗ [${i + 1}/${allVideos.length}] ${video.name}: ${e.message}`);
    }
  }

  // Save cache
  saveCache(cache);
  
  console.log(`video-enrichment: done. enriched=${enriched}, skipped=${skipped}, failed=${failed}, cached=${Object.keys(cache).length}`);
  return cache;
}

/**
 * Apply cached metadata to a video array (used by the feed endpoint).
 */
function applyCachedMetadata(videos, cache) {
  for (const video of videos) {
    const cacheKey = String(video.id || video.cdnKey || video.url);
    const cached = cache[cacheKey];
    if (!cached) continue;
    
    if (!video.fileSize && cached.fileSize) video.fileSize = cached.fileSize;
    if (!video.blurhash && cached.blurhash) video.blurhash = cached.blurhash;
    if (!video.orientation && cached.orientation) video.orientation = cached.orientation;
    if (!video.width && cached.width) video.width = cached.width;
    if (!video.height && cached.height) video.height = cached.height;
  }
  return videos;
}

module.exports = { runEnrichment, applyCachedMetadata, loadCache };
