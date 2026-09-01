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
  var errorHandlers = [];

  /**
   * Something went wrong with audio. Voice-first users cannot see a console, and
   * silence is indistinguishable from thinking — so a caller can subscribe and say
   * it out loud or on screen. Never throws: a broken listener must not break voice.
   */
  function notifyError(reason) {
    var why = String(reason || 'voice');
    for (var i = 0; i < errorHandlers.length; i++) {
      try { errorHandlers[i](why); } catch (_) {}
    }
    try {
      if (window.dispatchEvent && window.CustomEvent) {
        window.dispatchEvent(new CustomEvent('sgvoice:error', { detail: { reason: why } }));
      }
    } catch (_) {}
  }

  function onError(fn) {
    if (typeof fn === 'function') errorHandlers.push(fn);
  }

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
        .catch(function (e) {
          // Audio is a bonus, never a blocker — but the caller is told, so a
          // voice-first user gets something instead of unexplained silence.
          speaking = false;
          notifyError((e && e.message) || 'tts');
        });
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
      if (!r.ok) throw new Error(r.status === 429 ? 'tts_busy' : 'tts_' + r.status);
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
      .catch(function (e) { notifyError((e && e.message) || 'tts'); })
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
    }).catch(function (e) { pendingSays--; notifyError((e && e.message) || 'tts'); settleDrain(); });
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
  /**
   * End of turn.
   *
   * A flat 750ms was charged to every single turn: say "yes" and you still wait
   * three quarters of a second before we even start thinking. Dropping it flat to
   * 450ms buys that back on long sentences and loses it on short ones, because the
   * short utterances are exactly the ones people pause in the middle of — "book
   * me…" *(thinks)* "…a gym near Bolton". Cutting that in half is a worse product
   * than waiting.
   *
   * So the wait shrinks with the evidence. Once someone has been talking for
   * SETTLED_MS the phrase is almost certainly finished when they stop, and we take
   * the short wait. Below that we keep the patient one.
   */
  var SILENCE_MS = 750;      // end of turn, before we have much to go on
  var SILENCE_SETTLED_MS = 450;
  var SETTLED_MS = 1500;     // speech this long counts as a finished phrase
  var BARGE_FRAMES = 5;      // ~150ms of you talking kills our audio
  var MAX_SEGMENT_MS = 30000;
  var IDLE_RESTART_MS = 20000;
  // An open microphone that nobody is talking into is a battery drain and a privacy
  // story we do not want to have to explain. Two minutes of genuine silence and we
  // hand the mic back; the caller is told so it can say so on screen.
  var IDLE_END_MS = 120000;

  function rms(analyser, buf) {
    analyser.getByteTimeDomainData(buf);
    var sum = 0;
    for (var i = 0; i < buf.length; i++) {
      var v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  /**
   * A short, quiet blip the moment we start thinking.
   *
   * Without it, "thinking" and "the microphone is broken" sound exactly the same —
   * both are silence — and this file's own comment above says as much. Synthesised
   * rather than shipped as an asset: no extra request, and it cannot 404.
   */
  function playEarcon() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = live && live.ctx ? live.ctx : new AC();
      if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var t = ctx.currentTime;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(620, t + 0.16);
      // Quiet, and shaped so it reads as a soft "mm-hm" rather than an alert.
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    } catch (_) { /* a missing blip must never break voice */ }
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
          lastVoiceAt: Date.now(),
        };

        setState('listening');
        openSegment();
        live.timer = setInterval(tick, 30);
        return live;
      });
  }

  function setState(state) {
    if (!live) return;
    var was = live.state;
    live.state = state;
    // Only on the transition, so a re-entrant setState cannot blip twice per turn.
    if (state === 'thinking' && was !== 'thinking') playEarcon();
    if (live.opts.onState) live.opts.onState(state);
  }

  /** 'off' when there is no conversation — lets callers duck audio only when we hold the floor. */
  function liveState() {
    return live ? live.state : 'off';
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
    live.speechStartedAt = 0;
    live.startedAt = Date.now();
    live.rec.ondataavailable = function (e) { if (e.data && e.data.size) live.chunks.push(e.data); };
    live.rec.onstop = function () {
      var segment = live.chunks.slice();
      var spoke = live.heard;
      live.chunks = [];
      if (!live || !spoke || !segment.length) { if (live) openSegment(); return; }
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
    // Never go deaf. Recording restarts before the network call, so anything said
    // while we transcribe, think and answer is captured instead of lost forever.
    openSegment();
    if (blob.size < 2500) return;

    setState('thinking');
    if (live) live.lastVoiceAt = Date.now();
    var form = new FormData();
    form.append('audio', blob, 'speech.' + (type.indexOf('mp4') > -1 ? 'mp4' : 'webm'));
    fetch('/api/voice/stt', { method: 'POST', body: form })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!live) return;
        var said = res.ok && res.d && res.d.success ? String(res.d.text || '').trim() : '';
        if (!said) { setState('listening'); return; }
        setState('speaking'); // we hold the floor until the answer is done
        if (live.opts.onFinal) live.opts.onFinal(said);
      })
      .catch(function () {
        if (!live) return;
        notifyError('stt');
        setState('listening');
      });
  }

  /** The caller says: the answer is finished, take the mic back. */
  function resumeLive() {
    if (!live) return;
    if (live.state === 'listening') return; // already holding the mic open
    setState('listening');
    // A segment is normally already rolling; only reopen if one somehow is not,
    // otherwise we would discard speech captured while we were answering.
    if (!live.rec || live.rec.state !== 'recording') openSegment();
  }

  /** How long a pause has to last before we call the turn finished. */
  function endOfTurnMs() {
    if (!live || !live.heard) return SILENCE_MS;
    var spoken = (live.quietSince || Date.now()) - (live.speechStartedAt || live.startedAt);
    return spoken >= SETTLED_MS ? SILENCE_SETTLED_MS : SILENCE_MS;
  }

  function tick() {
    if (!live) return;
    var level = rms(live.analyser, live.buf);
    if (live.opts.onLevel) live.opts.onLevel(level);

    // A slowly-learned noise floor keeps a humming gym from counting as speech.
    if (level < live.floor) live.floor = live.floor * 0.98 + level * 0.02;

    var now = Date.now();
    var holding = live.state !== 'listening';

    // While we hold the floor our own voice leaks back into the mic, so the bar to
    // interrupt is deliberately higher, and held for longer, than the bar to start
    // talking into silence. Same detector either way — the mic never stops.
    var speechAt = holding ? Math.max(0.05, live.floor * 6) : Math.max(0.018, live.floor * 3.2);
    var needFrames = holding ? BARGE_FRAMES : ONSET_FRAMES;

    if (level > speechAt) {
      live.loud++;
      if (live.loud >= needFrames && !live.heard) {
        live.heard = true;
        live.speechStartedAt = now;
        live.lastVoiceAt = now;
        if (holding) {
          // Barge-in, including while we are still thinking. The words that
          // triggered this are already in the open segment, so nothing is lost.
          shutUp();
          if (live.opts.onBargeIn) live.opts.onBargeIn();
          setState('listening');
        }
        if (live.opts.onHeard) live.opts.onHeard();
      }
      live.quietSince = 0;
    } else {
      live.loud = 0;
      if (live.heard) {
        if (!live.quietSince) live.quietSince = now;
        else if (now - live.quietSince > endOfTurnMs()) { closeSegment(); return; }
      }
    }

    if (live.heard && now - live.startedAt > MAX_SEGMENT_MS) { closeSegment(); return; }

    // Nobody has said anything for two minutes: give the microphone back. Only while
    // listening — never mid-answer — and this is not an opt-out, so one tap resumes.
    if (!holding && now - live.lastVoiceAt > IDLE_END_MS) {
      var onIdle = live.opts.onIdleEnd;
      stopLive();
      if (onIdle) { try { onIdle(); } catch (_) {} }
      return;
    }
    // Rotate an idle recorder only while listening; mid-answer a swap would drop
    // the very speech that is about to interrupt us.
    if (!live.heard && !holding && now - live.startedAt > IDLE_RESTART_MS) { closeSegment(); openSegment(); }
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
    liveState: liveState,
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
    onError: onError,
    isLive: isLive,
  };
})();
