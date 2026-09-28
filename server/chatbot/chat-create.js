'use strict';
/**
 * Create image / video / voiceover / music RIGHT INSIDE the chat — no link,
 * no website (owner request 2026-09-26: "customers create from inside chatbot,
 * no need to click link and come to scangym.com").
 *
 * Safety is the whole design:
 *  - Only for a chat LINKED to a ScanGym account (customer-memory.js
 *    resolveCustomer: user_channels link made while signed in, or the email
 *    channel's sender). Never for an email typed into the chat.
 *  - Price shown first; nothing is spent until the customer replies YES.
 *  - The render goes through the exact ScanSquad routes (squad-image, -video,
 *    -audio, -music) in-process, so the same saved-card check (requireBillable),
 *    daily quota, spend budget, prompt screening and postpaid billing apply,
 *    and the result lands in the same account library every chatbot reads.
 */

const { EventEmitter } = require('events');

const ROUTES = {
  image: '../routes/squad-image',
  video: '../routes/squad-video',
  audio: '../routes/squad-audio',
  music: '../routes/squad-music',
};
const LABEL = { image: 'image', video: 'video', audio: 'voiceover', music: 'music track' };
const ICON = { image: '🖼️', video: '🎬', audio: '🎙️', music: '🎵' };

/* Rate limiters key on req.ip: give each customer their own, so one busy
   customer can't use up everyone's limit. 10.x.x.x is never a real caller. */
function ipFor(userId) {
  let n = 0;
  for (const ch of String(userId)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
}

/** Run one ScanSquad route as the signed-in customer, without HTTP. */
function callRoute(kind, method, url, userId, body, deps = {}) {
  const router = deps.router || require(ROUTES[kind]);
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, {
      method, url, originalUrl: `/api/squad-${kind}${url}`, baseUrl: '', path: url.split('?')[0],
      headers: { 'content-type': 'application/json', 'user-agent': 'scangym-chatbot' },
      body: body || {}, _body: true, query: {}, params: {},
      ip: ipFor(userId), socket: { remoteAddress: '127.0.0.1' }, connection: { remoteAddress: '127.0.0.1' },
      session: { userId }, get(h) { return this.headers[String(h).toLowerCase()]; },
    });
    req.header = req.get;
    const res = new EventEmitter();
    const headers = {};
    let code = 200;
    let done = false;
    const finish = (payload) => { if (done) return; done = true; res.headersSent = true; resolve({ status: code, body: payload || {} }); };
    Object.assign(res, {
      headersSent: false, locals: {}, statusCode: 200,
      status(c) { code = c; this.statusCode = c; return this; },
      json: finish, send: (p) => finish(typeof p === 'object' ? p : { message: p }), end: () => finish({}),
      setHeader(k, v) { headers[String(k).toLowerCase()] = v; }, getHeader(k) { return headers[String(k).toLowerCase()]; },
      removeHeader(k) { delete headers[String(k).toLowerCase()]; },
      set(k, v) { if (typeof k === 'object') Object.assign(headers, k); else headers[String(k).toLowerCase()] = v; return this; },
      header(k, v) { return this.set(k, v); }, append() { return this; },
    });
    try {
      router(req, res, (err) => finish({ error: err ? String(err.message || err) : 'not found', _status: err ? 500 : 404 }));
    } catch (e) {
      code = 500; finish({ error: e.message });
    }
  });
}

function urlOf(b) { return (b && (b.url || b.imageUrl || b.videoUrl || b.audioUrl || (b.images && b.images[0]))) || null; }

/** Normalise for loose model-name matching: "Kling 2.5 turbo" ~ "kling-2.5-turbo". */
function norm(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim(); }

/**
 * Which catalogue model the customer named in chat, if any, e.g.
 * "create video with Kling 2.5 Turbo of a boxer". Longest match wins so
 * "Nano Banana 2" is not read as "Nano Banana".
 */
function pickModel(kind, prompt, deps = {}) {
  try {
    const models = deps.models || require('../lib/gen-models');
    const text = ` ${norm(prompt)} `;
    let best = null; let bestLen = 0;
    for (const m of models.catalogueFor(kind) || []) {
      for (const name of [m.label, m.id]) {
        const n = norm(name);
        if (n && n.length > bestLen && text.includes(` ${n} `)) { best = m.id; bestLen = n.length; }
      }
    }
    return best;
  } catch (_) { return null; }
}

