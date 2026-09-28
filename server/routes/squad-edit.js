/**
 * Squad Edit — change a video you already have, on the phone.
 *
 * The ninth Create mode, and the first one whose input is a *video* rather
 * than only a prompt: pick a clip (one you made, or a link), say what should
 * change, get a new clip back. It exists in the shape squad-video.js
 * established (health → generate → poll status → history) so the sheet needs
 * no new client logic, and every payload difference between vendors lives in
 * EDIT_PROFILES below rather than in a branch.
 *
 * Why one mode instead of nine buttons: fal carries 220+ video-to-video
 * endpoints and a creator does not shop for endpoints, they want "make it
 * vertical", "dub it into Spanish", "add sound". So the catalogue row is the
 * *edit*, named by its role (see gen-models.js#ROLES), and the model picker
 * the sheet already draws is how you choose one. Adding a tenth edit is a
 * catalogue row plus a profile, not another sheet.
 *
 * Cost: these models bill per second of the source clip, and we do not know
 * that length until the vendor has the file. So the sheet asks for it
 * (whitelisted below), the quote is built from it, and the note line says the
 * quote follows the clip's real length. Quoting a length nobody entered is
 * how a 5s estimate lands as a 60s invoice.
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { optionalAuth } = require('../middleware/auth');
const { requireBillable } = require('../lib/gen-guard');
const spend = require('../lib/gen-budget');
const eta = require('../lib/gen-eta');
const models = require('../lib/gen-models');
const provider = require('../lib/gen-provider');
const jobs = require('../lib/gen-jobs');

const router = express.Router();
const KIND = 'edit';

/**
 * Whitelisted settings. The client is untrusted and every row here is billed
 * per second, so `sourceSeconds` is a money field, not a display one.
 */
const ALLOWED = {
  sourceSeconds: [5, 8, 10, 15, 30],
  aspectRatio: ['9:16', '1:1', '16:9'],
  resolution: ['720p', '1080p'],
  language: ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Hindi', 'Arabic', 'Polish', 'English'],
};
const DEFAULTS = { sourceSeconds: 8, aspectRatio: '9:16', resolution: '720p', language: 'Spanish' };

const MAX_PROMPT = 1200;
const MAX_URL = 2048;

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
  return {
    sourceSeconds: pick('sourceSeconds', Number(b.sourceSeconds)),
    aspectRatio: pick('aspectRatio', b.aspectRatio),
    resolution: pick('resolution', b.resolution),
    language: pick('language', b.language),
  };
}

/**
 * The source clip. Only http(s) is accepted: a `file://` or `data:` url is
 * either a mistake or an attempt to make our server fetch something local,
 * and the vendor has to be able to download it anyway.
 */
function cleanVideoUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return { error: 'Pick a clip to edit first.' };
  if (s.length > MAX_URL) return { error: 'That link is too long.' };
  let u;
  try {
    u = new URL(s);
  } catch (e) {
    return { error: 'That does not look like a video link.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { error: 'The clip link must start with https://' };
  }
  return { url: u.toString() };
}

/**
 * Catalogue row → the payload that model expects.
 *
 * Verified against each model's queue OpenAPI schema on 2026-09-28. fal
 * rejects unknown fields on some models and silently ignores them on others,
 * so guessing is how a setting a creator chose goes in the bin (see the
 * Seedream note in squad-image.js). Every row's required fields are covered
 * here; optional fields are only sent when the sheet can actually set them.
 */
const EDIT_PROFILES = {
  /** google/gemini-omni-flash/v1.1/edit — video_url, prompt, resolution. */
  'omni-edit': (url, prompt, s) => ({ video_url: url, prompt, resolution: s.resolution }),
  /** decart/lucy-restyle — resolution is a free string, 720p is its default. */
  restyle: (url, prompt, s) => ({ video_url: url, prompt, resolution: s.resolution }),
  /** xai/grok-imagine-video/edit-video — only 480p/720p/auto exist here. */
  'grok-edit': (url, prompt, s) => ({
    video_url: url,
    prompt,
    resolution: s.resolution === '1080p' ? '720p' : s.resolution,
  }),
  /** fal-ai/wan/v2.7/edit-video — keeps the original audio with audio_setting. */
  'wan-edit': (url, prompt, s) => ({
    video_url: url,
    prompt,
    resolution: s.resolution,
    aspect_ratio: s.aspectRatio,
    audio_setting: 'origin',
  }),
  /** luma/agent/ray/v3.2/reframe — aspect_ratio is required, that is the edit. */
  reframe: (url, prompt, s) => ({
    video_url: url,
    prompt: prompt || 'Reframe the shot, keeping the main subject centred.',
    aspect_ratio: s.aspectRatio,
    resolution: s.resolution,
  }),
  /** fal-ai/heygen/v2/translate/speed — output_language, not a prompt. */
  dub: (url, prompt, s) => ({ video_url: url, output_language: s.language, enable_caption: false }),
  /** fal-ai/hunyuan-video-foley — the prompt field is called text_prompt. */
  foley: (url, prompt) => ({ video_url: url, text_prompt: prompt || 'Natural sound matching the action in the clip.' }),
  /** fal-ai/ltx-2.3/extend-video — carries on from the end by default. */
  extend: (url, prompt) => ({ video_url: url, prompt: prompt || undefined, mode: 'end', duration: 5 }),
  /** fal-ai/kling-video/o3/4k/video-to-video/edit */
  'kling-edit': (url, prompt) => ({ video_url: url, prompt, keep_audio: true }),
};

