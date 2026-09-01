/**
 * Squad Create — the Create rail on the ScanSquad tab.
 *
 * ElevenLabs-mobile-style flow, in ScanGym dark brand: rail button → bottom
 * sheet → template chips → prompt → settings → Generate → inline preview →
 * native Share. Eight modes share ONE sheet; they differ only by the entry in
 * MODES below (icon, prompt copy, templates, settings schema, backend path).
 * Adding a ninth mode is a config entry, not another sheet.
 *
 * What is actually runnable is a deployment fact, so it is asked for at
 * runtime from /api/squad-create/modes rather than hardcoded here. A mode is
 * only given a working Generate when the server says it has both a route and
 * a provider key; otherwise the sheet renders the same layout with an explicit
 * "not switched on yet" banner and a disabled primary button. The rule is that
 * no control ever claims an action it cannot perform — we shipped the opposite
 * once (settings that were sent nowhere, and a Generate whose body was never
 * parsed), and both looked fine on screen while doing nothing.
 *
 * Placement follows the profile-rail.js lesson: /creator renders its own
 * native right rail in the app bundle, so the buttons are PREPENDED into that
 * rail when it exists and only float when it doesn't.
 *
 * Video mode keeps its full pipeline: settings are whitelisted server-side,
 * history comes from /api/squad-video/history so clips survive a deploy, and
 * remaining daily renders come from that payload rather than from hitting 429.
 */
