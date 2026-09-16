/**
 * Create Text's model picker, and the two Create buttons that were dark for
 * the wrong reason.
 *
 * The bug this file locks down: reachability was asked as "is this one
 * vendor's key present", when the app has for a while had more than one way
 * to reach the same models. On production 2026-09-16 that read as
 *
 *   text  → picker empty      (no OPENROUTER_API_KEY, though fal resells the
 *                              identical catalogue and FAL_KEY was set)
 *   video → provider_denied   (Gemini project blocked, six fal rows ignored)
 *   music → paid_plan_required(free ElevenLabs plan, eleven-music-fal ignored)
 *
 * — three buttons a customer could not use on a deployment that could serve
 * all three. So the rule under test is: a mode is offered when *some*
 * reachable catalogue row can serve it, and the answer must match what the
 * route would actually pick.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const provider = require(path.join(ROOT, 'server', 'lib', 'gen-provider.js'));
const models = require(path.join(ROOT, 'server', 'lib', 'gen-models.js'));
const { MODES } = require(path.join(ROOT, 'server', 'routes', 'squad-create.js'));
const { falRouterText } = provider._internals;

/** Run fn with env vars set, restoring whatever was there before. */
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

/** Stub global fetch for one call, capturing what was sent. */
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

const GEMINI_TEXT_ROW = { id: 'gemini-3', label: 'Gemini 3 Flash', providerModel: 'google/gemini-3-flash-preview' };

test('a fal key alone is enough to reach the named text models', () => {
  withEnv({ OPENROUTER_API_KEY: undefined, FAL_KEY: 'fal-test' }, () => {
    assert.strictEqual(provider.routerTransport(), 'fal');
    assert.strictEqual(provider.configured('openrouter'), true);
    const catalogue = models.catalogueFor('text', { tokensIn: 700, tokensOut: 200 });
    assert.ok(catalogue.length >= 5, 'the picker must not be empty when fal can serve it');
  });
});

test('a direct OpenRouter key is preferred, and no key means no picker', () => {
  withEnv({ OPENROUTER_API_KEY: 'or-test', FAL_KEY: 'fal-test' }, () => {
    assert.strictEqual(provider.routerTransport(), 'direct');
  });
  withEnv({ OPENROUTER_API_KEY: undefined, FAL_KEY: undefined }, () => {
    assert.strictEqual(provider.routerTransport(), null);
    assert.strictEqual(provider.configured('openrouter'), false);
  });
});

test('the fal transport sends the OpenRouter slug and reads fal\'s envelope', async () => {
  const { result, calls } = await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: '  Leg day. Any gym. £5.  ', usage: { cost: 0.0000031 } }),
      () => falRouterText(GEMINI_TEXT_ROW, { prompt: 'leg day post', system: 'be punchy', maxTokens: 400 }),
    ));

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].url, 'https://fal.run/openrouter/router');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Key fal-test');
  const sent = JSON.parse(calls[0].init.body);
  assert.strictEqual(sent.model, 'google/gemini-3-flash-preview', 'the row\'s slug goes through untranslated');
  assert.strictEqual(sent.prompt, 'leg day post');
  assert.strictEqual(sent.system_prompt, 'be punchy');
  assert.strictEqual(sent.max_tokens, 400);
  assert.strictEqual(result.text, 'Leg day. Any gym. £5.');
  assert.strictEqual(result.via, 'fal');
});

test('a failure inside a 200 envelope is still a failure', async () => {
  await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: null, error: 'upstream model unavailable' }),
      async () => {
        await assert.rejects(
          () => falRouterText(GEMINI_TEXT_ROW, { prompt: 'x' }),
          /failed/,
          'fal reports model errors with HTTP 200; treating that as success would return an empty caption',
        );
      },
    ));
});

test('nothing back is an error, not an empty caption', async () => {
  await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: '   ' }),
      async () => {
        await assert.rejects(() => falRouterText(GEMINI_TEXT_ROW, { prompt: 'x' }), /returned nothing/);
      },
    ));
});

test('a vendor refusal never quotes a credential back to the creator', async () => {
  await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(401, { detail: 'invalid key sk-abcdefghijklmnopqrstuvwxyz0123456789' }),
      async () => {
        await assert.rejects(
          () => falRouterText(GEMINI_TEXT_ROW, { prompt: 'x' }),
          (err) => {
            assert.match(err.message, /refused the request \(401\)/);
            assert.ok(!/abcdefghijklmnopqrstuvwxyz/.test(err.message), 'long tokens must be scrubbed');
            assert.strictEqual(err.status, 401);
            return true;
          },
        );
      },
    ));
});

test('a blocked Gemini project does not hide the fal video rows', () => {
  withEnv({ FAL_KEY: 'fal-test', GEMINI_API_KEY: 'gem-test' }, () => {
    // Teach the cache the exact production failure: Veo forbidden.
    provider.noteGenerationOutcome('gemini', 'veo-3.1-fast-generate-preview', { ok: false, status: 403 });
    assert.strictEqual(MODES.video.ready(), true, 'fal can render video even when Google refuses us');
  });
  withEnv({ FAL_KEY: undefined, GEMINI_API_KEY: 'gem-test' }, () => {
    provider.noteGenerationOutcome('gemini', 'veo-3.1-fast-generate-preview', { ok: false, status: 403 });
    assert.strictEqual(MODES.video.ready(), false, 'with only a denied Gemini key there is nothing to render with');
    assert.strictEqual(MODES.video.notReady(), 'provider_denied');
  });
});

test('music is on offer through fal without an ElevenLabs plan', () => {
  withEnv({ FAL_KEY: 'fal-test', ELEVENLABS_API_KEY: undefined, ELEVENLABS_MUSIC_ENABLED: undefined }, () => {
    assert.strictEqual(MODES.music.ready(), true);
    const row = models.resolveAvailable('music', undefined, provider.configured);
    assert.strictEqual(row.provider, 'fal', 'and the row the route picks is the fal one');
  });
  withEnv({ FAL_KEY: undefined, ELEVENLABS_API_KEY: undefined, ELEVENLABS_MUSIC_ENABLED: undefined }, () => {
    assert.strictEqual(MODES.music.ready(), false);
    assert.strictEqual(MODES.music.notReady(), 'no_provider', 'no key at all is not a plan problem');
  });
});

test('a reasoning-only row is asked with reasoning on', async () => {
  const grok = models.byKind('text').find((m) => m.id === 'grok-4.5');
  assert.strictEqual(grok.requiresReasoning, true, 'the catalogue must remember which rows need it');

  const { calls } = await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: 'Any gym. One price.', reasoning: 'thinking out loud' }),
      () => falRouterText(grok, { prompt: 'caption' }),
    ));
  assert.strictEqual(JSON.parse(calls[0].init.body).reasoning, true);

  const { calls: plain } = await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: 'x' }),
      () => falRouterText(GEMINI_TEXT_ROW, { prompt: 'caption' }),
    ));
  assert.strictEqual(JSON.parse(plain[0].init.body).reasoning, undefined, 'and only those rows');
});

test('the reasoning is never served as the caption', async () => {
  const grok = models.byKind('text').find((m) => m.id === 'grok-4.5');
  const { result } = await withEnv({ FAL_KEY: 'fal-test' }, () =>
    withFetch(
      () => jsonResponse(200, { output: 'Leg day.', reasoning: 'The user wants a gym caption, so…' }),
      () => falRouterText(grok, { prompt: 'caption' }),
    ));
  assert.strictEqual(result.text, 'Leg day.');
});
