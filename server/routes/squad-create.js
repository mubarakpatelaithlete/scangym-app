/**
 * Squad Create — which creation modes this deployment can actually run.
 *
 * The ScanSquad rail offers eight Create buttons (text, image, video, audio,
 * music, twin, clipping, UGC). Only some of them have a provider behind them
 * at any given time, and that is a deployment fact, not a UI opinion — so the
 * answer lives here and the sheet asks at runtime.
 *
 * The rule this endpoint exists to enforce: a mode is only offered as usable
 * when there is a provider key AND a route that can serve it. Everything else
 * renders as an explicit "not switched on yet" preview with no Generate
 * button, rather than a control that looks live and fails on tap. We shipped
 * that failure once already (the settings that were sent nowhere), so modes
 * are gated on configuration rather than hope.
 *
 * Turning a mode on is therefore two steps: implement its route, then set its
 * provider env var. No frontend change is needed — the sheet follows this.
 */

const express = require('express');

const router = express.Router();

/**
 * Is there any video model this box can actually run?
 *
 * Mirrors routes/squad-video.js: whatever models.resolveAvailable() would
 * choose is what a creator would get. The Gemini access cache is still
 * consulted, because a key we are known to be forbidden to use is not
 * reachability — but only for the row it applies to, so a blocked Gemini
 * project no longer hides the fal rows next to it.
 */
function videoReachable() {
  const p = require('../lib/gen-provider');
  const models = require('../lib/gen-models');
  const usable = (provider) => {
    if (!p.configured(provider)) return false;
    if (provider !== 'gemini') return true;
    const access = p.cachedGenerationAccess('gemini', 'veo-3.1-fast-generate-preview');
    return !access || access.ok; // unknown stays optimistic; /health is authoritative
  };
  return !!models.resolveAvailable('video', undefined, usable);
}

/**
 * Is Music purchasable on this box?
 *
 * Two ways: an ElevenLabs plan that allows it (their free tier answers 402
 * paid_plan_required), or the same ElevenLabs model through fal, which needs
 * no plan at all — the eleven-music-fal row. Gating on the plan alone kept
 * Music dark on a box holding a working FAL_KEY.
 */
function musicReachable() {
  const p = require('../lib/gen-provider');
  if (p.configured('fal')) return true;
  if (!p.configured('elevenlabs')) return false;
  if (process.env.ELEVENLABS_MUSIC_ENABLED === 'true') return true;
  const tier = p.cachedElevenTier();
  return !!tier && tier !== 'free';
}

/**
 * key → { label, env | ready, api }
 *   env:   provider credential that must be present for the mode to run.
 *   notReady: a more specific reason than 'no_provider' when ready() is false,
 *          either a string or a function returning one
 *          — Music has a key and a route but needs a paid plan, and
 *          'no_provider' would send someone hunting for a missing variable.
 *   ready: for modes served by an existing subsystem rather than by one
 *          dedicated key — text runs on lib/llm.js, which is happy with
 *          OPENAI_API_KEY *or* GROQ_API_KEY, so naming a single variable
 *          would report a working mode as broken on a Groq-only box.
 *   api:   base path of the route that serves it; null = not built yet.
 * A mode needs a route AND a provider to count as configured.
 */
const MODES = {
  text: { label: 'Text', ready: () => require('../lib/llm').configured(), api: '/api/squad-text' },
  image: { label: 'Image', env: 'FAL_KEY', api: '/api/squad-image' },
  /* A key being present is not the same as being allowed to use it. On
     2026-09-16 this box had a valid-looking GEMINI_API_KEY whose project
     Google had blocked from generating, so this registry advertised Video as
     usable while every render 403'd. If a probe or a real render has told us
     the provider refuses us, the mode is not on offer — see
     lib/gen-provider.js#geminiGenerationAccess. Unknown stays optimistic:
     the video route's own /health does the authoritative check, and going
     dark on no evidence would be its own outage. */
  /* Reachability is a question about the catalogue, not about one vendor.
     This gate named Gemini only, which was true when Veo was the only video
     row — and then wrong: on 2026-09-16 production had a working FAL_KEY and
     six fal video rows, Google had blocked the Gemini project, and this
     registry answered `provider_denied` and hid a Video button that worked.
     The route itself already picks a reachable model with
     models.resolveAvailable(), so the gate now asks the same question the
     route will answer. */
  video: {
    label: 'Video',
    ready: () => videoReachable(),
    /* Two different problems, two different answers: no key at all is
       'no_provider' (set one), a key we are not allowed to use is
       'provider_denied' (a wrong reason sends someone hunting for a
       variable that is already there). */
    notReady: () => (require('../lib/gen-provider').configured('gemini') ? 'provider_denied' : 'no_provider'),
    api: '/api/squad-video',
  },
  audio: {
    label: 'Audio',
    ready: () => require('../lib/gen-provider').configured('elevenlabs'),
    api: '/api/squad-audio',
  },
  // Music runs on the same key as Audio and is still not offered on a free
  // ElevenLabs plan: the vendor answers 402 paid_plan_required. So the gate
  // is the account's tier, read once at boot and cached, not an env var
  // somebody has to remember to flip. Forced on with
  // ELEVENLABS_MUSIC_ENABLED=true. See routes/squad-music.js.
  music: {
    label: 'Music',
    ready: () => musicReachable(),
    notReady: () => (require('../lib/gen-provider').configured('elevenlabs') ? 'paid_plan_required' : 'no_provider'),
    api: '/api/squad-music',
  },
  twin: { label: 'Twin', env: 'SQUAD_TWIN_API_KEY', api: null },
  clipping: { label: 'Clipping', env: 'SQUAD_CLIP_API_KEY', api: null },
  ugc: { label: 'UGC', env: 'SQUAD_UGC_API_KEY', api: null },
};

/** Why a mode cannot run yet — specific enough to act on. */
function statusFor(def) {
  if (!def.api) return { configured: false, reason: 'not_built' };
  const ok = def.ready ? !!def.ready() : !!process.env[def.env];
  if (!ok) {
    const reason = typeof def.notReady === 'function' ? def.notReady() : def.notReady;
    return { configured: false, reason: reason || 'no_provider' };
  }
  return { configured: true };
}

// ─── GET /api/squad-create/modes — per-mode availability ───
router.get('/modes', (req, res) => {
  const modes = {};
  for (const [key, def] of Object.entries(MODES)) {
    const st = statusFor(def);
    modes[key] = { label: def.label, api: def.api, ...st };
  }
  res.json({ modes });
});

module.exports = router;
module.exports.MODES = MODES;
