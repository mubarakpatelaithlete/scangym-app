/**
 * Squad Image — generate a post image from a prompt, on the phone.
 *
 * The second of the eight Create modes to get a provider. It exists in the
 * shape squad-video.js established (health → generate → poll status →
 * history) so the sheet needs no new client logic, but everything
 * provider-specific is in lib/gen-provider.js and every price is in
 * lib/gen-models.js. Adding Seedream next to Nano Banana is a catalogue row,
 * not an edit here.
 *
 * Why a job rather than bytes in the response, when an image takes seconds:
 * fal's queue is the same submit/poll for images as for video, and the sheet
 * already polls. Returning the image inline would mean a second code path,
 * and a request that occasionally takes 40 seconds through a proxy that gives
 * up at 30.
 *
 * Cost: ~$0.04 an image against ~$0.40–$2.24 a clip, so the cap here is
 * generous (30/day) where video's is tight (5/day). Both are counted in SQL
 * per mode — see lib/gen-jobs.js for why that matters.
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
const KIND = 'image';

/**
 * Whitelisted render settings. The client is untrusted and fal prices images
 * by megapixel, so an arbitrary size is a billing hole rather than a bad
 * render — the same reason squad-video.js whitelists duration.
 */
const ALLOWED = {
  aspectRatio: ['9:16', '1:1', '16:9'],
  count: [1, 2, 4],
};
const DEFAULTS = { aspectRatio: '9:16', count: 1 };

const MAX_PROMPT = 1200;

/** Well above what making posts looks like, well below scripted abuse. */
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment — try again shortly.' },
});

function cleanSettings(body) {
  const b = body || {};
  const pick = (name, value) => (ALLOWED[name].includes(value) ? value : DEFAULTS[name]);
  return {
    aspectRatio: pick('aspectRatio', b.aspectRatio),
    count: pick('count', Number(b.count)),
  };
}

/**
 * fal's image models do not share one payload shape, so the catalogue row
 * names a profile and this table knows what that profile wants.
 *
 * Without this, adding OpenAI's model would 422 every request: it takes
 * `image_size` (an enum or {width,height}) and has no `aspect_ratio` at all,
 * and fal rejects unknown fields rather than ignoring them. Guessing the
 * payload is the one failure the catalogue cannot express, so it lives here
 * next to the route that sends it.
 */
/** fal's shared image_size enum, used by OpenAI and Seedream alike. */
const OPENAI_IMAGE_SIZE = {
  '9:16': 'portrait_16_9',
  '1:1': 'square_hd',
  '16:9': 'landscape_16_9',
};

const IMAGE_PROFILES = {
  /** The shape fal's own models take: Nano Banana, Seedream, FLUX. */
  'fal-image': (prompt, settings) => ({
    prompt,
    num_images: settings.count,
    aspect_ratio: settings.aspectRatio,
    output_format: 'jpeg',
  }),
  /** Nano Banana 2: same, plus a pinned resolution — 2K bills 1.5x, 4K 2x. */
  'nano-banana-2': (prompt, settings) => ({
    prompt,
    num_images: settings.count,
    aspect_ratio: settings.aspectRatio,
    output_format: 'jpeg',
    resolution: '1K',
  }),
  /**
   * Seedream V4 has no `aspect_ratio` either — and because fal ignores
   * unknown fields rather than rejecting them, every Seedream image rendered
   * as a 2048x2048 square while the creator's 9:16 choice went in the bin.
   * Silent, so nothing logged it. Verified against fal's schema 2026-09-16.
   */
  seedream: (prompt, settings) => ({
    prompt,
    num_images: settings.count,
    image_size: OPENAI_IMAGE_SIZE[settings.aspectRatio] || 'portrait_16_9',
  }),
  /** OpenAI: image_size instead of aspect_ratio, and quality drives the bill. */
  'openai-image': (prompt, settings) => ({
    prompt,
    num_images: settings.count,
    image_size: OPENAI_IMAGE_SIZE[settings.aspectRatio] || 'portrait_16_9',
    output_format: 'jpeg',
    quality: 'medium',
  }),
};

