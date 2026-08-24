/**
 * LLM providers, in order of preference, with automatic failover.
 *
 * Why this exists: on 31 Jul 2026 the OpenAI key on production was revoked. Both
 * assistants kept greeting people happily and then failed the instant anyone asked a
 * question — the owner saw "Something went wrong on my side" and had no way to know the
 * product was one dead environment variable away from working. A single hard-coded
 * provider is a single point of failure for the most visible feature in the app.
 *
 * So: try each configured provider in turn. Groq is OpenAI-API-compatible (same client,
 * different baseURL) and supports streaming plus tool calling, so failover needs no
 * second code path. If the first provider rejects the request (bad key, quota, outage)
 * we quietly move to the next one and the user never notices.
 *
 * Order is deliberate: OpenAI first because gpt-4o-mini follows the "confirm before you
 * change money" instructions most reliably; Groq second as the always-on backup.
 */
const OpenAI = require('openai');

function build() {
  const list = [];

  if (process.env.OPENAI_API_KEY) {
    list.push({
      label: 'openai',
      model: process.env.AGENT_MODEL_OPENAI || 'gpt-4o-mini',
      client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    });
  }

  if (process.env.GROQ_API_KEY) {
    list.push({
      label: 'groq',
      model: process.env.AGENT_MODEL_GROQ || 'openai/gpt-oss-120b',
      client: new OpenAI({
        apiKey: process.env.GROQ_API_KEY,
        baseURL: 'https://api.groq.com/openai/v1',
      }),
    });
  }

  return list;
}

const providers = build();

function configured() {
  return providers.length > 0;
}

/**
 * Start a streaming chat completion, falling back through providers.
 *
 * Only the *opening* of the stream is retried. Once tokens are flowing we are committed:
 * silently restarting mid-answer would replay text the user has already read, and could
 * re-run a tool. A mid-stream failure is handled by the caller as a dropped connection.
 *
 * @param {string} tag  log prefix, e.g. 'PartnerAgent'
 * @param {object} params  OpenAI chat.completions.create params (model is filled in)
 * @returns {Promise<{stream: AsyncIterable, provider: string}>}
 */
// A provider that just rejected us with a dead key or a rate limit will almost certainly
// reject the next message too. Benching it briefly keeps the first token fast instead of
// paying a failed round-trip on every single question.
const COOLDOWN_MS = 5 * 60 * 1000;
const benched = new Map(); // label -> timestamp until which we skip it

function isBenched(label) {
  const until = benched.get(label);
  if (!until) return false;
  if (Date.now() > until) {
    benched.delete(label);
    return false;
  }
  return true;
}

/**
 * Models get retired. On 24 Aug 2026 the assistant answered every single question with
 * "my assistant service is down": the OpenAI key had been revoked (401) and Groq's
 * hard-coded `llama-3.3-70b-versatile` had been decommissioned (404), so both providers
 * failed and the failover had nothing left to fail over to. A pinned model name is a
 * time bomb with no clock on it.
 *
 * So: when a provider says the model does not exist, ask it what it *does* have and pick
 * the best tool-calling model on offer, once, then carry on. Failing over between two
 * providers does not help when the thing that expired is the model name.
 */
const PREFERRED = [
  /^openai\/gpt-oss-120b$/,
  /^openai\/gpt-oss-20b$/,
  /^qwen\/qwen3/,
  /^llama-3\.[0-9]+-70b/,
];
// Models that cannot hold a booking conversation, whatever else they are good at.
const UNUSABLE = /guard|whisper|tts|embed|safeguard|prompt-guard/i;

function isMissingModel(err) {
  return !!err && (err.status === 404 || /does not exist|decommissioned|model_not_found/i.test(err.message || ''));
}

async function repointToLiveModel(tag, p) {
  const list = await p.client.models.list();
  const ids = (list.data || []).map((m) => m.id).filter((id) => !UNUSABLE.test(id));
  const pick = PREFERRED.map((rx) => ids.find((id) => rx.test(id))).find(Boolean) || ids[0];
  if (!pick) return null;
  console.warn(`[${tag}] ${p.label} model ${p.model} is gone; switching to ${pick}`);
  p.model = pick;
  return pick;
}

async function streamChat(tag, params) {
  let lastErr = null;
  const usable = providers.filter((p) => !isBenched(p.label));
  // Everyone is benched: rather than fail, give the preferred provider another chance.
  const queue = usable.length ? usable : providers;

  for (const p of queue) {
    try {
      const stream = await p.client.chat.completions.create({ ...params, model: p.model });
      benched.delete(p.label);
      if (lastErr) {
        console.warn(`[${tag}] falling back to ${p.label} (${p.model})`);
      }
      return { stream, provider: p.label };
    } catch (err) {
      // A retired model name is recoverable without human help: find a live one and retry.
      if (isMissingModel(err)) {
        try {
          if (await repointToLiveModel(tag, p)) {
            const stream = await p.client.chat.completions.create({ ...params, model: p.model });
            benched.delete(p.label);
            return { stream, provider: p.label };
          }
        } catch (retryErr) {
          err = retryErr;
        }
      }
      lastErr = err;
      if ([401, 403, 429].includes(err.status)) {
        benched.set(p.label, Date.now() + COOLDOWN_MS);
      }
      console.error(`[${tag}] provider ${p.label} unavailable: ${err.status || ''} ${err.message}`);
    }
  }

  const err = new Error('no_provider');
  err.cause = lastErr;
  throw err;
}

/**
 * Provider errors quote the key back at you, partially masked. /agent/health is public, so
 * even a masked key does not belong in its response body.
 */
function scrub(message) {
  return String(message || '')
    .replace(/\b(sk|gsk|xai)[-_][A-Za-z0-9-_*]+/g, '<redacted>')
    .slice(0, 160);
}

/**
 * Prove the assistant can actually answer, rather than that a key is set.
 * One tiny completion per provider — cheap, but it is the truth.
 */
async function health() {
  const out = [];
  for (const p of providers) {
    const started = Date.now();
    try {
      await p.client.chat.completions.create({
        model: p.model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
      out.push({ provider: p.label, model: p.model, ok: true, ms: Date.now() - started });
    } catch (err) {
      if (isMissingModel(err)) {
        try {
          if (await repointToLiveModel('Health', p)) {
            await p.client.chat.completions.create({
              model: p.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1,
            });
            out.push({ provider: p.label, model: p.model, ok: true, repointed: true, ms: Date.now() - started });
            continue;
          }
        } catch (_) { /* fall through to the honest failure below */ }
      }
      out.push({ provider: p.label, model: p.model, ok: false, status: err.status || null, error: scrub(err.message) });
    }
  }
  return out;
}

module.exports = { streamChat, configured, providers, health, _internals: { repointToLiveModel, isMissingModel, scrub, PREFERRED, UNUSABLE } };
