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

/** Retail price for the default settings of each mode (same maths as the routes). */
function quoteFor(kind, prompt, deps = {}) {
  try {
    const models = deps.models || require('../lib/gen-models');
    const pricing = deps.pricing || require('../lib/gen-pricing');
    const provider = deps.provider || require('../lib/gen-provider');
    let model; let units;
    if (kind === 'image') { model = models.resolve('image'); units = { images: 1 }; }
    else if (kind === 'video') {
      model = models.resolveAvailable('video', null, provider.configured);
      let seconds = 8;
      try { if (model && model.provider === 'fal') seconds = require(ROUTES.video)._internals.effectiveSeconds(model, 8); } catch (_) { /* keep 8 */ }
      units = { seconds };
    } else if (kind === 'audio') { model = models.resolveAvailable('audio', null, provider.configured); units = { chars: String(prompt || '').length }; }
    else if (kind === 'music') { model = models.resolveAvailable('music', null, provider.configured); units = { minutes: 0.5 }; }
    if (!model) return null;
    const q = pricing.quote(model, units);
    return q && q.price ? { price: q.price, model: model.label || model.id } : { price: null, model: model.label || model.id };
  } catch (e) {
    console.error('[ChatCreate] quote failed:', e.message);
    return null;
  }
}

function askReply(kind, prompt, quote) {
  const price = quote && quote.price ? `💷 Price: *${quote.price}*${quote.model ? ` (${quote.model})` : ''}, added to your ScanSquad bill on your saved card.\n` : '💷 Charged at the ScanSquad price to your saved card.\n';
  return `${ICON[kind]} Ready to make your ${LABEL[kind]} right here:\n"${String(prompt).slice(0, 160)}"\n\n${price}\n👉 Reply *YES* to create, or *NO* to cancel.`;
}

function refusalText(status, body, kind) {
  const msg = (body && body.error) || '';
  if (status === 401) return '🔒 Please link this chat to your ScanGym account first: https://www.scangym.com/profile → Chatbots.';
  if (status === 402 || /card|payment method|mandate/i.test(msg)) {
    return `💳 Add a card once to create in chat: https://www.scangym.com/creator → Billing. Then say YES again.`;
  }
  return `😕 Couldn't make that ${LABEL[kind]}: ${msg || 'please try again in a minute.'}`;
}

/**
 * Start the render. Returns quickly (chat webhooks time out ~10s):
 *  { done:true, url } | { done:false, jobId, etaSeconds } | { error:text }
 * If it is still running, keeps polling in the background and calls onReady(url).
 */
async function startCreation(userId, kind, prompt, { onReady, syncMs = 8000, bgMs = 15 * 60 * 1000, deps = {} } = {}) {
  const gen = await callRoute(kind, 'POST', '/generate', userId, { prompt }, deps);
  if (gen.status >= 400 || gen.body.error) return { error: refusalText(gen.status, gen.body, kind) };
  const now = urlOf(gen.body);
  if (now) return { done: true, url: now };
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
    if (r && r.url) return { done: true, url: r.url };
    if (r && r.error) return { error: refusalText(500, { error: r.error }, kind) };
  }
  // Background: keeps the job moving (status polls are what finish a job and
  // trigger the "ready" email) and pushes the file to chats that can receive it.
  (async () => {
    while (Date.now() - started < bgMs) {
      await wait(deps.bgPollMs || 10000);
      try {
        const r = await poll();
        if (r && r.url) { if (onReady) await onReady(r.url); return; }
        if (r && r.error) return;
      } catch (_) { /* transient */ }
    }
  })().catch(() => {});
  return { done: false, jobId, etaSeconds: gen.body.etaSeconds || null };
}

function doneReply(kind, url) {
  return `${ICON[kind]} Your ${LABEL[kind]} is ready!\n${url}\n\n📚 Saved to your library, so every chatbot can find it ("my library").\n🔁 Say "remix my last" for a new version.`;
}

function runningReply(kind, etaSeconds, canPush) {
  const eta = etaSeconds ? ` (about ${Math.max(1, Math.round(etaSeconds / 60))} min)` : '';
  return `⏳ Creating your ${LABEL[kind]}${eta}…\n\n` +
    (canPush ? `I'll send it right here when it's ready.` : `Say "my library" in a few minutes to get it. We'll email you the link too.`);
}

const YES = /^\s*(yes|y|yeah|yep|ok|okay|go|confirm|create|do it|sure)\b/i;
const NO = /^\s*(no|n|nope|cancel|stop)\b/i;

module.exports = { callRoute, quoteFor, askReply, startCreation, doneReply, runningReply, refusalText, urlOf, YES, NO, LABEL };