/** Catalogue row → the payload that model expects. */
function buildInput(model, prompt, settings) {
  const profile = IMAGE_PROFILES[model?.inputProfile] || IMAGE_PROFILES['fal-image'];
  return profile(prompt, settings);
}

// ─── GET /health — can this box make an image right now? ──────────────────
// Free: reports configuration and quota, generates nothing.
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await jobs.quotaFor(req, KIND);
  const available = provider.configured('fal');
  /* The sheet needs to know what this creator can afford before it draws the
     model row, not after a 402: lib/gen-budget.js#annotate marks each row. */
  const budget = await spend.budgetFor(req);
  res.json({
    available,
    reason: available ? undefined : 'no_api_key',
    quota,
    budget,
    options: ALLOWED,
    defaults: DEFAULTS,
    models: spend.annotate(models.catalogueFor(KIND, { images: DEFAULTS.count }), budget),
  });
});

// ─── POST /generate — start an image job ──────────────────────────────────
// express.json() per route: the app-level parser in server.js runs for an
// allowlist of prefixes only, and without this req.body is undefined.
router.post('/generate', requireBillable, express.json({ limit: '64kb' }), limiter, async (req, res) => {
  if (!provider.configured('fal')) {
    return res.status(503).json({ error: 'Image generation is not configured yet.' });
  }

  const prompt = (req.body?.prompt || '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (prompt.length > MAX_PROMPT) return res.status(400).json({ error: 'prompt too long' });

  // Screen before spending, and before the provider sees it: a ban costs us
  // every Create button, not just this request.
  const refusal = jobs.screenPrompt(prompt);
  if (refusal) return res.status(400).json({ error: refusal });

  const quota = await jobs.quotaFor(req, KIND);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${quota.limit} images). Try again tomorrow.`,
      quota,
    });
  }

  const settings = cleanSettings(req.body);
  const model = models.resolve(KIND, req.body?.model);
  const costUsd = models.estimateUsd(model, { images: settings.count });

  /* Money, not clip count, is what needs guarding. @see lib/gen-budget.js */
  const refused = spend.verdict(await spend.budgetFor(req), costUsd);
  if (refused) return res.status(refused.status).json(refused.body);

  try {
    const { op } = await provider.submit(model, buildInput(model, prompt, settings));
    const jobId = crypto.randomBytes(8).toString('hex');
    await jobs.recordJob({ id: jobId, req, kind: KIND, prompt, params: { ...settings, op }, op, model, costUsd });
    res.json({
      jobId,
      settings,
      model: { id: model.id, label: model.label },
      costUsd,
      etaSeconds: eta.etaSeconds(KIND, model.id),
      quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 },
    });
  } catch (e) {
    console.error('[SquadImage] generate failed:', e.message);
    res.status(502).json({ error: provider.scrub(e.message) || 'Could not reach the image model.' });
  }
});

// ─── GET /status/:jobId — poll until done ─────────────────────────────────
// No in-process cache: unlike video there is nothing to cache cheaply, the
// row is the record, and a cache that only helps on the instance that
// happened to take the request is how the old video jobs got orphaned.
router.get('/status/:jobId', async (req, res) => {
  const row = await jobs.loadJob(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'unknown job' });
  if (row.status === 'done') return res.json({ status: 'done', imageUrl: row.video_url });
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
    // The URL is fal's CDN, which keeps outputs about 7 days. Good enough for
    // "look at what I just made"; anything a creator keeps is re-hosted when
    // it is attached to a post, which is where R2 already gets used.
    await jobs.finishJob(req.params.jobId, { status: 'done', url: out.url });
    res.json({ status: 'done', imageUrl: out.url });
  } catch (e) {
    console.error('[SquadImage] status error:', e.message);
    res.json({ status: 'running' }); // transient — let the client keep polling
  }
});

// ─── GET /history — this creator's recent images ──────────────────────────
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, KIND);
  res.json({ ...out, quota: await jobs.quotaFor(req, KIND) });
});

module.exports = router;
module.exports._internals = { buildInput, cleanSettings, IMAGE_PROFILES };
