/**
 * Generation model catalogue — what the Create buttons are allowed to run,
 * and what each run costs.
 *
 * Why a catalogue instead of a model id in each route: the ScanSquad Create
 * sheet is meant to work the way Higgsfield works — one account, one balance,
 * many models behind each button. If the model name lives inside the route
 * then adding "Kling 3.0 as well as WAN" is a code change in a place that
 * also knows about HTTP, quotas and storage. Here it is a row.
 *
 * The prices are the reason this file exists at all. Video is billed per
 * second and the spread between the cheapest and the dearest model is ~10x:
 * at 8s/clip, WAN 2.5 is $0.32 and Veo 3 is $2.24 for the *same button*. A
 * creator doing two clips a day costs either ~£19/month or ~£104/month
 * depending only on which row is the default. So price is a first-class
 * field, the cheapest sane model is the default, and the expensive ones are
 * opt-in — see `tier`.
 *
 * `usdPerSecond` / `usdPerImage` / `usdPerMinute` / `usdPerThousandChars` are
 * fal.ai and ElevenLabs list prices read on 2026-09-15. They are list prices,
 * not a contract: treat them as the number we quote the user, and reconcile
 * against the provider invoice. `estimateUsd()` is what the sheet shows
 * before spending, which is the single most effective cost control we have.
 *
 * Adding a model: add a row. Do not add a branch.
 */

/**
 * tier:
 *   'default'  — cheap enough to hand to anyone, used when no model is named.
 *   'standard' — same order of magnitude; free to offer.
 *   'premium'  — >5x the default. Gated behind PREMIUM_MODELS_ENABLED so a
 *                single creator cannot out-spend a month of day-pass revenue
 *                by holding down Generate.
 */
const MODELS = [
  // ── Video ────────────────────────────────────────────────────────────────
  // Billed per second of output. Durations are whitelisted by the route.
  {
    id: 'wan-2.5',
    kind: 'video',
    label: 'WAN 2.5',
    provider: 'fal',
    providerModel: 'fal-ai/wan-25-preview/text-to-video',
    usdPerSecond: 0.05,
    tier: 'default',
    note: 'Cheapest credible clip. The default for a reason.',
  },
  {
    id: 'kling-2.5-turbo',
    kind: 'video',
    label: 'Kling 2.5 Turbo',
    provider: 'fal',
    providerModel: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    usdPerSecond: 0.07,
    tier: 'standard',
  },
  {
    id: 'kling-3.0-pro',
    kind: 'video',
    label: 'Kling 3.0 Pro',
    provider: 'fal',
    providerModel: 'fal-ai/kling-video/v3/pro/text-to-video',
    usdPerSecond: 0.22,
    tier: 'premium',
  },
  {
    id: 'veo-3.1-fast',
    kind: 'video',
    label: 'Veo 3.1 Fast',
    provider: 'gemini',
    providerModel: process.env.VEO_MODEL || 'veo-3.1-fast-generate-preview',
    usdPerSecond: 0.15,
    tier: 'premium',
    note: 'The original Create Video provider. Kept as the premium option.',
  },

  // ── Image ────────────────────────────────────────────────────────────────
  // Billed per image at 1MP. Higher resolutions cost proportionally more,
  // which is why the route whitelists size.
  {
    id: 'nano-banana',
    kind: 'image',
    label: 'Nano Banana',
    provider: 'fal',
    providerModel: 'fal-ai/nano-banana',
    usdPerImage: 0.0398,
    tier: 'default',
  },
  {
    id: 'seedream-v4',
    kind: 'image',
    label: 'Seedream V4',
    provider: 'fal',
    providerModel: 'fal-ai/bytedance/seedream/v4/text-to-image',
    usdPerImage: 0.03,
    tier: 'standard',
  },
  {
    id: 'flux-kontext-pro',
    kind: 'image',
    label: 'FLUX Kontext Pro',
    provider: 'fal',
    providerModel: 'fal-ai/flux-pro/kontext/text-to-image',
    usdPerImage: 0.04,
    tier: 'standard',
  },

  // ── Audio (speech) ───────────────────────────────────────────────────────
  {
    id: 'eleven-flash-v2.5',
    kind: 'audio',
    label: 'ElevenLabs Flash v2.5',
    provider: 'elevenlabs',
    providerModel: 'eleven_flash_v2_5',
    usdPerThousandChars: 0.05,
    tier: 'default',
  },
  {
    id: 'eleven-multilingual-v2',
    kind: 'audio',
    label: 'ElevenLabs Multilingual v2',
    provider: 'elevenlabs',
    providerModel: 'eleven_multilingual_v2',
    usdPerThousandChars: 0.10,
    tier: 'standard',
  },

  // ── Music ────────────────────────────────────────────────────────────────
  // ElevenLabs rather than a cheaper generator on purpose: they hold the
  // label licences (Merlin, Kobalt, Believe, UMG). A gym reel with unlicensed
  // music is a takedown, and a takedown costs more than $0.30.
  {
    id: 'eleven-music',
    kind: 'music',
    label: 'Eleven Music',
    provider: 'elevenlabs',
    providerModel: 'music_v1',
    usdPerMinute: 0.30,
    tier: 'default',
  },
];

