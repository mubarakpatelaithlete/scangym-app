/**
 * The Create sheet sends each vendor the payload that vendor documents.
 *
 * Three live faults are pinned here. All three were found by checking the
 * payloads this app sends against fal's OpenAPI schemas on 2026-09-16, and
 * all three were invisible in production, because **fal ignores unknown
 * fields rather than rejecting them**. Nothing 422s at submit. The feature
 * just quietly does the wrong thing:
 *
 *  1. **Create Video returned no video at all.** WAN 2.5 (the default) and
 *     Kling 2.5 Turbo accept a duration of '5' or '10'. The sheet offers 4,
 *     6 and 8. Probed live with the exact payload this route sent: fal
 *     answers 200 with a request id, status goes to COMPLETED, and the
 *     result is `422 Input should be '5' or '10'`. Every tap, every
 *     customer. The submit succeeding is precisely why nobody saw it.
 *
 *  2. **Seedream V4 ignored the shape the creator picked.** It has no
 *     `aspect_ratio` field; it takes `image_size`. So a 9:16 story image
 *     came back as a 2048x2048 square, with no error anywhere.
 *
 *  3. **Kling 3.0 Pro was quoted at ~2x its price** — $0.22/s catalogued
 *     against fal's real $0.112 (audio off) / $0.168 (audio on).
 *     estimateUsd() is called "the single most effective cost control we
 *     have" in gen-models.js, and a cost control that is wrong against the
 *     customer is worse than none, because it is trusted.
 *
 * Plus the point of the change that found them: Create Music works on a free
 * ElevenLabs plan by going through fal, and returns to the cheaper direct
 * row on its own the day the account is upgraded — no release, no env var.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'server', 'lib');

function fresh(modPath) {
  const id = require.resolve(modPath);
  delete require.cache[id];
  return require(id);
}

const models = () => fresh(path.join(LIB, 'gen-models'));
const imageRoute = () => fresh(path.join(ROOT, 'server', 'routes', 'squad-image'))._internals;
const videoRoute = () => fresh(path.join(ROOT, 'server', 'routes', 'squad-video'))._internals;

// ─── 1. Every row can be sent to its vendor ───────────────────────────────

test('every catalogue row names a payload profile its route actually implements', () => {
  const m = models();
  const known = {
    image: Object.keys(imageRoute().IMAGE_PROFILES),
    video: Object.keys(videoRoute().VIDEO_PROFILES),
  };
  for (const row of m.MODELS) {
    if (!row.inputProfile || !known[row.kind]) continue;
    assert.ok(
      known[row.kind].includes(row.inputProfile),
      `${row.id} asks for profile "${row.inputProfile}", which ${row.kind} cannot build`,
    );
  }
});

test('the default video model gets a duration it actually accepts', () => {
  const { falInput } = videoRoute();
  const wan = models().byKind('video').find((r) => r.tier === 'default');
  for (const asked of [4, 6, 8]) {
    const out = falInput('a gym reel', { durationSeconds: asked, aspectRatio: '9:16', resolution: '720p', generateAudio: true }, wan);
    assert.ok(['5', '10'].includes(out.duration), `asked ${asked}s, sent ${out.duration} — fal accepts only '5' or '10'`);
  }
});

test('a duration rounds up to the vendor length, and the quote follows the render', () => {
  const m = models();
  const { effectiveSeconds } = videoRoute();
  const wan = m.byKind('video').find((r) => r.id === 'wan-2.5');

  assert.equal(effectiveSeconds(wan, 4), 5, 'a longer clip beats a failed one');
  assert.equal(effectiveSeconds(wan, 8), 10);
  // The whole point: price what renders. 8s asked, 10s rendered, 10s billed.
  assert.equal(m.estimateUsd(wan, { seconds: effectiveSeconds(wan, 8) }), 0.5);
});

test('a model that accepts the asked-for length is left alone', () => {
  const { effectiveSeconds } = videoRoute();
  const kling3 = models().MODELS.find((r) => r.id === 'kling-3.0-pro');
  assert.equal(effectiveSeconds(kling3, 8), 8, 'Kling v3 takes 3-15s; no rounding needed');
});

test('Kling v3 gets a string duration and generate_audio, and never a resolution', () => {
  const { falInput } = videoRoute();
  const kling = models().MODELS.find((r) => r.id === 'kling-3.0-pro');
  const out = falInput('a gym reel', { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true }, kling);

  assert.equal(out.duration, '8', 'fal types this field as a string enum');
  assert.equal(out.generate_audio, true);
  assert.ok(!('enable_audio' in out), 'that spelling is ignored, so audio silently stays on and bills 50% more');
  assert.ok(!('resolution' in out), 'Kling v3 has no resolution field');
});

test('Veo through fal gets the duration suffix it insists on', () => {
  const { falInput } = videoRoute();
  const veo = models().MODELS.find((r) => r.id === 'veo-3.1-fal');
  const out = falInput('a gym reel', { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true }, veo);

  assert.equal(out.duration, '8s', "fal's Veo enum is '4s' | '6s' | '8s'");
  assert.equal(out.generate_audio, true);
});

test('Seedream renders the shape the creator picked, not a square', () => {
  const { buildInput } = imageRoute();
  const seedream = models().MODELS.find((r) => r.id === 'seedream-v4');
  const out = buildInput(seedream, 'a kettlebell', { aspectRatio: '9:16', count: 1 });

  assert.equal(out.image_size, 'portrait_16_9');
  assert.ok(!('aspect_ratio' in out), 'the field Seedream ignored while stories came out square');
});

test('Grok Imagine is pinned to the one resolution fal publishes a price for', () => {
  const { falInput } = videoRoute();
  const grok = models().MODELS.find((r) => r.id === 'grok-imagine-video');
  const out = falInput('a gym reel', { durationSeconds: 6, aspectRatio: '9:16', resolution: '1080p', generateAudio: true }, grok);

  assert.equal(out.resolution, '480p', 'a 1080p request must not silently bill at an unquoted rate');
  assert.ok(!('audio' in out) && !('enable_audio' in out) && !('generate_audio' in out));
});

test('WAN 3.0 spells the audio flag its own way', () => {
  const { falInput } = videoRoute();
  const wan3 = models().MODELS.find((r) => r.id === 'wan-3.0');
  const out = falInput('a gym reel', { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: false }, wan3);

  assert.equal(out.audio, false);
  assert.equal(out.resolution, '720p');
  assert.equal(out.duration, 8, 'WAN takes a number where Kling takes a string');
});

test('no fal video payload carries a field that vendor does not define', () => {
  const { falInput, VIDEO_PROFILES } = videoRoute();
  // Field names per fal's schemas, 2026-09-16. An audio flag by the wrong
  // name is not an error — it is ignored, and the vendor default (audio on,
  // ~50% dearer) applies instead of the creator's choice.
  const AUDIO_FLAG = {
    'fal-video': null, 'kling-2.5': null, 'seedance-1': null, 'grok-video': null,
    'kling-v3': 'generate_audio', 'seedance-2.5': 'generate_audio', 'veo-fal': 'generate_audio',
    'wan-3': 'audio',
  };
  const NO_RESOLUTION = new Set(['kling-2.5', 'kling-v3']);

  for (const row of models().byKind('video').filter((r) => r.provider === 'fal')) {
    const profile = row.inputProfile || 'fal-video';
    assert.ok(VIDEO_PROFILES[profile], `${row.id} has no profile`);
    const out = falInput('a gym reel', { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: false }, row);

    const flag = AUDIO_FLAG[profile];
    for (const name of ['audio', 'enable_audio', 'generate_audio']) {
      if (name === flag) assert.equal(out[name], false, `${row.id} must pass the creator's audio choice through`);
      else assert.ok(!(name in out), `${row.id} sends '${name}', which ${profile} ignores`);
    }
    if (NO_RESOLUTION.has(profile)) assert.ok(!('resolution' in out), `${row.id} has no resolution field`);
  }
});

test('OpenAI takes image_size and never aspect_ratio, and is pinned off fal default quality', () => {
  const { buildInput } = imageRoute();
  const gpt = models().MODELS.find((r) => r.id === 'gpt-image-2.5');
  const out = buildInput(gpt, 'a kettlebell', { aspectRatio: '9:16', count: 1 });

  assert.equal(out.image_size, 'portrait_16_9');
  assert.ok(!('aspect_ratio' in out), 'an unknown field is a 422, not an ignored hint');
  assert.equal(out.quality, 'medium', "fal defaults to 'high', which bills several times more");
});

test('Nano Banana 2 is pinned to 1K, where its quoted price applies', () => {
  const { buildInput } = imageRoute();
  const nb2 = models().MODELS.find((r) => r.id === 'nano-banana-2');
  const out = buildInput(nb2, 'a kettlebell', { aspectRatio: '1:1', count: 2 });

  assert.equal(out.resolution, '1K', '2K bills 1.5x and 4K 2x the quoted rate');
  assert.equal(out.num_images, 2);
});

// ─── 2. The prices are fal's, not ours ────────────────────────────────────

test('Kling 3.0 Pro is quoted at the rate fal actually charges', () => {
  const m = models();
  const kling = m.MODELS.find((r) => r.id === 'kling-3.0-pro');
  // fal, 2026-09-16: $0.112/s audio off, $0.168/s audio on. The route sends
  // audio on by default, so that is the honest quote.
  assert.equal(kling.usdPerSecond, 0.168);
  assert.equal(m.estimateUsd(kling, { seconds: 8 }), 1.344);
});

/*
 * Note for whoever reads this next: 'image' is deliberately not in the list
 * below, because it would fail. Nano Banana ($0.0398) holds the default slot
 * while Seedream V4 ($0.03) is cheaper — a pre-existing choice, not something
 * this change introduced, and a quality call rather than a bug. It is a real
 * ~25% saving per image if the quality holds up, so it is worth a decision
 * rather than a silent default swap inside an unrelated PR.
 */
