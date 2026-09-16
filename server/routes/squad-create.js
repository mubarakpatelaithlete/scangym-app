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

const { optionalAuth } = require('../middleware/auth');
const { requireCreator } = require('../lib/gen-guard');
const spend = require('../lib/gen-budget');
const templates = require('../lib/gen-templates');
const jobs = require('../lib/gen-jobs');

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

/**
 * The creator's own referral link, so a share carries the thing that earns.
 *
 * A generated clip used to be shared as a bare CDN url: the creator posted our
 * content and there was nothing in the post to book through. The handle comes
 * from creator_landing_pages, the same slug /r/:handle already resolves in
 * routes/referrals.js — no second source of truth for what a creator's link is.
 */
async function refLinkFor(userId) {
  if (!userId) return null;
  try {
    const pool = require('../middleware/db');
    const r = await pool.query(
      `SELECT slug FROM creator_landing_pages
        WHERE creator_user_id::text = $1::text AND is_active = true
        ORDER BY created_at ASC LIMIT 1`,
      [String(userId)],
    );
    const slug = r.rows[0] && r.rows[0].slug;
    return slug ? `${SITE}/r/${slug}` : null;
  } catch (e) {
    console.error('[SquadCreate] ref link lookup failed:', e.message);
    return null;
  }
}

const SITE = process.env.PUBLIC_SITE_URL || 'https://www.scangym.com';

// ─── GET /api/squad-create/budget — what may this creator spend today ───
/* One balance for every mode. Before this, each mode reported a count of its
   own ("3 of 5 videos left") and none of them reported money, so nothing on
   screen could explain why a $3.78 model was out of reach. */
router.get('/budget', optionalAuth, async (req, res) => {
  const budget = await spend.budgetFor(req);
  res.json({
    ...budget,
    perConversionUsd: spend.PER_CONVERSION_USD,
    maxDailyUsd: spend.MAX_DAILY_USD,
    /* What climbing gets them, in the words the Creator dashboard uses. */
    tiers: spend.TIER_FLOOR_USD,
  });
});

// ─── GET /api/squad-create/templates — one-tap starters ───
/* Server-side so a better opener does not need a frontend deploy.
   @see lib/gen-templates.js */
router.get('/templates', (req, res) => {
  const kind = req.query.kind;
  res.json(kind ? { kind, templates: templates.forMode(kind) } : { templates: templates.all() });
});

// ─── GET /api/squad-create/library — My Creations, every mode ───
/* The gap this closes: a creator generated a clip, an image and a caption and
   owned none of them — per-mode history existed but nothing showed the work in
   one place, carried the prompt that made it, or offered the share that earns.
   Requires a login, because a creation belongs to somebody. */
router.get('/library', requireCreator, async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const [lib, refLink] = await Promise.all([
    jobs.libraryFor(userId, { limit: parseInt(req.query.limit, 10) || 40, kind: req.query.kind || null }),
    refLinkFor(userId),
  ]);
  const items = (lib.items || []).map((row) => ({
    id: row.id,
    kind: row.kind,
    model: row.model,
    prompt: row.prompt,
    status: row.status,
    url: row.url,
    text: row.params && row.params.text ? row.params.text : null,
    settings: row.params || {},
    costUsd: row.cost_usd != null ? Number(row.cost_usd) : null,
    downloads: row.download_count || 0,
    shares: row.share_count || 0,
    createdAt: row.created_at,
  }));
  res.json({
    items,
    degraded: lib.degraded,
    refLink,
    /* The caption that goes out with a share, with the link that earns already
       in it. The creator can edit it; they cannot forget it. */
    shareText: refLink
      ? `Any gym, £5 a day, no membership. Book yours: ${refLink}`
      : 'Any gym, £5 a day, no membership — on ScanGym.',
  });
});

// ─── POST /api/squad-create/events — a download or a share, recorded ───
/* These lived in localStorage, so they died with the phone and could not feed
   the tier ladder that decides who earns what. @see lib/gen-jobs.js#recordEvent */
router.post('/events', requireCreator, express.json({ limit: '8kb' }), async (req, res) => {
  const userId = req.user.id || req.user.userId;
  const { assetId, action } = req.body || {};
  const assetKind = req.body && req.body.assetKind === 'generated' ? 'generated' : 'library';
  const out = await jobs.recordEvent({ userId, assetId, action, assetKind });
  if (!out.ok && out.reason === 'bad_action') return res.status(400).json({ error: 'action must be download or share' });
  if (!out.ok && out.reason === 'missing_ids') return res.status(400).json({ error: 'assetId required' });
  res.json({ ok: out.ok, degraded: !out.ok });
});

// ─── GET /api/squad-create/events/summary — totals that survive a new phone ───
router.get('/events/summary', requireCreator, async (req, res) => {
  res.json(await jobs.eventSummaryFor(req.user.id || req.user.userId));
});

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
