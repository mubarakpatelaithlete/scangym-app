/**
 * The guards around a paid generation.
 *
 * Two failures this file exists to prevent:
 *
 *  1. A prompt that gets the provider account banned. A ban is not scoped to
 *     the request that caused it — it takes out every Create button at once —
 *     so prompts are screened locally before we submit, even though the check
 *     is crude.
 *  2. A vendor error message being handed to a creator verbatim. Provider
 *     errors quote the request back, which can include a long credential-like
 *     string, and they are written for whoever is reading server logs.
 *
 * Also checks the response-parsing that decides whether a paid generation is
 * recorded as a success: if we cannot find the URL in fal's envelope we have
 * paid for a render and lost it, so the shapes are pinned by tests.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://u:p@127.0.0.1:5432/none';
const LIB = path.join(__dirname, '..', 'server', 'lib');
const jobs = require(path.join(LIB, 'gen-jobs'));
const provider = require(path.join(LIB, 'gen-provider'));

test('prompts that would risk the account are refused before spending', () => {
  for (const bad of [
    'nude woman on a treadmill',
    'NSFW gym shoot',
    'a teen in the changing room',
    'gore and mutilation in the weights room',
  ]) {
    assert.ok(jobs.screenPrompt(bad), `should refuse: ${bad}`);
  }
});

test('the refusal explains what to do instead, and does not quote the prompt', () => {
  const reason = jobs.screenPrompt('nude gym shoot');
  assert.ok(/training|gym|vibe/i.test(reason), 'should redirect the creator');
  assert.ok(!/nude/i.test(reason), 'must not echo the prompt back');
});

test('ordinary gym prompts are not caught by the screen', () => {
  for (const ok of [
    'deadlift PB at sunrise, 9:16, gritty',
    'busy spin class, neon lighting',
    'protein shake on a bench, close up',
    'boxing gym, sweat, black and white',
    'woman lifting heavy, strong and confident',
  ]) {
    assert.strictEqual(jobs.screenPrompt(ok), null, `should allow: ${ok}`);
  }
});

test('provider errors are truncated and stripped of credential-like strings', () => {
  const leaky = `refused for key ${'k'.repeat(48)} on request`;
  const safe = provider.scrub(leaky);
  assert.ok(!safe.includes('k'.repeat(48)), 'long tokens must be redacted');
  assert.ok(safe.includes('[redacted]'));
  assert.ok(provider.scrub('x'.repeat(5000)).length <= 300);
});

test('a provider with no credential is reported as unconfigured', () => {
  const before = process.env.FAL_KEY;
  delete process.env.FAL_KEY;
  assert.strictEqual(provider.configured('fal'), false);
  process.env.FAL_KEY = 'test-key';
  assert.strictEqual(provider.configured('fal'), true);
  if (before === undefined) delete process.env.FAL_KEY;
  else process.env.FAL_KEY = before;
  assert.strictEqual(provider.configured('nonsense'), false);
});

test('the output URL is found in each envelope shape fal returns', () => {
  const { firstMediaUrl } = provider._internals;
  assert.strictEqual(firstMediaUrl({ images: [{ url: 'https://cdn/x.jpg' }] }), 'https://cdn/x.jpg');
  assert.strictEqual(firstMediaUrl({ video: { url: 'https://cdn/x.mp4' } }), 'https://cdn/x.mp4');
  assert.strictEqual(firstMediaUrl({ audio: { url: 'https://cdn/x.mp3' } }), 'https://cdn/x.mp3');
  assert.strictEqual(firstMediaUrl({ images: ['https://cdn/plain.jpg'] }), 'https://cdn/plain.jpg');
});

test('an unrecognised envelope reads as no output rather than crashing', () => {
  const { firstMediaUrl } = provider._internals;
  for (const junk of [null, undefined, {}, { images: [] }, 'a string', 42]) {
    assert.strictEqual(firstMediaUrl(junk), null);
  }
});

test('every mode has a daily cap, so no mode is unbounded', () => {
  for (const kind of ['video', 'image', 'audio', 'music']) {
    assert.ok(jobs.capFor(kind) > 0, `${kind} needs a cap`);
  }
  assert.ok(jobs.capFor('something-new') > 0, 'an unlisted mode must still be capped');
});
