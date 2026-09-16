/* A generation that can never finish must say so.

   Four Create jobs (one image, one music, two video) once sat at "running"
   for ninety minutes because falPoll answered 'running' to every non-OK
   status response, including a 404 for a model route that does not exist at
   the vendor, and treated a FAILED job as "not COMPLETED yet". A creator saw
   an eternal spinner. These lock the distinction: vendor blips keep polling,
   permanent answers surface as an error. */
const test = require('node:test');
const assert = require('node:assert');
const provider = require('../server/lib/gen-provider.js');

const { falPoll } = provider._internals;
const MODEL = { provider: 'fal', providerModel: 'vendor/some-model/text-to-video' };

function stubFetch(replies) {
  const real = global.fetch;
  let i = 0;
  global.fetch = async () => {
    const r = replies[Math.min(i++, replies.length - 1)];
    return { ok: r.ok ?? r.status < 400, status: r.status ?? 200, json: async () => r.body ?? {} };
  };
  return () => {
    global.fetch = real;
  };
}

test('a 404 from the vendor ends the job instead of polling forever', async () => {
  const restore = stubFetch([{ status: 404, body: { detail: 'model not found' } }]);
  try {
    const out = await falPoll(MODEL, 'req-1');
    assert.strictEqual(out.status, 'error');
    assert.match(out.error, /404/);
  } finally {
    restore();
  }
});

test('a 500 or a rate limit is a blip and keeps polling', async () => {
  for (const status of [500, 502, 429]) {
    const restore = stubFetch([{ status, body: {} }]);
    try {
      assert.strictEqual((await falPoll(MODEL, 'req-2')).status, 'running', `${status} should keep polling`);
    } finally {
      restore();
    }
  }
});

test('a failed job at the vendor is reported as failed', async () => {
  for (const s of ['FAILED', 'ERROR', 'CANCELLED', 'TIMED_OUT']) {
    const restore = stubFetch([{ status: 200, body: { status: s, error: 'bad prompt' } }]);
    try {
      const out = await falPoll(MODEL, 'req-3');
      assert.strictEqual(out.status, 'error', `${s} should be an error`);
    } finally {
      restore();
    }
  }
});

test('a queued job is still running, with its position', async () => {
  const restore = stubFetch([{ status: 200, body: { status: 'IN_QUEUE', queue_position: 3 } }]);
  try {
    const out = await falPoll(MODEL, 'req-4');
    assert.strictEqual(out.status, 'running');
    assert.strictEqual(out.queuePosition, 3);
  } finally {
    restore();
  }
});

test('a completed job returns the media url', async () => {
  const restore = stubFetch([
    { status: 200, body: { status: 'COMPLETED' } },
    { status: 200, body: { video: { url: 'https://cdn.example/clip.mp4' } } },
  ]);
  try {
    assert.deepStrictEqual(await falPoll(MODEL, 'req-5'), {
      status: 'done',
      url: 'https://cdn.example/clip.mp4',
    });
  } finally {
    restore();
  }
});
