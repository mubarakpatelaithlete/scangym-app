'use strict';
/**
 * Create picker (owner request 2026-09-28, modelled on CapCut / Higgsfield /
 * ElevenLabs): after "create", ask at most one tap-question at a time —
 *   ① Image / Video / Music / Audio  ② Model (Auto first, with prices)
 *   ③ Shape and length (image / video only)
 * — skipping anything the customer already said ("create a 16:9 video with
 * Kling 2.5 Turbo of …" goes straight to the price + YES step).
 *
 * Works in every chatbot: the reply text always carries a numbered list
 * ("Reply 1, 2 or 3"), and `options` lets Telegram draw the same choices as
 * buttons. The customer's last picks are kept in shared memory
 * (memory.createPrefs) and offered first next time, from any chatbot.
 */

const KINDS = ['image', 'video', 'music', 'audio'];
const KIND_LABEL = { image: '🖼️ Image', video: '🎬 Video', music: '🎵 Music', audio: '🎙️ Audio (voiceover)' };
const SHAPES = {
  image: [
    { label: '📱 9:16 tall', s: { aspectRatio: '9:16' } },
    { label: '⬛ 1:1 square', s: { aspectRatio: '1:1' } },
    { label: '🖥️ 16:9 wide', s: { aspectRatio: '16:9' } },
  ],
  video: [
    { label: '📱 9:16 · 8s', s: { aspectRatio: '9:16', durationSeconds: 8 } },
    { label: '🖥️ 16:9 · 8s', s: { aspectRatio: '16:9', durationSeconds: 8 } },
    { label: '📱 9:16 · 4s (cheaper)', s: { aspectRatio: '9:16', durationSeconds: 4 } },
    { label: '🖥️ 16:9 · 4s (cheaper)', s: { aspectRatio: '16:9', durationSeconds: 4 } },
  ],
};
const UNITS = { image: { images: 1 }, video: { seconds: 8 }, music: { minutes: 0.5 }, audio: { chars: 200 } };

/** "create" / "make something" with no media word → ask the kind. */
const BARE_CREATE = /^\s*(please\s+)?(create|make|generate)(\s+(something|me something|anything|content|stuff))?\s*[.!?]*\s*$/i;

function pence(p) {
  if (p == null) return '';
  return p < 100 ? `${p}p` : `£${(p / 100).toFixed(2)}`;
}

/** Settings the customer already typed ("16:9", "square", "4 seconds"). */
function settingsFromText(kind, text) {
  const t = String(text || '').toLowerCase();
  const s = {};
  if (/\b16\s*:\s*9\b|\b(landscape|wide(screen)?|horizontal)\b/.test(t)) s.aspectRatio = '16:9';
  else if (/\b9\s*:\s*16\b|\b(portrait|vertical|tall|story|reel)\b/.test(t)) s.aspectRatio = '9:16';
  else if (kind === 'image' && (/\b1\s*:\s*1\b|\bsquare\b/.test(t))) s.aspectRatio = '1:1';
  const sec = /\b([468])\s*(s|sec|secs|seconds?)\b/.exec(t);
  if (kind === 'video' && sec) s.durationSeconds = Number(sec[1]);
  return s;
}

function catalogue(kind, deps = {}) {
  try {
    const pricing = deps.pricing || require('../lib/gen-pricing');
    return (pricing.pricedCatalogue(kind, UNITS[kind]) || []).filter((m) => m.id && m.label);
  } catch (_) {
    try {
      const models = deps.models || require('../lib/gen-models');
      return (models.catalogueFor(kind) || []).map((m) => ({ id: m.id, label: m.label || m.id }));
    } catch (_) { return []; }
  }
}

/**
 * Start a picker state. If nextStep(w) is null nothing needs asking and the
 * caller goes straight to the price step.
 */
function start({ kind = null, prompt = '', model = null, text = '' }, prefs = {}) {
  const w = { kind, prompt, model, settings: kind ? settingsFromText(kind, text || prompt) : {}, at: Date.now(), prefs: prefs || {} };
  return w;
}

function nextStep(w) {
  if (!w.kind) return 'kind';
  if (!w.model) return 'model';
  if (SHAPES[w.kind] && !w.settings.aspectRatio) return 'shape';
  if (w.kind === 'video' && !w.settings.durationSeconds && !w.shapeDone) return 'shape';
  if (!w.prompt) return 'prompt';
  return null;
}

