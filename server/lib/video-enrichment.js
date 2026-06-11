/**
 * Video Enrichment — Permanent auto-enrichment pipeline
 *
 * On server startup, scans the video catalog for entries missing metadata
 * (fileSize, blurhash, orientation, width, height, duration).
 *
 * M11 FIX: Rewritten to download from R2 via S3 API instead of cdn.scangym.com
 * (which is inaccessible from Railway containers due to Cloudflare blocking).
 * Also adds duration extraction — was previously missing entirely.
 *
 * Enriched data is cached in /data/reels-metadata-cache.json (persistent volume)
 * so it survives redeploys. The feed endpoint merges cached metadata into responses.
 *
 * Requires: ffmpeg (added to Dockerfile), sharp, blurhash
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Lazy-load optional deps (installed in package.json)
let sharp, blurhashEncode;
try { sharp = require('sharp'); } catch(e) { console.warn('video-enrichment: sharp not available'); }
try { blurhashEncode = require('blurhash').encode; } catch(e) { console.warn('video-enrichment: blurhash not available'); }

const CACHE_PATH = '/data/reels-metadata-cache.json';
const FALLBACK_CACHE_PATH = path.join(__dirname, '..', 'data', 'reels-metadata-cache.json');
const TEMP_DIR = '/tmp/video-enrichment';

// ═══════════════════════════════════════════════════════════
//  R2 DOWNLOAD (M11 FIX — bypasses CDN blocking)
// ═══════════════════════════════════════════════════════════

let r2Download = null;
try {
  r2Download = require('./r2-download');
} catch (e) {
  console.warn('video-enrichment: r2-download not available, falling back to HTTP');
}

/**
 * Download video bytes for enrichment.
 * Tries R2 API first (reliable inside Railway), falls back to HTTP.
 */
async function downloadVideoForEnrichment(video, outputPath, bytes) {
  // Strategy 1: R2 API direct download (preferred — bypasses CDN block)
  if (r2Download && video.cdnKey) {
    try {
      const r2Key = r2Download.cdnKeyToR2Key(video.cdnKey);
      await r2Download.downloadFromR2(r2Key, outputPath, { rangeBytes: bytes });
      return true;
    } catch (err) {
      // Fall through to HTTP
    }
  }

  // Strategy 2: HTTP download (fallback for non-CDN videos)
  if (video.url) {
    return downloadRangeHTTP(video.url, outputPath, bytes);
  }

  return false;
}

/**
 * HTTP range download (legacy fallback).
 */
function downloadRangeHTTP(url, outputPath, bytes = 3 * 1024 * 1024) {
  const https = require('https');
  const http = require('http');
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

// ═══════════════════════════════════════════════════════════
//  CACHE
// ═══════════════════════════════════════════════════════════

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

function saveCache(cache) {
  const cachePath = fs.existsSync('/data') ? CACHE_PATH : FALLBACK_CACHE_PATH;
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.error('video-enrichment: failed to save cache:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
//  FILE SIZE VIA R2 HEAD (bypasses CDN)
// ═══════════════════════════════════════════════════════════

async function getFileSize(video) {
  // Try R2 HEAD first (reliable)
  if (r2Download && video.cdnKey) {
    try {
      const r2Key = r2Download.cdnKeyToR2Key(video.cdnKey);
      const info = await r2Download.headR2Object(r2Key);
      if (info && info.size > 0) return info.size;
    } catch {}
  }

  // Fallback: HTTP HEAD
  if (video.url) {
    const https = require('https');
    const http = require('http');
    return new Promise((resolve) => {
      const mod = video.url.startsWith('https') ? https : http;
      const req = mod.request(video.url, { method: 'HEAD', timeout: 10000 }, (res) => {
        const len = res.headers['content-length'];
        resolve(len ? parseInt(len) : null);
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    });
  }

  return null;
}

// ═══════════════════════════════════════════════════════════
//  FFMPEG HELPERS
// ═══════════════════════════════════════════════════════════

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

/** Extract first frame from a local video file. */
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

/** Generate blurhash from an image file. */
async function generateBlurhash(imagePath) {
  if (!sharp || !blurhashEncode) return null;
  try {
    const { data, info } = await sharp(imagePath)
      .resize(32, 32, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return blurhashEncode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}

/** Get video dimensions from ffprobe. */
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
 * M11 FIX: Extract video duration in seconds using ffprobe.
 * Previously missing — no video had duration data.
 */
function getVideoDuration(videoPath) {
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}" 2>/dev/null`,
      { timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    const dur = parseFloat(out);
    if (dur > 0 && isFinite(dur)) return Math.round(dur * 10) / 10; // 1 decimal place
  } catch {}
  return null;
}

// ═══════════════════════════════════════════════════════════
//  SINGLE VIDEO ENRICHMENT
// ═══════════════════════════════════════════════════════════

async function enrichVideo(video, index) {
  if (!video.url && !video.cdnKey) return null;

  const meta = {};

  // 1. File size via R2 HEAD (or HTTP HEAD fallback)
  if (!video.fileSize) {
    const size = await getFileSize(video);
    if (size) meta.fileSize = size;
  }

  // 2. Download partial video for ffmpeg analysis
  const needsMediaAnalysis = !video.blurhash || !video.width || !video.duration;
  if (needsMediaAnalysis && hasFfmpeg()) {
    const tmpVideo = path.join(TEMP_DIR, `enrich_${index}.mp4`);
    const tmpFrame = path.join(TEMP_DIR, `enrich_${index}.png`);

    try {
      const downloaded = await downloadVideoForEnrichment(video, tmpVideo, 4 * 1024 * 1024);
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

        // M11 FIX: Extract duration (new — was missing for all 115 videos)
        if (!video.duration) {
          const dur = getVideoDuration(tmpVideo);
          if (dur) meta.duration = dur;
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

// ═══════════════════════════════════════════════════════════
//  MAIN ENRICHMENT RUNNER
// ═══════════════════════════════════════════════════════════

async function runEnrichment(staticVideos) {
  console.log('video-enrichment: starting...');

  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const cache = loadCache();
  let enriched = 0;
  let skipped = 0;
  let failed = 0;

  const allVideos = staticVideos.map(v => ({ ...v, _source: 'static' }));

  for (let i = 0; i < allVideos.length; i++) {
    const video = allVideos[i];
    const cacheKey = String(video.id || video.cdnKey || video.url);

    // Merge cached data into video for checking
    const merged = { ...video, ...(cache[cacheKey] || {}) };

    // Skip if already fully enriched (now includes duration check)
    if (merged.fileSize && merged.blurhash && merged.orientation && merged.width && merged.duration) {
      if (!cache[cacheKey]) {
        cache[cacheKey] = {
          fileSize: merged.fileSize,
          blurhash: merged.blurhash,
          orientation: merged.orientation,
          width: merged.width,
          height: merged.height,
          duration: merged.duration,
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

  saveCache(cache);

  console.log(`video-enrichment: done. enriched=${enriched}, skipped=${skipped}, failed=${failed}, cached=${Object.keys(cache).length}`);
  return cache;
}

/**
 * Apply cached metadata to a video array (used by the feed endpoint).
 * M11 FIX: Now also applies duration.
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
    if (!video.duration && cached.duration) video.duration = cached.duration;
  }
  return videos;
}

module.exports = { runEnrichment, applyCachedMetadata, loadCache };
