/**
 * How long a generation really takes, so the sheet can stop lying.
 *
 * The Create sheet said "usually under a minute" for every mode and then
 * counted seconds upwards. Measured on production on 2026-09-17, through the
 * customer path, the truth is between 11 seconds and just under 4 minutes:
 *
 *   Eleven Music            11s        ChatGPT Images 2.5      21s
 *   Nano Banana 2           17s        Grok Imagine (8s)       73s
 *   Kling 3.0 Pro (8s)     166s        WAN 3.0 (8s)           215s
 *   Seedance 2.5 (8s)      226s
 *
 * A phone showing "under a minute" at second 200 is how you teach a creator
 * the button is broken, and a creator who reloads mid-render still gets billed
 * for the clip we abandoned. So the numbers below are the measurements, the
 * route quotes them at submit, and the status endpoint keeps quoting the
 * remainder while it runs.
 *
 * These are medians of what we have seen, not vendor promises: `etaSeconds` is
 * a hint for copy ("about 3 minutes"), never a timeout. Polling stops when the
 * vendor says done, exactly as before.
 */

/** Measured medians, seconds, at the reference length below. @see file header */
const MEASURED = {
  'eleven-music': 11,
  'eleven-music-fal': 11,
  'eleven-v3': 6,
  'eleven-v3-fal': 6,
  'eleven-flash-v2.5': 4,
  'eleven-multilingual-v2': 6,
  'nano-banana': 17,
  'nano-banana-2': 17,
  'gpt-image-2.5': 21,
  'seedream-v4': 15,
  'flux-kontext-pro': 12,
  'grok-imagine-video': 73,
  'kling-3.0-pro': 166,
  'kling-2.5-turbo': 150,
  'wan-3.0': 215,
  'wan-2.5': 200,
  'seedance-2.5': 226,
  'seedance-1-pro': 180,
  'veo-3.1-fal': 200,
  'veo-3.1-fast': 120,
};

/** The clip length the video medians were measured at. */
const REFERENCE_SECONDS = 8;

/** Fallbacks when a model is new and we have not timed it yet. */
const BY_KIND = { text: 3, image: 20, audio: 8, music: 15, video: 180, twin: 180, clipping: 120, ugc: 180 };

/**
 * Expected wall-clock seconds for one generation.
 * Video scales with the clip length, because a 4s clip is not a 30s clip.
 */
function etaSeconds(kind, modelId, units = {}) {
  const base = MEASURED[modelId] != null ? MEASURED[modelId] : (BY_KIND[kind] || 60);
  if (kind !== 'video' || !units.seconds) return base;
  return Math.max(20, Math.round((base * units.seconds) / REFERENCE_SECONDS));
}

/**
 * What to still expect, given how long it has already been running.
 * Never returns 0 while a job is unfinished: "any moment now" is honest,
 * "0 seconds left" on a job that is still going is not.
 */
function remainingSeconds(eta, elapsedSeconds) {
  const left = Math.round((eta || 0) - (elapsedSeconds || 0));
  return left > 0 ? left : null;
}

/** "about 3 minutes" / "about 40 seconds" / "any moment now" */
function phrase(seconds) {
  if (seconds == null) return 'any moment now';
  if (seconds < 45) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const mins = seconds / 60;
  if (mins < 1.5) return 'about a minute';
  return `about ${Math.round(mins)} minutes`;
}

/** Is this slow enough that a creator should be told rather than watched? */
function worthNotifying(seconds) {
  return (seconds || 0) >= 60;
}

module.exports = { etaSeconds, remainingSeconds, phrase, worthNotifying, MEASURED, BY_KIND, REFERENCE_SECONDS };
