/**
 * Squad Text — write the caption, on the phone.
 *
 * The ScanSquad Create sheet offers eight modes; seven of them were drawn but
 * not built, and showed a "not switched on yet" banner. Text is the one that
 * needs nothing new: the app already runs an LLM with provider failover
 * (lib/llm.js — OpenAI first, Groq second, dead keys benched by the watchdog).
 * A creator asking for a caption is the same call the booking agent makes,
 * minus the tools. So this mode costs no new provider, no new key, no new
 * billing decision — which is why it is the one to ship first.
 *
 * Shape: POST /generate answers with the finished text in the same response.
 * The video mode is a job (poll /status/:id) because Veo takes a minute and a
 * deploy mid-render must not orphan the clip. A caption arrives in a couple of
 * seconds, so a job id would mean inventing cross-instance state for something
 * that has already finished. The sheet handles both: text in the response is
 * rendered immediately, a jobId is polled.
 *
 * The client picks tone and length from a fixed list. Those are whitelisted
 * here rather than trusted, for the same reason the video settings are: the
 * body is untrusted input, and it ends up in a model prompt.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const llm = require('../lib/llm');
const models = require('../lib/gen-models');
const genProvider = require('../lib/gen-provider');
const { optionalAuth } = require('../middleware/auth');
const { requireBillable } = require('../lib/gen-guard');
const spend = require('../lib/gen-budget');
const jobs = require('../lib/gen-jobs');
const crypto = require('crypto');

const router = express.Router();

/** Whitelisted knobs. Anything else falls back to the default. */
const TONES = {
  Punchy: 'punchy and confident, short sentences, no waffle',
  Friendly: 'warm and friendly, like a message from a mate who trains',
  Professional: 'clear and professional, no slang, no hype',
};
const LENGTHS = {
  Short: 'At most 2 short lines.',
  Medium: 'At most 4 lines.',
  Long: 'At most 8 lines, still tight.',
};
const DEFAULTS = { tone: 'Punchy', length: 'Short' };

/**
 * What a live-web answer costs, per generation, on top of the tokens.
 *
 * Measured on the router on 2026-09-16: $0.028 for one search-backed caption
 * against $0.000008 for the same caption without it. Quoted to the sheet
 * rather than buried, because a toggle that multiplies the bill by three
 * thousand has to say so before it is tapped.
 */
const WEB_SEARCH_USD = 0.028;

const MAX_PROMPT = 600;

/**
 * One caption is cheap, a thousand are not, and this route needs no login.
 * 30 per 15 minutes per IP is far above what writing posts looks like and far
 * below what scripted abuse looks like.
 */
const textLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Slow down a moment — try again shortly.' },
});

function clean(body) {
  const b = body || {};
  const tone = TONES[b.tone] ? b.tone : DEFAULTS.tone;
  const length = LENGTHS[b.length] ? b.length : DEFAULTS.length;
  const prompt = String(b.prompt || '').trim().slice(0, MAX_PROMPT);
  /* The sheet cycles settings as values, so this arrives as true, 'On' or
     'true' depending on the caller. Anything else is off: a paid extra defaults
     to off and must be asked for explicitly. */
  const webSearch = b.webSearch === true || b.webSearch === 'On' || b.webSearch === 'true';
  return { tone, length, prompt, webSearch };
}

/**
 * What the creator is actually asking for: social copy that could go out as-is.
 * The house facts (any gym, day pass, no membership, free cancellation) are
 * stated here so the model does not invent an offer we do not sell — the same
 * reason the booking agent is told the price rather than asked to guess it.
 */
function systemPrompt({ tone, length }) {
  return [
    'You write social media copy for ScanGym creators.',
    'ScanGym sells gym day passes: any partner gym, one price, no membership, free cancellation up to 2 hours before.',
    `Voice: ${TONES[tone]}.`,
    LENGTHS[length],
    'Write the post itself and nothing else: no preamble, no "here is", no options, no quotation marks around the whole thing.',
    'Never invent prices, discounts, gym names or claims that were not asked for.',
    'At most one hashtag line, and only if it earns its place.',
  ].join(' ');
}

