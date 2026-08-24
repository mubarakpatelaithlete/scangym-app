/**
 * Voice — speech in, speech out.
 *
 * POST /api/voice/stt   audio file  -> { text }        (Groq whisper-large-v3-turbo)
 * POST /api/voice/tts   { text }    -> audio/wav bytes (Groq Canopy Orpheus)
 * GET  /api/voice/health             -> what is actually configured
 *
 * Why server-side and not the browser's built-in SpeechRecognition: that API only
 * exists in Chrome and Safari, it hears British place names badly, and it gives us
 * nothing to speak back with. The product promise is "you say it, and it is done,
 * in a human voice" — that needs both halves, on every browser, including the
 * Capacitor Android shell where the Web Speech API is not available at all.
 *
 * Why cascaded (STT -> existing text agent -> TTS) rather than a realtime speech
 * model: the text agents already enforce confirm-before-you-take-money and write an
 * audit row for every tool call. A realtime model would bypass both, cost roughly
 * twenty times more per conversation, and duplicate logic we have tested. Cascading
 * costs about 0.6p per spoken turn against a £6 day pass.
 *
 * The API key never reaches the browser. Both endpoints are thin proxies with a
 * hard size cap, so a hostile caller cannot turn this into a free transcription farm.
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const STT_MODEL = process.env.VOICE_STT_MODEL || 'whisper-large-v3-turbo';
const TTS_MODEL = process.env.VOICE_TTS_MODEL || 'canopylabs/orpheus-v1-english';
const TTS_VOICE = process.env.VOICE_TTS_VOICE || 'hannah';

// Groq caps uploads at 25MB; a spoken sentence is well under 1MB. Cap low on purpose.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const MAX_TTS_CHARS = 700;
const MAX_RETRY_WAIT_MS = 2000;

/**
 * Spoken replies repeat themselves constantly — "Which one would you like me to book?",
 * "Booked. See you there.", every gym name, every price. Synthesising those again costs
 * ~700ms and, worse, one of the ten requests a minute the tier allows. Keeping the bytes
 * turns the common lines into an instant, free reply and leaves the quota for new speech.
 *
 * Deliberately in-process: the audio is small, identical for every user, and cheap to
 * rebuild after a deploy. A shared cache would be a database round trip to save a hash
 * lookup. Bounded by total bytes, not entry count, because one long line can be a megabyte.
 */
const CACHE_MAX_BYTES = 24 * 1024 * 1024;
const CACHE_MAX_ENTRY_BYTES = 1024 * 1024;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const ttsCache = new Map(); // key -> { buf, expires }; Map keeps insertion order = LRU
let cacheBytes = 0;

function cacheKey(text) {
  return require('crypto').createHash('sha256').update(`${TTS_MODEL}|${TTS_VOICE}|${text}`).digest('hex');
}

function cacheGet(text) {
  const k = cacheKey(text);
  const hit = ttsCache.get(k);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    ttsCache.delete(k);
    cacheBytes -= hit.buf.length;
    return null;
  }
  ttsCache.delete(k); // re-insert so the freshest use sits newest
  ttsCache.set(k, hit);
  return hit.buf;
}

function cachePut(text, buf) {
  if (!buf || !buf.length || buf.length > CACHE_MAX_ENTRY_BYTES) return;
  const k = cacheKey(text);
  const existing = ttsCache.get(k);
  if (existing) cacheBytes -= existing.buf.length;
  ttsCache.set(k, { buf, expires: Date.now() + CACHE_TTL_MS });
  cacheBytes += buf.length;
  for (const [oldest, entry] of ttsCache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    if (oldest === k) continue; // never evict what we just stored
    ttsCache.delete(oldest);
    cacheBytes -= entry.buf.length;
  }
}

// This router parses its own JSON. server.js only applies express.json to a hand-listed
// set of API prefixes, so a new route silently receives an undefined body and every
// request answers "Nothing to say." — which is exactly what happened on production the
// first time. express.json ignores multipart, so /stt's file upload is unaffected.
router.use(express.json({ limit: '64kb' }));

function key() {
  return process.env.GROQ_API_KEY || '';
}

/**
 * GET /health          - what is configured. Cheap, safe to poll.
 * GET /health?deep=1   - actually synthesise two words and prove the audio is real.
 *
 * The shallow check answered 200 all the way through a production outage where a third of
 * spoken replies were failing, because "a key is set" is not "voice works". The deep check
 * spends one request to find out the truth, so it must not be polled every few seconds.
 */
router.get('/health', async (req, res) => {
  const base = {
    success: true,
    configured: !!key(),
    stt: key() ? STT_MODEL : null,
    tts: key() ? TTS_MODEL : null,
    voice: TTS_VOICE,
    cache: { entries: ttsCache.size, bytes: cacheBytes },
  };

  if (!req.query || !req.query.deep) return res.json(base);
  if (!key()) return res.status(503).json({ ...base, success: false, speaks: false, error: 'Voice is not configured on this server.' });

  const started = Date.now();
  try {
    const out = await synthesise('Voice check.');
    const ms = Date.now() - started;
    if (!out.ok) {
      return res.status(out.status === 429 ? 429 : 503).json({
        ...base, success: false, speaks: false, ms,
        throttled: out.status === 429,
        error: out.status === 429 ? 'Rate limited by the speech provider.' : 'The speech provider failed.',
        detail: String(out.detail).slice(0, 300),
      });
    }
    const audible = isAudibleWav(out.buf);
    return res.status(audible ? 200 : 503).json({
      ...base, success: audible, speaks: audible, ms, bytes: out.buf.length,
      error: audible ? undefined : 'Synthesis returned silence.',
    });
  } catch (err) {
    return res.status(503).json({ ...base, success: false, speaks: false, ms: Date.now() - started, error: err.message });
  }
});