(function () {
  'use strict';

  var ROUTE = /^\/(creator|scansquad)(\/|$)/;
  var RAIL_ID = 'sg-sv-rail';
  var BTN_ID = 'sg-sv-btn';
  var SHEET_ID = 'sg-sv-sheet';
  var POLL_MS = 4000;

  /**
   * The eight Create modes. `api` mirrors the server's registry; the server is
   * still the authority on whether a mode may be used (see modeStatus).
   *   settings: [{key,label,values,fmt}] — tap a value to cycle it.
   *   summary:  one-line echo of the chosen settings, shown next to the chips.
   */
  var MODES = [
    {
      key: 'text', label: 'Text', icon: '✍️', api: '/api/squad-text',
      title: 'Create text', placeholder: 'What should the post say?',
      gen: '⚡ Generate text', resultKind: 'text',
      templates: [
        { label: '📣 Gym promo', prompt: 'Short punchy Instagram caption for a gym day pass at £5, no membership, friendly and confident' },
        { label: '💬 Member win', prompt: 'Celebrate a member hitting 10 gym visits this month, warm and motivating, 2 short lines' },
      ],
      settings: [
        { key: 'tone', label: 'Tone', values: ['Punchy', 'Friendly', 'Professional'] },
        { key: 'length', label: 'Length', values: ['Short', 'Medium', 'Long'] },
      ],
    },
    {
      key: 'image', label: 'Image', icon: '🖼️', api: null,
      title: 'Create image', placeholder: 'Describe the image…',
      gen: '⚡ Generate image', resultKind: 'image',
      templates: [
        { label: '🏋️ Gym shot', prompt: 'Bright modern gym interior, squat racks, natural light, clean and energetic, vertical' },
        { label: '⚡ £5 poster', prompt: 'Bold poster: "Any gym. £5/day." orange accents on dark background, high contrast, vertical' },
      ],
      settings: [
        { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '1:1', '16:9'] },
        { key: 'style', label: 'Style', values: ['Photo', 'Bold', 'Minimal'] },
      ],
    },
    {
      key: 'video', label: 'Video', icon: '🎬', api: '/api/squad-video',
      title: 'Create video', placeholder: 'Describe your gym video…',
      gen: '⚡ Generate video', resultKind: 'video',
      note: 'Renders in ~1 min · 5 per day · then share straight to your socials',
      templates: [
        { label: '🏋️ Gym tour', prompt: 'Smooth cinematic walkthrough of a modern gym: squat racks, cardio zone, bright clean lighting, energetic people training, upbeat feel, vertical 9:16' },
        { label: '⚡ £5/day promo', prompt: 'High-energy promo: text "Any gym. £5/day. No membership." over fast cuts of people training in different gyms, bold orange accents, vertical 9:16' },
        { label: '🔥 Transformation', prompt: 'Motivational fitness transformation montage: early morning workouts, sweat, determination, sunrise through gym windows, inspiring tone, vertical 9:16' },
      ],
      settings: [
        { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '16:9'] },
        { key: 'durationSeconds', label: 'Duration', values: [4, 6, 8], fmt: function (v) { return v + 's'; } },
        { key: 'resolution', label: 'Resolution', values: ['720p', '1080p'] },
        { key: 'generateAudio', label: 'Generate audio', values: [true, false], fmt: function (v) { return v ? 'On' : 'Off'; } },
      ],
      summary: function (s) {
        return s.aspectRatio + ' · ' + s.durationSeconds + 's · ' + s.resolution + (s.generateAudio ? ' · 🔊' : ' · 🔇');
      },
    },
    {
      key: 'audio', label: 'Audio', icon: '🎙️', api: null,
      title: 'Create audio', placeholder: 'What should the voice say?',
      gen: '⚡ Generate audio', resultKind: 'audio',
      templates: [
        { label: '🎧 Promo read', prompt: 'Upbeat 15-second voiceover: any gym, five pounds a day, no membership, book in the ScanGym app' },
      ],
      settings: [
        { key: 'voice', label: 'Voice', values: ['Coach', 'Calm', 'Hype'] },
        { key: 'length', label: 'Length', values: ['15s', '30s', '60s'] },
      ],
    },
    {
      key: 'music', label: 'Music', icon: '🎵', api: null,
      title: 'Create music', placeholder: 'Describe the track…',
      gen: '⚡ Generate music', resultKind: 'audio',
      templates: [
        { label: '🔥 Hype loop', prompt: 'High-energy gym workout loop, driving drums, confident, 30 seconds' },
      ],
      settings: [
        { key: 'genre', label: 'Genre', values: ['Hype', 'Chill', 'Epic'] },
        { key: 'length', label: 'Length', values: ['15s', '30s', '60s'] },
      ],
    },
    {
      key: 'twin', label: 'Twin', icon: '🧍', api: null,
      title: 'Create twin', placeholder: 'What should your twin say?',
      gen: '⚡ Generate twin', resultKind: 'video',
      templates: [
        { label: '👋 Intro', prompt: 'Friendly piece to camera introducing ScanGym: any gym, £5 a day, no membership' },
      ],
      settings: [
        { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '16:9'] },
        { key: 'length', label: 'Length', values: ['15s', '30s'] },
      ],
    },
    {
      key: 'clipping', label: 'Clipping', icon: '✂️', api: null,
      title: 'Create clips', placeholder: 'Paste a video link to clip…',
      gen: '⚡ Generate clips', resultKind: 'video',
      templates: [
        { label: '📈 Best moments', prompt: 'Find the highest-energy 30 seconds and cut it vertical with captions' },
      ],
      settings: [
        { key: 'clipLength', label: 'Clip length', values: ['15s', '30s', '60s'] },
        { key: 'captions', label: 'Captions', values: [true, false], fmt: function (v) { return v ? 'On' : 'Off'; } },
      ],
    },
    {
      key: 'ugc', label: 'UGC', icon: '📱', api: null,
      title: 'Create UGC', placeholder: 'Describe the UGC ad…',
      gen: '⚡ Generate UGC', resultKind: 'video',
      templates: [
        { label: '🗣️ Testimonial', prompt: 'Selfie-style testimonial: someone trying three different gyms in one week with ScanGym, natural and unscripted' },
      ],
      settings: [
        { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '1:1'] },
        { key: 'style', label: 'Style', values: ['Selfie', 'Studio'] },
      ],
    },
  ];

  function modeByKey(k) {
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === k) return MODES[i];
    return null;
  }

  var modeStatus = null; // server truth: {video:{configured,reason},...}
  var health = null;     // per-mode runtime health, keyed by mode
  var job = null;        // {id, timer}
  var quota = null;

  function toast(m, k, t) { if (typeof window.sgToast === 'function') window.sgToast(m, k || 'info', t || 3000); }

  // ── styles ──────────────────────────────────────────────────────────────
  var css = [
    '#' + RAIL_ID + '{display:flex;flex-direction:column;gap:10px;}',
    '#' + RAIL_ID + '.sv-float{position:fixed;top:96px;right:10px;z-index:8990;max-height:64vh;overflow-y:auto;scrollbar-width:none;}',
    '#' + RAIL_ID + '.sv-float::-webkit-scrollbar{display:none;}',
    '.' + BTN_ID + '{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.' + BTN_ID + ' .sv-circle{position:relative;width:44px;height:44px;border-radius:50%;background:rgba(255,109,0,.18);border:1px solid rgba(255,109,0,.5);backdrop-filter:blur(12px);box-shadow:0 0 14px rgba(255,109,0,.3);display:flex;align-items:center;justify-content:center;font-size:19px;transition:transform .15s;}',
    '.' + BTN_ID + '.sv-off .sv-circle{background:rgba(148,163,184,.14);border-color:rgba(148,163,184,.4);box-shadow:none;}',
    '.' + BTN_ID + ':active .sv-circle{transform:scale(.92);}',
    '.' + BTN_ID + ' .sv-label{font-size:10px;color:#fff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);}',
    '.sv-dot{position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:50%;border:1.5px solid #0b1424;}',
    '.sv-dot.live{background:#22c55e;}',
    '.sv-dot.soon{background:#94a3b8;}',
    '#sg-sv-overlay{position:fixed;inset:0;background:rgba(3,6,12,.6);z-index:9490;opacity:0;transition:opacity .25s;}',
    '#sg-sv-overlay.open{opacity:1;}',
    '#' + SHEET_ID + '{position:fixed;left:0;right:0;bottom:0;max-height:82vh;overflow-y:auto;background:#101a2e;border-radius:20px 20px 0 0;border-top:1px solid #24344f;box-shadow:0 -12px 40px rgba(0,0,0,.6);z-index:9491;padding:10px 16px calc(20px + env(safe-area-inset-bottom,0px));transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);scrollbar-width:none;}',
    '#' + SHEET_ID + '::-webkit-scrollbar{display:none;}',
    '#' + SHEET_ID + '.open{transform:translateY(0);}',
    '.sv-handle{width:38px;height:4px;border-radius:2px;background:#33415c;margin:2px auto 12px;}',
    '.sv-seg{display:flex;gap:4px;overflow-x:auto;background:#0b1424;border-radius:11px;padding:3px;margin-bottom:12px;scrollbar-width:none;}',
    '.sv-seg::-webkit-scrollbar{display:none;}',
    '.sv-seg div{flex:0 0 auto;text-align:center;font-size:12px;color:#7d8ba3;padding:7px 10px;border-radius:9px;font-weight:600;cursor:pointer;white-space:nowrap;}',
    '.sv-seg .on{background:#1e2c47;color:#fff;}',
    '.sv-chips{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;scrollbar-width:none;}',
    '.sv-chips::-webkit-scrollbar{display:none;}',
    '.sv-chip{background:#16233b;border:1px solid #24344f;color:#cbd5e1;font-size:11.5px;padding:7px 11px;border-radius:16px;white-space:nowrap;cursor:pointer;flex-shrink:0;}',
    '.sv-prompt{width:100%;background:#0b1424;border:1px solid #24344f;border-radius:14px;padding:12px;color:#e2e8f0;font-size:13px;min-height:64px;resize:none;font-family:inherit;box-sizing:border-box;}',
    '.sv-prompt:focus{outline:none;border-color:rgba(255,109,0,.5);}',
    '.sv-row{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;}',
    '.sv-mchip{background:#16233b;border:1px solid #24344f;color:#e2e8f0;font-size:11.5px;font-weight:600;padding:8px 11px;border-radius:10px;cursor:pointer;}',
    '.sv-set{display:flex;justify-content:space-between;align-items:center;padding:11px 2px;border-bottom:1px solid #1a2740;color:#e2e8f0;font-size:13px;}',
    '.sv-val{background:#16233b;border:1px solid #24344f;border-radius:9px;padding:5px 10px;font-size:11.5px;color:#cbd5e1;font-weight:600;cursor:pointer;}',
    '.sv-gen{margin-top:14px;width:100%;height:48px;border:none;border-radius:24px;background:linear-gradient(135deg,#FF6D00,#E66200);color:#fff;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 10px 26px rgba(255,109,0,.35);}',
    '.sv-gen:disabled{opacity:.5;box-shadow:none;cursor:not-allowed;background:#1e2c47;}',
    '.sv-note{font-size:11.5px;color:#94a3b8;text-align:center;margin-top:10px;line-height:1.45;}',
    '.sv-warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:10px 12px;color:#fbbf24;font-size:12px;margin-bottom:10px;line-height:1.45;}',
    '.sv-video{width:100%;border-radius:14px;margin-top:12px;background:#000;max-height:52vh;}',
    '.sv-prog{display:flex;align-items:center;gap:10px;margin-top:14px;color:#cbd5e1;font-size:12.5px;}',
    '.sv-spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.2);border-top-color:#FF6D00;border-radius:50%;animation:svspin .7s linear infinite;flex-shrink:0;}',
    '@keyframes svspin{to{transform:rotate(360deg)}}',
  ].join('');

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ── per-mode settings state ─────────────────────────────────────────────
  var state = {};
  MODES.forEach(function (m) {
    state[m.key] = {};
    (m.settings || []).forEach(function (st) { state[m.key][st.key] = st.values[0]; });
  });
  // Video defaults match what the server whitelists as its defaults.
  state.video.durationSeconds = 8;
  state.video.generateAudio = true;

  function cycle(mode, setting) {
    var vals = setting.values;
    var i = vals.indexOf(state[mode.key][setting.key]);
    state[mode.key][setting.key] = vals[(i + 1) % vals.length];
  }

  function shown(mode, setting) {
    var v = state[mode.key][setting.key];
    return setting.fmt ? setting.fmt(v) : String(v);
  }

  /** A mode is usable only if the server says it is configured. */
  function isConfigured(mode) {
    if (!modeStatus) return false;
    var s = modeStatus[mode.key];
    return !!(s && s.configured);
  }

  function reasonText(mode) {
    var s = modeStatus && modeStatus[mode.key];
    var why = s && s.reason;
    if (why === 'not_built') return 'This mode is not built yet.';
    if (why === 'no_provider') return 'This mode has no provider key on this deployment yet.';
    return 'This mode is not switched on yet.';
  }

  // ── sheet ───────────────────────────────────────────────────────────────
  function openSheet(mode) {
    closeSheet();
    var ov = el('div', '', '');
    ov.id = 'sg-sv-overlay';
    ov.addEventListener('click', closeSheet);
    document.body.appendChild(ov);

    var sh = el('div');
    sh.id = SHEET_ID;
    sh.setAttribute('data-mode', mode.key);
    sh.appendChild(el('div', 'sv-handle'));

    // mode switcher — every mode reachable from every sheet
    var seg = el('div', 'sv-seg');
    MODES.forEach(function (m) {
      var d = el('div', m.key === mode.key ? 'on' : '', m.icon + ' ' + m.label);
      if (m.key !== mode.key) d.addEventListener('click', function () { openSheet(m); });
      seg.appendChild(d);
    });
    sh.appendChild(seg);

    var warn = el('div', 'sv-warn');
    warn.id = 'sv-warn';
    warn.style.display = 'none';
    sh.appendChild(warn);

    var chips = el('div', 'sv-chips');
    (mode.templates || []).forEach(function (t) {
      var c = el('div', 'sv-chip', t.label);
      c.addEventListener('click', function () { sh.querySelector('.sv-prompt').value = t.prompt; });
      chips.appendChild(c);
    });
    sh.appendChild(chips);

    var ta = el('textarea', 'sv-prompt');
    ta.placeholder = mode.placeholder;
    sh.appendChild(ta);

    var row = el('div', 'sv-row');
    var setChip = el('div', 'sv-mchip', '⚙ Settings ›');
    setChip.addEventListener('click', function () { toggleSettings(sh); });
    row.appendChild(setChip);
    var summary = el('div', 'sv-mchip');
    summary.id = 'sv-summary';
    summary.style.cssText = 'background:transparent;border:none;color:#7d8ba3;padding-left:0;cursor:default;';
    row.appendChild(summary);
    sh.appendChild(row);

    var settings = el('div');
    settings.id = 'sv-settings';
    settings.style.display = 'none';
    (mode.settings || []).forEach(function (st) {
      var line = el('div', 'sv-set');
      line.appendChild(el('span', '', st.label));
      var val = el('span', 'sv-val', shown(mode, st));
      val.addEventListener('click', function () {
        cycle(mode, st);
        val.textContent = shown(mode, st);
        refreshSummary(sh, mode);
      });
      line.appendChild(val);
      settings.appendChild(line);
    });
    sh.appendChild(settings);

    var gen = el('button', 'sv-gen', mode.gen);
    gen.id = 'sv-gen';
    gen.disabled = true; // stays disabled until the server says the mode can run
    gen.addEventListener('click', function () { startJob(sh, ta, gen, mode); });
    sh.appendChild(gen);

    var out = el('div');
    out.id = 'sv-out';
    sh.appendChild(out);

    var note = el('div', 'sv-note', mode.note || '');
    note.id = 'sv-note';
    sh.appendChild(note);

    var hist = el('div', 'sv-note');
    hist.id = 'sv-history';
    sh.appendChild(hist);

    refreshSummary(sh, mode);
    document.body.appendChild(sh);
    requestAnimationFrame(function () { ov.classList.add('open'); sh.classList.add('open'); });

    gateSheet(sh, mode);
  }

  /**
   * Decide whether this sheet gets a working Generate. Order matters: the
   * server's mode registry first (is it even built and keyed?), then the
   * mode's own /health for runtime truth, then the daily quota.
   */
  function gateSheet(sh, mode) {
    var warn = sh.querySelector('#sv-warn');
    var gen = sh.querySelector('#sv-gen');

    loadModes().then(function () {
      if (!isConfigured(mode)) {
        gen.disabled = true;
        gen.textContent = '🔒 Not switched on yet';
        warn.style.display = 'block';
        warn.innerHTML = '⏳ <b>' + mode.label + '</b> — ' + reasonText(mode) +
          ' The controls above are a preview of the flow. <b>440+ ready-to-post clips</b> are in your ScanSquad library.';
        return;
      }
      if (!mode.api) return;
      loadHistory(sh, mode);
      fetch(mode.api + '/health').then(function (r) { return r.json(); }).then(function (d) {
        health = d;
        if (d.quota) { quota = d.quota; refreshQuota(sh, mode); }
        if (!d.available) {
          gen.disabled = true;
          warn.style.display = 'block';
          warn.innerHTML = '⏳ ' + mode.label + ' rendering is still being switched on for this account (' +
            (d.reason || 'unavailable') + '). Meanwhile: <b>440+ ready-to-post clips</b> are in your ScanSquad library below.';
          return;
        }
        if (quota && quota.remaining <= 0) {
          gen.disabled = true;
          warn.style.display = 'block';
          warn.innerHTML = '\u23f3 You have used all <b>' + quota.limit + '</b> renders for today. Fresh batch tomorrow — or grab one of the ready-to-post clips in your library below.';
          return;
        }
        gen.disabled = false;
      }).catch(function () {
        gen.disabled = true;
        warn.style.display = 'block';
        warn.innerHTML = '⚠️ Could not reach the ' + mode.label.toLowerCase() + ' service just now — try again in a moment.';
      });
    });
  }

  /** Cached: the registry is a deployment fact, it will not change mid-session. */
  function loadModes() {
    if (modeStatus) return Promise.resolve(modeStatus);
    return fetch('/api/squad-create/modes')
      .then(function (r) { return r.json(); })
      .then(function (d) { modeStatus = (d && d.modes) || {}; return modeStatus; })
      .catch(function () { modeStatus = {}; return modeStatus; });
  }

  function toggleSettings(sh) {
    var m = sh.querySelector('#sv-settings');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }

  function refreshSummary(sh, mode) {
    var n = sh.querySelector('#sv-summary');
    if (!n) return;
    if (mode.summary) { n.textContent = mode.summary(state[mode.key]); return; }
    n.textContent = (mode.settings || []).map(function (st) { return shown(mode, st); }).join(' · ');
  }

  function refreshQuota(sh, mode) {
    var n = sh.querySelector('#sv-note');
    if (!n || !quota || !mode.note) return;
    n.textContent = 'Renders in ~1 min · ' + quota.remaining + ' of ' + quota.limit +
      ' left today · then share straight to your socials';
  }

  function closeSheet() {
    var ov = document.getElementById('sg-sv-overlay');
    var sh = document.getElementById(SHEET_ID);
    if (ov) ov.remove();
    if (sh) sh.remove();
    if (job && job.timer) { clearInterval(job.timer); job = null; }
  }

  // ── generation ──────────────────────────────────────────────────────────
  function startJob(sh, ta, gen, mode) {
    if (!isConfigured(mode) || !mode.api) return; // belt and braces: never fire a dead mode
    var prompt = (ta.value || '').trim();
    if (!prompt) { toast('Describe it first — or tap a template.', 'info', 2500); return; }
    gen.disabled = true;
    var out = sh.querySelector('#sv-out');
    out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span>Sending…</span></div>';

    var body = { prompt: prompt };
    (mode.settings || []).forEach(function (st) { body[st.key] = state[mode.key][st.key]; });

    fetch(mode.api + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.error || 'could not start');
        // Some modes finish inside the request (text is a couple of seconds, not
        // a minute), and answer with the result instead of a job to poll. A job
        // id for something already finished would be state we invent and then
        // have to keep across instances.
        if (res.d.text) {
          showText(out, res.d.text);
          gen.disabled = false;
          return;
        }
        if (!res.d.jobId) throw new Error(res.d.error || 'could not start');
        if (res.d.quota) { quota = res.d.quota; refreshQuota(sh, mode); }
        var start = Date.now();
        out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span id="sv-prog-t">Rendering… usually under a minute.</span></div>';
        job = { id: res.d.jobId };
        job.timer = setInterval(function () {
          fetch(mode.api + '/status/' + job.id).then(function (r) { return r.json(); }).then(function (st) {
            if (st.status === 'done') {
              clearInterval(job.timer);
              showResult(out, st.videoUrl || st.url, mode);
              gen.disabled = false;
            } else if (st.status === 'error') {
              clearInterval(job.timer);
              out.innerHTML = '<div class="sv-warn">❌ ' + (st.error || 'Generation failed.') + '</div>';
              gen.disabled = false;
            } else {
              var t = document.getElementById('sv-prog-t');
              if (t) t.textContent = 'Rendering… ' + Math.round((Date.now() - start) / 1000) + 's';
              if (Date.now() - start > 300000) { // 5 min: stop hammering
                clearInterval(job.timer);
                out.innerHTML = '<div class="sv-warn">⏳ Still rendering server-side — reopen Create in a minute.</div>';
                gen.disabled = false;
              }
            }
          }).catch(function () {});
        }, POLL_MS);
      })
      .catch(function (e) {
        out.innerHTML = '<div class="sv-warn">❌ ' + e.message + '</div>';
        gen.disabled = false;
      });
  }

  /** A caption is read, copied and pasted — not played. */
  function showText(out, text) {
    out.innerHTML = '';
    var box = el('div', 'sv-textout');
    box.textContent = text;
    box.style.cssText = 'white-space:pre-wrap;text-align:left;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px;margin-top:12px;color:#f1f5f9;font-size:15px;line-height:1.5;';
    out.appendChild(box);

    var row = el('div', 'sv-row');
    var copy = el('div', 'sv-mchip', '📋 Copy');
    copy.style.cssText = 'background:linear-gradient(135deg,#FF6D00,#E66200);border:none;color:#fff;';
    copy.addEventListener('click', function () {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(function () { toast('Copied — paste it anywhere.', 'success', 2500); });
      } else {
        var r = document.createRange(); r.selectNodeContents(box);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
        try { document.execCommand('copy'); toast('Copied — paste it anywhere.', 'success', 2500); } catch (e) {}
      }
    });
    row.appendChild(copy);
    var share = el('div', 'sv-mchip', '📤 Share');
    share.addEventListener('click', function () {
      if (navigator.share) navigator.share({ text: text }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { toast('Copied — paste it anywhere.', 'success', 2500); });
    });
    row.appendChild(share);
    out.appendChild(row);
  }

  function showResult(out, url, mode) {
    if (!url) return;
    out.innerHTML = '';
    if (mode.resultKind === 'image') {
      var img = document.createElement('img');
      img.className = 'sv-video';
      img.src = url;
      out.appendChild(img);
    } else if (mode.resultKind === 'audio') {
      var au = document.createElement('audio');
      au.src = url; au.controls = true; au.style.width = '100%'; au.style.marginTop = '12px';
      out.appendChild(au);
    } else {
      var v = document.createElement('video');
      v.className = 'sv-video';
      v.src = url;
      v.controls = true; v.muted = true; v.autoplay = true; v.playsInline = true;
      out.appendChild(v);
    }
    var row = el('div', 'sv-row');
    var share = el('div', 'sv-mchip', '📤 Share');
    share.style.cssText = 'background:linear-gradient(135deg,#FF6D00,#E66200);border:none;color:#fff;';
    share.addEventListener('click', function () {
      var abs = url.indexOf('http') === 0 ? url : location.origin + url;
      if (navigator.share) {
        navigator.share({ title: 'My ScanGym clip', text: 'Made with ScanGym — any gym, £5/day.', url: abs }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(abs).then(function () { toast('Link copied!', 'success', 2500); });
      }
    });
    row.appendChild(share);
    var dl = el('a', 'sv-mchip', '⬇ Download');
    dl.href = url;
    dl.download = 'scangym-clip';
    dl.style.textDecoration = 'none';
    row.appendChild(dl);
    out.appendChild(row);
  }

  // ── history ─────────────────────────────────────────────────────────────
  function loadHistory(sh, mode) {
    if (!mode.api || mode.resultKind === 'text') return; // captions are not stored

    fetch(mode.api + '/history').then(function (r) { return r.json(); }).then(function (d) {
      if (d.quota) { quota = d.quota; refreshQuota(sh, mode); }
      var box = sh.querySelector('#sv-history');
      if (!box) return;
      var done = (d.jobs || []).filter(function (j) { return j.status === 'done' && j.video_url; });
      if (!done.length) { box.textContent = ''; return; }
      box.innerHTML = '';
      var head = el('div', '', 'Your recent clips');
      head.style.cssText = 'margin:14px 0 6px;color:#cbd5e1;font-weight:700;text-align:left;';
      box.appendChild(head);
      done.slice(0, 6).forEach(function (j) {
        var a = el('div', 'sv-set');
        a.style.cursor = 'pointer';
        var label = (j.prompt || 'Clip').slice(0, 38) + ((j.prompt || '').length > 38 ? '…' : '');
        a.appendChild(el('span', '', label));
        a.appendChild(el('span', 'sv-val', '▶ Play'));
        a.addEventListener('click', function () { showResult(sh.querySelector('#sv-out'), j.video_url, mode); });
        box.appendChild(a);
      });
    }).catch(function () {});
  }

  // ── rail placement (native-rail-first, profile-rail.js lesson) ──────────
  function nativeRail() {
    var els = document.querySelectorAll('div[style*="flex-direction:column"]');
    for (var i = 0; i < els.length; i++) {
      var st = els[i].getAttribute('style') || '';
      if (/right:\s*(6|8|10|12|14|16)px/.test(st) && /top:\s*50%/.test(st) && els[i].getClientRects().length && !els[i].closest('#' + SHEET_ID)) return els[i];
    }
    return null;
  }

  function makeBtn(mode) {
    var b = el('div', BTN_ID);
    b.setAttribute('data-mode', mode.key);
    var live = isConfigured(mode);
    if (!live) b.classList.add('sv-off');
    b.innerHTML = '<div class="sv-circle"><span class="sv-dot ' + (live ? 'live' : 'soon') + '"></span>' +
      mode.icon + '</div><div class="sv-label">' + mode.label + '</div>';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openSheet(mode); });
    return b;
  }

  function makeRail(floating) {
    var r = el('div');
    r.id = RAIL_ID;
    if (floating) r.classList.add('sv-float');
    MODES.forEach(function (m) { r.appendChild(makeBtn(m)); });
    return r;
  }

  /** Repaint the live/soon dots once the server registry lands. */
  function paintDots() {
    var r = document.getElementById(RAIL_ID);
    if (!r || !modeStatus) return;
    MODES.forEach(function (m) {
      var b = r.querySelector('.' + BTN_ID + '[data-mode="' + m.key + '"]');
      if (!b) return;
      var live = isConfigured(m);
      b.classList.toggle('sv-off', !live);
      var dot = b.querySelector('.sv-dot');
      if (dot) dot.className = 'sv-dot ' + (live ? 'live' : 'soon');
    });
  }

  function sync() {
    var on = ROUTE.test(location.pathname);
    var rail = document.getElementById(RAIL_ID);
    if (!on) {
      if (rail) rail.remove();
      closeSheet();
      return;
    }
    var host = nativeRail();
    if (host) {
      if (rail && (rail.parentNode !== host || rail.classList.contains('sv-float'))) { rail.remove(); rail = null; }
      if (!rail) { host.insertBefore(makeRail(false), host.firstChild); paintDots(); }
    } else {
      if (rail && !rail.classList.contains('sv-float')) { rail.remove(); rail = null; }
      if (!rail) { document.body.appendChild(makeRail(true)); paintDots(); }
    }
  }

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    window.addEventListener('popstate', sync);
    setInterval(sync, 800);
    sync();
    loadModes().then(paintDots);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
