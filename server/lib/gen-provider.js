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
const ELEVEN_API = 'https://api.elevenlabs.io/v1';

/** A provider is usable only if its credential is present. */
function configured(provider) {
  if (provider === 'fal') return !!process.env.FAL_KEY;
  if (provider === 'elevenlabs') return !!process.env.ELEVENLABS_API_KEY;
  if (provider === 'gemini') return !!process.env.GEMINI_API_KEY;
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
async function falPoll(model, op) {
  const base = `${FAL_QUEUE}/${model.providerModel}/requests/${op}`;
  const r = await fetch(`${base}/status`, {
    headers: { Authorization: `Key ${process.env.FAL_KEY}` },
  });
  const status = await r.json().catch(() => ({}));
  if (!r.ok) return { status: 'running' };

  if (status.status === 'IN_QUEUE' || status.status === 'IN_PROGRESS') {
    return { status: 'running', queuePosition: status.queue_position ?? null };
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

// ─── ElevenLabs: synchronous bytes ─────────────────────────────────────────

/**
 * Speech. Returns a Buffer of MP3.
 *
 * The voice is a deployment setting, not a client choice: voice ids are
 * account-scoped and letting the body pick one would let a caller probe the
 * account's private voices.
 */
async function elevenSpeech(model, { text }) {
  const voice = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
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
  if (model.provider === 'elevenlabs') {
    if (model.kind === 'music') return elevenMusic(model, input);
    return elevenSpeech(model, input);
  }
  throw new Error(`${model.provider} has no sync generate path`);
}

module.exports = { submit, poll, generate, configured, scrub, _internals: { firstMediaUrl } };