const byKind = (kind) => MODELS.filter((m) => m.kind === kind);

/** Whether premium-tier models may be selected on this deployment. */
function premiumEnabled() {
  return process.env.PREMIUM_MODELS_ENABLED === 'true';
}

/**
 * Resolve a client-supplied model id for a kind.
 *
 * Unknown, missing or not-permitted ids all collapse to the kind's default
 * rather than erroring. The client is untrusted input and a bad model id is
 * not worth a failed generation — but note it never *escalates*: an
 * unrecognised id can only land on the cheap default, never on Veo.
 */
function resolve(kind, modelId) {
  const options = byKind(kind);
  if (!options.length) return null;
  const fallback = options.find((m) => m.tier === 'default') || options[0];
  if (!modelId) return fallback;
  const wanted = options.find((m) => m.id === modelId);
  if (!wanted) return fallback;
  if (wanted.tier === 'premium' && !premiumEnabled()) return fallback;
  return wanted;
}

/**
 * What this generation will cost, in USD, before we run it.
 *
 * Returns null when the unit is not known for that model, and callers must
 * treat null as "unknown" rather than "free" — showing "£0.00" for a clip
 * that bills $2.24 would be worse than showing nothing.
 *
 * @param {object} model  a catalogue row
 * @param {object} units  { seconds, images, minutes, chars }
 */
function estimateUsd(model, units = {}) {
  if (!model) return null;
  if (model.usdPerSecond != null && units.seconds != null) {
    return round(model.usdPerSecond * units.seconds);
  }
  if (model.usdPerImage != null) {
    return round(model.usdPerImage * (units.images || 1));
  }
  if (model.usdPerMinute != null && units.minutes != null) {
    return round(model.usdPerMinute * units.minutes);
  }
  if (model.usdPerThousandChars != null && units.chars != null) {
    return round((model.usdPerThousandChars * units.chars) / 1000);
  }
  return null;
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * The catalogue as the Create sheet needs it: only selectable models, with
 * the price the user will be quoted. Never leaks providerModel — that is an
 * internal routing detail and naming it in the client would let a crafted
 * request ask for a model we have not priced.
 */
function catalogueFor(kind, units = {}) {
  return byKind(kind)
    .filter((m) => m.tier !== 'premium' || premiumEnabled())
    .map((m) => ({
      id: m.id,
      label: m.label,
      tier: m.tier,
      estimateUsd: estimateUsd(m, units),
      note: m.note || null,
    }));
}

/**
 * Resolve a model, but never land on a provider this deployment cannot reach.
 *
 * Why this exists: the cheap default for video is on fal, while production ran
 * on Gemini/Veo. Merging the catalogue without this function would have pointed
 * every default request at fal, found no FAL_KEY, and returned 503 — i.e. it
 * would have *broken a working Create Video button* the moment it deployed.
 * A refactor that silently turns a live feature off is a regression no matter
 * how much nicer the new code is.
 *
 * Order of preference:
 *   1. exactly what the caller asked for, if it is reachable,
 *   2. the kind's default, if it is reachable,
 *   3. the cheapest reachable model of that kind,
 *   4. null — nothing is keyed, and the caller must say so honestly.
 *
 * Preference never escalates past an explicit ask: falling back picks the
 * cheapest reachable option, so a missing key can cost availability but never
 * money.
 *
 * @param {string}   kind          'video' | 'image' | 'audio' | 'music'
 * @param {string}   modelId       client-supplied id, may be undefined
 * @param {function} isConfigured  (provider) => boolean, injected for testing
 */
function resolveAvailable(kind, modelId, isConfigured) {
  const reachable = (m) => !!m && isConfigured(m.provider);

  const wanted = resolve(kind, modelId);
  if (reachable(wanted)) return wanted;

  const cheapest = (rows) =>
    rows.reduce((best, m) => (unitPrice(m) < unitPrice(best) ? m : best));

  const reachableRows = byKind(kind).filter(reachable);
  if (!reachableRows.length) return null;

  const affordable = reachableRows.filter((m) => m.tier !== 'premium' || premiumEnabled());
  if (affordable.length) return cheapest(affordable);

  // Last resort: the only reachable model is a premium one. This is exactly
  // production on 2026-09-16 — a Gemini key and no FAL_KEY, where the sole
  // video row is Veo. Refusing here would be "cost control" that switches a
  // working customer feature off, and Veo is what that box was already
  // running, so this is the status quo rather than an escalation. The moment
  // FAL_KEY exists the cheap default wins again, automatically.
  return cheapest(reachableRows);
}

/** Comparable per-unit price for ranking fallbacks. Unpriced sorts last. */
function unitPrice(m) {
  const p = m.usdPerSecond ?? m.usdPerImage ?? m.usdPerMinute ?? m.usdPerThousandChars;
  return p == null ? Number.POSITIVE_INFINITY : p;
}

module.exports = {
  MODELS,
  byKind,
  resolve,
  resolveAvailable,
  estimateUsd,
  catalogueFor,
  premiumEnabled,
};
