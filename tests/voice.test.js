/**
 * Voice is the product promise: you say it, you hear the answer. These tests pin the
 * properties that make that safe and honest, so a later change cannot quietly break them.
 *
 *   1. The Groq key stays on the server — it must never be shipped to a browser file.
 *   2. With no key configured, the endpoints say so instead of pretending.
 *   3. Speaking is wired into the shared chat engine, so all three tabs get it at once.
 *   4. Audio never blocks the conversation: a TTS failure is caught, not thrown.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the API key never leaves the server', () => {
  const browserFiles = ['frontend/public/voice.js', 'frontend/public/chat-agent.js'];
  for (const f of browserFiles) {
    const src = read(f);
    assert.ok(!/GROQ_API_KEY/.test(src), `${f} must not reference the Groq key`);
    assert.ok(!/api\.groq\.com/.test(src), `${f} must call our server, not Groq directly`);
  }
  assert.ok(/api\/voice\/stt/.test(read('frontend/public/voice.js')), 'the browser posts audio to our own server');
});

test('voice endpoints refuse honestly when nothing is configured', async () => {
  const before = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    delete require.cache[require.resolve(path.join(ROOT, 'server/routes/voice.js'))];
    const router = require(path.join(ROOT, 'server/routes/voice.js'));

    const health = router.stack.find((l) => l.route && l.route.path === '/health');
    assert.ok(health, 'GET /health must exist');

    const body = await new Promise((resolve) => {
      health.route.stack[0].handle({}, { json: resolve });
    });
    assert.equal(body.configured, false, 'health must admit voice is off');
    assert.equal(body.stt, null, 'no model may be advertised without a key');
  } finally {
    if (before !== undefined) process.env.GROQ_API_KEY = before;
  }
});

test('the server exposes voice and the page loads it', () => {
  const server = read('server/server.js');
  assert.ok(/require\('\.\/routes\/voice'\)/.test(server), 'voice router must be required');
  assert.ok(/app\.use\('\/api\/voice'/.test(server), 'voice router must be mounted at /api/voice');

  const html = read('frontend/public/index.html');
  assert.ok(/\/voice\.js/.test(html), 'the page must load voice.js');
  assert.ok(html.indexOf('/voice.js') < html.indexOf('/chat-agent.js'), 'voice.js must load before the chat engine');
});

test('every tab speaks, because speaking lives in the shared engine', () => {
  const src = read('frontend/public/chat-agent.js');
  assert.ok(/SGVoice\.speak\(/.test(src), 'the shared engine must speak its answers');
  assert.ok(/speakable\(/.test(src), 'markdown and links must be stripped before speaking');
  assert.ok(/SGVoice\.shutUp\(\)/.test(src), 'tapping the mic while it talks must interrupt it (barge-in)');
});

test('audio failure degrades to text instead of breaking the chat', () => {
  const src = read('frontend/public/voice.js');
  const speak = src.slice(src.indexOf('function speak('), src.indexOf('function shutUp('));
  assert.ok(/\.catch\(/.test(speak), 'speak must swallow its own failures');
  assert.ok(/autoplay/i.test(speak), 'a refused autoplay must be handled, not thrown');
});

test('uploads are capped so the endpoint cannot be farmed', () => {
  const src = read('server/routes/voice.js');
  assert.ok(/fileSize:\s*\d+\s*\*\s*1024\s*\*\s*1024/.test(src), 'STT uploads must have a size limit');
  assert.ok(/MAX_TTS_CHARS/.test(src), 'TTS input must be length-capped');
});
