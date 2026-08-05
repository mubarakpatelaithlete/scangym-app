/**
 * #61: Review Media — Photo & Video uploads for reviews
 * 
 * Uses multer for file handling → disk storage (Railway /data/uploads)
 * Optional R2 CDN upload for production (if R2 env vars configured)
 * 
 * Tables:
 *   review_media — id, review_id, media_type (photo|video), file_path, 
 *                  cdn_url, thumbnail_url, file_size, created_at
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── Storage config ──────────────────────────────────────────
const UPLOAD_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data/uploads/reviews'
  : path.join(__dirname, '..', 'uploads', 'reviews');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const hash = crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `rv_${Date.now()}_${hash}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max (videos up to 30s)
  fileFilter: (req, file, cb) => {
    const allowed = /^(image\/(jpeg|jpg|png|webp|heic)|video\/(mp4|quicktime|webm|mov))$/i;
    if (allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only images (jpg, png, webp) and videos (mp4, webm, mov) are allowed'));
  }
});

// ─── Init table ──────────────────────────────────────────────

// ─── POST /api/review-media/upload — Upload photos/videos for a review ───
// Can upload before review is submitted (review_id = null, linked later)
router.post('/upload', authenticateUser, upload.array('media', 5), async (req, res) => {
  try {
    const files = req.files;
    const { gymId } = req.body;
    const userId = req.user.id;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];
    for (const file of files) {
      const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'photo';
      const servePath = `/api/review-media/file/${path.basename(file.path)}`;

      const result = await pool.query(`
        INSERT INTO review_media (user_id, gym_id, media_type, file_path, cdn_url, file_size)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, media_type, cdn_url, file_size, created_at
      `, [userId, gymId ? parseInt(gymId) : null, mediaType, file.path, servePath, file.size]);

      const row = result.rows[0];
      results.push({
        id: row.id,
        type: row.media_type,
        url: servePath,
        size: row.file_size,
      });

      // Try R2 upload in background (non-blocking)
      tryR2Upload(file.path, row.id, mediaType).catch(() => {});
    }

    res.json({ success: true, media: results });
  } catch (err) {
    console.error('Review media upload error:', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ─── POST /api/review-media/link — Link uploaded media to a review ───
router.post('/link', authenticateUser, async (req, res) => {
  try {
    const { reviewId, mediaIds } = req.body;
    const userId = req.user.id;

    if (!reviewId || !mediaIds || !Array.isArray(mediaIds)) {
      return res.status(400).json({ error: 'reviewId and mediaIds[] required' });
    }

    await pool.query(
      `UPDATE review_media SET review_id = $1 WHERE id = ANY($2) AND user_id = $3`,
      [parseInt(reviewId), mediaIds.map(Number), userId]
    );

    res.json({ success: true, linked: mediaIds.length });
  } catch (err) {
    console.error('Link media error:', err);
    res.status(500).json({ error: 'Failed to link media' });
  }
});

// ─── GET /api/review-media/gym/:gymId — Get all media for a gym ───
router.get('/gym/:gymId', async (req, res) => {
  try {
    const { gymId } = req.params;
    const { type } = req.query; // optional: 'photo' or 'video'

    let query = `
      SELECT rm.id, rm.review_id, rm.media_type, 
             COALESCE(rm.cdn_url, '/api/review-media/file/' || split_part(rm.file_path, '/', -1)) as url,
             rm.thumbnail_url, rm.file_size, rm.width, rm.height, rm.duration_sec,
             rm.created_at,
             r.rating, r.comment
      FROM review_media rm
      LEFT JOIN reviews r ON rm.review_id = r.id
      WHERE rm.gym_id = $1
    `;
    const params = [parseInt(gymId)];

    if (type === 'photo' || type === 'video') {
      query += ` AND rm.media_type = $2`;
      params.push(type);
    }

    query += ` ORDER BY rm.created_at DESC LIMIT 50`;

    const result = await pool.query(query, params);
    res.json({
      media: result.rows,
      total: result.rows.length,
      photos: result.rows.filter(m => m.media_type === 'photo').length,
      videos: result.rows.filter(m => m.media_type === 'video').length,
    });
  } catch (err) {
    console.error('Get gym media error:', err);
    res.status(500).json({ error: 'Failed to fetch media' });
  }
});

// ─── GET /api/review-media/file/:filename — Serve uploaded file ───
router.get('/file/:filename', (req, res) => {
  const { filename } = req.params;
  // Security: only allow our generated filenames
  if (!/^rv_\d+_[a-f0-9]+\.\w+$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  // Set cache headers
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

// ─── Background R2 upload (if configured) ─────────────────────
async function tryR2Upload(localPath, mediaId, mediaType) {
  try {
    const { uploadToR2 } = require('../lib/r2-upload');
    const ext = path.extname(localPath);
    const r2Key = `review-media/${path.basename(localPath)}`;
    const contentType = mediaType === 'video' ? 'video/mp4' :
      ext === '.png' ? 'image/png' :
      ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const result = await uploadToR2(localPath, r2Key, { contentType });
    // Update DB with CDN URL
    await pool.query(
      'UPDATE review_media SET cdn_url = $1 WHERE id = $2',
      [result.url, mediaId]
    );
    console.log(`Review media uploaded to R2: ${r2Key}`);
  } catch (e) {
    // R2 not configured — that's fine, serve from disk
    if (!e.message?.includes('not configured')) {
      console.error('R2 review media upload error:', e.message);
    }
  }
}

module.exports = router;