const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s-]+/g, '[\\s-]+');

/**
 * What the model should actually see: the customer's idea without the chat
 * command around it. "create music with Eleven Music of an upbeat beat" must
 * reach the vendor as "an upbeat beat" — ElevenLabs' content checker rejects
 * prompts that name a brand, and a voiceover would otherwise read the command
 * aloud. Falls back to the original text if stripping leaves nothing.
 */
function cleanPrompt(kind, prompt, deps = {}) {
  const raw = String(prompt || '').trim();
  let t = raw.replace(/^(please\s+)?(can you\s+)?(create|make|generate|do)\s+(me\s+)?(an?\s+)?(image|picture|photo|video|clip|music|song|track|audio|voice\s*over|voiceover)\b[\s:,-]*/i, '');
  const m = /^(with|using|on|via|in)\s+/i.exec(t);
  if (m) {
    let names = [];
    try {
      const models = deps.models || require('../lib/gen-models');
      for (const x of models.catalogueFor(kind) || []) names.push(x.label, x.id);
    } catch (_) { /* no catalogue */ }
    names = names.filter(Boolean).sort((a, b) => b.length - a.length);
    const rest = t.slice(m[0].length);
    for (const n of names) {
      const r = new RegExp(`^${esc(n)}(?![a-z0-9])`, 'i').exec(rest);
      if (r) { t = rest.slice(r[0].length); break; }
    }
  }
  t = t.replace(/^[\s:,-]*((of|about|showing|saying|that says)\b)?[\s:,-]*/i, '').trim();
  return t || raw;
}

/** Other models this mode offers, for the confirm message. */
function modelNames(kind, deps = {}) {
  try {
    const models = deps.models || require('../lib/gen-models');
    return (models.catalogueFor(kind) || []).map((m) => m.label || m.id);
  } catch (_) { return []; }
}

/** Retail price for the default settings of each mode (same maths as the routes). */
function quoteFor(kind, prompt, deps = {}, opts = {}) {
  try {
    const models = deps.models || require('../lib/gen-models');
    const pricing = deps.pricing || require('../lib/gen-pricing');
    const provider = deps.provider || require('../lib/gen-provider');
    let model; let units;
    const picked = (opts.model && opts.model !== 'auto') ? opts.model : pickModel(kind, prompt, { models });
    if (kind === 'image') { model = models.resolve('image', picked); units = { images: 1 }; }
    else if (kind === 'video') {
      model = models.resolveAvailable('video', picked, provider.configured);
      const want = Number(opts.durationSeconds) || 8;
      let seconds = want;
      try { if (model && model.provider === 'fal') seconds = require(ROUTES.video)._internals.effectiveSeconds(model, want); } catch (_) { /* keep */ }
      units = { seconds };
    } else if (kind === 'audio') { model = models.resolveAvailable('audio', picked, provider.configured); units = { chars: cleanPrompt('audio', prompt, { models }).length }; }
    else if (kind === 'music') { model = models.resolveAvailable('music', picked, provider.configured); units = { minutes: 0.5 }; }
    if (!model) return null;
    const q = pricing.quote(model, units);
    return q && q.price ? { price: q.price, model: model.label || model.id } : { price: null, model: model.label || model.id };
  } catch (e) {
    console.error('[ChatCreate] quote failed:', e.message);
    return null;
  }
}

function askReply(kind, prompt, quote, settings) {
  const price = quote && quote.price ? `💷 Price: *${quote.price}*${quote.model ? ` (${quote.model})` : ''}, added to your ScanSquad bill on your saved card.\n` : '💷 Charged at the ScanSquad price to your saved card.\n';
  const names = modelNames(kind);
  const shape = settings && (settings.aspectRatio || settings.durationSeconds)
    ? `📐 ${[settings.aspectRatio, settings.durationSeconds ? `${settings.durationSeconds}s` : null].filter(Boolean).join(' · ')}\n` : '';
  const others = !settings && names.length > 1 ? `🎛 Other models: ${names.join(', ')}. Say e.g. "create ${kind} with ${names[names.length - 1]} …".\n` : '';
  return `${ICON[kind]} Ready to make your ${LABEL[kind]} right here:\n"${String(prompt).slice(0, 160)}"\n\n${price}${shape}${others}\n👉 Reply *YES* to create, or *NO* to cancel.`;
}