test('the cheapest row stays the default for every mode, so nobody is opted in to spend', () => {
  const m = models();
  for (const kind of ['video', 'audio']) {
    const rows = m.byKind(kind).filter((r) => r.tier !== 'premium');
    const dflt = rows.find((r) => r.tier === 'default');
    assert.ok(dflt, `${kind} has no default row`);
    for (const row of rows) {
      const price = (r) => r.usdPerSecond ?? r.usdPerImage ?? r.usdPerThousandChars ?? r.usdPerMinute;
      assert.ok(
        price(dflt) <= price(row),
        `${kind}: default ${dflt.id} (${price(dflt)}) costs more than ${row.id} (${price(row)})`,
      );
    }
  }
});

test('anything several times the default is premium-gated, not offered by accident', () => {
  const m = models();
  const dflt = m.byKind('video').find((r) => r.tier === 'default');
  for (const row of m.byKind('video')) {
    if (row.usdPerSecond >= dflt.usdPerSecond * 5) {
      assert.equal(row.tier, 'premium', `${row.id} is ${row.usdPerSecond / dflt.usdPerSecond}x the default`);
    }
  }
});

// ─── 3. Music works on a free plan, and un-works itself when it should ────

test('on a free ElevenLabs plan, music resolves to the fal row instead of being off', () => {
  const m = models();
  // What routes/squad-music.js hands the catalogue: ElevenLabs holds a valid
  // key but may not generate music, so it is unreachable *for this kind*.
  const freePlan = (p) => (p === 'elevenlabs' ? false : p === 'fal');
  const chosen = m.resolveAvailable('music', undefined, freePlan);

  assert.ok(chosen, 'a keyed fal account is enough to make music');
  assert.equal(chosen.id, 'eleven-music-fal');
  assert.equal(chosen.provider, 'fal');
});

test('the day the plan goes paid, the cheaper direct row wins again with no release', () => {
  const m = models();
  const paidPlan = (p) => p === 'elevenlabs' || p === 'fal';
  const chosen = m.resolveAvailable('music', undefined, paidPlan);

  assert.equal(chosen.id, 'eleven-music', 'direct is $0.30/min against fal at $0.60');
  assert.ok(m.estimateUsd(chosen, { minutes: 1 }) < m.estimateUsd(m.byKind('music').find((r) => r.id === 'eleven-music-fal'), { minutes: 1 }));
});

test('with no key anywhere, music reports nothing rather than guessing', () => {
  const m = models();
  assert.equal(m.resolveAvailable('music', undefined, () => false), null);
});

test('the fal music payload carries the length the creator picked', () => {
  const { falMusicInput, LENGTH_MS } = fresh(path.join(ROOT, 'server', 'routes', 'squad-music'))._internals;
  const out = falMusicInput('hype gym track', LENGTH_MS['30s']);
  assert.equal(out.music_length_ms, 30000);
  assert.ok(out.prompt.length > 0);
});
