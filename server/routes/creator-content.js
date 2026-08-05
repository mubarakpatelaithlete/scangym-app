/**
 * Creator Content Tools — Phase 5 of ScanSquad Creator Empowerment.
 *
 *  - Pin Top Reel (OnlyFans): pin one upload to the front of the feed
 *  - Clip Reel (Twitch): 15-second clip of any catalog reel, with the
 *    creator's personal link burned in (Link Sticker style)
 *  - Add Music (TikTok "use this sound"): optionally swap the clip's
 *    audio with the audio track of another catalog reel
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { downloadVideo } = require('../lib/video-watermark');

router.use(express.json());

const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;

let FFMPEG_PATH = 'ffmpeg';
try { FFMPEG_PATH = require('@ffmpeg-installer/ffmpeg').path; } catch { /* system ffmpeg */ }

const CLIPS_DIR = fs.existsSync('/data') ? '/data/clips' : path.join(__dirname, '..', 'data', 'clips');
const TEMP_DIR = fs.existsSync('/data') ? '/data/tmp' : path.join(__dirname, '..', 'data', 'tmp');
for (const d of [CLIPS_DIR, TEMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}


// ── Pin Top Reel ────────────────────────────────────────────────

router.post('/pin', async (req, res) => {
  try {
    const { handle, uploadId } = req.body || {};
    if (!handle || !HANDLE_RE.test(handle)) return res.status(400).json({ error: 'Invalid handle' });
    await pool.query(`UPDATE creator_uploads SET is_pinned = false WHERE creator_handle = $1`, [handle]);
    if (uploadId) {
      const upId = parseInt(uploadId, 10);
      if (!upId) return res.status(400).json({ error: 'Invalid uploadId' });
      const result = await pool.query(
        `UPDATE creator_uploads SET is_pinned = true
         WHERE id = $1 AND creator_handle = $2 RETURNING id`,
        [upId, handle]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Reel not found' });
      return res.json({ success: true, pinned: upId });
    }
    res.json({ success: true, pinned: null });
  } catch (err) {
    console.error('[CreatorContent] pin error:', err.message);
    res.status(500).json({ error: 'Failed to pin reel' });
  }
});

// ── Clip Reel (+ optional "use this sound") ─────────────────────

function buildDrawtext(handle) {
  const safeHandle = (handle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  const urlText = safeHandle ? `scangym.com/r/${safeHandle}` : 'scangym.com';
  return [
    `drawtext=text='ScanGym':fontsize=28:fontcolor=0xFF6D00@0.5:borderw=1:bordercolor=0x000000@0.3:x=20:y=h-th-60`,
    `drawtext=text='${urlText}':fontsize=16:fontcolor=0xFFFFFF@0.55:borderw=1:bordercolor=0x000000@0.2:x=20:y=h-th-30`,
  ].join(',');
}

router.get('/clip/:cdnKey', async (req, res) => {
  const cdnKey = String(req.params.cdnKey || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200);
  if (!cdnKey) return res.status(400).json({ error: 'Invalid video' });
  const audioKey = String(req.query.audio || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 200);
  const handle = String(req.query.handle || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60);
  let start = parseInt(req.query.start, 10) || 0;
  start = Math.min(Math.max(start, 0), 600);

  const cacheName = `${cdnKey}_c${start}_${audioKey || 'orig'}_${handle || 'none'}.mp4`;
  const cachedPath = path.join(CLIPS_DIR, cacheName);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Content-Disposition', `attachment; filename="scangym-clip-${cdnKey}.mp4"`);

  try {
    if (!fs.existsSync(cachedPath) || fs.statSync(cachedPath).size < 1000) {
      const srcPath = path.join(TEMP_DIR, `_clip_src_${cdnKey}_${Date.now()}.mp4`);
      await downloadVideo(`https://cdn.scangym.com/videos/${cdnKey}.mp4`, srcPath);

      let audioPath = null;
      if (audioKey && audioKey !== cdnKey) {
        audioPath = path.join(TEMP_DIR, `_clip_aud_${audioKey}_${Date.now()}.mp4`);
        try {
          await downloadVideo(`https://cdn.scangym.com/videos/${audioKey}.mp4`, audioPath);
        } catch (e) {
          audioPath = null; // fall back to original audio
        }
      }

      const vf = buildDrawtext(handle);
      const args = audioPath
        ? ['-ss', String(start), '-i', srcPath, '-i', audioPath,
           '-t', '15', '-map', '0:v:0', '-map', '1:a:0?',
           '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
           '-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-y', cachedPath]
        : ['-ss', String(start), '-i', srcPath,
           '-t', '15', '-vf', vf, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
           '-c:a', 'aac', '-movflags', '+faststart', '-y', cachedPath];

      await new Promise((resolve, reject) => {
        execFile(FFMPEG_PATH, args, { timeout: 120000 }, (err) => {
          if (err && !(fs.existsSync(cachedPath) && fs.statSync(cachedPath).size > 1000)) {
            return reject(new Error(`Clip failed: ${err.message}`));
          }
          resolve();
        });
      });
      try { fs.unlinkSync(srcPath); } catch {}
      if (audioPath) { try { fs.unlinkSync(audioPath); } catch {} }
    }
    const stat = fs.statSync(cachedPath);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(cachedPath).pipe(res);
  } catch (err) {
    console.error('[CreatorContent] clip error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Clip generation failed' });
  }
});

module.exports = router;