/** Options for the current step: [{ label, pick }] where pick mutates w. */
function optionsFor(w, deps = {}) {
  const step = nextStep(w);
  const last = (w.prefs && w.kind && w.prefs[w.kind]) || null;
  if (step === 'kind') return KINDS.map((k) => ({ label: KIND_LABEL[k], pick: (x) => { x.kind = k; x.settings = { ...x.settings, ...settingsFromText(k, x.prompt) }; } }));
  if (step === 'model') {
    const rows = catalogue(w.kind, deps);
    const out = [];
    if (last && last.model) {
      const r = rows.find((m) => m.id === last.model);
      if (r) out.push({ label: `🔁 Same as last time: ${r.label}${r.pricePence != null ? ` · ${pence(r.pricePence)}` : ''}`, pick: (x) => { x.model = r.id; if (last.settings) x.settings = { ...last.settings, ...x.settings }; x.shapeDone = !!last.settings; } });
    }
    out.push({ label: '⭐ Auto (recommended)', pick: (x) => { x.model = 'auto'; } });
    for (const m of rows) {
      const tag = m.tier === 'default' ? ' · fast & cheap' : m.tier === 'premium' ? ' · best quality' : '';
      out.push({ label: `${m.label}${m.pricePence != null ? ` · ${pence(m.pricePence)}` : ''}${tag}`, pick: (x) => { x.model = m.id; } });
    }
    return out;
  }
  if (step === 'shape') {
    return SHAPES[w.kind].map((o) => ({ label: o.label, pick: (x) => { x.settings = { ...x.settings, ...o.s }; x.shapeDone = true; } }));
  }
  return [];
}

function question(w, deps = {}) {
  const step = nextStep(w);
  if (step === 'prompt') {
    return { text: `✍️ Now describe your ${w.kind === 'audio' ? 'voiceover (the words to say)' : w.kind}, e.g. "a boxer training at sunrise".`, options: [] };
  }
  const opts = optionsFor(w, deps);
  const head = {
    kind: '🎨 What would you like to create?',
    model: `🎛 Which model for your ${w.kind}? (prices for one ${w.kind === 'video' ? '8s video' : w.kind === 'music' ? '30s track' : w.kind === 'audio' ? 'short voiceover' : 'image'})`,
    shape: w.kind === 'video' ? '📐 Shape and length?' : '📐 Which shape?',
  }[step];
  const list = opts.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  return { text: `${head}\n\n${list}\n\n👉 Reply with a number (1–${opts.length}), or NO to cancel.`, options: opts.map((o, i) => ({ label: o.label, value: String(i + 1) })) };
}

/**
 * Apply the customer's answer. Returns 'next' (ask again / done — check
 * nextStep), 'cancel', or null (not an answer: they moved on).
 */
function answer(w, text, deps = {}) {
  const t = String(text || '').trim();
  if (/^\s*(no|cancel|stop)\b/i.test(t)) return 'cancel';
  const step = nextStep(w);
  if (step === 'prompt') { if (t) { w.prompt = t; return 'next'; } return null; }
  const opts = optionsFor(w, deps);
  const n = /^\s*#?(\d{1,2})\s*[.)]?\s*$/.exec(t);
  let hit = n ? opts[Number(n[1]) - 1] : null;
  if (!hit && t) {
    const low = t.toLowerCase();
    hit = opts.find((o) => o.label.toLowerCase().replace(/[^a-z0-9: .]/g, '').includes(low));
    if (!hit && step === 'kind') { const k = KINDS.find((x) => low.includes(x) || (x === 'audio' && /voice/.test(low))); if (k) hit = opts[KINDS.indexOf(k)]; }
    if (!hit && step === 'model' && /\bauto\b/.test(low)) hit = opts.find((o) => o.label.includes('Auto'));
  }
  if (!hit) return null;
  hit.pick(w);
  return 'next';
}

/** What to send to /generate for a finished wizard. */
function body(w) {
  const out = { ...w.settings };
  if (w.model && w.model !== 'auto') out.model = w.model;
  return out;
}

function remember(prefs, w) {
  const p = { ...(prefs || {}) };
  if (w.kind && w.model && w.model !== 'auto') p[w.kind] = { model: w.model, settings: { ...w.settings } };
  return p;
}

module.exports = { start, nextStep, question, answer, body, remember, settingsFromText, BARE_CREATE, KINDS };