/** Models that do their job without a prompt — asking for one would be theatre. */
const PROMPT_OPTIONAL = new Set(['dub', 'foley', 'extend', 'reframe']);

function buildInput(model, url, prompt, settings) {
  const profile = EDIT_PROFILES[model?.inputProfile] || EDIT_PROFILES['omni-edit'];
  return profile(url, prompt, settings);
}

function promptRequired(model) {
  return !PROMPT_OPTIONAL.has(model?.inputProfile);
}

// ─── GET /health — can this box edit a video right now? ───────────────────
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await jobs.quotaFor(req, KIND);
  const available = provider.configured('fal');
  const budget = await spend.budgetFor(req);
  res.json({
    available,
    reason: available ? undefined : 'no_api_key',
    quota,
    budget,
    options: ALLOWED,
    defaults: DEFAULTS,
    needsSource: true,
    models: spend.annotate(models.catalogueFor(KIND, { seconds: DEFAULTS.sourceSeconds }), budget),
  });
});

// ─── POST /generate — start an edit job ───────────────────────────────────
router.post('/generate', requireBillable, express.json({ limit: '64kb' }), limiter, async (req, res) => {
  if (!provider.configured('fal')) {
    return res.status(503).json({ error: 'Video editing is not configured yet.' });
  }

  const source = cleanVideoUrl(req.body?.videoUrl);
  if (source.error) return res.status(400).json({ error: source.error });

  const prompt = (req.body?.prompt || '').trim();
  if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: 'prompt too long' });

  const settings = cleanSettings(req.body);
  const model = models.resolveAvailable(KIND, req.body?.model, (p) => provider.configured(p));
  if (!model) return res.status(503).json({ error: 'No edit model is reachable on this deployment.' });

  if (!prompt && promptRequired(model)) {
    return res.status(400).json({ error: 'Say what should change in the clip.' });
  }
  if (prompt) {
    // Screen before spending, and before the vendor sees it: a ban costs us
    // every Create button, not just this request.
    const refusal = jobs.screenPrompt(prompt);
    if (refusal) return res.status(400).json({ error: refusal });
  }

  const quota = await jobs.quotaFor(req, KIND);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${quota.limit} edits). Try again tomorrow.`,
      quota,
    });
  }

  const costUsd = models.estimateUsd(model, { seconds: settings.sourceSeconds });
  const refused = spend.verdict(await spend.budgetFor(req), costUsd);
  if (refused) return res.status(refused.status).json(refused.body);

  try {
    const { op } = await provider.submit(model, buildInput(model, source.url, prompt, settings));
    const jobId = crypto.randomBytes(8).toString('hex');
    await jobs.recordJob({
      id: jobId,
      req,
      kind: KIND,
      prompt: prompt || model.label,
      params: { ...settings, sourceUrl: source.url, op },
      op,
      model,
      costUsd,
    });
    res.json({
      jobId,
      settings,
      model: { id: model.id, label: model.label },
      costUsd,
      etaSeconds: eta.etaSeconds(KIND, model.id),
      quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
    });
  } catch (e) {
    console.error('[SquadEdit] generate failed:', e.message);
    res.status(502).json({ error: provider.scrub(e.message) || 'Could not reach the edit model.' });
  }
});

// ─── GET /status/:jobId — poll until done ─────────────────────────────────
router.get('/status/:jobId', async (req, res) => {
  const row = await jobs.loadJob(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'unknown job' });
  if (row.status === 'done') return res.json({ status: 'done', videoUrl: row.video_url });
  if (row.status === 'error') return res.json({ status: 'error', error: row.error });

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
    res.json({ status: 'done', videoUrl: out.url });
  } catch (e) {
    console.error('[SquadEdit] status error:', e.message);
    res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /history — this creator's recent edits ───────────────────────────
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, KIND);
  res.json({ ...out, quota: await jobs.quotaFor(req, KIND) });
});

module.exports = router;
module.exports._internals = { buildInput, cleanSettings, cleanVideoUrl, promptRequired, EDIT_PROFILES, ALLOWED };
