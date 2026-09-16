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
const { requireCreator } = require('../lib/gen-guard');
const spend = require('../lib/gen-budget');
const eta = require('../lib/gen-eta');
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
async function elevenMusicAllowed() {
  if (!provider.configured('elevenlabs')) return { ok: false, reason: 'no_api_key' };
  if (process.env.ELEVENLABS_MUSIC_ENABLED === 'true') return { ok: true };
  const balance = await provider.elevenCharacterQuota();
  if (!balance) return { ok: false, reason: 'paid_plan_required' };
  if (balance.tier === 'free') return { ok: false, reason: 'paid_plan_required' };
  return { ok: true, tier: balance.tier };
}

/**
 * Which providers can actually make music on this box right now.
 *
 * "Has a key" is not the same as "may generate" for ElevenLabs music — the
 * free tier holds a perfectly valid key and still answers 402. So the
 * predicate handed to the catalogue reports ElevenLabs as unreachable *for
 * music* on a free plan, and the cheapest-reachable rule then lands on the
 * fal row by itself. No branch here picks a vendor; the catalogue does, which
 * is why the direct row can keep the default slot and win again the moment
 * the account goes paid.
 */
async function musicProviders() {
  const eleven = await elevenMusicAllowed();
  const isConfigured = (p) =>
    p === 'elevenlabs' ? eleven.ok : provider.configured(p);
  return { eleven, isConfigured };
}

/**
 * Can this box make music at all, and with what?
 *
 * Reports the reason from whichever provider got closest: if fal is keyed we
 * are available regardless of the ElevenLabs plan, and if neither works the
 * ElevenLabs reason is the useful one to show.
 */
async function musicAllowed() {
  const { eleven, isConfigured } = await musicProviders();
  const model = models.resolveAvailable(KIND, undefined, isConfigured);
  if (!model) return { ok: false, reason: eleven.reason || 'no_api_key' };
  return { ok: true, tier: eleven.tier, via: model.provider, model };
}

// ─── GET /health — may this box make music right now? ─────────────────────
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await jobs.quotaFor(req, KIND);
  const allowed = await musicAllowed();
  const creatorBudget = await spend.budgetFor(req);
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
    budget: creatorBudget,
    models: spend.annotate(models.catalogueFor(KIND, { minutes: LENGTH_MS[DEFAULTS.length] / 60000 }), creatorBudget),
  });
});

// ─── POST /generate — compose the track, inline ───────────────────────────
router.post('/generate', requireCreator, express.json({ limit: '64kb' }), limiter, async (req, res) => {
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
  const { isConfigured } = await musicProviders();
  const model = models.resolveAvailable(KIND, req.body?.model, isConfigured);
  if (!model) return res.status(503).json({ error: 'No music model is reachable on this deployment.' });
  const costUsd = models.estimateUsd(model, { minutes: ms / 60000 });

  /* Money, not clip count, is what needs guarding. @see lib/gen-budget.js */
  const refusedForBudget = spend.verdict(await spend.budgetFor(req), costUsd);
  if (refusedForBudget) return res.status(refusedForBudget.status).json(refusedForBudget.body);
  const jobId = crypto.randomBytes(8).toString('hex');
  const fullPrompt = `${prompt}. Style: ${GENRE_HINT[settings.genre]}.`;

  /*
   * fal is a queue, not a synchronous call. A minute of music takes longer
   * than the 30s this app's proxy allows, so the fal path answers with a job
   * and the sheet polls — exactly what Create Image does. The sheet already
   * handles both shapes (it shows the media inline when `status: done`
   * arrives with a url, and polls otherwise), so this needs no client change.
   */
  if (model.provider === 'fal') {
    try {
      const { op } = await provider.submit(model, falMusicInput(fullPrompt, ms));
      await jobs.recordJob({ id: jobId, req, kind: KIND, prompt, params: { ...settings, op }, op, model, costUsd });
      return res.json({
        jobId,
        status: 'running',
        settings,
        model: { id: model.id, label: model.label },
        costUsd,
        quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
      });
    } catch (e) {
      console.error('[SquadMusic] fal submit failed:', e.message);
      return res.status(502).json({ error: provider.scrub(e.message) || 'Could not reach the music model.' });
    }
  }

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

/**
 * The payload fal's Eleven Music endpoint takes.
 *
 * `music_length_ms` is the same field the direct API uses, which is the
 * whole reason this row was worth adding rather than a cheaper generator:
 * same model, same controls, same licensing, different bill.
 */
function falMusicInput(prompt, ms) {
  return { prompt, music_length_ms: ms, output_format: 'mp3_44100_128' };
}

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

  // A row with an `op` is a fal job: still out at the vendor, so ask. Rows
  // without one are the direct ElevenLabs path, which finishes inside the
  // request and can only be 'running' here if it died mid-flight.
  if (!row.op) return res.json({ status: 'running' });

  const model = models.resolve(KIND, row.model);
  try {
    const out = await provider.poll(model, row.op);
    if (out.status === 'running') {
      return res.json({ status: 'running', queuePosition: out.queuePosition ?? null });
    }
    if (out.status === 'error') {
      await jobs.finishJob(req.params.jobId, { status: 'error', error: out.error });
      return res.json({ status: 'error', error: out.error });
    }
    await jobs.finishJob(req.params.jobId, { status: 'done', url: out.url });
    return res.json({ status: 'done', audioUrl: out.url, url: out.url });
  } catch (e) {
    console.error('[SquadMusic] status error:', e.message);
    return res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /history ─────────────────────────────────────────────────────────
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, KIND);
  res.json({ ...out, quota: await jobs.quotaFor(req, KIND) });
});

module.exports = router;
module.exports._internals = { LENGTH_MS, GENRE_HINT, cleanSettings, musicAllowed, elevenMusicAllowed, musicProviders, falMusicInput };
