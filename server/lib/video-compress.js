/**
 * Video Compression — Automatic post-upload compression pipeline
 * 
 * Compresses uploaded videos to 720p, CRF 28, AAC 96k with faststart.
 * Runs asynchronously after upload so the user gets an instant response.
 * Replaces the original file in-place to save disk space.
 * 
 * Requires: ffmpeg (already in Dockerfile)
 * 
 * Usage:
 *   const { compressVideo } = require('./lib/video-compress');
 *   compressVideo('/path/to/video.mp4')
 *     .then(result => console.log(`Compressed: ${result.savedMB}MB saved`))
 *     .catch(err => console.error('Compression failed:', err));
 */

const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Compression settings — matches the proven bulk re-encode config
const COMPRESS_CONFIG = {
  maxHeight: 720,        // Scale down to 720p max
  crf: 28,               // Quality factor (18=high, 28=good-enough for mobile)
  preset: 'fast',        // Encoding speed (fast = good balance)
  audioBitrate: '96k',   // AAC audio bitrate
  skipIfUnder: 4 * 1024 * 1024,  // Skip compression if already under 4MB
};

/**
 * Probe a video file for dimensions and duration.
 * @param {string} filePath 
 * @returns {Promise<{width: number, height: number, duration: number}>}
 */
function probeVideo(filePath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      '-show_format',
      filePath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) return reject(err);
      try {
        const data = JSON.parse(stdout);
        const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
        resolve({
          width: videoStream ? parseInt(videoStream.width) : 0,
          height: videoStream ? parseInt(videoStream.height) : 0,
          duration: data.format ? parseFloat(data.format.duration) : 0,
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Compress a video file in-place.
 * 
 * @param {string} filePath - Absolute path to the video file
 * @param {object} [opts] - Override compression settings
 * @returns {Promise<{compressed: boolean, originalSize: number, newSize: number, savedMB: number, skipped?: string}>}
 */
async function compressVideo(filePath, opts = {}) {
  const config = { ...COMPRESS_CONFIG, ...opts };
  const originalSize = fs.statSync(filePath).size;

  // Skip if already small enough
  if (originalSize <= config.skipIfUnder) {
    return {
      compressed: false,
      originalSize,
      newSize: originalSize,
      savedMB: 0,
      skipped: `Already under ${(config.skipIfUnder / 1024 / 1024).toFixed(0)}MB`,
    };
  }

  // Probe to decide scaling
  let scaleFilter = `scale=-2:${config.maxHeight}`;
  try {
    const probe = await probeVideo(filePath);
    // Only downscale if video is taller than maxHeight
    if (probe.height > 0 && probe.height <= config.maxHeight) {
      scaleFilter = null; // No scaling needed
    }
  } catch (e) {
    // Probe failed — still try to compress without scaling info
    console.warn('video-compress: probe failed, using default scale:', e.message);
  }

  const tmpOutput = filePath + '.compressed.mp4';

  const ffmpegArgs = [
    '-y', '-i', filePath,
    ...(scaleFilter ? ['-vf', scaleFilter] : []),
    '-c:v', 'libx264',
    '-preset', config.preset,
    '-crf', String(config.crf),
    '-c:a', 'aac',
    '-b:a', config.audioBitrate,
    '-movflags', '+faststart',
    '-max_muxing_queue_size', '1024',
    tmpOutput,
  ];

  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ffmpegArgs, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        // Clean up temp file on failure
        try { fs.unlinkSync(tmpOutput); } catch {}
        return reject(new Error(`ffmpeg failed: ${err.message}`));
      }

      try {
        const newSize = fs.statSync(tmpOutput).size;

        // Only replace if actually smaller
        if (newSize >= originalSize) {
          fs.unlinkSync(tmpOutput);
          return resolve({
            compressed: false,
            originalSize,
            newSize: originalSize,
            savedMB: 0,
            skipped: 'Compressed version not smaller',
          });
        }

        // Replace original with compressed version
        fs.renameSync(tmpOutput, filePath);

        const savedMB = (originalSize - newSize) / 1024 / 1024;
        console.log(`video-compress: ${path.basename(filePath)} ${(originalSize/1024/1024).toFixed(1)}MB → ${(newSize/1024/1024).toFixed(1)}MB (saved ${savedMB.toFixed(1)}MB)`);

        resolve({
          compressed: true,
          originalSize,
          newSize,
          savedMB: Math.round(savedMB * 10) / 10,
        });
      } catch (e) {
        try { fs.unlinkSync(tmpOutput); } catch {}
        reject(e);
      }
    });
  });
}

/**
 * Compress a Buffer (for base64 uploads) and return the compressed Buffer.
 * Writes to a temp file, compresses, reads back.
 * 
 * @param {Buffer} videoBuffer - Raw video data
 * @param {string} [filename] - Optional filename for logging
 * @returns {Promise<{buffer: Buffer, compressed: boolean, originalSize: number, newSize: number}>}
 */
async function compressBuffer(videoBuffer, filename = 'video.mp4') {
  const tmpDir = os.tmpdir();
  const tmpInput = path.join(tmpDir, `compress_in_${Date.now()}_${filename}`);
  
  try {
    fs.writeFileSync(tmpInput, videoBuffer);
    const result = await compressVideo(tmpInput);
    const outputBuffer = fs.readFileSync(tmpInput);
    
    return {
      buffer: outputBuffer,
      compressed: result.compressed,
      originalSize: result.originalSize,
      newSize: result.newSize,
    };
  } finally {
    try { fs.unlinkSync(tmpInput); } catch {}
  }
}

module.exports = { compressVideo, compressBuffer, probeVideo };
