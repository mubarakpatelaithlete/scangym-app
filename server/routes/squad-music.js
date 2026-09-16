/**
 * Squad Music — a licensed backing track from a description.
 *
 * ElevenLabs rather than a cheaper generator, on purpose: they hold the label
 * licences (Merlin, Kobalt, Believe, UMG), and a gym reel taken down for
 * music costs the creator more than the $0.30 a minute saved. That reasoning
 * lives in lib/gen-models.js next to the price.
 *
 * The thing to know before touching this route: **Music is not available on
 * ElevenLabs' free tier.** Probed against the live account on 2026-09-16, the
 * API answers 402 `paid_plan_required` — "Music API is not available for free
 * users." Text-to-speech on the same key works fine, which is why Create
 * Audio shipped and this did not.
 *
 * So the route is written, tested and wired, and it reports itself
 * unavailable with that exact reason until the account is on a paid plan. It
 * then switches itself on with no release and no env var to remember, because
 * the tier is read from the account rather than configured by hand. A button
 * that looks live and 402s on tap is the failure this whole sheet is built to
 * avoid — see routes/squad-create.js.
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { optionalAuth } = require('../middleware/auth');
const models = require('../lib/gen-models');
const provider = require('../lib/gen-provider');
const jobs = require('../lib/gen-jobs');
const r2 = require('../lib/r2-upload');

const router = express.Router();
const KIND = 'music';

/** Length presets → milliseconds, which is what the vendor takes. */
const LENGTH_MS = { '15s': 15000, '30s': 30000, '60s': 60000 };

/** Genre is a prompt prefix, not a vendor parameter. */
const GENRE_HINT = {
  Hype: 'high-energy, driving drums, confident',
  Chill: 'relaxed, warm, unhurried groove',
  Epic: 'cinematic, building, wide and powerful',
};

const ALLOWED = { genre: Object.keys(GENRE_HINT), length: Object.keys(LENGTH_MS) };
const DEFAULTS = { genre: 'Hype', length: '30s' };

const MAX_PROMPT = 600;

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment — try again shortly.' },
});

function cleanSettings(body) {
  const b = body || {};
  const pick = (name, value) => (ALLOWED[name].includes(value) ? value : DEFAULTS[name]);
  return { genre: pick('genre', b.genre), length: pick('length', b.length) };
}

/**
 * Whether this account may call the Music API.
 *
 * `ELEVENLABS_MUSIC_ENABLED=true` forces it on for a deployment that knows
 * better than us. Otherwise the answer comes from the account's own tier:
 * anything other than free is allowed, and an unreadable tier is treated as
 * not allowed, because the cost of guessing wrong is a dead button.
 */
async function musicAllowed() {
  if (!provider.configured('elevenlabs')) return { ok: false, reason: 'no_api_key' };
  if (process.env.ELEVENLABS_MUSIC_ENABLED === 'true') return { ok: true };
  const balance = await provider.elevenCharacterQuota();
  if (!balance) return { ok: false, reason: 'paid_plan_required' };
  if (balance.tier === 'free') return { ok: false, reason: 'paid_plan_required' };
  return { ok: true, tier: balance.tier };
}

// ─── GET /health — may this box make music right now? ─────────────────────
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await jobs.quotaFor(req, KIND);
  const allowed = await musicAllowed();
  res.json({
    available: allowed.ok,
    reason: allowed.ok ? undefined : allowed.reason,
    note: allowed.ok
      ? undefined
      : allowed.reason === 'paid_plan_required'
        ? 'Eleven Music needs a paid ElevenLabs plan. Voiceovers work on the current plan.'
        : undefined,
    quota,
    options: ALLOWED,
    defaults: DEFAULTS,
    models: models.catalogueFor(KIND, { minutes: LENGTH_MS[DEFAULTS.length] / 60000 }),
  });
});

// ─── POST /generate — compose the track, inline ───────────────────────────
router.post('/generate', optionalAuth, express.json({ limit: '64kb' }), limiter, async (req, res) => {
  const allowed = await musicAllowed();
  if (!allowed.ok) {
    // 503, not 402: this is our deployment not being able to serve the
    // feature, and the creator cannot fix it by paying anyone.
    return res.status(503).json({
      error:
        allowed.reason === 'paid_plan_required'
          ? 'Music is not switched on yet — it needs a paid plan on our side. Try Create Audio for a voiceover.'
          : 'Music is not configured yet.',
      reason: allowed.reason,
    });
  }

  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: 'prompt too long' });

  const refusal = jobs.screenPrompt(prompt);
  if (refusal) return res.status(400).json({ error: refusal });

  const quota = await jobs.quotaFor(req, KIND);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${quota.limit} tracks). Try again tomorrow.`,
      quota,
    });
  }

  const settings = cleanSettings(req.body);
  const ms = LENGTH_MS[settings.length];
  const model = models.resolveAvailable(KIND, req.body?.model, provider.configured);
  if (!model) return res.status(503).json({ error: 'No music model is reachable on this deployment.' });
  const costUsd = models.estimateUsd(model, { minutes: ms / 60000 });
  const jobId = crypto.randomBytes(8).toString('hex');
  const fullPrompt = `${prompt}. Style: ${GENRE_HINT[settings.genre]}.`;

  try {
    const { buffer, contentType } = await provider.generate(model, { prompt: fullPrompt, ms });
    const url = await store(buffer, contentType, jobId);

    await jobs.recordJob({ id: jobId, req, kind: KIND, prompt, params: settings, op: null, model, costUsd });
    await jobs.finishJob(jobId, { status: 'done', url });

    res.json({
      jobId,
      status: 'done',
      audioUrl: url,
      settings,
      model: { id: model.id, label: model.label },
      costUsd,
      quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
    });
  } catch (e) {
    console.error('[SquadMusic] generate failed:', e.message);
    await jobs.recordJob({ id: jobId, req, kind: KIND, prompt, params: settings, op: null, model, costUsd });
    await jobs.finishJob(jobId, { status: 'error', error: provider.scrub(e.message) });
    res.status(502).json({ error: provider.scrub(e.message) || 'Could not reach the music model.' });
  }
});

/** Same storage rule as voiceovers — see routes/squad-audio.js. */
async function store(buffer, contentType, jobId) {
  if (!r2.r2Configured()) {
    return `data:${contentType || 'audio/mpeg'};base64,${buffer.toString('base64')}`;
  }
  try {
    const out = await r2.uploadBufferToR2(buffer, `squad-music/${jobId}.mp3`, {
      contentType: contentType || 'audio/mpeg',
    });
    return out.url;
  } catch (e) {
    console.error('[SquadMusic] R2 upload failed, serving inline:', e.message);
    return `data:${contentType || 'audio/mpeg'};base64,${buffer.toString('base64')}`;
  }
}

// ─── GET /status/:jobId ───────────────────────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  const row = await jobs.loadJob(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'unknown job' });
  if (row.status === 'error') return res.json({ status: 'error', error: row.error });
  if (row.status === 'done') return res.json({ status: 'done', audioUrl: row.video_url, url: row.video_url });
  return res.json({ status: 'running' });
});

// ─── GET /history ─────────────────────────────────────────────────────────
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, KIND);
  res.json({ ...out, quota: await jobs.quotaFor(req, KIND) });
});

module.exports = router;
module.exports._internals = { LENGTH_MS, GENRE_HINT, cleanSettings, musicAllowed };
