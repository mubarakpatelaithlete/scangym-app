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
 * key → { label, env, api }
 *   env: provider credential that must be present for the mode to run.
 *   api: base path of the route that serves it; null = not built yet.
 * A mode needs BOTH to count as configured.
 */
const MODES = {
  text: { label: 'Text', env: 'SQUAD_TEXT_API_KEY', api: null },
  image: { label: 'Image', env: 'SQUAD_IMAGE_API_KEY', api: null },
  video: { label: 'Video', env: 'GEMINI_API_KEY', api: '/api/squad-video' },
  audio: { label: 'Audio', env: 'SQUAD_AUDIO_API_KEY', api: null },
  music: { label: 'Music', env: 'SQUAD_MUSIC_API_KEY', api: null },
  twin: { label: 'Twin', env: 'SQUAD_TWIN_API_KEY', api: null },
  clipping: { label: 'Clipping', env: 'SQUAD_CLIP_API_KEY', api: null },
  ugc: { label: 'UGC', env: 'SQUAD_UGC_API_KEY', api: null },
};

/** Why a mode cannot run yet — specific enough to act on. */
function statusFor(def) {
  if (!def.api) return { configured: false, reason: 'not_built' };
  if (!process.env[def.env]) return { configured: false, reason: 'no_provider' };
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
