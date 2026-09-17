/**
 * Squad Audio — turn a script into a voiceover, on the phone.
 *
 * The third Create mode to get a provider, and the first synchronous one.
 * Speech comes back in two or three seconds, so inventing a background job
 * for it would mean cross-instance state for work that is already finished
 * (lib/gen-provider.js explains the two shapes). The route therefore
 * generates inline, stores the result, and answers with a job id that is
 * already `done` — which means the Create sheet's existing poll-until-done
 * path works unchanged and still has a row to show in history.
 *
 * Why the character accounting is so careful: the ElevenLabs account is on
 * the free tier — 10,000 characters a month for the whole deployment, shared
 * by every creator. That is roughly fourteen full-length voiceovers in total.
 * Without a check, the first two creators spend everyone's month and every
 * later tap fails at the vendor with a 401 that the sheet renders as a shrug.
 * So: a per-request cap, a check against the real remaining balance before
 * spending, and an honest message when it is gone.
 *
 * Voices are presets, not ids. A voice id is account-scoped, and accepting
 * one from the body would let a caller enumerate and spend against the
 * account's private voices.
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
const r2 = require('../lib/r2-upload');

const router = express.Router();
const KIND = 'audio';

/**
 * Named voices → ElevenLabs voice ids, overridable per deployment so the
 * cast can change without a release. The defaults are ElevenLabs' own public
 * voices, which every account can reach.
 */
const VOICES = {
  Coach: process.env.ELEVENLABS_VOICE_COACH || 'JBFqnCBsd6RMkjVDRZzb', // George — warm, firm
  Calm: process.env.ELEVENLABS_VOICE_CALM || 'EXAVITQu4vr4xnSDxMaL', // Sarah — even, unhurried
  Hype: process.env.ELEVENLABS_VOICE_HYPE || 'pNInz6obpgDQGcFmaJgB', // Adam — bright, driving
};

/**
 * The same three voices as fal knows them.
 *
 * ElevenLabs takes account-scoped voice ids; fal's wrapper takes the public
 * voice *name*. Same speakers either way — George, Sarah and Adam are the
 * voices the ids above point at — so a creator hears the same cast whichever
 * row serves the request.
 */
const FAL_VOICES = { Coach: 'George', Calm: 'Sarah', Hype: 'Adam' };

/**
 * Length presets → a character budget. Speech runs at roughly 15 characters
 * a second, and the honest way to offer "30 seconds" from a text-to-speech
 * model is to bound the script rather than pretend to stretch it.
 */
const LENGTH_CHARS = { '15s': 350, '30s': 700, '60s': 1400 };

const ALLOWED = {
  voice: Object.keys(VOICES),
  length: Object.keys(LENGTH_CHARS),
};
const DEFAULTS = { voice: 'Coach', length: '30s' };

/** Hard ceiling regardless of preset — one request can never eat the month. */
const MAX_CHARS = 1400;

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
  return { voice: pick('voice', b.voice), length: pick('length', b.length) };
}

// ─── GET /health — can this box make a voiceover right now? ───────────────
// Free: reports configuration, quota and the month's remaining characters,
// generates nothing.
router.get('/health', optionalAuth, async (req, res) => {
  const quota = await jobs.quotaFor(req, KIND);
  const keyed = provider.configured('elevenlabs');
  const balance = keyed ? await provider.elevenCharacterQuota() : null;

  // A present key with an empty monthly allowance is not "available" — it is
  // a button that would fail on tap, which is the one thing the Create sheet
  // is built to avoid. But that is only fatal when ElevenLabs direct is the
  // only way to speak: the fal row has no monthly ceiling, so a spent
  // allowance now costs a row, not the button.
  const exhausted = !!balance && balance.remaining <= 0;
  const model = models.resolveAvailable(KIND, undefined, (p) => reachable(p, { exhausted }));
  const available = !!model;
  const creatorBudget = await spend.budgetFor(req);

  res.json({
    available,
    reason: available ? undefined : keyed ? 'monthly_characters_spent' : 'no_api_key',
    via: model ? model.provider : undefined,
    quota,
    characters: balance
      ? { remaining: balance.remaining, limit: balance.limit, tier: balance.tier, resetsAt: balance.resetsAt }
      : null,
    options: ALLOWED,
    defaults: DEFAULTS,
    budget: creatorBudget,
    models: spend.annotate(models.catalogueFor(KIND, { chars: LENGTH_CHARS[DEFAULTS.length] }), creatorBudget),
  });
});

/**
 * Which providers can actually speak right now.
 *
 * ElevenLabs direct needs a key *and* characters left this month — a valid key
 * with a spent allowance is a button that fails on tap. fal needs only its
 * key. Written as one predicate so the catalogue picks the row (cheapest
 * reachable first), rather than a branch here choosing a vendor.
 */
function reachable(p, { exhausted }) {
  if (p === 'elevenlabs') return provider.configured('elevenlabs') && !exhausted;
  return provider.configured(p);
}