// ─── GET /api/squad-text/health ───
// The sheet asks this before offering Generate, exactly as it does for video.
router.get('/health', optionalAuth, async (req, res) => {
  /* Two ways this mode can be on, and the sheet needs to know which:
     - the house writer (lib/llm.js on OpenAI or Groq), always available,
     - the named models, when either OpenRouter transport is reachable: our
       own OPENROUTER_API_KEY, or fal's openrouter/router on the FAL_KEY the
       app already has (lib/gen-provider.js#routerTransport).
     `models` is empty rather than absent when there is no picker, so the
     sheet renders a working button with no dropdown instead of a dropdown
     whose entries all fail. */
  const picker = genProvider.configured('openrouter');
  /* Captions cost a fraction of a penny, so the budget almost never blocks one
     — it is here so the sheet can show one balance for every mode instead of a
     rule that appears only when a creator reaches for video. */
  const creatorBudget = await spend.budgetFor(req);
  res.json({
    ok: true,
    configured: llm.configured() || picker,
    house: llm.configured(),
    budget: creatorBudget,
    models: picker
      ? spend.annotate(models.catalogueFor('text', { tokensIn: 700, tokensOut: 200 }), creatorBudget)
      : [],
    /* Live web results are a property of the router, not of the house writer:
       lib/llm.js has no search. So the sheet only offers the toggle when a
       named model can serve it, and it is told the surcharge rather than
       discovering it on the bill. */
    webSearch: { available: picker, estimateUsd: picker ? WEB_SEARCH_USD : null },
    defaults: { model: 'house' },
  });
});

// ─── POST /api/squad-text/generate ───
/**
 * Write one post. Shared by the sheet's /generate and the ScanSquad voice tool
 * (lib/squad-tools.js create_content), so "write me a punchy caption" by voice is
 * the same writer, same brief, same guard-rails as the Text button.
 * @returns {{ text, provider, tone, length }}  throws on provider failure
 */
async function writePost(body) {
  const { tone, length, prompt, webSearch } = clean(body);
  if (!prompt) throw Object.assign(new Error('Describe the post first.'), { status: 400 });

  /* A named model, if the creator picked one and we can reach it. Anything
     unknown, or a picker with no key behind it, falls through to the house
     writer rather than erroring: a caption is worth writing with whatever is
     available, and a dropdown that can fail the whole request would be a
     worse button than no dropdown. */
  const named = pickNamedModel(body);
  if (named) {
    const out = await genProvider.generate(named, {
      prompt,
      system: systemPrompt({ tone, length }),
      maxTokens: 400,
      webSearch,
    });
    const chosen = (out.text || '').trim();
    if (!chosen) throw Object.assign(new Error('Nothing came back — try again.'), { status: 502 });
    const cost = out.usage && out.usage.cost != null ? out.usage.cost : null;
    console.log(
      `[SquadText] ${named.id} wrote ${chosen.length} chars (${tone}/${length}`
      + `${webSearch ? ', web search' : ''})${cost != null ? ` for $${cost}` : ''}`,
    );
    return {
      text: chosen,
      provider: named.id,
      model: { id: named.id, label: named.label },
      tone,
      length,
      webSearch,
      costUsd: cost,
    };
  }

  if (webSearch) {
    /* Asked for something the house writer cannot do. Silently writing a
       caption with no web results would look like the search happened. */
    throw Object.assign(new Error('Web search needs one of the named models — pick one first.'), { status: 400 });
  }
  if (!llm.configured()) throw Object.assign(new Error('Text is not switched on yet.'), { status: 503 });
  const { stream, provider } = await llm.streamChat('SquadText', {
    stream: false,
    temperature: 0.9,
    max_tokens: 400,
    messages: [
      { role: 'system', content: systemPrompt({ tone, length }) },
      { role: 'user', content: prompt },
    ],
  });
  const text = (stream.choices?.[0]?.message?.content || '').trim();
  if (!text) throw Object.assign(new Error('Nothing came back — try again.'), { status: 502 });
  console.log(`[SquadText] ${provider} wrote ${text.length} chars (${tone}/${length})`);
  return { text, provider, tone, length };
}

