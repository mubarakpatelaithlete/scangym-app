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
 * else to local disk served from /file/:id.
 *
 * Jobs are rows in squad_video_jobs, with an in-memory Map in front as a
 * per-instance cache. They used to be ONLY in the Map, which cost us twice:
 * a deploy mid-render orphaned the video (the MP4 existed, the pointer did
 * not), and there was no way to show a user what they had already made.
 * The Map is still the fast path; the database is the truth. If the database
 * is unreachable the routes keep working off the Map alone, because a broken
 * history is not a reason to refuse to render.
 *
 * Cost control: 5 renders per user per day (per IP for anonymous). This is
 * now counted with a SELECT over today's rows rather than an in-process
 * counter — the old counter reset on deploy and was per instance, so the
 * real limit was 5 x (number of dynos). Veo Fast preview is billed per
 * second of output, so the cap is a budget guard, not a UX preference.
 *
 * Render settings (duration, resolution, audio, aspect) are whitelisted
 * here, never passed through from the client verbatim.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { optionalAuth } = require('../middleware/auth');
const pool = require('../middleware/db');

const router = express.Router();

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const VEO_MODEL = process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const OUT_DIR = path.join('/tmp', 'squad-gen');
const DAILY_CAP = parseInt(process.env.SQUAD_VIDEO_DAILY_CAP || '5', 10);

const jobs = new Map(); // jobId -> { op, status, videoUrl, error, createdAt, filePath } (cache)

/**
 * Allowed render settings. Anything not in here never reaches the model:
 * the client is untrusted, and Veo bills per second of output, so a
 * hand-crafted durationSeconds is a billing hole rather than a bad render.
 */
const ALLOWED = {
  aspectRatio: ['9:16', '16:9'],
  durationSeconds: [4, 6, 8],
  resolution: ['720p', '1080p'],
};
const DEFAULTS = { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true };

/** Coerce a client body into exactly the settings we are willing to send. */
function cleanSettings(body) {
  const b = body || {};
  const pick = (name, value) => (ALLOWED[name].includes(value) ? value : DEFAULTS[name]);
  return {
    aspectRatio: pick('aspectRatio', b.aspectRatio),
    durationSeconds: pick('durationSeconds', Number(b.durationSeconds)),
    resolution: pick('resolution', b.resolution),
    generateAudio: b.generateAudio === undefined ? DEFAULTS.generateAudio : b.generateAudio !== false,
  };
}

function userKey(req) {
  return (req.user && (req.user.id || req.user.userId)) || req.session?.userId || req.ip || 'anon';
}

/**
 * Renders used today. Counted in the database so the cap survives a deploy
 * and is shared across instances. If the database is unreachable we return
 * null, and callers treat "unknown" as "allow" — refusing to render because
 * the history table is down would be the wrong trade.
 */
async function usedToday(req) {
  try {
    const r = await pool.query(
      "SELECT COUNT(*)::int AS n FROM squad_video_jobs WHERE user_id = $1 AND created_at >= date_trunc('day', NOW())",
      [String(userKey(req))],
    );
    return r.rows[0].n;
  } catch (e) {
    console.error('[SquadVideo] quota lookup failed:', e.message);
    return null;
  }
}

async function quotaFor(req) {
  const used = await usedToday(req);
  return { used: used ?? 0, limit: DAILY_CAP, remaining: used === null ? DAILY_CAP : Math.max(0, DAILY_CAP - used) };
}

/** Best-effort persistence: never let a database problem fail a render. */
async function recordJob(id, req, prompt, settings, op) {
  try {
    await pool.query(
      `INSERT INTO squad_video_jobs (id, user_id, op, prompt, params, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'running') ON CONFLICT (id) DO NOTHING`,
      [id, String(userKey(req)), op, prompt, JSON.stringify(settings)],
    );
  } catch (e) {
    console.error('[SquadVideo] could not record job:', e.message);
  }
}

