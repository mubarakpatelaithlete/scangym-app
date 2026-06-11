/**
 * R2 Upload — Upload videos to Cloudflare R2 (S3-compatible)
 *
 * M9 FIX: Provides the "upload to CDN" step of the content pipeline.
 * Videos go from server disk → R2 bucket → served via cdn.scangym.com
 *
 * Required env vars:
 *   R2_ENDPOINT       — S3-compatible endpoint (e.g. https://xxx.r2.cloudflarestorage.com)
 *   R2_ACCESS_KEY_ID  — R2 API access key
 *   R2_SECRET_KEY     — R2 API secret key
 *   R2_BUCKET         — Bucket name (default: scangym-videos)
 */

const { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

let _client = null;

/**
 * Get (or create) the S3-compatible client for R2.
 */
function getR2Client() {
  if (_client) return _client;

  const endpoint = process.env.R2_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'R2 not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_KEY env vars.'
    );
  }

  _client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

/**
 * Upload a local file to R2.
 *
 * @param {string} localPath  — Absolute path to the file on disk
 * @param {string} r2Key     — The object key in R2 (e.g. "videos/my_video.mp4")
 * @param {object} [opts]    — Optional overrides
 * @param {string} [opts.contentType] — MIME type (default: video/mp4)
 * @param {string} [opts.cacheControl] — Cache-Control header
 * @returns {{ key: string, size: number, url: string }}
 */
async function uploadToR2(localPath, r2Key, opts = {}) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET || 'scangym-videos';

  const fileStream = fs.createReadStream(localPath);
  const stat = fs.statSync(localPath);

  const contentType = opts.contentType || 'video/mp4';
  const cacheControl = opts.cacheControl || 'public, max-age=31536000'; // 1 year

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: r2Key,
    Body: fileStream,
    ContentType: contentType,
    CacheControl: cacheControl,
    ContentLength: stat.size,
  }));

  // Build the public CDN URL
  const cdnBase = process.env.R2_CDN_URL || 'https://cdn.scangym.com';
  const publicUrl = `${cdnBase}/${r2Key}`;

  console.log(`R2: Uploaded ${r2Key} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);

  return {
    key: r2Key,
    size: stat.size,
    url: publicUrl,
  };
}

/**
 * Check if an object already exists in R2.
 */
async function existsInR2(r2Key) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET || 'scangym-videos';

  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: r2Key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
}

/**
 * Delete an object from R2.
 */
async function deleteFromR2(r2Key) {
  const client = getR2Client();
  const bucket = process.env.R2_BUCKET || 'scangym-videos';

  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: r2Key }));
  console.log(`R2: Deleted ${r2Key}`);
}

module.exports = { uploadToR2, existsInR2, deleteFromR2, getR2Client };
