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
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'scangym-watermark.png');

/**
 * Add the ScanGym stamp to a video: the orange disc logo + wordmark, with the
 * creator's personal booking link under it.
 *
 * It used to be drawtext only — small orange "ScanGym" text at 45% opacity and
 * a 10px bullet standing in for the logo. On a phone screen the owner read that
 * as "saved without the ScanGym logo branding like TikTok", and he was right:
 * there was no mark, just letters. This overlays the real disc (server/assets/
 * scangym-watermark.png, the same #FF6D00 circle with the white S the app paints)
 * so a reposted clip is recognisably ScanGym's.
 *
 * Scaled to the video: 34% of its width, so it reads the same on 720p and 1080p.
 * Kept above the bottom edge where TikTok/Instagram put their own UI, and out of
 * the top-right corner where the app's own chrome sits.
 */
function addWatermark(inputPath, outputPath, linkHandle, opts) {
  const safeHandle = (linkHandle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const urlText = safeHandle ? ('scangym.com/r/' + safeHandle) : 'scangym.com';
  /* safeMode = the retry after the full stamp failed. Text only: no second
     input, no scale2ref, no overlay - the parts that break when a clip has an
     odd pixel format or ffmpeg drops a filter between versions. A plain stamp
     still carries the link, which is the whole point of stamping. */
  const safeMode = !!(opts && opts.safeMode);
  const hasLogo = !safeMode && fs.existsSync(LOGO_PATH);

  /* TikTok's mark does not sit still: the logo drifts between corners every few
     seconds so cropping one corner cannot remove it, and so a reposted clip
     shows the mark wherever the viewer looks. Same idea here - phase A bottom
     left, phase B top right, swapping every PHASE seconds. Commas inside an
     ffmpeg expression have to be escaped or they read as filter separators. */
  const PHASE = 6;
  const phaseA = "enable='lt(mod(t\\," + (PHASE * 2) + ")\\," + PHASE + ")'";
  const phaseB = "enable='gte(mod(t\\," + (PHASE * 2) + ")\\," + PHASE + ")'";

  const linkText = (pos) =>
    "drawtext=text='" + urlText + "':" +
      'fontsize=h/44:' +
      'fontcolor=0xFFFFFF@' + (safeHandle ? '0.85' : '0.65') + ':' +
      'borderw=2:bordercolor=0x000000@0.35:' +
      (pos === 'top'
        ? 'x=w-tw-w*0.055:y=h*0.055:'
        : 'x=w*0.055:y=h-th-h*0.055:') +
      (pos === 'top' ? phaseB : phaseA);

  return new Promise((resolve, reject) => {
    const attribution =
      "drawtext=text='\u00a9 ScanGym " + new Date().getFullYear() + "':" +
        'fontsize=h/56:' +
        'fontcolor=0xFFFFFF@0.5:' +
        'borderw=1:bordercolor=0x000000@0.3:' +
        'x=w-tw-w*0.04:' +
        'y=h-th-h*0.03';

    // Drifting link line (follows the logo) + a fixed attribution line.
    const textChain = [linkText('bottom'), linkText('top'), attribution].join(',');

    let args;
    if (hasLogo) {
      args = [
        '-i', inputPath,
        '-i', LOGO_PATH,
        '-filter_complex',
        /* scale2ref sizes the logo against the video itself (42% of its width),
           so the stamp reads the same on a 720p and a 1080p clip. split feeds
           the same scaled logo to both corner overlays. */
        '[1:v][0:v]scale2ref=w=iw*0.42:h=ow/mdar[wmr][base];' +
        '[wmr]format=rgba,colorchannelmixer=aa=0.9,split=2[wmA][wmB];' +
        '[base][wmA]overlay=W*0.05:H-h-H*0.085:' + phaseA + ':format=auto[ph1];' +
        '[ph1][wmB]overlay=W*0.53:H*0.14:' + phaseB + ':format=auto[stamped];' +
        '[stamped]' + textChain + '[out]',
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath,
      ];
    } else {
      // No logo asset, or the retry: keep a text stamp rather than ship a clean file.
      args = [
        '-i', inputPath,
        '-vf', "drawtext=text='ScanGym':fontsize=h/26:fontcolor=0xFF6D00@0.85:borderw=2:bordercolor=0x000000@0.35:x=w*0.055:y=h-th-h*0.10," + textChain,
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
        '-c:a', 'copy', '-movflags', '+faststart', '-y', outputPath,
      ];
    }

    execFile(FFMPEG_PATH, args, { timeout: 120000 }, (err) => {
      if (err) {
        console.error('Watermark FFmpeg error:', err.message);
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 1000) return resolve();
        try { fs.unlinkSync(outputPath); } catch {}
        return reject(new Error(`Watermark failed: ${err.message}`));
      }
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 100) {
        try { fs.unlinkSync(outputPath); } catch {}
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
async function getWatermarkedVideo(cdnKey, linkHandle, opts) {
  const safeHandle = (linkHandle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const safeMode = !!(opts && opts.safeMode);
  /* wm4: the stamp now drifts between corners, so older cached files are stale.
     Safe-mode output is cached separately - it is the text-only version. */
  const tag = 'wm4' + (safeMode ? 'safe' : '');
  const cachedPath = path.join(WATERMARK_DIR, safeHandle ? `${cdnKey}_${tag}_${safeHandle}.mp4` : `${cdnKey}_${tag}.mp4`);

  // Serve from cache if available
  if (fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 1000) {
    return cachedPath;
  }

  const tmpInput = path.join(TEMP_DIR, `_dl_${cdnKey}_${Date.now()}.mp4`);
  const cdnUrl = `https://cdn.scangym.com/videos/${cdnKey}.mp4`;

  try {
    await downloadVideo(cdnUrl, tmpInput);
    await addWatermark(tmpInput, cachedPath, safeHandle, { safeMode });
    return cachedPath;
  } finally {
    try { fs.unlinkSync(tmpInput); } catch {}
  }
}

module.exports = { getWatermarkedVideo, addWatermark, downloadVideo };