/** A WAV of the right shape that is entirely silence is a failure wearing a 200. */
function isAudibleWav(buf) {
  if (!buf || buf.length < 64) return false;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return false;
  for (let i = 44; i + 1 < buf.length; i += 2) {
    if (Math.abs(buf.readInt16LE(i)) > 300) return true;
  }
  return false;
}

/** Speech in. Accepts any container the browser's MediaRecorder produces. */
router.post('/stt', upload.single('audio'), async (req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'Voice is not configured on this server.' });
  if (!req.file || !req.file.buffer || !req.file.buffer.length) {
    return res.status(400).json({ success: false, error: 'No audio received.' });
  }

  try {
    const form = new FormData();
    const name = req.file.originalname && req.file.originalname.includes('.') ? req.file.originalname : 'speech.webm';
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' }), name);
    form.append('model', STT_MODEL);
    form.append('language', 'en');
    form.append('response_format', 'json');
    // Names Whisper otherwise mangles. Cheap accuracy win, no cost.
    form.append('prompt', 'ScanGym, day pass, Scan Squad, gym, London');

    const r = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}` },
      body: form,
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('[Voice] STT failed:', r.status, detail.slice(0, 300));
      return res.status(502).json({ success: false, error: "Didn't catch that — try again or type it." });
    }

    const data = await r.json();
    const text = (data.text || '').trim();
    return res.json({ success: true, text });
  } catch (err) {
    console.error('[Voice] STT error:', err.message);
    return res.status(502).json({ success: false, error: "Didn't catch that — try again or type it." });
  }
});

/**
 * Asks Groq to synthesise one line. Returns { ok, buf } or { ok:false, status, detail }.
 *
 * Groq's on-demand tier allows 10 requests per minute for the whole organisation, and we
 * spend one request per spoken sentence — so a busy minute hits the wall. When it does,
 * Groq answers 429 and tells us how long to wait. A short wait is worth sitting out once,
 * because the alternative the user hears is silence.
 */
async function synthesise(text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(`${GROQ_BASE}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: TTS_MODEL, voice: TTS_VOICE, input: text, response_format: 'wav' }),
    });

    if (r.ok && r.body) return { ok: true, buf: Buffer.from(await r.arrayBuffer()) };

    const detail = await r.text().catch(() => '');
    if (r.status === 429 && attempt === 0) {
      const wait = retryAfterMs(r, detail);
      if (wait > 0 && wait <= MAX_RETRY_WAIT_MS) {
        await new Promise((done) => setTimeout(done, wait));
        continue;
      }
    }
    return { ok: false, status: r.status, detail };
  }
  return { ok: false, status: 429, detail: 'rate limited' };
}

/** Groq puts the wait in a Retry-After header, or in prose: "Please try again in 6s". */
function retryAfterMs(r, detail) {
  const header = Number(r.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return header * 1000;
  const m = /try again in ([\d.]+)\s*(ms|s)\b/i.exec(detail || '');
  if (!m) return 0;
  return m[2].toLowerCase() === 'ms' ? Number(m[1]) : Number(m[1]) * 1000;
}

/** Speech out. Returns audio bytes so the browser can play them straight back. */
router.post('/tts', async (req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'Voice is not configured on this server.' });

  const text = String((req.body && req.body.text) || '').trim().slice(0, MAX_TTS_CHARS);
  if (!text) return res.status(400).json({ success: false, error: 'Nothing to say.' });

  const cached = cacheGet(text);
  if (cached) {
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Cache', 'hit');
    return res.end(cached);
  }

  try {
    const out = await synthesise(text);

    if (!out.ok) {
      console.error('[Voice] TTS failed:', out.status, String(out.detail).slice(0, 300));
      // A throttle is not a fault. Say so plainly, so monitoring can tell the two apart
      // and the browser knows it is worth trying again.
      if (out.status === 429) {
        res.setHeader('Retry-After', '5');
        return res.status(429).json({ success: false, error: 'Voice is busy right now.', detail: String(out.detail).slice(0, 300) });
      }
      // The caller falls back to text-only; never break the conversation over audio.
      return res.status(502).json({ success: false, error: 'Voice is unavailable right now.', detail: String(out.detail).slice(0, 300) });
    }

    cachePut(text, out.buf);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-TTS-Cache', 'miss');
    return res.end(out.buf);
  } catch (err) {
    console.error('[Voice] TTS error:', err.message);
    // NB: `detail` used to be read here but is scoped to the branch above, so any
    // network-level error threw a ReferenceError inside its own error handler.
    if (!res.headersSent) return res.status(502).json({ success: false, error: 'Voice is unavailable right now.', detail: err.message });
    return res.end();
  }
});

module.exports = router;
