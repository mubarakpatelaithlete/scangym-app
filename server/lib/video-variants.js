/**
 * Video Variants — Multi-resolution encoding pipeline (TikTok-grade)
 *
 * Encodes each video at multiple quality levels so the player can
 * adaptively select the best resolution for the user's connection.
 *
 * Variants: 360p, 480p, 720p, 1080p
 * Codec: H.264 (libx264), CRF-based quality, AAC audio
 * All variants have -movflags +faststart for instant range-request playback.
 *
 * Storage: R2 bucket with naming convention:
 *   videos/{cdnKey}.mp4         → original (or highest quality)
 *   videos/{cdnKey}_360p.mp4    → 360p variant
 *   videos/{cdnKey}_480p.mp4    → 480p variant
 *   videos/{cdnKey}_720p.mp4    → 720p variant
 *
 * Requires: ffmpeg (already in Dockerfile)
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const pool = require('../middleware/db');

// ── ffmpeg binary path (same logic as video-enrichment.js) ──
let FFMPEG_PATH = 'ffmpeg';
let FFPROBE_PATH = 'ffprobe';
try { FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path; } catch { /* system fallback */ }
try { FFPROBE_PATH = require('@ffprobe-installer/ffprobe').path; } catch { /* system fallback */ }

const TEMP_DIR = '/tmp/video-variants';
const VARIANT_DIR = '/data/video-variants'; // persistent volume

// Check if libx265 (HEVC encoder) is available in ffmpeg
let _hevcAvailable = null;
function isHevcAvailable() {
  if (_hevcAvailable !== null) return _hevcAvailable;
  try {
    const { execSync } = require('child_process');
    const out = execSync(`"${FFMPEG_PATH}" -encoders 2>&1 | grep libx265`, {
      stdio: ['pipe', 'pipe', 'pipe'], timeout: 5000
    }).toString();
    _hevcAvailable = out.includes('libx265');
  } catch {
    _hevcAvailable = false;
  }
  console.log(`[VideoVariants] libx265 ${_hevcAvailable ? 'available — HEVC variants enabled' : 'not available — HEVC variants will be skipped'}`);
  return _hevcAvailable;
}

// ═══════════════════════════════════════════════════════════
//  VARIANT DEFINITIONS
// ═══════════════════════════════════════════════════════════

const VARIANTS = [
  { name: '360p',  maxHeight: 360,  crf: 28, audioBitrate: '64k',  preset: 'fast', codec: 'h264' },
  { name: '480p',  maxHeight: 480,  crf: 26, audioBitrate: '96k',  preset: 'fast', codec: 'h264' },
  { name: '720p',  maxHeight: 720,  crf: 24, audioBitrate: '128k', preset: 'fast', codec: 'h264' },
  { name: '1080p', maxHeight: 1080, crf: 23, audioBitrate: '128k', preset: 'fast', codec: 'h264' },
];

// H.265/HEVC variants — ~50% smaller at same quality.
// Supported by Safari/iOS (since iOS 11), Chrome Android (hardware-dependent).
// Served only to devices that support HEVC; H.264 remains the universal fallback.
const HEVC_VARIANTS = [
  { name: '480p_hevc', maxHeight: 480, crf: 28, audioBitrate: '96k',  preset: 'fast', codec: 'hevc' },
  { name: '720p_hevc', maxHeight: 720, crf: 26, audioBitrate: '128k', preset: 'fast', codec: 'hevc' },
];

// Combined list for processing
const ALL_VARIANTS = [...VARIANTS, ...HEVC_VARIANTS];

// ═══════════════════════════════════════════════════════════
//  DB SETUP
// ═══════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════
//  PROBE VIDEO
// ═══════════════════════════════════════════════════════════

