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
const { optionalAuth } = require('../middleware/auth');

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
  return { tone, length, prompt };
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
router.get('/health', (req, res) => {
  res.json({ ok: true, configured: llm.configured() });
});

// ─── POST /api/squad-text/generate ───
router.post('/generate', textLimiter, optionalAuth, express.json(), async (req, res) => {
  const { tone, length, prompt } = clean(req.body);
  if (!prompt) return res.status(400).json({ error: 'Describe the post first.' });
  if (!llm.configured()) return res.status(503).json({ error: 'Text is not switched on yet.' });

  try {
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
    if (!text) return res.status(502).json({ error: 'Nothing came back — try again.' });

    console.log(`[SquadText] ${provider} wrote ${text.length} chars (${tone}/${length})`);
    return res.json({ text, provider, tone, length });
  } catch (err) {
    // no_provider means every key is dead or benched. Say that, do not pretend.
    const dead = err && err.message === 'no_provider';
    console.error('[SquadText] generation failed:', (err && err.message) || err);
    return res
      .status(dead ? 503 : 500)
      .json({ error: dead ? 'Writing is offline for a moment — try again shortly.' : 'Could not write that one.' });
  }
});

// ─── GET /api/squad-text/history ───
// The sheet asks every mode for history. Text is not stored anywhere: a caption
// lives in the creator's clipboard, not in our database. Answer honestly and
// empty rather than 404 into the sheet's error path.
router.get('/history', (req, res) => res.json({ items: [] }));

module.exports = router;
module.exports._internals = { clean, systemPrompt, TONES, LENGTHS, MAX_PROMPT };
