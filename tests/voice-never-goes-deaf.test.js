'use strict';

/**
 * Live voice must never stop listening.
 *
 * Two defects made the voice mode feel broken end to end, and neither is visible
 * to a source-level assertion — they are properties of the state machine:
 *
 *   1. The mic went deaf for the whole 2.5-4s of thinking + speaking. The recorder
 *      was stopped to close a turn and nothing restarted it until playback drained,
 *      so anything said in that window was lost forever.
 *   2. Barge-in was dead while thinking. It required `state === 'speaking' && speaking`,
 *      but during thinking the audio flag is still false, so neither branch of tick()
 *      ran and the user could not interrupt.
 *
 * So this file runs the real frontend/public/voice.js inside a VM with a fake mic,
 * fake MediaRecorder and a controllable clock, and drives actual audio frames through
 * it. Both tests fail against the pre-fix file, which is the point.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'frontend', 'public', 'voice.js');

/** Let queued promise callbacks run. */
const flush = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

function harness({ sttText = 'book me a gym', ttsStatus = 200 } = {}) {
  const h = {
    clock: 1000,
    ticks: [],          // captured setInterval callbacks
    recorders: [],      // every MediaRecorder ever constructed
    level: 0,           // current mic loudness, 0..1
    errors: [],
    states: [],
    finals: [],
    barges: 0,
  };

  class FakeRecorder {
    constructor() {
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
      h.recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() {
      if (this.state !== 'recording') return;
      this.state = 'inactive';
      // A real recorder flushes its buffer, then reports the stop.
      if (this.ondataavailable) this.ondataavailable({ data: { size: 8000, type: 'audio/webm' } });
      if (this.onstop) this.onstop();
    }
  }
  FakeRecorder.isTypeSupported = () => true;

  class FakeBlob {
    constructor(parts, opts) {
      this.size = (parts || []).reduce((n, p) => n + (p && p.size ? p.size : 0), 0);
      this.type = (opts && opts.type) || '';
    }
  }

  const sandbox = {
    console,
    Promise,
    Math,
    Date: { now: () => h.clock },
    Blob: FakeBlob,
    FormData: class { append() {} },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
    Audio: class {
      constructor() { this.onended = null; this.onerror = null; }
      play() { return Promise.resolve(); }
      pause() {}
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    setInterval: (fn) => { h.ticks.push(fn); return h.ticks.length; },
    clearInterval: () => {},
    setTimeout,
    fetch: (url) => {
      if (String(url).indexOf('/api/voice/health') > -1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ configured: true }) });
      }
      if (String(url).indexOf('/api/voice/stt') > -1) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, text: sttText }) });
      }
      // tts
      return Promise.resolve({
        ok: ttsStatus === 200,
        status: ttsStatus,
        blob: () => Promise.resolve(new FakeBlob([{ size: 10 }], { type: 'audio/mpeg' })),
      });
    },
    navigator: {
      mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [{ stop() {} }] }) },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.MediaRecorder = FakeRecorder;
  sandbox.window.dispatchEvent = () => true;
  sandbox.AudioContext = class {
    resume() {}
    createAnalyser() {
      return {
        fftSize: 1024,
        // Fill the buffer so rms() returns exactly h.level.
        getByteTimeDomainData: (buf) => { buf.fill(Math.round(128 + h.level * 128)); },
      };
    }
    createMediaStreamSource() { return { connect() {} }; }
  };
  sandbox.Uint8Array = Uint8Array;

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox);

  /** Run N tick frames at a given loudness, advancing the clock 30ms each. */
  h.frames = (count, level) => {
    h.level = level;
    for (let i = 0; i < count; i++) {
      h.clock += 30;
      h.ticks.forEach((fn) => fn());
    }
  };
  h.recording = () => h.recorders.filter((r) => r.state === 'recording').length;
  h.V = sandbox.SGVoice;
  h.start = () => h.V.startLive({
    onState: (s) => h.states.push(s),
    onFinal: (t) => h.finals.push(t),
    onBargeIn: () => { h.barges++; },
  });
  return h;
}

test('the mic keeps recording while we transcribe and think', async () => {
  const h = harness();
  await h.start();
  await flush();
  assert.equal(h.recording(), 1, 'a segment records as soon as live mode starts');

  h.frames(6, 0.4);        // speech
  h.frames(30, 0.001);     // 900ms of quiet ends the turn (SILENCE_MS is 750)
  await flush();

  assert.deepEqual(h.finals, ['book me a gym'], 'the turn was transcribed');
  assert.ok(h.states.includes('thinking'), 'it entered thinking');

  // The regression: pre-fix, zero recorders were live here for the whole answer.
  assert.equal(h.recording(), 1, 'a recorder is still live while thinking — the mic never goes deaf');
});

test('you can interrupt it while it is still thinking', async () => {
  const h = harness();
  await h.start();
  await flush();

  h.frames(6, 0.4);
  h.frames(30, 0.001);
  await flush();
  const stateBefore = h.states[h.states.length - 1];
  assert.ok(stateBefore === 'thinking' || stateBefore === 'speaking', 'we are holding the floor');
  assert.equal(h.barges, 0, 'nothing interrupted yet');

  // Talk over it. No TTS audio is playing, so the old `&& speaking` guard blocked this.
  h.frames(8, 0.6);

  assert.equal(h.barges, 1, 'barge-in fires while thinking, not only during playback');
  assert.equal(h.states[h.states.length - 1], 'listening', 'the floor comes back to the user');
  assert.equal(h.recording(), 1, 'and the interrupting words are being recorded');
});

test('words spoken while it thinks are transcribed, not lost', async () => {
  const h = harness();
  await h.start();
  await flush();

  h.frames(6, 0.4);
  h.frames(30, 0.001);
  await flush();
  assert.equal(h.finals.length, 1);

  // Second utterance, begun while the first answer is still in flight.
  h.frames(8, 0.6);        // interrupts
  h.frames(30, 0.001);     // and ends
  await flush();

  assert.equal(h.finals.length, 2, 'the interrupting sentence became a real turn');
});

test('a rate-limited voice reply is reported, never silent', async () => {
  const h = harness({ ttsStatus: 429 });
  h.V.onError((reason) => h.errors.push(reason));

  h.V.say('Twenty gyms near you.');
  await flush();

  assert.ok(h.errors.length >= 1, 'the caller is told the voice failed');
  assert.ok(h.errors.includes('tts_busy'), `429 is reported as busy, got ${JSON.stringify(h.errors)}`);
});

test('the swallowed-failure pattern does not come back', () => {
  const src = fs.readFileSync(SRC, 'utf8');
  assert.ok(!/\.catch\(function \(\) \{\}\)/.test(src), 'an empty catch hides TTS failure from a user who cannot see a screen');
  assert.ok(/notifyError/.test(src), 'audio failures must be surfaced');
});

test('an interrupting sentence is held, not dropped, while the old turn unwinds', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'chat-agent.js'), 'utf8');
  assert.ok(/sendWhenIdle\(said\)/.test(src), 'a busy turn must park the utterance, not discard it');
  assert.ok(!/if \(S\.busy\) return;\s*\n\s*send\(said\);/.test(src), 'the silent drop must be gone');
  // The money-safety property: it only ever sends when the previous turn has ended.
  assert.ok(/if \(!S\.busy\) \{[\s\S]{0,220}send\(text\);/.test(src), 'sendWhenIdle must only fire once idle — never two turns at once');
});
