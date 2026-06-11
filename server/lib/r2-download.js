/**
 * R2 Download — Download videos from Cloudflare R2 via S3 API
 *
 * M11 FIX: Bypasses the public CDN URL (cdn.scangym.com) which is
 * inaccessible from inside Railway containers (Cloudflare blocks it).
 * Instead, uses the S3-compatible R2 API directly to download video bytes.
 *
 * Required env vars (same as r2-upload.js):
 *   R2_ENDPOINT       — S3-compatible endpoint
 *   R2_ACCESS_KEY_ID  — R2 API access key
 *   R2_SECRET_KEY     — R2 API secret key
 *   R2_BUCKET         — Bucket name (default: scangym-videos)
 */

const { GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getR2Client } = require('./r2-upload');
const fs = require('fs');
const { pipeline } = require('stream/promises');

/**
 * Download a video from R2 to a local file path.
 *
 * @param {string} r2Key   — Object key in R2 (e.g. "videos/my_video.mp4")
 * @param {string} destPath — Local file path to write to
 * @param {object} [opts]
 * @param {number} [opts.rangeBytes] — Only download first N bytes (for metadata extraction)
 * @returns {{ size: number, contentType: string }}
 */
async function downloadFromR2(r2Key, destPath, opts = {}) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET || 'scangym-videos';

  const params = { Bucket: bucket, Key: r2Key };
  if (opts.rangeBytes) {
    params.Range = `bytes=0-${opts.rangeBytes - 1}`;
  }

  const resp = await client.send(new GetObjectCommand(params));

  // Stream body to file
  const ws = fs.createWriteStream(destPath);
  await pipeline(resp.Body, ws);

  return {
    size: resp.ContentLength || 0,
    contentType: resp.ContentType || 'video/mp4',
  };
}

/**
 * Get metadata (size, content-type) for an R2 object without downloading.
 *
 * @param {string} r2Key — Object key in R2
 * @returns {{ size: number, contentType: string } | null}
 */
async function headR2Object(r2Key) {
  try {
    const client = getR2Client();
    const bucket = process.env.R2_BUCKET || 'scangym-videos';
    const resp = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }));
    return {
      size: resp.ContentLength || 0,
      contentType: resp.ContentType || 'video/mp4',
    };
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

/**
 * Convert a CDN key (e.g. "tiktok_gym_hopping") to R2 key (e.g. "videos/tiktok_gym_hopping.mp4").
 */
function cdnKeyToR2Key(cdnKey) {
  // Strip any existing prefix/extension
  const clean = cdnKey.replace(/^videos\//, '').replace(/\.mp4$/, '');
  return `videos/${clean}.mp4`;
}

module.exports = { downloadFromR2, headR2Object, cdnKeyToR2Key };
