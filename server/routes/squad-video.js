/**
 * Squad Video — generate a gym promo clip from a prompt, on the phone.
 *
 * Powers the ScanSquad "Create" sheet: prompt → Veo 3.1 Fast (Gemini API,
 * paid preview) → poll → MP4. The model runs on the GEMINI_API_KEY that is
 * already on this box for the AI Trainer; whether that key's billing tier
 * can actually run Veo is answered by /health at runtime, not assumed here —
 * the sheet uses that answer to show Generate or point at the clip library.
 *
 * Storage: finished MP4s go to R2 (cdn path squad-gen/) when configured,
 * else to local disk served from /file/:id. Jobs are in-memory: a deploy
 * mid-generation loses the pointer, the video is regenerable, and a jobs
 * table for a <90s pipeline is not worth a migration yet.
 *
 * Cost control: 5 renders per user per day (per IP for anonymous), tracked
 * in-memory per instance. Veo Fast preview is billed per second of output —
 * the cap exists so a stuck client loop cannot burn the month's budget.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OUT_DIR = path.join('/tmp', 'squad-gen');
const DAILY_CAP = parseInt(process.env.SQUAD_VIDEO_DAILY_CAP || '5', 10);

const jobs = new Map(); // jobId -> { op, status, videoUrl, error, createdAt, filePath }
const usage = new Map(); // userKey -> { day, count }

function userKey(req) {
  return (req.user && (req.user.id || req.user.userId)) || req.session?.userId || req.ip || 'anon';
}

function underCap(req) {
  const key = String(userKey(req));
  const day = new Date().toISOString().slice(0, 10);
  const u = usage.get(key);
  if (!u || u.day !== day) {
    usage.set(key, { day, count: 1 });
    return true;
  }
  if (u.count >= DAILY_CAP) return false;
  u.count += 1;
  return true;
}

// ─── GET /health — can this box render video right now? ─────────────────
// Free check: lists models and looks for the Veo id. No generation spend.
router.get('/health', async (_req, res) => {
  if (!GEMINI_KEY) return res.json({ available: false, reason: 'no_api_key' });
  try {
    const r = await fetch(`${API_BASE}/models/${VEO_MODEL}?key=${GEMINI_KEY}`);
    if (r.ok) return res.json({ available: true, model: VEO_MODEL });
    const body = await r.json().catch(() => ({}));
    return res.json({
      available: false,
      reason: r.status === 404 ? 'model_not_visible' : 'key_rejected',
      status: r.status,
      detail: body.error?.message?.slice(0, 200),
    });
  } catch (e) {
    return res.json({ available: false, reason: 'network', detail: e.message });
  }
});

// ─── POST /generate — kick off a render ──────────────────────────────────
router.post('/generate', optionalAuth, async (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'Video generation is not configured yet.' });
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > 1500) return res.status(400).json({ error: 'prompt too long' });
  if (!underCap(req)) {
    return res.status(429).json({ error: `Daily limit reached (${DAILY_CAP} videos). Try again tomorrow or grab a ready-made clip from the library.` });
  }

  const aspectRatio = req.body?.aspectRatio === '16:9' ? '16:9' : '9:16';
  try {
    const r = await fetch(`${API_BASE}/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { aspectRatio },
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.name) {
      console.error('[SquadVideo] generate failed:', r.status, JSON.stringify(data).slice(0, 300));
      const msg = data.error?.message || 'Video model refused the request.';
      return res.status(502).json({ error: msg.slice(0, 300) });
    }
    const jobId = crypto.randomBytes(8).toString('hex');
    jobs.set(jobId, { op: data.name, status: 'running', createdAt: Date.now() });
    // GC: drop jobs older than 2h
    for (const [k, v] of jobs) if (Date.now() - v.createdAt > 7200000) jobs.delete(k);
    res.json({ jobId });
  } catch (e) {
    console.error('[SquadVideo] generate error:', e.message);
    res.status(502).json({ error: 'Could not reach the video model.' });
  }
});

// ─── GET /status/:jobId — poll until done ────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'unknown job' });
  if (job.status === 'done') return res.json({ status: 'done', videoUrl: job.videoUrl });
  if (job.status === 'error') return res.json({ status: 'error', error: job.error });

  try {
    const r = await fetch(`${API_BASE}/${job.op}?key=${GEMINI_KEY}`);
    const data = await r.json();
    if (!data.done) return res.json({ status: 'running' });
    if (data.error) {
      job.status = 'error';
      job.error = (data.error.message || 'generation failed').slice(0, 300);
      return res.json({ status: 'error', error: job.error });
    }
    const sample =
      data.response?.generateVideoResponse?.generatedSamples?.[0] ||
      data.response?.generatedVideos?.[0] ||
      null;
    const uri = sample?.video?.uri;
    if (!uri) {
      job.status = 'error';
      job.error = 'model returned no video';
      return res.json({ status: 'error', error: job.error });
    }
    // Download server-side (the URI needs the API key; never hand the key to the client)
    const sep = uri.includes('?') ? '&' : '?';
    const vidResp = await fetch(`${uri}${sep}key=${GEMINI_KEY}`);
    if (!vidResp.ok) throw new Error('video download failed: ' + vidResp.status);
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const filePath = path.join(OUT_DIR, `${req.params.jobId}.mp4`);
    fs.writeFileSync(filePath, Buffer.from(await vidResp.arrayBuffer()));
    job.filePath = filePath;

    // Prefer R2 → CDN; fall back to serving from this box
    try {
      const { uploadToR2 } = require('../lib/r2-upload');
      const key = `squad-gen/${req.params.jobId}.mp4`;
      const up = await uploadToR2(filePath, key, { contentType: 'video/mp4' });
      job.videoUrl = up?.url || `https://cdn.scangym.com/${key}`;
    } catch (e) {
      job.videoUrl = `/api/squad-video/file/${req.params.jobId}`;
    }
    job.status = 'done';
    res.json({ status: 'done', videoUrl: job.videoUrl });
  } catch (e) {
    console.error('[SquadVideo] status error:', e.message);
    res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /file/:jobId — local-disk fallback when R2 is absent ────────────
router.get('/file/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).json({ error: 'not found' });
  }
  res.setHeader('Content-Type', 'video/mp4');
  fs.createReadStream(job.filePath).pipe(res);
});

module.exports = router;
