/**
 * SGVoice — the browser half of speech in, speech out.
 *
 * window.SGVoice
 *   .ready()            -> Promise<boolean>  is server voice configured
 *   .listen(opts)       -> Promise<string>   record until stop(), transcribe, return text
 *   .stopListening()
 *   .speak(text)        -> Promise           play it back in a human voice
 *   .shutUp()                                barge-in: kill audio immediately
 *   .isSpeaking()
 *
 * Why not the browser's SpeechRecognition: it does not exist in Firefox, it does not
 * exist inside the Android app shell, and it cannot speak back. This records with
 * MediaRecorder — which works everywhere — and lets the server do both halves.
 *
 * Everything degrades quietly. If the mic is blocked or the server has no key, the
 * caller gets a rejected promise with a sentence it can show, and typing still works.
 */
(function () {
  'use strict';

  var readyPromise = null;
  var rec = null;
  var chunks = [];
  var stream = null;
  var audioEl = null;
  var speaking = false;

  function ready() {
    if (!readyPromise) {
      readyPromise = fetch('/api/voice/health')
        .then(function (r) { return r.ok ? r.json() : { configured: false }; })
        .then(function (d) { return !!(d && d.configured); })
        .catch(function () { return false; });
    }
    return readyPromise;
  }

  function canRecord() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function pickMime() {
    var options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (var i = 0; i < options.length; i++) {
      if (window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(options[i])) return options[i];
    }
    return '';
  }

  /** Records until stopListening(), then resolves with what was said. */
  function listen(opts) {
    opts = opts || {};
    shutUp(); // barge-in: never record ourselves talking

    if (!canRecord()) return Promise.reject(new Error('This browser cannot record — type it instead.'));

    return navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .catch(function () { throw new Error('Microphone blocked — allow it in your browser settings.'); })
      .then(function (s) {
        stream = s;
        var mime = pickMime();
        rec = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
        chunks = [];

        return new Promise(function (resolve, reject) {
          rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
          rec.onerror = function () { cleanup(); reject(new Error("Didn't catch that — try again or type it.")); };
          rec.onstart = function () { if (opts.onStart) opts.onStart(); };
          rec.onstop = function () {
            var type = (chunks[0] && chunks[0].type) || mime || 'audio/webm';
            var blob = new Blob(chunks, { type: type });
            cleanup();
            if (opts.onThinking) opts.onThinking();
            if (blob.size < 1200) { resolve(''); return; } // a tap, not a sentence

            var form = new FormData();
            form.append('audio', blob, 'speech.' + (type.indexOf('mp4') > -1 ? 'mp4' : 'webm'));
            fetch('/api/voice/stt', { method: 'POST', body: form })
              .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
              .then(function (res) {
                if (!res.ok || !res.d.success) throw new Error(res.d.error || "Didn't catch that.");
                resolve((res.d.text || '').trim());
              })
              .catch(function (e) { reject(e); });
          };
          rec.start();
        });
      });
  }

  function stopListening() {
    try { if (rec && rec.state === 'recording') rec.stop(); } catch (_) {}
  }

  function isListening() {
    return !!(rec && rec.state === 'recording');
  }

  function cleanup() {
    try { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    stream = null;
    rec = null;
  }

  /** Speaks a line. Resolves when the audio finishes, or immediately if voice is off. */
  function speak(text) {
    var say = String(text || '').trim();
    if (!say) return Promise.resolve();

    return ready().then(function (on) {
      if (!on) return;
      shutUp();
      return fetch('/api/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: say }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error('tts');
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var url = URL.createObjectURL(blob);
            audioEl = new Audio(url);
            speaking = true;
            var done = function () {
              speaking = false;
              URL.revokeObjectURL(url);
              resolve();
            };
            audioEl.onended = done;
            audioEl.onerror = done;
            audioEl.play().catch(done); // autoplay refused: stay silent, keep the text
          });
        })
        .catch(function () { speaking = false; }); // audio is a bonus, never a blocker
    });
  }

  function shutUp() {
    try {
      if (audioEl) { audioEl.pause(); audioEl.src = ''; }
    } catch (_) {}
    audioEl = null;
    queue = [];
    playing = false;
    pendingSays = 0;
    speaking = false;
    var waiting = drainWaiters;
    drainWaiters = [];
    waiting.forEach(function (fn) { fn(); });
  }


  // ── streaming speech out ──────────────────────────────────────────────────
  // Time-to-first-audio is the whole game. Waiting for a full answer before
  // synthesising costs a second or more; sentences are queued and played in
  // order instead, so the first words land while the rest is still arriving.
  var queue = [];        // [{ blob: Promise<Blob> }]
  var playing = false;
  var turnEnded = true;
  var drainWaiters = [];
  var pendingSays = 0;   // queued synchronously, so endSay() cannot finish early

  function synth(text) {
    return fetch('/api/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text }),
    }).then(function (r) {
      if (!r.ok) throw new Error('tts');
      return r.blob();
    });
  }

  function playBlob(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      audioEl = new Audio(url);
      speaking = true;
      var done = function () {
        URL.revokeObjectURL(url);
        resolve();
      };
      audioEl.onended = done;
      audioEl.onerror = done;
      audioEl.play().catch(done);
    });
  }

  function drained() {
    return !playing && !queue.length && !pendingSays;
  }

  function settleDrain() {
    if (!drained()) return;
    speaking = false;
    var waiting = drainWaiters;
    drainWaiters = [];
    waiting.forEach(function (fn) { fn(); });
  }

  function pump() {
    if (playing || !queue.length) { settleDrain(); return; }
    playing = true;
    var item = queue.shift();
    item.blob
      .then(playBlob)
      .catch(function () {})
      .then(function () {
        playing = false;
        if (queue.length) pump();
        else settleDrain();
      });
  }

  /** Queues one chunk of speech. Synthesis starts now, playback stays in order. */
  function say(text) {
    var line = String(text || '').trim();
    if (!line) return;
    pendingSays++;
    turnEnded = false;
    speaking = true;
    return ready().then(function (on) {
      pendingSays--;
      if (!on) { settleDrain(); return; }
      queue.push({ blob: synth(line) });
      pump();
    }).catch(function () { pendingSays--; settleDrain(); });
  }

  /** Resolves once everything queued has finished playing. */
  function endSay() {
    turnEnded = true;
    if (drained()) { speaking = false; return Promise.resolve(); }
    return new Promise(function (resolve) { drainWaiters.push(resolve); });
  }

  // ── live conversation ─────────────────────────────────────────────────────
  // ChatGPT-style: you talk, it hears you stop, it answers out loud, it listens
  // again. No tap to start, no tap to stop, and talking over it cuts it off.
  var live = null;

  var ONSET_FRAMES = 3;      // ~90ms of sound before we call it speech
  var SILENCE_MS = 750;      // end of turn
  var BARGE_FRAMES = 5;      // ~150ms of you talking kills our audio
  var MAX_SEGMENT_MS = 30000;
  var IDLE_RESTART_MS = 20000;

  function rms(analyser, buf) {
    analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function startLive(opts) {
    opts = opts || {};
    if (live) return Promise.resolve(live);
    if (!canRecord()) return Promise.reject(new Error('This browser cannot record — type it instead.'));

    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return Promise.reject(new Error('This browser cannot listen live — tap the mic instead.'));

    return navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .catch(function () { throw new Error('Microphone blocked — allow it in your browser settings.'); })
      .then(function (s) {
        var ctx = new AC();
        if (ctx.resume) ctx.resume();
        var analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(analyser);

        live = {
          stream: s,
          ctx: ctx,
          analyser: analyser,
          buf: new Uint8Array(analyser.fftSize),
          mime: pickMime(),
          rec: null,
          chunks: [],
          state: 'listening',   // listening | thinking | speaking
          heard: false,
          loud: 0,
          quietSince: 0,
          startedAt: 0,
          floor: 0.012,
          opts: opts,
          timer: null,
        };

        setState('listening');
        openSegment();
        live.timer = setInterval(tick, 30);
        return live;
      });
  }

  function setState(state) {
    if (!live) return;
    live.state = state;
    if (live.opts.onState) live.opts.onState(state);
  }

  function openSegment() {
    if (!live) return;
    try { if (live.rec && live.rec.state === 'recording') { live.rec.onstop = null; live.rec.stop(); } } catch (_) {}
    try {
      live.rec = new MediaRecorder(live.stream, live.mime ? { mimeType: live.mime } : undefined);
    } catch (_) {
      live.rec = new MediaRecorder(live.stream);
    }
    live.chunks = [];
    live.heard = false;
    live.loud = 0;
    live.quietSince = 0;
    live.startedAt = Date.now();
    live.rec.ondataavailable = function (e) { if (e.data && e.data.size) live.chunks.push(e.data); };
    live.rec.onstop = function () {
      var segment = live.chunks.slice();
      var spoke = live.heard;
      live.chunks = [];
      if (!live || !spoke || !segment.length) { if (live && live.state === 'listening') openSegment(); return; }
      transcribe(segment);
    };
    try { live.rec.start(); } catch (_) {}
  }

  function closeSegment() {
    if (!live || !live.rec) return;
    try { if (live.rec.state === 'recording') live.rec.stop(); } catch (_) {}
  }

  function transcribe(segment) {
    var type = (segment[0] && segment[0].type) || live.mime || 'audio/webm';
    var blob = new Blob(segment, { type: type });
    if (blob.size < 2500) { if (live && live.state === 'listening') openSegment(); return; }

    setState('thinking');
    var form = new FormData();
    form.append('audio', blob, 'speech.' + (type.indexOf('mp4') > -1 ? 'mp4' : 'webm'));
    fetch('/api/voice/stt', { method: 'POST', body: form })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!live) return;
        var said = res.ok && res.d && res.d.success ? String(res.d.text || '').trim() : '';
        if (!said) { setState('listening'); openSegment(); return; }
        setState('speaking'); // we hold the floor until the answer is done
        if (live.opts.onFinal) live.opts.onFinal(said);
      })
      .catch(function () {
        if (!live) return;
        setState('listening');
        openSegment();
      });
  }

  /** The caller says: the answer is finished, take the mic back. */
  function resumeLive() {
    if (!live) return;
    if (live.state === 'listening') return; // already holding the mic open
    setState('listening');
    openSegment();
  }

  function tick() {
    if (!live) return;
    var level = rms(live.analyser, live.buf);
    if (live.opts.onLevel) live.opts.onLevel(level);

    // A slowly-learned noise floor keeps a humming gym from counting as speech.
    if (level < live.floor) live.floor = live.floor * 0.98 + level * 0.02;
    var speechAt = Math.max(0.018, live.floor * 3.2);

    if (live.state === 'listening') {
      var now = Date.now();
      if (level > speechAt) {
        live.loud++;
        if (live.loud >= ONSET_FRAMES && !live.heard) {
          live.heard = true;
          if (live.opts.onHeard) live.opts.onHeard();
        }
        live.quietSince = 0;
      } else {
        live.loud = 0;
        if (live.heard) {
          if (!live.quietSince) live.quietSince = now;
          else if (now - live.quietSince > SILENCE_MS) { closeSegment(); return; }
        }
      }
      if (live.heard && now - live.startedAt > MAX_SEGMENT_MS) { closeSegment(); return; }
      if (!live.heard && now - live.startedAt > IDLE_RESTART_MS) { closeSegment(); openSegment(); }
      return;
    }

    if (live.state === 'speaking' && speaking) {
      // Barge-in: start talking and it stops mid-sentence, like a person would.
      if (level > Math.max(0.05, live.floor * 6)) {
        live.loud++;
        if (live.loud >= BARGE_FRAMES) {
          live.loud = 0;
          shutUp();
          if (live.opts.onBargeIn) live.opts.onBargeIn();
          resumeLive();
        }
      } else {
        live.loud = 0;
      }
    }
  }

  function stopLive() {
    if (!live) return;
    var l = live;
    live = null;
    try { clearInterval(l.timer); } catch (_) {}
    try { if (l.rec && l.rec.state === 'recording') { l.rec.onstop = null; l.rec.stop(); } } catch (_) {}
    try { l.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) {}
    try { if (l.ctx.close) l.ctx.close(); } catch (_) {}
    shutUp();
    if (l.opts.onState) l.opts.onState('off');
  }

  function isLive() { return !!live; }

  window.SGVoice = {
    ready: ready,
    listen: listen,
    stopListening: stopListening,
    isListening: isListening,
    speak: speak,
    shutUp: shutUp,
    isSpeaking: function () { return speaking; },
    canRecord: canRecord,
    say: say,
    endSay: endSay,
    startLive: startLive,
    stopLive: stopLive,
    resumeLive: resumeLive,
    isLive: isLive,
  };
})();
