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
  const before = { ...process.env };
  delete process.env.GROQ_API_KEY;
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
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
    for (const k of ['GROQ_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION']) {
      if (before[k] !== undefined) process.env[k] = before[k]; else delete process.env[k];
    }
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

/**
 * Voice is only "on every tab" if each agent claims every route its own tab routes to.
 * getTabForRoute() in app.ctr576.js is the source of truth for that mapping. Before this
 * test, /nearby and /checkout had no agent at all — voice went silent on the money step.
 */
function pathsOf(file) {
  const src = read(file);
  const m = src.match(/^\s*paths:\s*(\/.+\/),\s*$/m);
  assert.ok(m, `${file} declares a paths regex`);
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}

test('every tab route has a voice agent that claims it', () => {
  const claims = {
    'frontend/public/book-chat.js': ['/explore', '/book', '/nearby', '/search', '/checkout',
      '/booking-success', '/gym/42', '/r/abc', '/'],
    'frontend/public/squad-chat.js': ['/creator', '/creator/', '/creators', '/scansquad',
      '/creator-hub', '/creator-reels', '/creator-earnings'],
    'frontend/public/partner-chat.js': ['/partner', '/partner/', '/partner/gyms', '/partners'],
  };
  for (const file of Object.keys(claims)) {
    const re = pathsOf(file);
    for (const p of claims[file]) {
      assert.ok(re.test(p), `${file} should claim ${p}`);
    }
  }
});