function refusalText(status, body, kind) {
  const msg = (body && body.error) || '';
  if (status === 401) return '🔒 Please link this chat to your ScanGym account first: https://www.scangym.com/profile → Chatbots.';
  if ((body && body.needsCard) || (!msg && status === 402) || /payment method|mandate/i.test(msg)) {
    return `💳 Add a card once to create in chat: https://www.scangym.com/creator → Billing. Then say YES again.`;
  }
  return `😕 Couldn't make that ${LABEL[kind]}: ${msg || 'please try again in a minute.'}`;
}

/**
 * Start the render. Returns quickly (chat webhooks time out ~10s):
 *  { done:true, url } | { done:false, jobId, etaSeconds } | { error:text }
 * If it is still running, keeps polling in the background and calls onReady(url).
 */
async function startCreation(userId, kind, prompt, { onReady, syncMs = 8000, bgMs = 15 * 60 * 1000, deps = {}, extra = {} } = {}) {
  const model = extra.model || pickModel(kind, prompt, deps);
  const gen = await callRoute(kind, 'POST', '/generate', userId, { ...extra, prompt: cleanPrompt(kind, prompt, deps), ...(model ? { model } : {}) }, deps);
  if (gen.status >= 400 || gen.body.error) return { error: refusalText(gen.status, gen.body, kind) };
  const now = urlOf(gen.body);
  if (now) return { done: true, url: now, jobId: gen.body.jobId || gen.body.id || null };
  const jobId = gen.body.jobId;
  if (!jobId) return { error: refusalText(500, {}, kind) };

  const poll = async () => {
    const s = await callRoute(kind, 'GET', `/status/${jobId}`, userId, null, deps);
    if (s.body.status === 'done') return { url: urlOf(s.body) };
    if (s.body.status === 'error') return { error: s.body.error || 'failed' };
    return null;
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const started = Date.now();
  while (Date.now() - started < syncMs) {
    await wait(deps.pollMs || 2000);
    const r = await poll();
    if (r && r.url) return { done: true, url: r.url, jobId };
    if (r && r.error) return { error: refusalText(500, { error: r.error }, kind) };
  }
  // Background: keeps the job moving (status polls are what finish a job and
  // trigger the "ready" email) and pushes the file to chats that can receive it.
  (async () => {
    while (Date.now() - started < bgMs) {
      await wait(deps.bgPollMs || 10000);
      try {
        const r = await poll();
        if (r && r.url) { if (onReady) await onReady(r.url, jobId); return; }
        if (r && r.error) return;
      } catch (_) { /* transient */ }
    }
  })().catch(() => {});
  return { done: false, jobId, etaSeconds: gen.body.etaSeconds || null };
}

function doneReply(kind, url, jobId) {
  const share = require('../lib/share-remix').shareLink(jobId);
  const earn = share
    ? `\n\n💸 Share & earn: ${share}\n(Your contacts get the same model, shape, length and prompt ready to go. You earn when they buy.)\n📤 Send to all your contacts in 1 tap: ${share}?share=1`
    : '';
  return `${ICON[kind]} Your ${LABEL[kind]} is ready!\n${require('./safe-link').safeLink(url)}${earn}\n\n📚 Saved to your library, so every chatbot can find it ("my library").\n🔁 Say "remix my last" for a new version.`;
}

function runningReply(kind, etaSeconds, canPush) {
  const eta = etaSeconds ? ` (about ${Math.max(1, Math.round(etaSeconds / 60))} min)` : '';
  return `⏳ Creating your ${LABEL[kind]}${eta}…\n\n` +
    (canPush ? `I'll send it right here when it's ready.` : `Say "my library" in a few minutes to get it. We'll email you the link too.`);
}

const YES = /^\s*(yes|y|yeah|yep|ok|okay|go|confirm|create|do it|sure)\b/i;
const NO = /^\s*(no|n|nope|cancel|stop)\b/i;

module.exports = { callRoute, pickModel, cleanPrompt, quoteFor, askReply, startCreation, doneReply, runningReply, refusalText, urlOf, YES, NO, LABEL };
