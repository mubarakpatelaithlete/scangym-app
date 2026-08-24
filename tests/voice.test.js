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
  // Answers are now spoken sentence by sentence as they stream (SGVoice.say),
  // which is what keeps the first words under a second; .speak() stays valid too.
  assert.ok(/SGVoice\.(speak|say)\(/.test(src), 'the shared engine must speak its answers');
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

test('the voice router parses its own JSON body', () => {
  const src = read('server/routes/voice.js');
  assert.ok(/router\.use\(express\.json/.test(src), 'server.js only json-parses a hand-listed set of prefixes, so this router must parse its own');

  const server = read('server/server.js');
  const list = server.slice(server.indexOf('const apiPaths'), server.indexOf('apiPaths.forEach'));
  assert.ok(!/\/api\/voice/.test(list), 'if /api/voice is ever added to apiPaths, drop the local parser to avoid double-parsing');
});

/* ── live voice (hands-free) ──────────────────────────────────────────────
 * Section 9 of the product vision is "you just say it": no tap to start a
 * sentence, no tap to end one, and you can talk over the answer. These are
 * text guards on the shipped browser files, which have no test runtime of
 * their own — if the hands-free path is deleted, this fails loudly.            */
{
  const fsx = require('node:fs');
  const pathx = require('node:path');
  const PUBX = pathx.join(__dirname, '..', 'frontend', 'public');
  const readx = (f) => fsx.readFileSync(pathx.join(PUBX, f), 'utf8');

  test('voice.js exposes hands-free live mode and streaming speech', () => {
    const s = readx('voice.js');
    for (const api of ['startLive', 'stopLive', 'resumeLive', 'isLive', 'say:', 'endSay']) {
      assert.ok(s.includes(api), `voice.js no longer exposes ${api}`);
    }
    assert.ok(/getByteTimeDomainData/.test(s), 'voice.js lost its end-of-speech detection');
  });

  test('chat-agent.js starts live voice from the mic and speaks each sentence', () => {
    const s = readx('chat-agent.js');
    assert.ok(s.includes('startLive'), 'the mic no longer opens hands-free voice');
    assert.ok(s.includes('sayReady'), 'answers are no longer spoken sentence by sentence');
    assert.ok(s.includes('onBargeIn'), 'talking over the answer no longer stops it');
  });

  test('index.html loads the current voice bundles', () => {
    const s = readx('index.html');
    assert.ok(/\/voice\.js\?v=3\.0/.test(s), 'voice.js cache-bust not bumped');
    assert.ok(/\/chat-agent\.js\?v=5\.0/.test(s), 'chat-agent.js cache-bust not bumped');
  });
}

test('voice arms itself without a dedicated tap', () => {
  const s = fs.readFileSync(path.join(ROOT, 'frontend/public/voice-always.js'), 'utf8');
  assert.ok(/navigator\.permissions/.test(s), 'no already-granted fast path');
  assert.ok(/pointerdown/.test(s) && /first-gesture/.test(s), 'no first-gesture arming');
  assert.ok(/sg_voice_off_until/.test(s), 'opt-out is not remembered');
  const html = fs.readFileSync(path.join(ROOT, 'frontend/public/index.html'), 'utf8');
  assert.ok(/voice-always\.js/.test(html), 'voice-always.js is not loaded');
  const agent = fs.readFileSync(path.join(ROOT, 'frontend/public/chat-agent.js'), 'utf8');
  assert.ok(/startLive: function/.test(agent), 'agents do not expose startLive');
  assert.ok(/onTab: function/.test(agent), 'agents do not expose onTab');
});

test('the Book tab lives at /explore, so voice must claim that path too', () => {
  const src = read('frontend/public/book-chat.js');
  const m = src.match(/paths:\s*(\/[^\n,]+\/)/);
  assert.ok(m, 'book-chat.js declares a paths regex');
  const re = new RegExp(m[1].slice(1, -1));
  for (const p of ['/explore', '/book', '/']) {
    assert.ok(re.test(p), `book agent should claim ${p}`);
  }
});

test('saying yes confirms a booking — no tap required', () => {
  const src = read('frontend/public/chat-agent.js');
  const yes = src.match(/var YES = (\/.*\/i);/);
  const no = src.match(/var NO = (\/.*\/i);/);
  assert.ok(yes && no, 'chat-agent must recognise spoken agreement');
  // eslint-disable-next-line no-eval
  const Y = eval(yes[1]); const N = eval(no[1]);
  for (const s of ['yes', 'Yeah.', 'do it', 'book it', 'go ahead', 'confirm', 'sounds good']) {
    assert.ok(Y.test(s), `"${s}" should confirm`);
  }
  for (const s of ['no', 'cancel', 'never mind', 'not now']) {
    assert.ok(N.test(s), `"${s}" should cancel`);
    assert.ok(!Y.test(s), `"${s}" must never confirm`);
  }
  for (const s of ['yes but change the time', 'book me a gym in Soho']) {
    assert.ok(!Y.test(s), `"${s}" is a new instruction, not a confirmation`);
  }
  assert.ok(/confirmByWord\(text\)/.test(src), 'send() must route spoken agreement through confirmByWord');
});

test('the browser is allowed to use the microphone on our own origin', () => {
  const src = read('server/server.js');
  const m = src.match(/'Permissions-Policy',\s*'([^']+)'/);
  assert.ok(m, 'server must set a Permissions-Policy header');
  assert.ok(/microphone=\(self\)/.test(m[1]),
    'microphone must be allowed for self — microphone=() silently kills voice');
});