async function finishJob(id, fields) {
  try {
    await pool.query(
      `UPDATE squad_video_jobs
          SET status = $2, video_url = $3, error = $4, completed_at = NOW()
        WHERE id = $1`,
      [id, fields.status, fields.videoUrl || null, fields.error || null],
    );
  } catch (e) {
    console.error('[SquadVideo] could not finish job:', e.message);
  }
}

// ─── GET /health — can this box render video right now? ─────────────────
// Free check: lists models and looks for the Veo id. No generation spend.
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await quotaFor(req);
  if (!GEMINI_KEY) return res.json({ available: false, reason: 'no_api_key', quota });
  try {
    const r = await fetch(`${API_BASE}/models/${VEO_MODEL}?key=${GEMINI_KEY}`);
    if (r.ok) return res.json({ available: true, model: VEO_MODEL, quota, options: ALLOWED, defaults: DEFAULTS });
    const body = await r.json().catch(() => ({}));
    return res.json({
      available: false,
      reason: r.status === 404 ? 'model_not_visible' : 'key_rejected',
      status: r.status,
      detail: body.error?.message?.slice(0, 200),
      quota,
    });
  } catch (e) {
    return res.json({ available: false, reason: 'network', detail: e.message, quota });
  }
});

// ─── POST /generate — kick off a render ──────────────────────────────────
router.post('/generate', optionalAuth, async (req, res) => {
  if (!GEMINI_KEY) return res.status(503).json({ error: 'Video generation is not configured yet.' });
  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > 1500) return res.status(400).json({ error: 'prompt too long' });
  const quota = await quotaFor(req);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${DAILY_CAP} videos). Try again tomorrow or grab a ready-made clip from the library.`,
      quota,
    });
  }

  const settings = cleanSettings(req.body);
  try {
    const r = await fetch(`${API_BASE}/models/${VEO_MODEL}:predictLongRunning?key=${GEMINI_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: settings,
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
    // GC: drop cached jobs older than 2h — the row in Postgres is the record.
    for (const [k, v] of jobs) if (Date.now() - v.createdAt > 7200000) jobs.delete(k);
    await recordJob(jobId, req, prompt, settings, data.name);
    res.json({ jobId, settings, quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 } });
  } catch (e) {
    console.error('[SquadVideo] generate error:', e.message);
    res.status(502).json({ error: 'Could not reach the video model.' });
  }
});

// ─── GET /status/:jobId — poll until done ────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  let job = jobs.get(req.params.jobId);

  // Cache miss is the normal case after a deploy: the Map is gone but the
  // Veo operation is still running and the row remembers which one it is.
  if (!job) {
    try {
      const r = await pool.query(
        'SELECT op, status, video_url, error FROM squad_video_jobs WHERE id = $1',
        [req.params.jobId],
      );
      if (r.rows[0]) {
        const row = r.rows[0];
        job = { op: row.op, status: row.status, videoUrl: row.video_url, error: row.error, createdAt: Date.now() };
        jobs.set(req.params.jobId, job);
      }
    } catch (e) {
      console.error('[SquadVideo] status lookup failed:', e.message);
    }
  }

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
      await finishJob(req.params.jobId, { status: 'error', error: job.error });
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
      await finishJob(req.params.jobId, { status: 'error', error: job.error });
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
    await finishJob(req.params.jobId, { status: 'done', videoUrl: job.videoUrl });
    res.json({ status: 'done', videoUrl: job.videoUrl });
  } catch (e) {
    console.error('[SquadVideo] status error:', e.message);
    res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /history — this user's recent clips ────────────────────────────
// The reason the jobs table exists: without it the sheet could only ever
// show the clip you made in this session, on this instance.
router.get('/history', optionalAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, prompt, params, status, video_url, error, created_at
         FROM squad_video_jobs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20`,
      [String(userKey(req))],
    );
    res.json({ jobs: r.rows, quota: await quotaFor(req) });
  } catch (e) {
    console.error('[SquadVideo] history failed:', e.message);
    res.json({ jobs: [], quota: { used: 0, limit: DAILY_CAP, remaining: DAILY_CAP }, degraded: true });
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
