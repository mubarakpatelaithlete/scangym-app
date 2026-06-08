/**
 * Poster frame generator — extracts first frame from CDN videos as JPEG thumbnails.
 * Runs at startup to pre-generate poster frames for all catalog videos.
 * Stores poster JPEGs in server/data/posters/ directory.
 * Serves poster frames via /api/reels/poster/:cdnKey endpoint.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const POSTER_DIR = path.join(__dirname, '..', 'data', 'posters');
const CDN_BASE = 'https://cdn.scangym.com/videos';
const POSTER_WIDTH = 360; // enough for blur-up effect
const POSTER_QUALITY = 60; // JPEG quality — small file size

// Ensure poster directory exists
if (!fs.existsSync(POSTER_DIR)) {
  fs.mkdirSync(POSTER_DIR, { recursive: true });
}

/**
 * Generate a poster frame for a single video
 * @param {string} cdnKey - The CDN key (filename without .mp4)
 * @returns {Promise<string>} Path to generated poster JPEG
 */
function generatePoster(cdnKey) {
  return new Promise((resolve, reject) => {
    const posterPath = path.join(POSTER_DIR, cdnKey + '.jpg');
    
    // Skip if already generated
    if (fs.existsSync(posterPath)) {
      return resolve(posterPath);
    }

    const videoUrl = `${CDN_BASE}/${cdnKey}.mp4`;
    
    // Use ffmpeg to extract first frame from remote URL
    // -ss 0.5 = seek to 0.5s (skip black intro frames)
    // -vframes 1 = extract 1 frame
    // -vf scale = resize to poster width
    // -q:v = JPEG quality (2-31, lower=better, 5 is good balance)
    const args = [
      '-ss', '0.5',
      '-i', videoUrl,
      '-vframes', '1',
      '-vf', `scale=${POSTER_WIDTH}:-1`,
      '-q:v', '5',
      '-y',
      posterPath
    ];

    execFile('ffmpeg', args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        // Try at 0.1s if 0.5s fails (short video)
        const args2 = [
          '-ss', '0.1',
          '-i', videoUrl,
          '-vframes', '1',
          '-vf', `scale=${POSTER_WIDTH}:-1`,
          '-q:v', '5',
          '-y',
          posterPath
        ];
        execFile('ffmpeg', args2, { timeout: 15000 }, (err2) => {
          if (err2) return reject(err2);
          resolve(posterPath);
        });
        return;
      }
      resolve(posterPath);
    });
  });
}

/**
 * Generate poster frames for all videos in batch
 * Runs concurrently with limited parallelism to avoid overload
 * @param {Array} videos - Array of video objects with cdnKey field
 */
async function generateAllPosters(videos) {
  const cdnKeys = videos
    .filter(v => v.cdnKey)
    .map(v => v.cdnKey);

  // Count existing
  const existing = cdnKeys.filter(k => fs.existsSync(path.join(POSTER_DIR, k + '.jpg')));
  const needed = cdnKeys.filter(k => !fs.existsSync(path.join(POSTER_DIR, k + '.jpg')));
  
  console.log(`[Posters] ${existing.length} already exist, ${needed.length} to generate`);
  
  if (needed.length === 0) return;

  // Process in batches of 5 (don't overload ffmpeg)
  const BATCH_SIZE = 5;
  let done = 0;
  let failed = 0;
  
  for (let i = 0; i < needed.length; i += BATCH_SIZE) {
    const batch = needed.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(key => generatePoster(key))
    );
    
    for (const r of results) {
      if (r.status === 'fulfilled') done++;
      else { failed++; }
    }
    
    if ((done + failed) % 25 === 0 || i + BATCH_SIZE >= needed.length) {
      console.log(`[Posters] Progress: ${done}/${needed.length} generated (${failed} failed)`);
    }
  }
  
  console.log(`[Posters] Complete: ${done} generated, ${failed} failed`);
}

/**
 * Get poster path for a cdnKey (returns null if not generated yet)
 */
function getPosterPath(cdnKey) {
  const p = path.join(POSTER_DIR, cdnKey + '.jpg');
  return fs.existsSync(p) ? p : null;
}

module.exports = { generatePoster, generateAllPosters, getPosterPath, POSTER_DIR };
