/**
 * Generation providers — one interface in front of fal.ai and ElevenLabs.
 *
 * The Create sheet has eight buttons and, before this, one working provider
 * per built button: Veo wired directly into routes/squad-video.js. That
 * pattern does not survive contact with eight modes — six routes each
 * speaking a different vendor's HTTP dialect, each with its own polling and
 * its own error strings.
 *
 * So there are exactly two shapes here, because generation only comes in two
 * shapes:
 *
 *   submit()/poll()  asynchronous. Video takes 2–5 minutes; you cannot hold
 *                    an HTTP connection open that long, so the route hands
 *                    back a job id and the client polls. fal's queue gives us
 *                    a request id and a status url for exactly this.
 *   generate()       synchronous, returns bytes. Speech and music arrive in
 *                    seconds, so inventing a job for them would mean
 *                    cross-instance state for something already finished.
 *
 * Polling rather than fal webhooks is deliberate, for now. Webhooks are
 * cheaper and fal supports them, but they need a public URL that returns 2xx
 * within 15 seconds, does not redirect, and is idempotent across up to 31
 * retries. The app already polls Veo and the sheet already knows how, so
 * polling is the smaller change and has no new failure mode. Webhooks are the
 * right follow-up once volume makes the polling chatter matter — noted here
 * so the next person knows it was a choice and not an oversight.
 *
 * Nothing in this file knows about quotas, the database, or Express. It takes
 * a catalogue row and a prompt, and it talks to a vendor.
 */

const FAL_QUEUE = 'https://queue.fal.run';
const FAL_SYNC = 'https://fal.run';
const OPENROUTER_API = 'https://openrouter.ai/api/v1';
const ELEVEN_API = 'https://api.elevenlabs.io/v1';

/**
 * How the OpenRouter catalogue can be reached from this box.
 *
 * Two transports, same model slugs, same bill-per-token shape:
 *   'direct' — OPENROUTER_API_KEY, an account of our own at openrouter.ai,
 *   'fal'    — FAL_KEY, through fal's `openrouter/router` endpoint, which is
 *              fal reselling the same catalogue and billing it to the fal
 *              balance the app already tops up for image and video.
 *
 * The fal transport exists because signing up at openrouter.ai cannot be
 * completed headlessly (their bot check refuses automated browsers) and,
 * more importantly, because a second vendor account is a second balance to
 * remember, a second card and a second thing to run dry. FAL_KEY is already
 * in production, so this turns Create Text's model picker on with no new
 * credential and no new billing relationship.
 *
 * Direct wins when both exist: it is one hop fewer and slightly cheaper
 * (fal adds its margin on top of OpenRouter's token price).
 *
 * @returns {'direct'|'fal'|null}
 */
function routerTransport() {
  if (process.env.OPENROUTER_API_KEY) return 'direct';
  if (process.env.FAL_KEY) return 'fal';
  return null;
}

/** A provider is usable only if its credential is present. */
function configured(provider) {
  if (provider === 'fal') return !!process.env.FAL_KEY;
  if (provider === 'elevenlabs') return !!process.env.ELEVENLABS_API_KEY;
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
  // Either transport counts: the catalogue rows do not care which one carries
  // them, and gating on OPENROUTER_API_KEY alone reported an empty model
  // picker on a box that could reach every one of those models through fal.
  if (provider === 'openrouter') return routerTransport() !== null;
  return false;
}

/**
 * Vendor error messages are for us, not for a creator holding a phone, and
 * they sometimes quote the request back — which can include the prompt and,
 * on a bad day, a key. Truncate hard and never pass one through verbatim
 * without this.
 */
function scrub(text) {
  return String(text || '')
    .replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
    .slice(0, 300);
}

// ─── fal.ai: asynchronous queue ────────────────────────────────────────────

/**
 * Put a job on fal's queue.
 * @returns {Promise<{op: string, statusUrl: string}>} op is fal's request_id.
 */
