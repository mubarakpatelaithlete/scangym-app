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
    speaking = false;
  }

  window.SGVoice = {
    ready: ready,
    listen: listen,
    stopListening: stopListening,
    isListening: isListening,
    speak: speak,
    shutUp: shutUp,
    isSpeaking: function () { return speaking; },
    canRecord: canRecord,
  };
})();