// ─── POST /generate — speak the script, inline ────────────────────────────
router.post('/generate', requireBillable, express.json({ limit: '64kb' }), limiter, async (req, res) => {
  if (!provider.configured('elevenlabs') && !provider.configured('fal')) {
    return res.status(503).json({ error: 'Voiceover is not configured yet.' });
  }

  const text = (req.body?.prompt || '').trim();
  if (!text) return res.status(400).json({ error: 'prompt required' });

  const settings = cleanSettings(req.body);
  const budget = Math.min(LENGTH_CHARS[settings.length], MAX_CHARS);
  if (text.length > budget) {
    return res.status(400).json({
      error: `That script is ${text.length} characters — ${settings.length} of speech fits about ${budget}. Trim it, or pick a longer length.`,
    });
  }

  const refusal = jobs.screenPrompt(text);
  if (refusal) return res.status(400).json({ error: refusal });

  const quota = await jobs.quotaFor(req, KIND);
  if (quota.remaining <= 0) {
    return res.status(429).json({
      error: `Daily limit reached (${quota.limit} voiceovers). Try again tomorrow.`,
      quota,
    });
  }

  /* The shared monthly allowance. Checked live rather than assumed, and only
     enforced when we could actually read it — and now only against the rows it
     applies to. It is ElevenLabs' own limit on our free plan, not a fact about
     speech, so letting it block a fal generation would be inventing a ceiling
     that does not exist. */
  const balance = provider.configured('elevenlabs') ? await provider.elevenCharacterQuota() : null;
  const short = !!balance && balance.remaining < text.length;

  const model = models.resolveAvailable(KIND, req.body?.model, (p) => reachable(p, { exhausted: short }));
  if (!model) {
    if (short) {
      return res.status(429).json({
        error: `Voiceovers are out for this month (${balance.remaining} characters left of ${balance.limit}). They reset on the 1st.`,
        characters: { remaining: balance.remaining, limit: balance.limit },
      });
    }
    return res.status(503).json({ error: 'No voice model is reachable on this deployment.' });
  }
  const costUsd = models.estimateUsd(model, { chars: text.length });

  /* Money, not clip count, is what needs guarding. @see lib/gen-budget.js */
  const refused = spend.verdict(await spend.budgetFor(req), costUsd);
  if (refused) return res.status(refused.status).json(refused.body);

  const jobId = crypto.randomBytes(8).toString('hex');

  try {
    const { buffer, contentType } = await provider.generate(model, {
      text,
      voiceId: VOICES[settings.voice],
      voiceName: FAL_VOICES[settings.voice],
    });
    // Only the direct rows spend the ElevenLabs allowance; a fal generation
    // leaves it untouched, and forgetting a balance we did not move would
    // cost a needless vendor call on the next health poll.
    if (model.provider === 'elevenlabs') provider.invalidateCharacterQuota();

    const url = await store(buffer, contentType, jobId);

    await jobs.recordJob({ id: jobId, req, kind: KIND, prompt: text, params: settings, op: null, model, costUsd });
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
    console.error('[SquadAudio] generate failed:', e.message);
    await jobs.recordJob({ id: jobId, req, kind: KIND, prompt: text, params: settings, op: null, model, costUsd });
    await jobs.finishJob(jobId, { status: 'error', error: provider.scrub(e.message) });
    res.status(502).json({ error: provider.scrub(e.message) || 'Could not reach the voice model.' });
  }
});

/**
 * Where the MP3 lives.
 *
 * R2 when it is configured, because a CDN url can be shared, replayed and
 * attached to a post. When it is not, fall back to an inline data url rather
 * than failing: a voiceover the creator can play and download beats a 503
 * because a storage variable is missing, and at these sizes (a 30s clip is
 * ~200KB) it is a reasonable degradation rather than a leak of megabytes.
 */
async function store(buffer, contentType, jobId) {
  if (!r2.r2Configured()) {
    return `data:${contentType || 'audio/mpeg'};base64,${buffer.toString('base64')}`;
  }
  try {
    const out = await r2.uploadBufferToR2(buffer, `squad-audio/${jobId}.mp3`, {
      contentType: contentType || 'audio/mpeg',
    });
    return out.url;
  } catch (e) {
    console.error('[SquadAudio] R2 upload failed, serving inline:', e.message);
    return `data:${contentType || 'audio/mpeg'};base64,${buffer.toString('base64')}`;
  }
}

// ─── GET /status/:jobId — always already finished ─────────────────────────
// Kept so the sheet's one polling path works for every mode. The row is the
// record; there is nothing to ask a vendor.
router.get('/status/:jobId', async (req, res) => {
  const row = await jobs.loadJob(req.params.jobId);
  if (!row) return res.status(404).json({ error: 'unknown job' });
  if (row.status === 'error') return res.json({ status: 'error', error: row.error });
  if (row.status === 'done') return res.json({ status: 'done', audioUrl: row.video_url, url: row.video_url });
  return res.json({ status: 'running' });
});

// ─── GET /history — this creator's recent voiceovers ──────────────────────
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, KIND);
  res.json({ ...out, quota: await jobs.quotaFor(req, KIND) });
});

module.exports = router;
module.exports._internals = { VOICES, FAL_VOICES, LENGTH_CHARS, cleanSettings, MAX_CHARS, reachable };