test('no two tabs claim the same route — one live conversation at a time', () => {
  const files = ['frontend/public/book-chat.js', 'frontend/public/squad-chat.js',
    'frontend/public/partner-chat.js'];
  const res = files.map(pathsOf);
  const everyRoute = ['/', '/explore', '/nearby', '/checkout', '/booking-success', '/gym/42',
    '/r/abc', '/creator', '/creators', '/creator-hub', '/creator-reels', '/scansquad',
    '/partner', '/partners', '/partner/gyms'];
  for (const p of everyRoute) {
    const owners = res.filter((re) => re.test(p)).length;
    assert.ok(owners <= 1, `${p} is claimed by ${owners} agents`);
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

/**
 * Rate limiting is the thing that actually took voice down: the provider allows ten
 * requests a minute for the whole organisation, we spend one per spoken sentence, and
 * a throttle came back to the browser dressed as a 502 while /health still said 200.
 * These tests pin the three habits that keep that from happening quietly again.
 */
test('a throttle is reported as a throttle, not a server fault', () => {
  const src = read('server/routes/voice.js');
  assert.ok(/status === 429/.test(src), 'the TTS route must recognise a 429 from the provider');
  assert.ok(/res\.status\(429\)/.test(src), 'a provider throttle must surface as 429, not 502');
  assert.ok(/Retry-After/.test(src), 'a throttled reply must tell the caller when to come back');
  assert.ok(/retryAfterMs/.test(src), 'the wait the provider asks for must be honoured');
});

test('spoken lines are cached, so repeats cost neither time nor quota', () => {
  const src = read('server/routes/voice.js');
  assert.ok(/cacheGet\(text\)/.test(src), 'TTS must look in the cache before calling the provider');
  assert.ok(/cachePut\(text/.test(src), 'freshly synthesised audio must be kept');
  assert.ok(/CACHE_MAX_BYTES/.test(src), 'the cache must be bounded or it becomes a memory leak');
  assert.ok(/X-TTS-Cache/.test(src), 'cache hits must be observable from outside');
});

test('the deep health check actually synthesises instead of trusting a key', async () => {
  const src = read('server/routes/voice.js');
  assert.ok(/req\.query.*deep/.test(src), '/health must support ?deep=1');
  assert.ok(/isAudibleWav/.test(src), 'a deep check must prove the audio is not silence');

  // The silence detector is the whole point — exercise it for real.
  const routerPath = path.join(ROOT, 'server/routes/voice.js');
  const before = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'test-key';
  try {
    delete require.cache[require.resolve(routerPath)];
    require(routerPath);
    const body = fs.readFileSync(routerPath, 'utf8');
    const fn = body.match(/function isAudibleWav\(buf\) \{[\s\S]*?\n\}/);
    assert.ok(fn, 'isAudibleWav must be defined');
    // eslint-disable-next-line no-eval
    const isAudibleWav = eval(`(${fn[0]})`);

    const wav = (fill) => {
      const b = Buffer.alloc(44 + 200);
      b.write('RIFF', 0, 'ascii'); b.write('WAVE', 8, 'ascii');
      for (let i = 44; i + 1 < b.length; i += 2) b.writeInt16LE(fill, i);
      return b;
    };
    assert.equal(isAudibleWav(wav(4000)), true, 'real speech must read as audible');
    assert.equal(isAudibleWav(wav(0)), false, 'digital silence must fail the check');
    assert.equal(isAudibleWav(Buffer.alloc(10)), false, 'a truncated file is not audio');
    assert.equal(isAudibleWav(Buffer.alloc(200)), false, 'a non-RIFF blob is not audio');
  } finally {
    if (before === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = before;
  }
});

test('only the opening line may be short, so we stop burning a request per clause', () => {
  const src = read('frontend/public/chat-agent.js');
  assert.ok(/S\.spoken === 0/.test(src), 'the first chunk of a turn must be identifiable');
  assert.ok(/cut < \(first \? 12 : 80\)/.test(src),
    'first chunk stays fast for time-to-first-audio; later chunks batch to save quota');
});


/**
 * The provider swap is the whole point of the change: Azure's free tier removes the
 * ten-a-minute ceiling that was failing a third of spoken replies. These run the real
 * router against a stubbed network, so they check behaviour rather than source text.
 */
const WAV = (() => {
  const b = Buffer.alloc(200);
  b.write('RIFF', 0, 'ascii'); b.write('WAVE', 8, 'ascii');
  for (let i = 44; i + 1 < b.length; i += 2) b.writeInt16LE(4000, i);
  return b;
})();

function loadVoiceRouter(env) {
  const saved = { ...process.env };
  for (const k of ['GROQ_API_KEY', 'AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'VOICE_TTS_PROVIDER']) delete process.env[k];
  Object.assign(process.env, env);
  delete require.cache[require.resolve(path.join(ROOT, 'server/routes/voice.js'))];
  const router = require(path.join(ROOT, 'server/routes/voice.js'));
  return { router, restore: () => { for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, saved); } };
}

function postTts(router, text) {
  const layer = router.stack.find((l) => l.route && l.route.path === '/tts');
  const headers = {};
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      status(c) { this.statusCode = c; return this; },
      json: (body) => resolve({ status: res.statusCode, headers, body }),
      end: (buf) => resolve({ status: res.statusCode, headers, buf }),
    };
    layer.route.stack[layer.route.stack.length - 1].handle({ body: { text } }, res, () => {});
  });
}

const reply = (status, body, hdrs = {}) => ({
  ok: status < 400, status,
  headers: { get: (h) => hdrs[h.toLowerCase()] ?? null },
  arrayBuffer: async () => body,
  text: async () => String(body),
});

test('Azure serves the audio when it is configured, and says so', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'uksouth', GROQ_API_KEY: 'g' });
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, opts) => { seen.push(String(url)); return reply(200, WAV); };
  try {
    const out = await postTts(router, 'Booked. See you there.');
    assert.equal(out.status, 200, 'a working provider must return audio');
    assert.equal(out.headers['x-tts-provider'], 'azure', 'Azure must be preferred over Groq');
    assert.ok(/tts\.speech\.microsoft\.com/.test(seen[0]), 'the call must go to Azure');
    assert.equal(seen.length, 1, 'a success must not also call the fallback');
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('a broken Azure falls back to Groq instead of going silent', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'bad', AZURE_SPEECH_REGION: 'uksouth', GROQ_API_KEY: 'g' });
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    return /microsoft\.com/.test(String(url)) ? reply(401, 'Access denied') : reply(200, WAV);
  };
  try {
    const out = await postTts(router, 'Which one shall I book?');
    assert.equal(out.status, 200, 'the user must still hear an answer');
    assert.equal(out.headers['x-tts-provider'], 'groq', 'the fallback must have served it');
    assert.equal(seen.length, 2, 'both providers must have been tried');
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('audio from the fallback is not cached under the primary voice', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'bad', AZURE_SPEECH_REGION: 'uksouth', GROQ_API_KEY: 'g' });
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    return /microsoft\.com/.test(String(url)) ? reply(500, 'down') : reply(200, WAV);
  };
  try {
    await postTts(router, 'Same line twice.');
    const second = await postTts(router, 'Same line twice.');
    assert.notEqual(second.headers['x-tts-cache'], 'hit',
      'a fallback voice must not be served later as if it were the primary');
    assert.equal(calls, 4, 'the second request must try the primary again, not serve stale audio');
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('a 200 carrying no audio is treated as a failure, not played as silence', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'uksouth' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => reply(200, Buffer.alloc(0));
  try {
    const out = await postTts(router, 'Hello.');
    assert.equal(out.status, 502, 'empty audio must not be returned as success');
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('the provider order is overridable, so a bad swap can be rolled back without a deploy', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'uksouth', GROQ_API_KEY: 'g', VOICE_TTS_PROVIDER: 'groq' });
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return reply(200, WAV); };
  try {
    const out = await postTts(router, 'Roll back.');
    assert.equal(out.headers['x-tts-provider'], 'groq', 'VOICE_TTS_PROVIDER must decide who answers');
    assert.ok(/api\.groq\.com/.test(seen[0]), 'Azure must not be called when it is not in the order');
  } finally { globalThis.fetch = realFetch; restore(); }
});

test('spoken text is escaped before it becomes SSML', async () => {
  const { router, restore } = loadVoiceRouter({ AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'uksouth' });
  const realFetch = globalThis.fetch;
  let body = '';
  globalThis.fetch = async (url, opts) => { body = String(opts.body); return reply(200, WAV); };
  try {
    await postTts(router, 'Fitness & Co <script> "gym"');
    assert.ok(/Fitness &amp; Co &lt;script&gt;/.test(body), 'markup in a gym name must not break the SSML');
    assert.ok(!/<script>/.test(body), 'raw tags must never reach the provider');
  } finally { globalThis.fetch = realFetch; restore(); }
});
