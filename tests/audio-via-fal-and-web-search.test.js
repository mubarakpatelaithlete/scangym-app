/**
 * Two ceilings, removed.
 *
 * 1. Create Audio ran only on the direct ElevenLabs rows, and that account is
 *    on the free plan: 10,000 characters a month for the whole site, shared by
 *    every creator — about fourteen voiceovers before every later tap fails.
 *    The same model is reachable through fal with no monthly cap, exactly as
 *    Music already is, so a spent allowance should cost a row and not a button.
 *
 * 2. Create Text could not answer anything about the world today. The router
 *    can search, so the sheet gets a toggle — off by default and priced,
 *    because a search costs ~$0.028 against ~$0.000008 for the same caption.
 *
 * The rule both halves defend is the sheet's founding one: a control may not
 * claim an action it cannot perform, and it may not quietly spend more than
 * the creator agreed to.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const provider = require(path.join(ROOT, 'server', 'lib', 'gen-provider.js'));
const models = require(path.join(ROOT, 'server', 'lib', 'gen-models.js'));
const audio = require(path.join(ROOT, 'server', 'routes', 'squad-audio.js'));
const text = require(path.join(ROOT, 'server', 'routes', 'squad-text.js'));
const { falSpeech, falRouterText } = provider._internals;
const { reachable, FAL_VOICES, VOICES } = audio._internals;
const { clean, WEB_SEARCH_USD } = text._internals;
const SHEET = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'squad-create.js'), 'utf8');

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withFetch(handler, fn) {
  const real = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  try {
    return { result: await fn(), calls };
  } finally {
    global.fetch = real;
  }
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const FAL_AUDIO_ROW = models.byKind('audio').find((m) => m.provider === 'fal');

// ─── Create Audio ──────────────────────────────────────────────────────────

test('a spent ElevenLabs month costs a row, not the button', () => {
  withEnv({ ELEVENLABS_API_KEY: 'el-test', FAL_KEY: 'fal-test' }, () => {
    assert.strictEqual(reachable('elevenlabs', { exhausted: true }), false);
    assert.strictEqual(reachable('fal', { exhausted: true }), true);
    const row = models.resolveAvailable('audio', undefined, (p) => reachable(p, { exhausted: true }));
    assert.ok(row, 'there must still be a way to speak');
    assert.strictEqual(row.provider, 'fal');
  });
});

test('the cheap direct row still wins while the allowance lasts', () => {
  withEnv({ ELEVENLABS_API_KEY: 'el-test', FAL_KEY: 'fal-test' }, () => {
    const row = models.resolveAvailable('audio', undefined, (p) => reachable(p, { exhausted: false }));
    assert.strictEqual(row.provider, 'elevenlabs', 'no unnecessary spend, and no release needed when the plan goes paid');
  });
});

test('with neither credential there is nothing to offer', () => {
  withEnv({ ELEVENLABS_API_KEY: undefined, FAL_KEY: undefined }, () => {
    assert.strictEqual(models.resolveAvailable('audio', undefined, (p) => reachable(p, { exhausted: false })), null);
  });
});

test('the three voices exist on both transports', () => {
  assert.deepStrictEqual(Object.keys(FAL_VOICES), Object.keys(VOICES), 'a voice a creator can pick must be speakable either way');
  for (const name of Object.values(FAL_VOICES)) assert.match(name, /^[A-Z][a-z]+$/, 'fal takes public voice names, not ids');
});

test('fal speech returns bytes, so storage has one path', async () => {
  const mp3 = Buffer.from('ID3fake-audio');
  const { result, calls } = await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      (url) => (url.startsWith('https://fal.run/')
        ? jsonResponse(200, { audio: { url: 'https://v3.fal.media/x.mp3', content_type: 'audio/mpeg' } })
        : { ok: true, status: 200, arrayBuffer: async () => mp3 }),
      () => falSpeech(FAL_AUDIO_ROW, { text: 'Leg day.', voiceName: 'George' }),
    ));

  assert.strictEqual(calls[0].url, `https://fal.run/${FAL_AUDIO_ROW.providerModel}`);
  assert.strictEqual(JSON.parse(calls[0].init.body).voice, 'George');
  assert.strictEqual(calls[1].url, 'https://v3.fal.media/x.mp3', 'the hosted file is fetched, not handed to the client');
  assert.ok(Buffer.isBuffer(result.buffer));
  assert.strictEqual(result.contentType, 'audio/mpeg');
});

test('no audio in the envelope is an error, not a silent empty clip', async () => {
  await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, {}),
      async () => {
        await assert.rejects(() => falSpeech(FAL_AUDIO_ROW, { text: 'x' }), /no audio/);
      },
    ));
});

// ─── Web search in Create Text ─────────────────────────────────────────────

test('web search is off unless it was asked for', () => {
  assert.strictEqual(clean({ prompt: 'hi' }).webSearch, false);
  assert.strictEqual(clean({ prompt: 'hi', webSearch: 'maybe' }).webSearch, false);
  assert.strictEqual(clean({ prompt: 'hi', webSearch: true }).webSearch, true);
  assert.strictEqual(clean({ prompt: 'hi', webSearch: 'On' }).webSearch, true, 'the sheet cycles settings as displayed values');
});

test('the toggle reaches the vendor in that vendor\'s spelling', async () => {
  const row = models.byKind('text')[0];
  const { calls } = await withEnv({ FAL_KEY: 'fal-test', OPENROUTER_API_KEY: undefined }, () =>
    withFetch(
      () => jsonResponse(200, { output: 'Today in fitness…' }),
      () => falRouterText(row, { prompt: 'x', webSearch: true }),
    ));
  assert.strictEqual(JSON.parse(calls[0].init.body).enable_web_search, true);

  const { calls: off } = await withEnv({ FAL_KEY: 'fal-test', OPENROUTER_API_KEY: undefined }, () =>
    withFetch(() => jsonResponse(200, { output: 'x' }), () => falRouterText(row, { prompt: 'x' })));
  assert.strictEqual(JSON.parse(off[0].init.body).enable_web_search, undefined);

  const { calls: direct } = await withEnv({ OPENROUTER_API_KEY: 'or-test' }, () =>
    withFetch(
      () => jsonResponse(200, { choices: [{ message: { content: 'x' } }] }),
      () => provider.generate(row, { prompt: 'x', webSearch: true }),
    ));
  assert.match(JSON.parse(direct[0].init.body).model, /:online$/, 'OpenRouter asks for search with the :online suffix');
});

test('the surcharge is quoted, not discovered', () => {
  assert.ok(WEB_SEARCH_USD > 0.01, 'a search is cents, not a rounding error');
  assert.match(SHEET, /webSearch/, 'the sheet must offer the toggle');
  assert.match(SHEET, /Web search/, 'labelled in words');
  assert.match(SHEET, /~£0\.02/, 'and priced on the chip itself');
});

test('the house writer refuses to pretend it searched', async () => {
  await assert.rejects(
    () => text.writePost({ prompt: 'what happened today', webSearch: true }),
    (err) => {
      assert.strictEqual(err.status, 400);
      assert.match(err.message, /named models/);
      return true;
    },
  );
});