function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    execFile(FFPROBE_PATH, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
        const audioStream = (data.streams || []).find(s => s.codec_type === 'audio');
        resolve({
          width: videoStream ? parseInt(videoStream.width) : 0,
          height: videoStream ? parseInt(videoStream.height) : 0,
          duration: data.format ? parseFloat(data.format.duration) : 0,
          bitrate: data.format ? parseInt(data.format.bit_rate) : 0,
          codec: videoStream ? videoStream.codec_name : 'unknown',
          hasAudio: !!audioStream,
          hasFaststart: false, // checked separately
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Check if a video has moov atom at the start (faststart).
 * This is critical for instant playback via range requests.
 */
function checkFaststart(filePath) {
  return new Promise((resolve) => {
    // Read first 32 bytes to check for ftyp/moov atom
    try {
      const fd = fs.openSync(filePath, 'r');
      const buf = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);

      // Look for 'moov' in first 4KB — if present, faststart is enabled
      const str = buf.toString('ascii', 0, bytesRead);
      resolve(str.includes('moov') || str.includes('ftyp'));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Ensure a video has faststart (moov atom at beginning).
 * If not, re-mux with -movflags +faststart.
 */
function ensureFaststart(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG_PATH, [
      '-y', '-i', inputPath,
      '-c', 'copy',           // No re-encoding, just move moov
      '-movflags', '+faststart',
      '-max_muxing_queue_size', '1024',
      outputPath
    ], { timeout: 120000 }, (err) => {
      if (err) return reject(err);
      resolve(true);
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  ENCODE VARIANT
// ═══════════════════════════════════════════════════════════

/**
 * Encode a single quality variant of a video.
 *
 * @param {string} inputPath - Source video file
 * @param {string} outputPath - Destination file
 * @param {object} variant - Variant config { name, maxHeight, crf, audioBitrate, preset }
 * @param {object} probe - Probe data for the source
 * @returns {{ width, height, fileSize, bitrate }}
 */
function encodeVariant(inputPath, outputPath, variant, probe) {
  return new Promise((resolve, reject) => {
    // Skip if source is already at or below target resolution
    const sourceHeight = Math.min(probe.width, probe.height); // handle both orientations
    const sourceMax = Math.max(probe.width, probe.height);

    // Determine scaling: scale to maxHeight while preserving aspect ratio
    // -2 ensures even dimensions (required by H.264/H.265)
    let scaleFilter;
    if (probe.height >= probe.width) {
      // Vertical/portrait video: scale height
      if (probe.height <= variant.maxHeight) {
        scaleFilter = null; // No upscaling needed
      } else {
        scaleFilter = `scale=-2:${variant.maxHeight}`;
      }
    } else {
      // Horizontal/landscape video: scale width based on height
      if (probe.height <= variant.maxHeight) {
        scaleFilter = null;
      } else {
        scaleFilter = `scale=-2:${variant.maxHeight}`;
      }
    }

    // Select codec: H.265/HEVC for ~50% smaller files, H.264 as universal fallback
    const isHevc = variant.codec === 'hevc';
    const videoCodec = isHevc ? 'libx265' : 'libx264';
    const codecArgs = isHevc
      ? ['-c:v', videoCodec, '-preset', variant.preset, '-crf', String(variant.crf),
         '-tag:v', 'hvc1',         // Required for Safari/iOS HEVC playback
         '-x265-params', 'log-level=error']  // Suppress x265 verbose output
      : ['-c:v', videoCodec, '-preset', variant.preset, '-crf', String(variant.crf),
         '-profile:v', 'high', '-level', '4.1'];

    const args = [
      '-y', '-i', inputPath,
      ...(scaleFilter ? ['-vf', scaleFilter] : []),
      ...codecArgs,
      '-pix_fmt', 'yuv420p',     // Universal compatibility
      ...(probe.hasAudio ? ['-c:a', 'aac', '-b:a', variant.audioBitrate] : ['-an']),
      '-movflags', '+faststart',  // CRITICAL: moov atom at start for instant playback
      '-max_muxing_queue_size', '1024',
      outputPath
    ];

    execFile(FFMPEG_PATH, args, { timeout: 600000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`Encode ${variant.name} failed: ${err.message}`));
      try {
        const stat = fs.statSync(outputPath);
        // Quick probe of output for dimensions
        execFile(FFPROBE_PATH, [
          '-v', 'quiet', '-print_format', 'json',
          '-show_streams', '-show_format', outputPath
        ], { timeout: 10000 }, (pErr, pOut) => {
          let w = 0, h = 0, br = 0;
          if (!pErr) {
            try {
              const d = JSON.parse(pOut);
              const vs = (d.streams || []).find(s => s.codec_type === 'video');
              if (vs) { w = parseInt(vs.width); h = parseInt(vs.height); }
              if (d.format) br = parseInt(d.format.bit_rate) || 0;
            } catch {}
          }
          resolve({
            width: w,
            height: h,
            fileSize: stat.size,
            bitrate: br,
          });
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// ═══════════════════════════════════════════════════════════
//  UPLOAD VARIANT TO R2
// ═══════════════════════════════════════════════════════════

async function uploadVariantToR2(localPath, r2Key) {
  try {
    const { uploadToR2 } = require('./r2-upload');
    const result = await uploadToR2(localPath, r2Key, {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=31536000', // 1 year (immutable variants)
    });
    return result;
  } catch (err) {
    console.error(`[VideoVariants] R2 upload failed for ${r2Key}:`, err.message);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
//  PROCESS SINGLE VIDEO
// ═══════════════════════════════════════════════════════════

/**
 * Generate all quality variants for a single video.
 *
 * @param {object} video - Video object from catalog { id, cdnKey, url, ... }
 * @returns {{ variants: Array, skipped: boolean }}
 */
async function processVideoVariants(video) {
  if (!video.cdnKey) {
    return { variants: [], skipped: true, reason: 'no cdnKey' };
  }

  // Check if variants already exist
  const existing = await pool.query(
    'SELECT quality FROM video_variants WHERE cdn_key = $1',
    [video.cdnKey]
  );
  const existingQualities = new Set(existing.rows.map(r => r.quality));

  // Determine which variants are needed
  const needed = ALL_VARIANTS.filter(v => !existingQualities.has(v.name));
  if (needed.length === 0) {
    return { variants: [], skipped: true, reason: 'all variants exist' };
  }

  // Ensure temp dirs exist
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Download source video from R2
  const sourcePath = path.join(TEMP_DIR, `source_${video.cdnKey}.mp4`);
  try {
    const r2Download = require('./r2-download');
    const r2Key = r2Download.cdnKeyToR2Key(video.cdnKey);
    await r2Download.downloadFromR2(r2Key, sourcePath);
  } catch (err) {
    console.error(`[VideoVariants] Download failed for ${video.cdnKey}:`, err.message);
    return { variants: [], skipped: true, reason: 'download failed' };
  }

  // Probe source
  let probe;
  try {
    probe = await probeVideo(sourcePath);
  } catch (err) {
    cleanup(sourcePath);
    return { variants: [], skipped: true, reason: 'probe failed' };
  }

  // Check and fix faststart on original
  try {
    const hasFaststart = await checkFaststart(sourcePath);
    if (!hasFaststart) {
      const fixedPath = sourcePath + '.faststart.mp4';
      await ensureFaststart(sourcePath, fixedPath);
      // Upload fixed version back to R2 (replaces original)
      const r2Download = require('./r2-download');
      const r2Key = r2Download.cdnKeyToR2Key(video.cdnKey);
      await uploadVariantToR2(fixedPath, r2Key);
      // Update DB
      await pool.query(
        'UPDATE video_catalog SET has_faststart = true WHERE id = $1',
        [video.id]
      ).catch(() => {});
      cleanup(fixedPath);
      console.log(`  ✓ Fixed faststart for ${video.cdnKey}`);
    } else {
      await pool.query(
        'UPDATE video_catalog SET has_faststart = true WHERE id = $1',
        [video.id]
      ).catch(() => {});
    }
  } catch (err) {
    console.warn(`[VideoVariants] Faststart check/fix failed for ${video.cdnKey}:`, err.message);
  }

  const results = [];

  // Encode each needed variant
  for (const variant of needed) {
    // Skip HEVC variants if libx265 is not available
    if (variant.codec === 'hevc' && !isHevcAvailable()) continue;

    // Skip variants larger than or equal to source
    if (variant.maxHeight >= Math.max(probe.width, probe.height) && variant.name !== '720p') {
      // Don't upscale, but always create 720p as the "standard" quality
      if (variant.maxHeight > probe.height && variant.maxHeight > probe.width) {
        continue;
      }
    }

    const outputPath = path.join(TEMP_DIR, `${video.cdnKey}_${variant.name}.mp4`);

    try {
      console.log(`  Encoding ${video.cdnKey} @ ${variant.name}...`);
      const result = await encodeVariant(sourcePath, outputPath, variant, probe);

      // Upload to R2
      const variantR2Key = `videos/${video.cdnKey}_${variant.name}.mp4`;
      await uploadVariantToR2(outputPath, variantR2Key);

      // Record in DB
      await pool.query(
        `INSERT INTO video_variants (video_id, cdn_key, quality, r2_key, width, height, file_size, bitrate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (cdn_key, quality) DO UPDATE SET
           r2_key = EXCLUDED.r2_key, width = EXCLUDED.width, height = EXCLUDED.height,
           file_size = EXCLUDED.file_size, bitrate = EXCLUDED.bitrate`,
        [video.id, video.cdnKey, variant.name, variantR2Key,
         result.width, result.height, result.fileSize, result.bitrate]
      );

      results.push({ quality: variant.name, ...result });
      console.log(`  ✓ ${variant.name}: ${(result.fileSize / 1024 / 1024).toFixed(1)}MB`);
    } catch (err) {
      console.error(`  ✗ ${variant.name}: ${err.message}`);
    } finally {
      cleanup(outputPath);
    }
  }

  // Mark video as variants_ready
  if (results.length > 0) {
    await pool.query(
      'UPDATE video_catalog SET variants_ready = true WHERE id = $1',
      [video.id]
    ).catch(() => {});
  }

  cleanup(sourcePath);
  return { variants: results, skipped: false };
}

// ═══════════════════════════════════════════════════════════
//  BATCH PROCESSING (STARTUP PIPELINE)
// ═══════════════════════════════════════════════════════════

/**
 * Process all catalog videos that don't have variants yet.
 * Runs in background after startup. Rate-limited to avoid CPU saturation.
 *
 * @param {Array} catalogVideos - Array of video objects from DB
 * @param {object} opts - { maxConcurrent: 1, maxVideos: 10 }
 */
async function processAllVariants(catalogVideos, opts = {}) {
  const maxVideos = opts.maxVideos || 5; // Process 5 per startup to avoid timeout
  const delayBetween = opts.delayMs || 2000; // 2s between videos

  console.log(`[VideoVariants] Starting batch processing (${catalogVideos.length} catalog videos, max ${maxVideos} per run)...`);

  // Filter to videos without variants
  const needsProcessing = [];
  for (const video of catalogVideos) {
    if (!video.cdnKey) continue;
    const existing = await pool.query(
      'SELECT COUNT(*) FROM video_variants WHERE cdn_key = $1',
      [video.cdnKey]
    );
    if (parseInt(existing.rows[0].count) < ALL_VARIANTS.length) {
      needsProcessing.push(video);
    }
  }

  console.log(`[VideoVariants] ${needsProcessing.length} videos need variants`);

  let processed = 0;
  for (const video of needsProcessing.slice(0, maxVideos)) {
    try {
      const result = await processVideoVariants(video);
      if (!result.skipped) {
        processed++;
        console.log(`[VideoVariants] [${processed}/${Math.min(needsProcessing.length, maxVideos)}] ${video.cdnKey}: ${result.variants.length} variants created`);
      }
    } catch (err) {
      console.error(`[VideoVariants] Error processing ${video.cdnKey}:`, err.message);
    }

    // Delay between videos to avoid CPU saturation
    if (delayBetween > 0) {
      await new Promise(r => setTimeout(r, delayBetween));
    }
  }

  console.log(`[VideoVariants] Batch complete: ${processed} videos processed, ${Math.max(0, needsProcessing.length - maxVideos)} remaining for next run`);
  return { processed, remaining: Math.max(0, needsProcessing.length - maxVideos) };
}

// ═══════════════════════════════════════════════════════════
//  GET VARIANTS FOR FEED
// ═══════════════════════════════════════════════════════════

/**
 * Load all variant data for a list of videos (batch query).
 * Returns a map: cdnKey → { '360p': { url, fileSize }, '480p': ..., ... }
 */
async function getVariantsForFeed(cdnKeys) {
  if (!cdnKeys || cdnKeys.length === 0) return {};

  try {
    const result = await pool.query(
      `SELECT cdn_key, quality, r2_key, width, height, file_size, bitrate
       FROM video_variants
       WHERE cdn_key = ANY($1)
       ORDER BY cdn_key, quality`,
      [cdnKeys]
    );

    const map = {};
    for (const row of result.rows) {
      if (!map[row.cdn_key]) map[row.cdn_key] = {};
      const isHevc = row.quality.includes('hevc');
      map[row.cdn_key][row.quality] = {
        url: `https://cdn.scangym.com/${row.r2_key}`,
        width: row.width,
        height: row.height,
        fileSize: row.file_size,
        bitrate: row.bitrate,
        codec: isHevc ? 'hevc' : 'h264',
      };
    }
    return map;
  } catch (err) {
    console.error('[VideoVariants] getVariantsForFeed error:', err.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════
//  PROCESS SINGLE UPLOAD (for future videos)
// ═══════════════════════════════════════════════════════════

/**
 * Process a newly uploaded video — encode all variants.
 * Called from the upload/ingest pipeline after the video is in R2.
 *
 * @param {string} localPath - Path to the video file on disk
 * @param {string} cdnKey - The CDN key for this video
 * @param {number} videoId - The video_catalog ID
 */
async function processUploadVariants(localPath, cdnKey, videoId) {
  const probe = await probeVideo(localPath);

  // Ensure faststart on the source
  const hasFaststart = await checkFaststart(localPath);
  if (!hasFaststart) {
    const fixedPath = localPath + '.faststart.mp4';
    await ensureFaststart(localPath, fixedPath);
    fs.renameSync(fixedPath, localPath);
  }

  const results = [];

  for (const variant of ALL_VARIANTS) {
    // Skip HEVC variants if libx265 is not available
    if (variant.codec === 'hevc' && !isHevcAvailable()) continue;
    // Skip if variant would be larger than source
    if (variant.maxHeight > Math.max(probe.width, probe.height)) continue;

    const outputPath = localPath + `_${variant.name}.mp4`;
    try {
      const result = await encodeVariant(localPath, outputPath, variant, probe);
      const variantR2Key = `videos/${cdnKey}_${variant.name}.mp4`;
      await uploadVariantToR2(outputPath, variantR2Key);

      await pool.query(
        `INSERT INTO video_variants (video_id, cdn_key, quality, r2_key, width, height, file_size, bitrate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (cdn_key, quality) DO UPDATE SET
           r2_key = EXCLUDED.r2_key, width = EXCLUDED.width, height = EXCLUDED.height,
           file_size = EXCLUDED.file_size, bitrate = EXCLUDED.bitrate`,
        [videoId, cdnKey, variant.name, variantR2Key,
         result.width, result.height, result.fileSize, result.bitrate]
      );

      results.push({ quality: variant.name, ...result });
    } catch (err) {
      console.error(`[VideoVariants] Upload variant ${variant.name} failed:`, err.message);
    } finally {
      cleanup(outputPath);
    }
  }

  // Mark variants_ready
  await pool.query(
    'UPDATE video_catalog SET variants_ready = true, has_faststart = true WHERE id = $1',
    [videoId]
  ).catch(() => {});

  return results;
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════

function cleanup(...paths) {
  for (const p of paths) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }
}

module.exports = {
  processVideoVariants,
  processAllVariants,
  processUploadVariants,
  getVariantsForFeed,
  ensureFaststart,
  checkFaststart,
  probeVideo,
  VARIANTS,
  HEVC_VARIANTS,
  ALL_VARIANTS,
};