/**
 * Which catalogue row the body asked for, or null for the house writer.
 *
 * Never throws on a bad id: the client is untrusted and a typo should cost a
 * dropdown selection, not the caption.
 */
function pickNamedModel(body) {
  const wanted = body && body.model;
  if (!wanted || wanted === 'house') return null;
  const row = models.byKind('text').find((m) => m.id === wanted);
  if (!row || !genProvider.configured(row.provider)) return null;
  return row;
}

router.post('/generate', textLimiter, requireBillable, express.json(), async (req, res) => {
  const { prompt } = clean(req.body);
  if (!prompt) return res.status(400).json({ error: 'Describe the post first.' });
  if (!llm.configured() && !pickNamedModel(req.body)) {
    return res.status(503).json({ error: 'Text is not switched on yet.' });
  }

  /* A named model is priced; the house writer is not. Same budget as every
     other mode so a creator reads one balance, not five. */
  const named = pickNamedModel(req.body);
  const estimate = named ? models.estimateUsd(named, { tokensIn: 700, tokensOut: 200 }) : null;
  const refused = spend.verdict(await spend.budgetFor(req), estimate);
  if (refused) return res.status(refused.status).json(refused.body);

  try {
    /* One writer for both callers. The voice tool (lib/squad-tools.js) and
       this button used to hold two copies of the same call, which is how the
       tone/length brief drifted between them once already. */
    const written = await writePost(req.body);
    /* A caption is a creation too. It used to be written and forgotten — the
       sheet's history was empty by design and "My Creations" could not show the
       one mode every creator uses. The text lives in params because there is no
       file to point at. */
    recordCaption(req, written).catch(() => {});
    return res.json(written);
  } catch (err) {
    // no_provider means every key is dead or benched. Say that, do not pretend.
    const dead = err && err.message === 'no_provider';
    console.error('[SquadText] generation failed:', (err && err.message) || err);
    // writePost carries a status for the cases it knows about (empty prompt,
    // empty answer). Losing it turned a 400 into a 500 and made a user error
    // look like an outage.
    const status = dead ? 503 : (err && err.status) || 500;
    return res.status(status).json({
      error: dead
        ? 'Writing is offline for a moment — try again shortly.'
        : (status === 400 || status === 502) && err.message ? err.message : 'Could not write that one.',
    });
  }
});

// ─── GET /api/squad-text/history ───
// The sheet asks every mode for history. Text is not stored anywhere: a caption
// lives in the creator's clipboard, not in our database. Answer honestly and
// empty rather than 404 into the sheet's error path.
router.get('/history', optionalAuth, async (req, res) => {
  const out = await jobs.historyFor(req, 'text', 20);
  res.json({ items: out.jobs || [], degraded: out.degraded });
});

/**
 * Keep the caption. Best effort: a database blip must not lose the creator the
 * text that is already in the response body in front of them.
 */
async function recordCaption(req, written) {
  const id = crypto.randomBytes(8).toString('hex');
  await jobs.recordJob({
    id,
    req,
    kind: 'text',
    prompt: clean(req.body).prompt,
    params: { tone: written.tone, length: written.length, webSearch: !!written.webSearch, text: written.text },
    op: null,
    model: { id: written.provider, provider: written.provider === 'groq' ? 'groq' : 'openrouter' },
    costUsd: written.costUsd ?? null,
  });
  await jobs.finishJob(id, { status: 'done', url: null });
}

module.exports = router;
module.exports._internals = { clean, systemPrompt, TONES, LENGTHS, MAX_PROMPT, pickNamedModel, WEB_SEARCH_USD };
module.exports.writePost = writePost;
