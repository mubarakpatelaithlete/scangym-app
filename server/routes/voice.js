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
const TTS_MODEL = process.env.VOICE_TTS_MODEL || 'canopylabs/orpheus-3b-0.1-ft';
const TTS_VOICE = process.env.VOICE_TTS_VOICE || 'tara';

// Groq caps uploads at 25MB; a spoken sentence is well under 1MB. Cap low on purpose.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const MAX_TTS_CHARS = 700;

function key() {
  return process.env.GROQ_API_KEY || '';
}

router.get('/health', (_req, res) => {
  res.json({
    success: true,
    configured: !!key(),
    stt: key() ? STT_MODEL : null,
    tts: key() ? TTS_MODEL : null,
    voice: TTS_VOICE,
  });
});

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

/** Speech out. Returns audio bytes so the browser can play them straight back. */
router.post('/tts', async (req, res) => {
  if (!key()) return res.status(503).json({ success: false, error: 'Voice is not configured on this server.' });

  const text = String((req.body && req.body.text) || '').trim().slice(0, MAX_TTS_CHARS);
  if (!text) return res.status(400).json({ success: false, error: 'Nothing to say.' });

  try {
    const r = await fetch(`${GROQ_BASE}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: 'wav',
      }),
    });

    if (!r.ok || !r.body) {
      const detail = r.body ? await r.text() : '';
      console.error('[Voice] TTS failed:', r.status, detail.slice(0, 300));
      // The caller falls back to text-only; never break the conversation over audio.
      return res.status(502).json({ success: false, error: 'Voice is unavailable right now.' });
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    for await (const chunk of r.body) res.write(Buffer.from(chunk));
    return res.end();
  } catch (err) {
    console.error('[Voice] TTS error:', err.message);
    if (!res.headersSent) return res.status(502).json({ success: false, error: 'Voice is unavailable right now.' });
    return res.end();
  }
});

module.exports = router;
