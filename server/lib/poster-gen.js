/**
 * Poster frame generator — extracts first frame from R2 videos as JPEG thumbnails.
 *
 * M11 FIX: Rewritten to use R2 API directly (S3 GetObjectCommand) instead of
 * fetching from cdn.scangym.com which is inaccessible from Railway containers.
 * Posters now stored on Railway persistent volume (/data/posters/) so they
 * survive container redeploys.
 *
 * Flow:  R2 (first 3 MB) → local temp → ffmpeg extract frame → JPEG poster
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

// ── ffmpeg binary: prefer npm-installed static binary, fallback to system ──
let FFMPEG_PATH = 'ffmpeg';
try { FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path; } catch { /* use system ffmpeg */ }

// ── Storage: persistent volume first, fallback to in-container ──
const POSTER_DIR = fs.existsSync('/data')
  ? '/data/posters'
  : path.join(__dirname, '..', 'data', 'posters');

const POSTER_WIDTH = 360;   // enough for blur-up effect
const POSTER_QUALITY = 60;  // JPEG quality — small file size

// Ensure poster directory exists
if (!fs.existsSync(POSTER_DIR)) {
  fs.mkdirSync(POSTER_DIR, { recursive: true });
}

/**
 * Generate a poster frame for a single video via R2 download.
 * @param {string} cdnKey - The CDN key (filename without .mp4)
 * @returns {Promise<string>} Path to generated poster JPEG
 */
async function generatePoster(cdnKey) {
  const posterPath = path.join(POSTER_DIR, cdnKey + '.jpg');

  // Skip if already generated
  if (fs.existsSync(posterPath) && fs.statSync(posterPath).size > 100) {
    return posterPath;
  }

  // Download first 3 MB from R2 (enough for first frame extraction)
  const { downloadFromR2, cdnKeyToR2Key } = require('./r2-download');
  const r2Key = cdnKeyToR2Key(cdnKey);
  const tmpVideo = path.join(POSTER_DIR, `_tmp_${cdnKey}.mp4`);

  try {
    await downloadFromR2(r2Key, tmpVideo, { rangeBytes: 3 * 1024 * 1024 });
  } catch (err) {
    // Clean up partial download
    try { fs.unlinkSync(tmpVideo); } catch {}
    throw new Error(`R2 download failed for ${cdnKey}: ${err.message}`);
  }

  // Extract first frame with ffmpeg
  try {
    await extractFrameFromFile(tmpVideo, posterPath);
  } finally {
    // Always clean up temp video
    try { fs.unlinkSync(tmpVideo); } catch {}
  }

  return posterPath;
}

/**
 * Run ffmpeg to extract a frame from a local video file.
 */
function extractFrameFromFile(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-ss', '0.5',
      '-i', videoPath,
      '-vframes', '1',
      '-vf', `scale=${POSTER_WIDTH}:-1`,
      '-q:v', '5',
      '-y',
      outputPath,
    ];

    execFile(FFMPEG_PATH, args, { timeout: 15000 }, (err) => {
      if (err) {
        // Retry at 0.1s (short video might not have 0.5s)
        const args2 = [
          '-ss', '0.1',
          '-i', videoPath,
          '-vframes', '1',
          '-vf', `scale=${POSTER_WIDTH}:-1`,
          '-q:v', '5',
          '-y',
          outputPath,
        ];
        execFile(FFMPEG_PATH, args2, { timeout: 15000 }, (err2) => {
          if (err2) return reject(err2);
          if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
            return reject(new Error('ffmpeg produced empty output'));
          }
          resolve(outputPath);
        });
        return;
      }
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
        return reject(new Error('ffmpeg produced empty output'));
      }
      resolve(outputPath);
    });
  });
}

/**
 * Generate poster frames for all videos in batch.
 * @param {Array} videos - Array of video objects with cdnKey field
 */
async function generateAllPosters(videos) {
  const cdnKeys = videos
    .filter(v => v.cdnKey)
    .map(v => v.cdnKey);

  // Count existing
  const existing = cdnKeys.filter(k =>
    fs.existsSync(path.join(POSTER_DIR, k + '.jpg')) &&
    fs.statSync(path.join(POSTER_DIR, k + '.jpg')).size > 100
  );
  const needed = cdnKeys.filter(k =>
    !fs.existsSync(path.join(POSTER_DIR, k + '.jpg')) ||
    fs.statSync(path.join(POSTER_DIR, k + '.jpg')).size < 100
  );

  console.log(`[Posters] ${existing.length} already exist, ${needed.length} to generate (stored in ${POSTER_DIR})`);

  if (needed.length === 0) return;

  // Process in batches of 3 (R2 downloads + ffmpeg — don't overload)
  const BATCH_SIZE = 3;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < needed.length; i += BATCH_SIZE) {
    const batch = needed.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(key => generatePoster(key))
    );

    for (const r of results) {
      if (r.status === 'fulfilled') done++;
      else {
        failed++;
        console.warn(`[Posters] Failed: ${r.reason?.message || 'unknown'}`);
      }
    }

    if ((done + failed) % 15 === 0 || i + BATCH_SIZE >= needed.length) {
      console.log(`[Posters] Progress: ${done}/${needed.length} generated (${failed} failed)`);
    }
  }

  console.log(`[Posters] Complete: ${done} generated, ${failed} failed`);
}

/**
 * Get poster path for a cdnKey (returns null if not generated yet).
 */
function getPosterPath(cdnKey) {
  const p = path.join(POSTER_DIR, cdnKey + '.jpg');
  return (fs.existsSync(p) && fs.statSync(p).size > 100) ? p : null;
}

module.exports = { generatePoster, generateAllPosters, getPosterPath, POSTER_DIR };
// v4.5.1 — ffmpeg via npm