async function falSubmit(model, input) {
  const r = await fetch(`${FAL_QUEUE}/${model.providerModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.request_id) {
    throw new Error(`fal refused the request (${r.status}): ${scrub(data.detail || data.error)}`);
  }
  return {
    op: data.request_id,
    statusUrl: data.status_url || `${FAL_QUEUE}/${model.providerModel}/requests/${data.request_id}/status`,
    responseUrl: data.response_url || `${FAL_QUEUE}/${model.providerModel}/requests/${data.request_id}`,
  };
}

/**
 * Ask fal whether a job is done.
 *
 * Returns { status: 'running' | 'done' | 'error', url, error }. A network
 * blip maps to 'running', not 'error': the job is still out there, and
 * telling a creator their clip failed because one poll timed out would throw
 * away a generation we have already paid for.
 */
const FAL_FAILED_STATUS = new Set(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'TIMED_OUT']);

async function falPoll(model, op) {
  const base = `${FAL_QUEUE}/${model.providerModel}/requests/${op}`;
  const r = await fetch(`${base}/status`, {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
  });
  const status = await r.json().catch(() => ({}));
  if (!r.ok) {
    // A 5xx or a rate limit is a blip: the job is still out there, keep polling.
    // A 400/401/403/404/422 is permanent — the request id or the model route
    // does not exist at fal — and answering 'running' to those is how four
    // jobs sat spinning for ninety minutes with no error a creator could see.
    if (r.status >= 500 || r.status === 429) return { status: 'running' };
    return {
      status: 'error',
      error: `fal could not report on this job (${r.status}): ${scrub(status.detail || status.error) || 'unknown request or model'}`,
    };
  }

  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
    return { status: 'running', queuePosition: status.queue_position ?? null };
  }
  // fal's terminal failure words. Anything else unknown stays 'running'.
  if (FAL_FAILED_STATUS.has(String(status.status || '').toUpperCase())) {
    return {
      status: 'error',
      error: `the model failed this job: ${scrub(status.error || status.detail) || String(status.status).toLowerCase()}`,
    };
  }
  if (status.status !== 'COMPLETED') return { status: 'running' };

  const rr = await fetch(base, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  const out = await rr.json().catch(() => ({}));
  if (!rr.ok) return { status: 'error', error: `fal result unavailable: ${scrub(out.detail)}` };

  const url = firstMediaUrl(out);
  if (!url) return { status: 'error', error: 'model returned no output' };
  return { status: 'done', url };
}

/**
 * Pull the output URL out of a fal response.
 *
 * fal is a thousand models and the result envelope differs per family:
 * `{video:{url}}`, `{images:[{url}]}`, `{audio:{url}}`. Rather than a
 * per-model parser, take the first url-bearing media field we recognise.
 * Unknown shapes return null and surface as "no output" instead of a crash.
 */
function firstMediaUrl(out) {
  if (!out || typeof out !== 'object') return null;
  const direct = out.video || out.audio || out.image;
  if (direct && direct.url) return direct.url;
  for (const key of ['images', 'videos', 'audios', 'outputs']) {
    const arr = out[key];
    if (Array.isArray(arr) && arr[0]) {
      if (typeof arr[0] === 'string') return arr[0];
      if (arr[0].url) return arr[0].url;
    }
  }
  if (typeof out.url === 'string') return out.url;
  return null;
}

// ─── OpenRouter: one key in front of every text model ──────────────────────

/**
 * Write text with a named third-party model.
 *
 * Five vendors behind one credential, which is the whole reason this exists:
 * offering ChatGPT, Claude, Gemini, Kimi and Grok as separate integrations
 * would mean five accounts, five billing relationships and five sets of
 * outage handling for what a creator experiences as one dropdown. OpenRouter
 * is an OpenAI-shaped endpoint in front of 400+ models, so the catalogue row
 * carries the vendor slug and nothing here needs to know whose model it is.
 *
 * lib/llm.js stays the default path for captions on a box with no OpenRouter
 * key — it has the provider failover and model-repointing that the booking
 * agent depends on. This is the picker, not a replacement.
 */
async function openrouterText(model, { prompt, system, maxTokens = 400, webSearch = false }) {
  if (routerTransport() === 'fal') return falRouterText(model, { prompt, system, maxTokens, webSearch });

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const r = await fetch(`${OPENROUTER_API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      // OpenRouter attributes traffic by these, and they are how our rate
      // limits and spend show up on their dashboard rather than as anonymous.
      'HTTP-Referer': process.env.PUBLIC_BASE_URL || 'https://www.scangym.com',
      'X-Title': 'ScanGym ScanSquad',
    },
    body: JSON.stringify({
      /* OpenRouter's own way of asking for search is the `:online` suffix on
         the slug — same feature, same per-search fee, different spelling from
         fal's boolean. */
      model: webSearch ? `${model.providerModel}:online` : model.providerModel,
      messages,
      max_tokens: maxTokens,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${model.label} refused the request (${r.status}): ${scrub(data.error?.message)}`);
  }
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${model.label} returned nothing`);
  return { text, usage: data.usage || null };
}

/**
 * The same named models, reached through fal instead of an OpenRouter account.
 *
 * fal's `openrouter/router` takes the OpenRouter model slug verbatim, so the
 * catalogue rows need no second set of ids — the row that says
 * `anthropic/claude-sonnet-5` works on either transport. The envelope differs:
 * fal answers `{ output, usage }` rather than OpenAI's `{ choices: [...] }`,
 * and it is a plain synchronous POST to fal.run rather than the queue the
 * video rows use, because a caption comes back in a couple of seconds and a
 * job id for something already finished would mean cross-instance state.
 *
 * Billed per token to the fal balance, ~$0.000003 for a caption on Gemini
 * Flash, so the price the sheet quotes from the catalogue stays the right
 * order of magnitude; fal's own `usage.cost` is passed back for the log.
 */
async function falRouterText(model, { prompt, system, maxTokens = 400, webSearch = false }) {
  const r = await fetch(`${FAL_SYNC}/openrouter/router`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: model.providerModel,
      prompt,
      ...(system ? { system_prompt: system } : {}),
      max_tokens: maxTokens,
      // Some rows have no non-reasoning mode at all (Grok 4.5 answers 400
      // without it). The reasoning text is never shown: `output` is the post.
      ...(model.requiresReasoning ? { reasoning: true } : {}),
      /* Live web results, when the creator asked for them. Off by default and
         priced separately on purpose: a search-backed answer cost $0.028 in
         testing against $0.000008 for the same caption without it — three
         thousand times the price, so it can never be silently on. */
      ...(webSearch ? { enable_web_search: true } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = Array.isArray(data.detail)
      ? data.detail.map((d) => d && d.msg).filter(Boolean).join('; ')
      : data.detail || data.error;
    throw Object.assign(new Error(`${model.label} refused the request (${r.status}): ${scrub(detail)}`), {
      status: r.status,
    });
  }
  // fal reports a model-side failure inside a 200 envelope, so an `error`
  // field is a failure even though the HTTP call succeeded.
  if (data.error) throw new Error(`${model.label} failed: ${scrub(data.error)}`);
  const text = String(data.output || '').trim();
  if (!text) throw new Error(`${model.label} returned nothing`);
  return { text, usage: data.usage || null, via: 'fal' };
}

/**
 * Speech through fal instead of an ElevenLabs account.
 *
 * The same reason Music went this way: the ElevenLabs plan is the free tier,
 * 10,000 characters a month for the whole deployment — about fourteen
 * voiceovers shared by every creator on the site. fal bills the same model
 * per character against the balance the app already tops up, with no monthly
 * ceiling, so the cap stops being a product limit.
 *
 * Two shape differences from the direct call: fal takes a voice *name*
 * ('George') where ElevenLabs takes an account-scoped voice id, and it answers
 * with a hosted url rather than bytes. The route stores bytes (R2, or an
 * inline data url when R2 is unset), so the audio is fetched here and the
 * interface stays `{ buffer, contentType }` — one place that knows about fal
 * instead of a second storage path in the route.
 */
async function falSpeech(model, { text, voiceName, stability }) {
  const r = await fetch(`${FAL_SYNC}/${model.providerModel}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${process.env.FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      ...(voiceName ? { voice: voiceName } : {}),
      ...(stability != null ? { stability } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`voice model refused the request (${r.status}): ${scrub(data.detail || data.error)}`);
  }
  const url = data.audio && data.audio.url;
  if (!url) throw new Error('voice model returned no audio');

  const media = await fetch(url);
  if (!media.ok) throw new Error(`voice audio could not be fetched (${media.status})`);
  return {
    buffer: Buffer.from(await media.arrayBuffer()),
    contentType: (data.audio && data.audio.content_type) || 'audio/mpeg',
  };
}

// ─── ElevenLabs: synchronous bytes ─────────────────────────────────────────

/**
 * Speech. Returns a Buffer of MP3.
 *
 * The voice is chosen from a named preset by the route, never taken raw from
 * the body: voice ids are account-scoped, and letting a caller pass one would
 * let them probe (and spend against) the account's private voices.
 */
async function elevenSpeech(model, { text, voiceId }) {
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const r = await fetch(`${ELEVEN_API}/text-to-speech/${voice}`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text, model_id: model.providerModel }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`speech model refused the request (${r.status}): ${scrub(body)}`);
  }
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: 'audio/mpeg' };
}

/** Music. Returns a Buffer of MP3. Billed per minute of output. */
async function elevenMusic(model, { prompt, ms }) {
  const r = await fetch(`${ELEVEN_API}/music`, {
    method: 'POST',
    headers: {
      'xi-api-key': process.env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ prompt, music_length_ms: ms }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`music model refused the request (${r.status}): ${scrub(body)}`);
  }
  return { buffer: Buffer.from(await r.arrayBuffer()), contentType: 'audio/mpeg' };
}

/**
 * How much of the ElevenLabs character allowance is left this month.
 *
 * This matters more than it looks. The account is on the free tier: 10,000
 * characters a month for the whole deployment, not per creator. At a 700
 * character voiceover that is fourteen generations in total, so two
 * enthusiastic creators can exhaust everyone's allowance before lunch and
 * every later request fails at the vendor with a 401 the sheet would render
 * as "something went wrong".
 *
 * So the route checks the remaining balance before spending it, and says
 * plainly when it is gone. Cached for five minutes: the number moves only
 * when we ourselves spend, and health is polled every time the sheet opens.
 *
 * Returns null when the balance cannot be read — callers must treat that as
 * "unknown, carry on" rather than "empty", because refusing to generate
 * because a status endpoint blipped would be a self-inflicted outage.
 */
let _quotaCache = { at: 0, value: null };
const QUOTA_TTL_MS = 5 * 60 * 1000;

async function elevenCharacterQuota({ force = false } = {}) {
  if (!configured('elevenlabs')) return null;
  if (!force && Date.now() - _quotaCache.at < QUOTA_TTL_MS) return _quotaCache.value;
  try {
    const r = await fetch(`${ELEVEN_API}/user/subscription`, {
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const used = Number(d.character_count);
    const limit = Number(d.character_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
    const value = {
      tier: d.tier || 'unknown',
      used,
      limit,
      remaining: Math.max(0, limit - used),
      resetsAt: d.next_character_count_reset_unix ? d.next_character_count_reset_unix * 1000 : null,
    };
    _quotaCache = { at: Date.now(), value };
    return value;
  } catch (e) {
    console.error('[SquadGen] could not read ElevenLabs balance:', e.message);
    return null;
  }
}

/**
 * The last known plan tier, without a network call.
 *
 * routes/squad-create.js answers synchronously (it is polled on every sheet
 * open and must not wait on a vendor), but it still needs to know whether
 * Music is purchasable on this account. Returns null when nothing has been
 * read yet, which callers must treat as "not known to be allowed".
 */
function cachedElevenTier() {
  return _quotaCache.value ? _quotaCache.value.tier : null;
}

/** Forget the cached balance — called after we spend characters. */
function invalidateCharacterQuota() {
  _quotaCache = { at: 0, value: null };
}

/**
 * Whether this key may actually *generate* with a Gemini model — not merely
 * read its description.
 *
 * This function exists because of a real outage that a health check reported
 * as healthy. On 2026-09-16 the production Gemini key could list models and
 * fetch model metadata perfectly well, while every render came back
 * `403 PERMISSION_DENIED — "Your project has been denied access"`. Create
 * Video's health probe fetched model metadata, so it answered
 * `available: true` for a button that failed for every customer who pressed
 * it. A health check that passes while the feature is dead is worse than no
 * health check, because it stops anybody looking.
 *
 * There is no free "can I generate" endpoint, so this asks the generation
 * endpoint itself with a deliberately empty payload. Google checks
 * authorization before it validates arguments, which makes the two answers
 * unambiguous and costs nothing:
 *
 *   403 → the project is blocked. Nothing will render.
 *   400 → authorized; it only refused our intentionally invalid arguments.
 *
 * Nothing is generated either way, so this is safe to call from a health
 * endpoint. Cached for five minutes: access changes at Google's pace, not
 * per request.
 */
const _access = new Map(); // `${provider}:${providerModel}` → { at, value }
const ACCESS_TTL_MS = 5 * 60 * 1000;

async function geminiGenerationAccess(providerModel, { force = false } = {}) {
  const key = `gemini:${providerModel}`;
  if (!configured('gemini')) return { ok: false, reason: 'no_api_key' };
  const hit = _access.get(key);
  if (!force && hit && Date.now() - hit.at < ACCESS_TTL_MS) return hit.value;

  let value;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${providerModel}:predictLongRunning?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instances: [] }), // invalid on purpose: no render, no bill
      },
    );
    const body = await r.json().catch(() => ({}));
    const detail = scrub(body.error?.message);
    if (r.status === 400) value = { ok: true };
    else if (r.status === 403) value = { ok: false, reason: 'provider_denied', status: 403, detail };
    else if (r.status === 401) value = { ok: false, reason: 'key_rejected', status: 401, detail };
    else if (r.status === 404) value = { ok: false, reason: 'model_not_visible', status: 404, detail };
    else if (r.ok) value = { ok: true }; // accepted our nonsense; access is clearly not the problem
    else value = { ok: false, reason: 'provider_error', status: r.status, detail };
  } catch (e) {
    // A network blip is not a denial. Report unknown and let the caller
    // decide; refusing here would switch a working feature off.
    return { ok: true, unverified: true, detail: scrub(e.message) };
  }
  _access.set(key, { at: Date.now(), value });
  return value;
}

/**
 * The last known generation access for a model, without a network call.
 *
 * routes/squad-create.js answers synchronously on every sheet open, so it
 * cannot await a probe — but it must not advertise a mode whose provider we
 * already know has refused us. Returns null when nothing is known yet.
 */
function cachedGenerationAccess(provider, providerModel) {
  const hit = _access.get(`${provider}:${providerModel}`);
  return hit ? hit.value : null;
}

/**
 * Teach the cache from a real generation result.
 *
 * A live 403 is better evidence than any probe, and a success proves access
 * regardless of what the last probe said.
 */
function noteGenerationOutcome(provider, providerModel, { ok, status }) {
  const key = `${provider}:${providerModel}`;
  if (ok) {
    _access.set(key, { at: Date.now(), value: { ok: true } });
  } else if (status === 403 || status === 401) {
    _access.set(key, {
      at: Date.now(),
      value: { ok: false, reason: status === 403 ? 'provider_denied' : 'key_rejected', status },
    });
  }
}

// ─── The interface the routes use ──────────────────────────────────────────

/**
 * Start an asynchronous generation.
 * @param {object} model  catalogue row (see gen-models.js)
 * @param {object} input  provider-shaped payload, built by the route
 */
async function submit(model, input) {
  if (!configured(model.provider)) throw new Error(`${model.provider} is not configured`);
  if (model.provider === 'fal') return falSubmit(model, input);
  throw new Error(`${model.provider} has no async submit path`);
}

/** Poll an asynchronous generation. */
async function poll(model, op) {
  if (model.provider === 'fal') return falPoll(model, op);
  throw new Error(`${model.provider} has no async poll path`);
}

/** Run a synchronous generation and return bytes. */
async function generate(model, input) {
  if (!configured(model.provider)) throw new Error(`${model.provider} is not configured`);
  if (model.provider === 'openrouter') return openrouterText(model, input);
  if (model.provider === 'fal' && model.kind === 'audio') return falSpeech(model, input);
  if (model.provider === 'elevenlabs') {
    if (model.kind === 'music') return elevenMusic(model, input);
    return elevenSpeech(model, input);
  }
  throw new Error(`${model.provider} has no sync generate path`);
}

module.exports = {
  submit,
  poll,
  generate,
  configured,
  routerTransport,
  scrub,
  elevenCharacterQuota,
  cachedElevenTier,
  geminiGenerationAccess,
  cachedGenerationAccess,
  noteGenerationOutcome,
  invalidateCharacterQuota,
  _internals: { falPoll, firstMediaUrl, falRouterText, openrouterText, falSpeech },
};
