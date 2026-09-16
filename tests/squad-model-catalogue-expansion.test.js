/**
 * Adding models to the Create sheet, without a 422 or a wrong price.
 *
 * Two things broke the "adding a model is a row, not a branch" promise the
 * catalogue was built on, and these tests pin both:
 *
 *  1. **fal has no single payload.** Verified against fal's own OpenAPI
 *     schemas on 2026-09-16: Kling v3 wants a *string* duration, calls the
 *     audio flag `generate_audio` and has no `resolution` field; OpenAI's
 *     image model has no `aspect_ratio` and takes `image_size`; WAN 3.0 calls
 *     the flag `audio`; Grok Imagine has no audio flag at all. fal rejects
 *     unknown fields, so a row added without a matching payload profile is a
 *     model that 422s on every tap — the exact "button that looks live and
 *     fails" failure the sheet exists to prevent. Kling 3.0 Pro shipped in
 *     that state and was invisible only because premium was gated off.
 *
 *  2. **A price nobody checked.** Kling 3.0 Pro was catalogued at $0.22/s
 *     against fal's actual $0.112 (audio off) / $0.168 (audio on) — the sheet
 *     quoted a creator roughly double. estimateUsd() is described in
 *     gen-models.js as "the single most effective cost control we have", and
 *     a cost control that is wrong in the customer's disfavour is worse than
 *     none, because it is trusted.
 *
 * Plus the point of the whole change: Create Music works on a free
 * ElevenLabs plan by going through fal, and goes back to the cheaper direct
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

test('Kling v3 gets a string duration and generate_audio, and never a resolution', () => {
  const { falInput } = videoRoute();
  const kling = models().MODELS.find((r) => r.id === 'kling-3.0-pro');
  const out = falInput('a gym reel', { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true }, kling);

  assert.equal(out.duration, '8', 'fal types this field as a string enum');
  assert.equal(out.generate_audio, true);
  assert.ok(!('enable_audio' in out), 'the WAN spelling of the flag is an unknown field here');
  assert.ok(!('resolution' in out), 'Kling v3 has no resolution field; sending one is a 422');
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

test('models that shipped before profiles existed keep their exact payload', () => {
  const { falInput } = videoRoute();
  const wan25 = models().MODELS.find((r) => r.id === 'wan-2.5');
  assert.equal(wan25.inputProfile, undefined, 'the row that works should not need a profile');

  const settings = { durationSeconds: 8, aspectRatio: '9:16', resolution: '720p', generateAudio: true };
  assert.deepEqual(falInput('a gym reel', settings, wan25), {
    prompt: 'a gym reel',
    duration: 8,
    aspect_ratio: '9:16',
    resolution: '720p',
    enable_audio: true,
  });
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
