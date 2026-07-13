/**
 * Video Watermark — Burns ScanGym 🟠 branding into downloaded reels.
 * 
 * Like TikTok's @username watermark: semi-transparent orange "ScanGym" text
 * in bottom-left, plus "scangym.com" below it.
 * 
 * Uses FFmpeg drawtext filter (no external image files needed).
 * Caches watermarked videos to avoid re-processing on repeat downloads.
 * 
 * Requires: @ffmpeg-installer/ffmpeg (already in package.json)
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ── FFmpeg binary: prefer npm-installed static binary ──
let FFMPEG_PATH = 'ffmpeg';
try { FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path; } catch { /* use system ffmpeg */ }

// ── Cache directory for watermarked videos ──
const WATERMARK_DIR = fs.existsSync('/data')
  ? '/data/watermarked'
  : path.join(__dirname, '..', 'data', 'watermarked');

if (!fs.existsSync(WATERMARK_DIR)) {
  fs.mkdirSync(WATERMARK_DIR, { recursive: true });
}

// ── Temp directory for downloads ──
const TEMP_DIR = fs.existsSync('/data')
  ? '/data/tmp'
  : path.join(__dirname, '..', 'data', 'tmp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Download a CDN video to a local temp file.
 * @param {string} cdnUrl - Full CDN URL
 * @param {string} destPath - Local file path
 * @returns {Promise<void>}
 */
function downloadVideo(cdnUrl, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(cdnUrl, (response) => {
      if (response.statusCode >= 400) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        return reject(new Error(`CDN returned ${response.statusCode}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(resolve); });
    }).on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(err);
    });
  });
}

/**
 * Add ScanGym watermark to a video using FFmpeg drawtext.
 * 
 * Watermark style (TikTok-inspired):
 * - "ScanGym" in bold orange (#FF6D00) at bottom-left
 * - "scangym.com" smaller text below
 * - Semi-transparent (40% opacity)
 * - White text shadow for readability on light backgrounds
 * 
 * @param {string} inputPath - Source video file
 * @param {string} outputPath - Destination watermarked video
 * @returns {Promise<void>}
 */
function addWatermark(inputPath, outputPath, linkHandle) {
  // P3 Link Sticker: burn the creator's personal booking link instead of the
  // generic domain. Handle is sanitised to [a-zA-Z0-9_-] so it is safe for
  // FFmpeg drawtext (no quotes/colons/backslashes possible).
  const safeHandle = (linkHandle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const urlText = safeHandle ? ('scangym.com/r/' + safeHandle) : 'scangym.com';
  return new Promise((resolve, reject) => {
    // Dual drawtext: "ScanGym" large + "scangym.com" small below it
    // Uses fontcolor with alpha for semi-transparency
    // borderw for glow/shadow effect (like TikTok)
    const watermarkFilter = [
      // Main brand name — bottom-left
      "drawtext=text='ScanGym':" +
        "fontsize=28:" +
        "fontcolor=0xFF6D00@0.45:" +    // orange at 45% opacity
        "borderw=1:" +
        "bordercolor=0x000000@0.3:" +    // subtle dark border
        "x=20:" +
        "y=h-th-60",                      // 60px from bottom
      // URL — smaller, below the name
      "drawtext=text='" + urlText + "':" +
        "fontsize=16:" +
        "fontcolor=0xFFFFFF@" + (linkHandle ? "0.55" : "0.35") + ":" +     // white at 35% opacity
        "borderw=1:" +
        "bordercolor=0x000000@0.2:" +
        "x=20:" +
        "y=h-th-30",                      // 30px from bottom
      // Orange dot (circle emoji effect via small text)
      "drawtext=text='●':" +
        "fontsize=10:" +
        "fontcolor=0xFF6D00@0.5:" +
        "x=8:" +
        "y=h-40"
    ].join(',');

    const args = [
      '-i', inputPath,
      '-vf', watermarkFilter,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',   // fast encoding for on-demand processing
      '-crf', '23',             // good quality, reasonable file size
      '-c:a', 'copy',           // don't re-encode audio
      '-movflags', '+faststart', // optimize for web streaming
      '-y',                     // overwrite output
      outputPath,
    ];

    execFile(FFMPEG_PATH, args, { timeout: 120000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('Watermark FFmpeg error:', err.message);
        // Check if output exists anyway (some warnings are non-fatal)
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) {
          return resolve();
        }
        return reject(new Error(`Watermark failed: ${err.message}`));
      }
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
        return reject(new Error('Watermark produced empty output'));
      }
      resolve();
    });
  });
}

/**
 * Get a watermarked version of a CDN video.
 * Returns the path to the cached watermarked file.
 * Downloads + processes on first request, serves cache after.
 * 
 * @param {string} cdnKey - The CDN key (filename without .mp4)
 * @returns {Promise<string>} Path to watermarked video file
 */
async function getWatermarkedVideo(cdnKey, linkHandle) {
  const safeHandle = (linkHandle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const cachedPath = path.join(WATERMARK_DIR, safeHandle ? `${cdnKey}_wm_${safeHandle}.mp4` : `${cdnKey}_wm.mp4`);

  // Serve from cache if available
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 1000) {
    return cachedPath;
  }

  const tmpInput = path.join(TEMP_DIR, `_dl_${cdnKey}_${Date.now()}.mp4`);
  const cdnUrl = `https://cdn.scangym.com/videos/${cdnKey}.mp4`;

  try {
    // Step 1: Download original from CDN
    await downloadVideo(cdnUrl, tmpInput);

    // Step 2: Add watermark
    await addWatermark(tmpInput, cachedPath, safeHandle);

    return cachedPath;
  } finally {
    // Always clean up temp download
    try { fs.unlinkSync(tmpInput); } catch {}
  }
}

module.exports = { getWatermarkedVideo, addWatermark, downloadVideo };
