/**
 * Squad Create — the Create rail on the ScanSquad tab.
 *
 * ElevenLabs-mobile-style flow, in ScanGym dark brand: rail button → bottom
 * sheet → template chips → prompt → settings → Generate → inline preview →
 * native Share. Nine modes share ONE sheet; they differ only by the entry in
 * MODES below (icon, prompt copy, templates, settings schema, backend path).
 * Adding a tenth mode is a config entry, not another sheet.
 *
 * Edit is the one mode that also takes a *video in*: its entry sets
 * `needsSource`, which adds the source row (paste a link, or tap a clip you
 * already made) above the prompt. That is the only structural difference.
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
   * The nine Create modes. `api` mirrors the server's registry; the server is
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
        /* Live web results, off by default and priced in the label: a search
           costs about £0.02 against a caption's £0.001, so a creator should
           see the trade before tapping it, not on a bill. Needs one of the
           named models — the house writer cannot search, and the route says so
           rather than quietly writing without it. */
        { key: 'webSearch', label: 'Web search', values: [false, true], fmt: function (v) { return v ? 'On · ~£0.02' : 'Off'; } },
      ],
    },
    {
      key: 'image', label: 'Image', icon: '🖼️', api: '/api/squad-image',
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
      key: 'audio', label: 'Audio', icon: '🎙️', api: '/api/squad-audio',
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
      key: 'music', label: 'Music', icon: '🎵', api: '/api/squad-music',
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
      /* The one mode whose input is a clip, not only a prompt: `needsSource`
         adds the source row above the prompt and nothing else in the sheet
         changes. Which edit you get (restyle, reframe, dub, sound, extend) is
         the model chip — the server prices and names them. */
      key: 'edit', label: 'Edit', icon: '🎞️', api: '/api/squad-edit',
      title: 'Edit video', placeholder: 'What should change in the clip?',
      gen: '⚡ Edit video', resultKind: 'video', needsSource: true,
      note: 'Pick a clip, say what to change · billed per second of the clip',
      templates: [
        { label: '📱 Make it vertical', prompt: 'Reframe to 9:16 for Reels, keep the person centred' },
        { label: '🔤 Add a caption bar', prompt: 'Add a bold caption bar reading "Any gym. £5/day." in orange at the bottom' },
        { label: '🌅 Brighter gym', prompt: 'Make the gym look brighter and cleaner, warmer light, same action' },
      ],
      settings: [
        { key: 'sourceSeconds', label: 'Clip length', values: [5, 8, 10, 15, 30], fmt: function (v) { return v + 's'; } },
        { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '1:1', '16:9'] },
        { key: 'resolution', label: 'Resolution', values: ['720p', '1080p'] },
        { key: 'language', label: 'Dub into', values: ['Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Hindi', 'Arabic', 'Polish', 'English'] },
      ],
      summary: function (s) { return s.sourceSeconds + 's · ' + s.aspectRatio + ' · ' + s.resolution; },
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
  var budget = null;     // {signedIn,tier,dailyUsd,remainingUsd} — one allowance for every mode
  /* Card on file, what is owed, whether Create is paused: /api/squad-billing/status */
  var billing = null;
  var serverTemplates = null; // /api/squad-create/templates, so a better opener needs no deploy
  var shareInfo = null;  // {refLink, shareText} — a share has to carry the link that earns

  /**
   * The seconds this model will really render.
   *
   * Mirrors squad-video.js#effectiveSeconds. The sheet offers 4s, 6s and 8s;
   * WAN 2.5 and Kling only accept 5s or 10s, so the route rounds up and bills
   * the longer clip. Showing the 4s the creator tapped, at the 4s price, was a
   * quote the invoice then disagreed with.
   */
  function billedSeconds(durations, picked) {
    if (!durations || !durations.length) return picked;
    for (var i = 0; i < durations.length; i++) if (durations[i] >= picked) return durations[i];
    return durations[durations.length - 1];
  }

  // ── Voice preview ────────────────────────────────────────────────────────
  var previewAudio = null;
  function stopPreview() {
    if (previewAudio) { try { previewAudio.pause(); } catch (e) {} previewAudio = null; }
  }
  function playVoicePreview(btn, voice) {
    stopPreview();
    var label = btn.textContent;
    btn.textContent = '\u2026';
    fetch('/api/squad-audio/preview?voice=' + encodeURIComponent(voice))
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        btn.textContent = label;
        if (!res.ok || !res.d.url) { toast(res.d.error || 'Could not play that voice', 'info', 3000); return; }
        previewAudio = new Audio(res.d.url);
        previewAudio.play().catch(function () { toast('Tap again to play', 'info', 2000); });
      })
      .catch(function () { btn.textContent = label; toast('Could not play that voice', 'info', 3000); });
  }

  function pence(p) {
    if (p == null) return '';
    return p < 100 ? Math.round(p) + 'p' : '\u00a3' + (p / 100).toFixed(2);
  }

  function gbp(usd) {
    if (usd == null) return '';
    var v = usd * 0.79;
    return v < 1 ? Math.round(v * 100) + 'p' : '£' + v.toFixed(2);
  }

  /** Mirrors lib/gen-eta.js#phrase so the sheet and the server say the same thing. */
  function phrase(seconds) {
    if (seconds == null) return 'any moment now';
    if (seconds < 45) return 'about ' + Math.max(5, Math.round(seconds / 5) * 5) + ' seconds';
    if (seconds / 60 < 1.5) return 'about a minute';
    return 'about ' + Math.round(seconds / 60) + ' minutes';
  }

  /* Records that a creator downloaded or shared something. These counts used to
     live in localStorage, where they died with the phone and could not feed the
     tier ladder that decides who earns what. Fire and forget: a failed count
     must never interrupt a share. */
  function logEvent(assetId, action, assetKind) {
    if (!assetId) return;
    try {
      fetch('/api/squad-create/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: assetId, action: action, assetKind: assetKind || 'generated' }),
      }).catch(function () {});
    } catch (e) {}
  }

  function toast(m, k, t) { if (typeof window.sgToast === 'function') window.sgToast(m, k || 'info', t || 3000); }

  // ── styles ──────────────────────────────────────────────────────────────
  var css = [
    '#' + RAIL_ID + '{display:flex;flex-direction:column;gap:10px;}',
    /* Geometry (top/right/bottom/max-height) lives in rails.css — a second
       opinion here is what let this column land on the card rail. */
    '#' + RAIL_ID + '.sv-float{position:fixed;z-index:8990;}',
    '#' + RAIL_ID + '.sv-float::-webkit-scrollbar{display:none;}',
    '.' + BTN_ID + '{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    // One circle, one-button.css's, read through var(). This button used to be
    // orange-tinted with an orange glow, which read as the primary action of a
    // screen where it is not one, and took the orange that one-orange.css
    // reserves for the voice pill. The live/soon dot below still carries the
    // state the tint was pretending to carry.
    '.' + BTN_ID + ' .sv-circle{position:relative;width:var(--sg-btn-size,44px);height:var(--sg-btn-size,44px);border-radius:50%;background:var(--sg-btn-bg,rgba(0,0,0,.40));border:var(--sg-btn-border-width,1.5px) solid var(--sg-btn-border-color,rgba(255,255,255,.12));backdrop-filter:var(--sg-btn-blur,blur(12px));-webkit-backdrop-filter:var(--sg-btn-blur,blur(12px));box-shadow:var(--sg-btn-shadow,0 2px 10px rgba(0,0,0,.25));display:flex;align-items:center;justify-content:center;font-size:var(--sg-btn-icon,20px);color:#fff;transition:transform .15s;}',
    // The icon itself, same drawing set and same 20px as every other rail: the
    // eight modes used to be colour emoji, which is why this row still looked
    // unlike Share and Save once the circles already matched.
    '.' + BTN_ID + ' .sv-circle svg{width:var(--sg-btn-icon,20px);height:var(--sg-btn-icon,20px);display:block;}',
    '.' + BTN_ID + ' .sv-circle .sv-gif{width:calc(var(--sg-btn-icon,20px) + 8px);height:calc(var(--sg-btn-icon,20px) + 8px);display:block;object-fit:contain;}',
    '.' + BTN_ID + '.sv-off .sv-circle{opacity:.55;}',
    '.' + BTN_ID + ':active .sv-circle{transform:scale(.92);}',
    '.' + BTN_ID + ' .sv-label{font-size:10px;color:#fff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);}',
    '.sv-dot{position:absolute;top:1px;right:1px;width:8px;height:8px;border-radius:50%;border:1.5px solid #0b1424;}',
    '.sv-dot.live{background:#22c55e;}',
    '.sv-dot.soon{background:#94a3b8;}',
    /* Half-screen sheet (owner, 2026-09-30): every button on Create opens a
       sheet from the bottom — the grid stays visible dimmed behind it, ← goes
       back to it, the red ✕ and a swipe down close it, and so does the phone's
       back button. Same shape as the chat sheet and sg-half-sheet.js. */
    '#sg-sv-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9490;}',
    '#' + SHEET_ID + '{position:fixed;left:0;right:0;bottom:var(--sg-tab-height,56px);max-height:70vh;overflow-y:auto;background:linear-gradient(to top,rgba(8,10,18,.95) 0%,rgba(8,10,18,.82) 60%,rgba(8,10,18,.6) 100%);border-radius:22px 22px 0 0;box-shadow:0 -10px 40px rgba(0,0,0,.6);z-index:9491;padding:0 16px calc(20px + env(safe-area-inset-bottom,0px));will-change:transform;transform:translateY(105%);transition:transform .2s cubic-bezier(.32,.72,0,1);scrollbar-width:none;box-sizing:border-box;}',
    '#' + SHEET_ID + '::-webkit-scrollbar{display:none;}',
    '#' + SHEET_ID + '.open{transform:translateY(0);}',
    '.sv-step-hidden{display:none !important;}',
    '.sv-done{margin-top:16px;}',
    '.sv-handle{width:44px;height:5px;border-radius:3px;background:rgba(255,255,255,.28);margin:10px auto 8px;}',
    '.sv-x{width:36px;height:36px;border-radius:50%;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.45);color:#ef4444;font-size:22px;line-height:34px;text-align:center;cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent;}',
    '.sv-head{display:flex;align-items:center;gap:12px;margin:0 0 14px;}',
    '.sv-back{width:36px;height:36px;border-radius:50%;background:#141b2b;border:1px solid #223050;color:#e5e7eb;font-size:20px;line-height:34px;text-align:center;cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent;}',
    '.sv-head-t{flex:1;min-width:0;}',
    '.sv-head-t b{display:block;font-size:19px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.2px;}',
    '.sv-head-t span{display:block;font-size:12.5px;color:#c3cddc;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.sv-head-t span i{font-style:normal;color:#FF6D00;font-weight:700;}',
    '.sv-kind{font-size:9.5px;font-weight:800;letter-spacing:.6px;padding:4px 8px;border-radius:6px;background:rgba(255,255,255,.08);border:1px solid #223050;color:#cbd5e1;text-transform:uppercase;flex:0 0 auto;}',
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
    '.sv-next{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;padding-bottom:2px;}',
    '.sv-next::-webkit-scrollbar{display:none;}',
    '.sv-next .sv-mchip{flex:0 0 auto;white-space:nowrap;}',
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
  // Edit defaults mirror the server's whitelist defaults (routes/squad-edit.js).
  state.edit.sourceSeconds = 8;

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

  /* A control that apologises is still a control. Modes the server reports as
   * `not_built` have no backend at all and never will on this deployment, so
   * they are hidden from the rail and the switcher instead of shown locked.
   * Before /modes lands (modeStatus null) nothing is hidden — a mode is only
   * removed on server truth, never guessed. */
  function isHidden(mode) {
    var s = modeStatus && modeStatus[mode.key];
    return !!(s && !s.configured && s.reason === 'not_built');
  }

  function visibleModes() {
    return MODES.filter(function (m) { return !isHidden(m); });
  }

  function reasonText(mode) {
    var s = modeStatus && modeStatus[mode.key];
    var why = s && s.reason;
    if (why === 'not_built') return 'This mode is not built yet.';
    if (why === 'no_provider') return 'This mode has no provider key on this deployment yet.';
    return 'This mode is not switched on yet.';
  }

  // ── sheet ───────────────────────────────────────────────────────────────
  /* The back button used to leave ScanSquad — leave the app, in fact — instead
     of closing this sheet, because the sheet was never a history entry. It is
     one now: back closes Create and lands the creator back on the tab they
     opened it from, which is what every phone user expects and what Uber,
     Airbnb and Booking all do on mobile web. @see frontend/public/sg-sheets.js
     for the same treatment of the booking sheets. */
  var sheetEntry = false;

  function pushSheetEntry() {
    if (sheetEntry) return;
    sheetEntry = true;
    try { history.pushState({ sgCreateSheet: 1 }, '', location.href); } catch (e) {}
  }

  /* The one place the model grid is opened from here: "Change model ›" on the
     page. create-studio.js owns the grid; we only ask for it, filtered to this
     type, with the creator's prompt kept in state[mode].__prompt. */
  /* Task 103: upload a photo / clip from the phone → https URL every model can read. */
  function uploadRef(accept, done) {
    var f = document.createElement('input');
    f.type = 'file'; f.accept = accept;
    f.addEventListener('change', function () {
      var file = f.files && f.files[0];
      if (!file) return;
      if (file.size > 25 * 1024 * 1024) { toast('Max 25 MB', 'info', 2500); return; }
      toast('Uploading\u2026', 'info', 1500);
      var fd = new FormData(); fd.append('file', file);
      fetch('/api/squad-image/upload', { method: 'POST', credentials: 'include', body: fd })
        .then(function (r) { return r.json().then(function (j) { if (r.status === 401) throw new Error('Sign in to upload'); if (!r.ok) throw new Error(j.error || 'Upload failed'); return j; }); })
        .then(function (j) { done(j.url); })
        .catch(function (e) { toast(e.message, 'info', 3000); });
    });
    f.click();
  }

  /* Higgsfield-style slots under the prompt: Reference (image), Start + End frame (video). */
  function renderFrames(sh, mode) {
    var box = sh.querySelector('#sv-frames');
    if (!box) return;
    var st = state[mode.key];
    var slots = mode.key === 'image' ? [['__ref', '\uD83D\uDCCE Reference image']]
      : mode.key === 'video' ? [['__start', '\uD83D\uDDBC\uFE0F Start frame'], ['__end', '\uD83C\uDFC1 End frame']] : [];
    box.innerHTML = '';
    Array.prototype.forEach.call(sh.querySelectorAll('.sv-ref'), function (n) { n.remove(); });
    slots.forEach(function (sl) {
      var key = sl[0], url = st[key];
      var c = el('div', 'sv-chip');
      c.style.cssText = 'display:inline-flex;align-items:center;gap:6px;';
      if (url) {
        c.innerHTML = '<img alt="" src="' + url + '" style="width:28px;height:28px;border-radius:6px;object-fit:cover"><span>' + sl[1].replace(/^\S+ /, '') + '</span><b style="margin-left:2px">\u2715</b>';
        c.addEventListener('click', function () { st[key] = null; renderFrames(sh, mode); });
      } else {
        c.textContent = '+ ' + sl[1];
        c.addEventListener('click', function () {
          if (key === '__end' && !st.__start) { toast('Add a start frame first', 'info', 2500); return; }
          uploadRef('image/*', function (u) { st[key] = u; renderFrames(sh, mode); toast(mode.key === 'video' ? 'Frame added \u00b7 renders with Veo 3.1 Fast' : 'Reference added \u00b7 your image follows it', 'info', 2500); });
        });
      }
      box.appendChild(c);
    });
  }

  function promptHistory(key) {
    try { var l = JSON.parse(localStorage.getItem('sg_prompt_hist_' + key) || '[]'); return Array.isArray(l) ? l : []; } catch (e) { return []; }
  }
  function rememberPrompt(key, p) {
    p = String(p || '').trim(); if (!p) return;
    var l = promptHistory(key).filter(function (x) { return x !== p; }); l.unshift(p);
    try { localStorage.setItem('sg_prompt_hist_' + key, JSON.stringify(l.slice(0, 10))); } catch (e) {}
  }

  function openGrid(mode) {
    var sh = document.getElementById(SHEET_ID);
    var ta = sh && sh.querySelector('.sv-prompt');
    if (ta) state[mode.key].__prompt = ta.value;
    closeSheet();
    if (window.sgCreateStudio && typeof window.sgCreateStudio.show === 'function') window.sgCreateStudio.show(mode.key);
  }

  function openSheet(mode) {
    closeSheet();
    pushSheetEntry();

    var sh = el('div');
    sh.id = SHEET_ID;
    sh.setAttribute('data-mode', mode.key);

    /* Page header: ← back · model name · role + price · type badge. The model
       line is filled by renderModelPicker once /health answers; until then it
       carries the mode. Type tabs used to live here — they are the grid's job. */
    var head = el('div', 'sv-head');
    var back = el('div', 'sv-back', '\u2190');
    back.setAttribute('role', 'button'); back.setAttribute('aria-label', 'Back');
    back.addEventListener('click', function () { if (sh.__step) exitSettings(sh, mode); else closeSheet(); });
    head.appendChild(back);
    var ht = el('div', 'sv-head-t', '<b id="sv-head-name">' + mode.label + '</b><span id="sv-head-sub">' + (mode.gen || '') + '</span>');
    head.appendChild(ht);
    head.appendChild(el('div', 'sv-kind', mode.label));
    var x = el('div', 'sv-x', '\u00d7');
    x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', function () { closeSheet(); });
    head.appendChild(x);
    sh.appendChild(el('div', 'sv-handle'));
    sh.appendChild(head);

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
    if (state[mode.key].__prompt) { ta.value = state[mode.key].__prompt; state[mode.key].__prompt = ''; } // back from "Change model": the idea survives the trip
    sh.appendChild(ta);
    /* Batch 5 (Tasks 112/120): Higgsfield-style prompt counter + one-tap Clear. */
    var cnt = el('div', 'sv-count');
    cnt.id = 'sv-count';
    cnt.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;font-size:11px;color:rgba(255,255,255,.5);margin:2px 2px 0';
    var cntN = el('span', '', '0 characters'), clr = el('span', '', '\u2715 Clear');
    clr.setAttribute('role', 'button'); clr.style.cursor = 'pointer';
    clr.addEventListener('click', function () { ta.value = ''; upd(); ta.focus(); });
    cnt.appendChild(cntN); cnt.appendChild(clr);
    function upd() { var n = ta.value.length; cntN.textContent = n + (n === 1 ? ' character' : ' characters'); clr.style.visibility = n ? 'visible' : 'hidden'; }
    ta.addEventListener('input', upd); upd();
    sh.appendChild(cnt);

    /* Task 120 step 1: ✨ Enhance (Higgsfield / CapCut / ElevenLabs) + 🎲 Surprise me. */
    var tools = el('div', 'sv-row sv-ptools');
    tools.style.cssText = 'display:flex;gap:8px;margin:6px 0 2px';
    var enh = el('div', 'sv-chip', '\u2728 Enhance prompt');
    enh.setAttribute('role', 'button');
    enh.addEventListener('click', function () {
      var idea = ta.value.trim();
      if (idea.length < 2) { ta.focus(); ta.placeholder = 'Type a short idea, then tap \u2728 Enhance'; return; }
      if (enh.dataset.busy) return; enh.dataset.busy = '1'; enh.textContent = '\u2728 Enhancing\u2026';
      fetch('/api/squad-image/enhance', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: idea, kind: mode.key === 'video' ? 'video' : (mode.key === 'image' ? 'image' : 'audio') }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Could not enhance'); return j; }); })
        .then(function (j) { ta.dataset.before = idea; ta.value = j.prompt; undo.style.display = ''; })
        .catch(function (e) { enh.textContent = '\u26A0\uFE0F ' + e.message; setTimeout(function () { enh.textContent = '\u2728 Enhance prompt'; }, 2200); })
        .then(function () { delete enh.dataset.busy; if (/Enhancing/.test(enh.textContent)) enh.textContent = '\u2728 Enhance prompt'; });
    });
    var undo = el('div', 'sv-chip', '\u21A9\uFE0F Undo');
    undo.style.display = 'none';
    undo.addEventListener('click', function () { if (ta.dataset.before != null) ta.value = ta.dataset.before; undo.style.display = 'none'; });
    var dice = el('div', 'sv-chip', '\uD83C\uDFB2 Surprise me');
    dice.addEventListener('click', function () {
      var t = mode.templates || [];
      if (!t.length) return;
      ta.value = t[Math.floor(Math.random() * t.length)].prompt;
    });
    /* Task 112/120 batch 2 (Higgsfield "prompt history"): your last 10 prompts per type. */
    var rec = el('div', 'sv-chip', '\uD83D\uDD58 Recent');
    var recBox = el('div', 'sv-recent');
    recBox.style.cssText = 'display:none;flex-direction:column;gap:4px;margin:4px 0;max-height:180px;overflow-y:auto;';
    rec.addEventListener('click', function () {
      var l = promptHistory(mode.key);
      if (!l.length) { toast('Your prompts will show here after you create', 'info', 2200); return; }
      if (recBox.style.display === 'flex') { recBox.style.display = 'none'; return; }
      recBox.innerHTML = '';
      l.forEach(function (p) {
        var r = el('div', 'sv-chip');
        r.textContent = p.length > 90 ? p.slice(0, 90) + '\u2026' : p;
        r.style.cssText = 'text-align:left;white-space:normal;';
        r.addEventListener('click', function () { ta.value = p; recBox.style.display = 'none'; });
        recBox.appendChild(r);
      });
      recBox.style.display = 'flex';
    });
    /* Task 112/120 batch 3 (Higgsfield styles): one tap adds a proven style line to the prompt. */
    var STYLES = [['\uD83C\uDFAC Cinematic', 'cinematic film still, anamorphic lens, dramatic lighting, shallow depth of field'],
      ['\uD83C\uDF8C Anime', 'anime style, clean line art, vibrant cel shading'], ['\uD83E\uDDF8 3D', '3D render, Pixar style, soft global illumination'],
      ['\uD83C\uDF03 Neon', 'neon cyberpunk night, glowing signs, wet reflective streets'], ['\uD83C\uDF9E\uFE0F Film noir', 'black and white film noir, hard shadows, 1940s'],
      ['\uD83D\uDCF8 Photo', 'ultra-realistic photo, natural light, 50mm lens, high detail'], ['\uD83C\uDFA8 Watercolour', 'soft watercolour painting, paper texture']];
    var styleBox = el('div', 'sv-styles');
    styleBox.style.cssText = 'display:none;gap:6px;overflow-x:auto;margin:4px 0;scrollbar-width:none;';
    STYLES.forEach(function (st) {
      var c = el('div', 'sv-chip', st[0]);
      c.style.flex = 'none';
      c.addEventListener('click', function () {
        var base = ta.value.replace(/\s*\|\s*style:.*$/i, '').trim();
        ta.value = (base ? base + ' | style: ' : 'style: ') + st[1];
        styleBox.style.display = 'none';
      });
      styleBox.appendChild(c);
    });
    var sty = el('div', 'sv-chip', '\uD83C\uDFA8 Style');
    sty.addEventListener('click', function () { styleBox.style.display = styleBox.style.display === 'flex' ? 'none' : 'flex'; });
    tools.appendChild(enh); tools.appendChild(undo); tools.appendChild(rec);
    if (mode.key === 'image' || mode.key === 'video') tools.appendChild(sty);
    if ((mode.templates || []).length) tools.appendChild(dice);
    sh.appendChild(tools);
    sh.appendChild(recBox);
    sh.appendChild(styleBox);
    if (mode.key === 'video') {
      var negIn = document.createElement('input');
      negIn.id = 'sv-neg'; negIn.maxLength = 300;
      negIn.placeholder = '\u2796 Avoid\u2026 (e.g. text, blur, extra fingers) \u00b7 Veo models';
      negIn.style.cssText = 'width:100%;box-sizing:border-box;margin:6px 0 2px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:9px 12px;color:#f1f5f9;font-size:13px;';
      sh.appendChild(negIn);
    }
    var frames = el('div', 'sv-row');
    frames.id = 'sv-frames';
    frames.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 2px';
    sh.appendChild(frames);
    renderFrames(sh, mode);

    /* Task 101: "Reference" under a result lands here — the old image rides
       along as the reference for the next one (Nano Banana /edit on the server). */
    /* (Task 103) The reference chip now lives in #sv-frames — see renderFrames(). */

    /* Edit needs a clip before it needs a prompt, so the source row sits
       above the prompt: a link box, plus one-tap chips for clips this creator
       already made. Only modes that declare needsSource get it — nothing else
       in the sheet changes. */
    if (mode.needsSource) sh.appendChild(sourceRow(sh, mode));

    var picker = el('div', 'sv-row');
    picker.id = 'sv-models';
    picker.style.display = 'none';
    picker.style.flexWrap = 'wrap';
    sh.appendChild(picker);

    var row = el('div', 'sv-row');
    var inline = (mode.settings || []).length > 0 && (mode.settings || []).length <= 3;
    var summary = el('div', 'sv-mchip');
    summary.id = 'sv-summary';
    summary.style.cssText = 'background:transparent;border:none;color:#b6c2d6;padding-left:0;cursor:default;';
    if (inline) {
      /* Task 23: Higgsfield/CapCut show aspect ratio and style as pills right
         under the prompt, one tap each. A separate Settings screen for two
         values was an extra screen and a Done tap for nothing. */
      row.style.flexWrap = 'wrap';
      (mode.settings || []).forEach(function (st) {
        var p = el('div', 'sv-mchip sv-pill');
        p.setAttribute('role', 'button');
        p.setAttribute('aria-label', st.label);
        p.__paint = function () { p.textContent = shown(mode, st) + ' ▾'; p.title = st.label; };
        p.__paint();
        p.addEventListener('click', function () { cycle(mode, st); p.__paint(); repaintSettings(sh, mode); });
        row.appendChild(p);
      });
      summary.style.display = 'none';
    } else {
      var setChip = el('div', 'sv-mchip', '⚙ Settings ›');
      setChip.addEventListener('click', function () { enterSettings(sh, mode); });
      row.appendChild(setChip);
    }
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
        if (mode.key === 'audio' && st.key === 'voice') stopPreview();
      });
      line.appendChild(val);
      /* Hearing the voice is free and comes before paying for a read of it —
         the ElevenLabs funnel. @see server/routes/squad-audio.js#/preview */
      if (mode.key === 'audio' && st.key === 'voice') {
        var play = el('span', 'sv-val', '\u25b6 Hear it');
        play.style.cssText = 'margin-left:8px;color:#FF6D00;';
        play.addEventListener('click', function () { playVoicePreview(play, state.audio.voice); });
        line.appendChild(play);
      }
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

    /* No "My Creations" list on this page: the Library row at the top of the
       Create grid (create-studio.js) is the one history. loadHistory() still
       runs for shareInfo (the referral link under every result). */

    refreshSummary(sh, mode);
    var ov = el('div');
    ov.id = 'sg-sv-overlay';
    ov.addEventListener('click', function () { closeSheet(); });
    document.body.appendChild(ov);
    document.body.appendChild(sh);
    if (typeof window.sgSheetDrag === 'function') window.sgSheetDrag(sh, function () { closeSheet(); }, ov);
    requestAnimationFrame(function () { sh.classList.add('open'); });

    gateSheet(sh, mode);
  }

  /**
   * The source clip for an edit: paste a link, or tap one you already made.
   *
   * Deliberately small — an input and a row of chips — because the failure to
   * avoid is a picker that looks like a file browser and then has nothing to
   * browse. The chips come from /api/squad-create/library, which needs a
   * login, so they simply do not appear when there is nothing to show.
   */
  function sourceRow(sh, mode) {
    var box = el('div');
    box.id = 'sv-source';
    box.style.cssText = 'margin:2px 0 8px;text-align:left;';

    var inp = document.createElement('input');
    inp.type = 'url';
    inp.id = 'sv-source-url';
    inp.placeholder = 'Paste a video link…';
    inp.style.cssText = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:11px 12px;color:#f1f5f9;font-size:14px;';
    inp.addEventListener('input', function () { state[mode.key].__sourceUrl = inp.value.trim(); });
    box.appendChild(inp);

    var chips = el('div', 'sv-chips');
    chips.id = 'sv-source-chips';
    chips.style.marginTop = '6px';
    box.appendChild(chips);
    /* Task 103: reference video straight from the phone. */
    var up = el('div', 'sv-chip', '\uD83D\uDCE4 Upload a video');
    up.addEventListener('click', function () {
      uploadRef('video/*', function (u) { inp.value = u; state[mode.key].__sourceUrl = u; toast('Video uploaded \u2014 now say what to change.', 'info', 2500); });
    });
    chips.appendChild(up);

    fetch('/api/squad-create/library?kind=video&limit=8').then(function (r) {
      return r.status === 401 ? null : r.json();
    }).then(function (d) {
      var items = ((d && d.items) || []).filter(function (j) { return j.status === 'done' && j.url; });
      if (!items.length) return;
      var head = el('div', '', 'Or one of yours:');
      head.style.cssText = 'color:#7d8ba3;font-size:11.5px;width:100%;margin-bottom:2px;';
      chips.appendChild(head);
      items.slice(0, 6).forEach(function (j) {
        var c = el('div', 'sv-chip', '🎬 ' + String(j.prompt || 'clip').slice(0, 22));
        c.addEventListener('click', function () {
          inp.value = j.url;
          state[mode.key].__sourceUrl = j.url;
          toast('Clip selected — now say what to change.', 'info', 2200);
        });
        chips.appendChild(c);
      });
    }).catch(function () {});

    return box;
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
          ' The controls above are a preview of the flow. <b>'+((window.SQUAD_ASSET_COUNT||242))+'+ ready-to-post clips</b> are in your ScanSquad library.';
        return;
      }
      if (!mode.api) return;
      loadHistory(sh, mode); // My Creations: every mode, not just this one
      loadTemplates(sh, mode);
      loadBilling(sh, mode);  // card on file, what is owed, whether Create is paused
      getHealth(mode).then(function (d) {
        health = d;
        if (d.budget) { budget = d.budget; }
        if (d.quota) { quota = d.quota; }
        refreshQuota(sh, mode);
        renderModelPicker(sh, mode, d);
        /* Two health shapes in the wild: the media modes answer `available`,
           text answers `configured`. Treat either as yes, or a working Text
           button ends up disabled by a check written for video. */
        var usable = (d.available === undefined) ? (d.configured !== false) : d.available;
        if (!usable) {
          gen.disabled = true;
          warn.style.display = 'block';
          warn.innerHTML = '⏳ ' + mode.label + ' rendering is still being switched on for this account (' +
            (d.reason || 'unavailable') + '). Meanwhile: <b>' + ((window.SQUAD_ASSET_COUNT||242)) + '+ ready-to-post clips</b> are in your ScanSquad library below.';
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

  /**
   * Starters from the server, merged over the built-in chips.
   *
   * A starter carries prompt + settings + a model that suits it, so tapping
   * "Gym tour" no longer means paying for 1080p on whatever model happened to
   * be first in the list. Cached for the session; if the call fails the
   * built-in chips stay, which is why they are still in MODES.
   * @see server/lib/gen-templates.js
   */
  function loadTemplates(sh, mode) {
    var apply = function (list) {
      if (!list || !list.length) return;
      var host = sh.querySelector('.sv-chips');
      if (!host) return;
      host.innerHTML = '';
      list.forEach(function (t) {
        var c = el('div', 'sv-chip', t.label);
        c.addEventListener('click', function () {
          var ta = sh.querySelector('.sv-prompt');
          if (ta) ta.value = t.prompt;
          if (t.settings) {
            Object.keys(t.settings).forEach(function (k) { state[mode.key][k] = t.settings[k]; });
            repaintSettings(sh, mode);
          }
          if (t.model) {
            state[mode.key].__model = t.model;
            var picker = sh.querySelector('#sv-models');
            if (picker) { picker.querySelectorAll('.sv-mchip').forEach(function (ch) { if (ch.__paint) ch.__paint(); }); if (picker.__paintPill) picker.__paintPill(); }
          }
          refreshSummary(sh, mode);
        });
        host.appendChild(c);
      });
    };
    if (serverTemplates && serverTemplates[mode.key]) { apply(serverTemplates[mode.key]); return; }
    fetch('/api/squad-create/templates').then(function (r) { return r.json(); }).then(function (d) {
      serverTemplates = (d && d.templates) || {};
      apply(serverTemplates[mode.key]);
    }).catch(function () {});
  }

  /** Redraw the settings rows after a starter has set them. */
  function repaintSettings(sh, mode) {
    var rows = sh.querySelectorAll('#sv-settings .sv-set');
    (mode.settings || []).forEach(function (st, i) {
      var row = rows[i];
      if (!row) return;
      var val = row.querySelector('.sv-val');
      if (val) val.textContent = shown(mode, st);
    });
  }

  /* Task 14 (owner, 2026-09-30): "clicking button… is slow". The sheet
     opened at once but sat half-drawn until /health answered, then jumped
     (price, model line and an orange Generate all arrived ~250 ms later). The
     proven fix is the one Instagram/TikTok use: start the request on the
     finger going down (makeBtn), and keep the answer for a minute so opening
     the same sheet again is instant. A render drops the entry, since it
     changes the quota. */
  var healthCache = {};
  function getHealth(mode) {
    var c = healthCache[mode.key];
    if (c && Date.now() - c.t < 60000) return c.p;
    var p = fetch(mode.api + '/health').then(function (r) { return r.json(); });
    healthCache[mode.key] = { t: Date.now(), p: p };
    p.catch(function () { delete healthCache[mode.key]; });
    return p;
  }
  function warmMode(mode) {
    loadModes().then(function () {
      if (isConfigured(mode) && mode.api) getHealth(mode).catch(function () {});
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

  /* Settings is a step inside the sheet, not a list that unfolds under the
     prompt (owner, 2026-09-30: no button that reveals a pile of buttons). ←
     and Done return to the prompt exactly as it was. */
  function enterSettings(sh, mode) {
    if (sh.__step) return;
    sh.__step = true;
    Array.prototype.forEach.call(sh.children, function (c) {
      if (c.classList.contains('sv-handle') || c.classList.contains('sv-head') || c.id === 'sv-settings') return;
      c.classList.add('sv-step-hidden');
    });
    var m = sh.querySelector('#sv-settings');
    m.style.display = 'block';
    if (!m.querySelector('.sv-done')) {
      var done = el('button', 'sv-gen sv-done', 'Done \u2713');
      done.addEventListener('click', function () { exitSettings(sh, mode); });
      m.appendChild(done);
    }
    var name = sh.querySelector('#sv-head-name'), sub = sh.querySelector('#sv-head-sub');
    sh.__head = [name.innerHTML, sub.innerHTML];
    name.textContent = 'Settings';
    sub.textContent = mode.label + ' \u00b7 tap a value to change it';
    sh.scrollTop = 0;
  }

  function exitSettings(sh, mode) {
    if (!sh.__step) return;
    sh.__step = false;
    Array.prototype.forEach.call(sh.querySelectorAll('.sv-step-hidden'), function (c) { c.classList.remove('sv-step-hidden'); });
    sh.querySelector('#sv-settings').style.display = 'none';
    var name = sh.querySelector('#sv-head-name'), sub = sh.querySelector('#sv-head-sub');
    if (sh.__head) { name.innerHTML = sh.__head[0]; sub.innerHTML = sh.__head[1]; }
    refreshSummary(sh, mode);
    stopPreview();
  }

  function refreshSummary(sh, mode) {
    Array.prototype.forEach.call(sh.querySelectorAll('.sv-pill'), function (p) { if (p.__paint) p.__paint(); });
    var n = sh.querySelector('#sv-summary');
    if (!n) return;
    if (mode.summary) { n.textContent = mode.summary(state[mode.key]); return; }
    n.textContent = (mode.settings || []).map(function (st) { return shown(mode, st); }).join(' · ');
  }

  /**
   * The line under Generate. It used to count clips per mode ("3 of 5 left"),
   * which could not explain why a £3 model was out of reach — so it now reads
   * out the one thing that decides: today's credit, and what grows it.
   */
  /**
   * The invoices list, rendered in the sheet. The API at
   * /api/squad-billing/invoices is JSON for the app, not a page for a person —
   * linking a creator straight to it showed them raw JSON on a black screen.
   * Each row links to the printable single-invoice page, which is HTML.
   */
  function showInvoices(host) {
    var box = host.querySelector('.sv-invoices');
    if (!box) { box = el('div', 'sv-invoices'); box.style.cssText = 'margin-top:8px;font-size:12px;color:#e5e7eb;'; host.appendChild(box); }
    box.textContent = 'Loading invoices…';
    fetch('/api/squad-billing/invoices').then(function (r) { return r.json(); }).then(function (d) {
      var items = (d && d.items) || [];
      if (!items.length) { box.textContent = 'No invoices yet.'; return; }
      box.innerHTML = '';
      items.forEach(function (i) {
        var row = el('div');
        row.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.08);';
        var a = el('a'); a.href = i.url; a.target = '_blank'; a.rel = 'noopener';
        a.style.cssText = 'color:#FF6D00;font-weight:700;text-decoration:none;';
        a.textContent = i.number;
        var when = el('span'); when.textContent = String(i.issuedOn || '').slice(0, 10);
        var amt = el('span'); amt.textContent = i.total + ' · ' + (i.status === 'paid' ? 'paid' : i.status === 'failed' ? 'card failed' : 'unpaid');
        row.appendChild(a); row.appendChild(when); row.appendChild(amt);
        box.appendChild(row);
      });
    }).catch(function () { box.textContent = 'Could not load your invoices.'; });
  }

  function refreshQuota(sh, mode) {
    var n = sh.querySelector('#sv-note');
    if (!n) return;
    var bits = [];
    /* What this tap will cost, before it is spent. Create is postpaid — the
       creator is invoiced in the morning — so the one moment they can still
       change their mind is now. @see server/lib/gen-billing.js */
    var st = state[mode.key] || {};
    var p = st.__price;
    var vat = (billing && billing.vatIncluded) ? ' inc VAT' : '';
    /* Video is the one mode where the number on the chip is not the number on
       the invoice: the quote covers the vendor's nearest allowed length, not
       the length in the settings row. Say both, and say why. */
    if (mode.key === 'video' && st.__durations && st.__pricePence != null && st.__quotedSeconds) {
      var billed = billedSeconds(st.__durations, st.durationSeconds);
      var runPence = Math.round(st.__pricePence * (billed / st.__quotedSeconds));
      bits.push('⚡ This run: ' + pence(runPence) + vat + ' · ' + billed + 's billed');
      if (billed !== st.durationSeconds) {
        bits.push('this model only renders ' + st.__durations.join('s or ') + 's, so ' +
          st.durationSeconds + 's becomes ' + billed + 's');
      }
    } else if (p) {
      /* "8p" and "28p" are not the same kind of number: one is per image, the
         other is a whole minute of music whether you asked for 15s or 60s. */
      bits.push('⚡ This run: ' + p + vat + (st.__unit ? ' ' + st.__unit : ''));
    }
    /* Every text model prices out at a penny a caption, so six chips reading
       "1p" made the price look like the thing to choose on. It is not. */
    if (mode.key === 'text' && p) bits.push('any model here costs about a penny a caption — pick on style, not price');
    if (billing && billing.suspended) {
      bits.push('⏸ Creating is paused until your invoice is paid');
    } else if (billing && billing.unpaid && billing.unpaidPence > 0) {
      bits.push('🧾 ' + billing.unpaid + ' on your next invoice');
    }
    if (budget && budget.signedIn) {
      bits.push('💳 ' + (budget.remaining || gbp(budget.remainingUsd)) + ' of today\'s ' +
        (budget.daily || gbp(budget.dailyUsd)) + ' allowance left');
      if (budget.remainingUsd <= 0) bits.push('every booking you drive adds credit');
    } else if (budget && budget.signedIn === false) {
      bits.push('🔐 Sign in to create — your work and your credit live on your account');
    }
    if (quota && mode.note) bits.push(quota.remaining + ' of ' + quota.limit + ' ' + mode.key + ' runs left today');
    n.innerHTML = bits.length ? bits.join(' · ') : (mode.note || '');
  }

  function closeSheet(fromPop) {
    var ov = document.getElementById('sg-sv-overlay');
    var sh = document.getElementById(SHEET_ID);
    var wasOpen = !!(ov || sh);
    if (ov) ov.remove();
    if (sh) sh.remove();
    if (job && job.timer) { clearInterval(job.timer); job = null; }
    stopPreview();
    /* Closing by ✕ or backdrop has to consume the entry we pushed, or the next
       back press would do nothing at all. When the pop *is* what closed us, the
       entry is already gone. */
    if (sheetEntry) {
      sheetEntry = false;
      if (wasOpen && !fromPop) { try { history.back(); } catch (e) {} }
    }
  }

  window.addEventListener('popstate', function () {
    if (sheetEntry) closeSheet(true);
  });

  // ── generation ──────────────────────────────────────────────────────────
  function startJob(sh, ta, gen, mode) {
    delete healthCache[mode.key]; // the quota is about to change
    if (!isConfigured(mode) || !mode.api) return; // belt and braces: never fire a dead mode
    var prompt = (ta.value || '').trim();
    /* An edit needs the clip first: without one there is nothing to change,
       and the server would refuse the request anyway. */
    var sourceUrl = null;
    if (mode.needsSource) {
      var srcInput = sh.querySelector('#sv-source-url');
      sourceUrl = ((srcInput && srcInput.value) || state[mode.key].__sourceUrl || '').trim();
      if (!sourceUrl) { toast('Pick a clip to edit — paste a link or tap one of yours.', 'info', 3000); return; }
    }
    if (!prompt && !mode.needsSource) { toast('Describe it first — or tap a template.', 'info', 2500); return; }
    /* Some edits (dub, sound effects, extend) need no prompt at all; the
       server knows which, and answers with what is missing if it does. */
    if (!prompt && mode.needsSource && !state[mode.key].__model) {
      toast('Say what should change — or pick an edit below.', 'info', 3000); return;
    }
    /* Postpaid means the bill arrives after the render, so anything over a
       pound gets an explicit yes first. Cheap runs (a caption, an image) are
       not worth a dialog — the price is already on the note line. */
    var px = state[mode.key].__pricePence;
    var pl = state[mode.key].__price;
    if (px != null && px >= 100 && typeof window.confirm === 'function') {
      if (!window.confirm('Generate for ' + pl + (billing && billing.vatIncluded ? ' inc VAT' : '') +
        '? It goes on your next invoice.')) return;
    }
    gen.disabled = true;
    var out = sh.querySelector('#sv-out');
    out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span>Sending…</span></div>';

    var body = { prompt: prompt };
    rememberPrompt(mode.key, prompt);
    if (sourceUrl) body.videoUrl = sourceUrl;
    (mode.settings || []).forEach(function (st) { body[st.key] = state[mode.key][st.key]; });
    if (state[mode.key].__model) body.model = state[mode.key].__model;
    if (mode.key === 'image' && state.image.__ref) body.referenceUrl = state.image.__ref;
    var neg = sh.querySelector('#sv-neg');
    if (mode.key === 'video' && neg && neg.value.trim()) body.negativePrompt = neg.value.trim();
    if (mode.key === 'video' && state.video.__start) {
      body.startFrameUrl = state.video.__start;
      if (state.video.__end) body.endFrameUrl = state.video.__end;
    }

    fetch(mode.api + '/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); })
      .then(function (res) {
        /* Two refusals a creator can act on, and both used to arrive as a bare
           red line: not signed in, and out of today's credit. */
        if (res.status === 401 || (res.d && res.d.needsLogin)) {
          out.innerHTML = '<div class="sv-warn">🔐 ' + (res.d.error || 'Sign in to create.') +
            ' <a href="/login" style="color:#FF6D00;font-weight:700">Sign in</a></div>';
          if (window.sgAskSignIn) window.sgAskSignIn('create');
          gen.disabled = false;
          return;
        }
        /* Postpaid refusals, both fixable by the creator in one tap: no card on
           file, and suspended for an unpaid invoice. @see lib/gen-billing.js */
        if (res.d && res.d.needsCard) {
          out.innerHTML = '';
          out.appendChild(cardPrompt(res.d.error));
          billing = null; // re-read after they add one
          gen.disabled = false;
          return;
        }
        if (res.status === 403 && res.d && res.d.suspended) {
          out.innerHTML = '<div class="sv-warn">⏸ ' + (res.d.error || 'Creating is paused until your invoice is paid.') +
            ' <a href="#" class="sv-invoices-link" style="color:#FF6D00;font-weight:700">See invoices</a></div>';
          var link = out.querySelector('.sv-invoices-link');
          if (link) link.addEventListener('click', function (ev) { ev.preventDefault(); showInvoices(out); });
          billing = null;
          gen.disabled = false;
          return;
        }
        if (res.status === 402 || (res.d && res.d.needsBudget)) {
          if (res.d.budget) { budget = res.d.budget; }
          out.innerHTML = '<div class="sv-warn">💳 ' + (res.d.error || 'Out of today\'s credit.') + '</div>';
          refreshQuota(sh, mode);
          gen.disabled = false;
          return;
        }
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
        // Speech and music finish inside the request and answer with the
        // media url as well as a job id. Showing it now saves a poll for
        // something already on disk.
        if (res.d.status === 'done' && (res.d.audioUrl || res.d.url)) {
          if (res.d.quota) { quota = res.d.quota; refreshQuota(sh, mode); }
          showResult(out, res.d.audioUrl || res.d.url, mode, res.d.jobId);
          gen.disabled = false;
          return;
        }
        if (!res.d.jobId) throw new Error(res.d.error || 'could not start');
        if (res.d.quota) { quota = res.d.quota; refreshQuota(sh, mode); }
        var start = Date.now();
        /* The measured time for this exact model, from the server, instead of
           "usually under a minute" on a render measured at 226 seconds. */
        var etaS = res.d.etaSeconds || null;
        var slow = etaS && etaS >= 60;
        out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span id="sv-prog-t">' +
          (etaS ? 'Rendering… ' + phrase(etaS) : 'Rendering…') + '</span></div>' +
          (slow ? '<div class="sv-note" style="margin-top:6px">You can close this — we\'ll email you the moment it lands, and it will be waiting in My Creations.</div>' : '');
        job = { id: res.d.jobId };
        job.timer = setInterval(function () {
          fetch(mode.api + '/status/' + job.id).then(function (r) { return r.json(); }).then(function (st) {
            if (st.status === 'done') {
              clearInterval(job.timer);
              showResult(out, st.videoUrl || st.imageUrl || st.audioUrl || st.url, mode, job.id);
              gen.disabled = false;
            } else if (st.status === 'error') {
              clearInterval(job.timer);
              out.innerHTML = '<div class="sv-warn">❌ ' + (st.error || 'Generation failed.') + '</div>';
              gen.disabled = false;
            } else {
              var t = document.getElementById('sv-prog-t');
              if (t) {
                var elapsed = Math.round((Date.now() - start) / 1000);
                var left = st.remainingSeconds != null ? st.remainingSeconds
                  : (etaS ? Math.max(0, etaS - elapsed) : null);
                t.textContent = 'Rendering… ' + elapsed + 's · ' +
                  (left ? phrase(left) + ' to go' : 'any moment now') +
                  (st.queuePosition ? ' · queue position ' + st.queuePosition : '');
              }
              if (Date.now() - start > 600000) { // 10 min: measured worst case is under 4
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

  /**
   * The model row.
   *
   * Every mode's /health already returned its catalogue — the prices, the
   * labels, the cheap default — and until now the sheet threw it away, so a
   * customer could not actually choose a model however many the server could
   * reach. One account, one balance, many models behind one button is the
   * whole point of ScanSquad; this is where a creator gets to see it.
   *
   * Hidden when there is nothing to choose between, because a dropdown with
   * one entry is furniture, not a feature.
   */
  function renderModelPicker(sh, mode, d) {
    var list = (d && d.models) || [];
    /* One model is still a price. This used to return before reading the row,
       so on any mode with a single reachable model ("This run: …") showed
       nothing at all and the creator tapped Generate with no idea of the cost —
       Music, where one label hides two differently-priced routes, is exactly
       that case. Take the price first, then decide whether chips are worth
       drawing: a picker with one entry is furniture, a price is not. */
    if (list.length) {
      var only = list[0];
      var st0 = state[mode.key];
      if (!st0.__model || list.length === 1) {
        st0.__price = only.price || st0.__price || null;
        st0.__pricePence = (only.pricePence != null) ? only.pricePence : st0.__pricePence;
        st0.__unit = only.unit || null;
      }
    }
    if (list.length < 2) { refreshQuota(sh, mode); return; }
    var picker = sh.querySelector('#sv-models');
    if (!picker) return;
    picker.innerHTML = '';
    picker.style.display = 'block';
    /* CapCut-style: one line — "Using 10p · Nano Banana 2 — Change model ›" —
       and the chips only unfold when asked. Six priced chips open by default
       read as the form itself; the price is what a creator needs to see before
       Generate, the choice is optional. */
    var pill = el('div', 'sv-mchip');
    pill.id = 'sv-model-pill';
    pill.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;width:100%;box-sizing:border-box;';
    var host = el('div', 'sv-row');
    /* Task 102: the models sit right here as a one-tap strip (no trip to the grid). */
    host.className = 'sv-row sv-mstrip';
    host.style.cssText = 'display:flex;flex-wrap:nowrap;overflow-x:auto;gap:6px;margin-top:8px;padding-bottom:2px;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
    picker.appendChild(pill);
    picker.appendChild(host);
    var openChips = false;
    var paintPill = function () {
      var cur = list.filter(function (m) { return m.id === state[mode.key].__model; })[0];
      var price = cur && cur.price && mode.key !== 'text' ? cur.price + (cur.unit === 'per image' ? '/image' : '') : '';
      pill.innerHTML = '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (price ? '<b>Using ' + price + '</b> \u00b7 ' : '') + (cur ? (cur.role ? cur.role + ' \u00b7 ' : '') + cur.label : 'Pick a model') + '</span>' +
        '<span style="color:#FF6D00;font-weight:700;white-space:nowrap;">All models \u203a</span>';
      /* The page header carries the same truth, Higgsfield-style. */
      var hn = sh.querySelector('#sv-head-name'), hs = sh.querySelector('#sv-head-sub');
      if (hn && cur) hn.textContent = cur.label;
      if (hs && cur) hs.innerHTML = (cur.role ? cur.role + ' \u00b7 ' : '') + (price ? '<i>' + price + '</i>' : mode.label);
    };
    /* The strip below switches in one tap; "All models" still opens the full grid. */
    pill.addEventListener('click', function () { openGrid(mode); });
    picker.__paintPill = paintPill;

    /* Default to something the creator can actually run: picking a locked
       premium row for them is a 402 they did not ask for. */
    var runnable = list.filter(function (m) { return m.affordable !== false; });
    var known = list.some(function (m) { return m.id === state[mode.key].__model; });
    var chosen = (known && state[mode.key].__model)
      || (runnable.filter(function (m) { return m.tier === 'default'; })[0] || runnable[0] || list[0]).id;
    state[mode.key].__model = chosen;
    var chosenRow = list.filter(function (m) { return m.id === chosen; })[0];
    if (chosenRow) {
      state[mode.key].__price = chosenRow.price || null;
      state[mode.key].__pricePence = (chosenRow.pricePence != null) ? chosenRow.pricePence : null;
      state[mode.key].__durations = chosenRow.durations || null;
      state[mode.key].__quotedSeconds = chosenRow.quotedSeconds || null;
      state[mode.key].__unit = chosenRow.unit || null;
    }

    list.forEach(function (m) {
      var chip = el('div', 'sv-mchip');
      /* The price the creator pays, formatted by the server (VAT included), not
         our supplier cost converted at a hard-coded FX rate — which is what
         this line used to print. @see server/lib/gen-pricing.js */
      var price = m.price ? ' · ' + m.price : '';
      /* See refreshQuota: identical penny prices on every text chip are noise. */
      if (mode.key === 'text') price = '';
      else if (m.unit === 'per image') price += '/image';
      /* The role first, the vendor's release name second: "Seedance 2.5" is not
         an answer to "which one do I tap". @see server/lib/gen-models.js#ROLES */
      var locked = m.affordable === false;
      chip.innerHTML = (locked ? '🔒 ' : '') + (m.role ? '<b>' + m.role + '</b> · ' : '') +
        m.label + price;
      if (m.note) chip.title = m.note;
      if (locked) chip.title = (m.lockedReason === 'sign_in')
        ? 'Sign in to use this model'
        : 'Above today\'s credit — every booking you drive adds to it';
      var paint = function () {
        var on = state[mode.key].__model === m.id;
        chip.style.cssText = on
          ? 'background:linear-gradient(135deg,#FF6D00,#E66200);border:none;color:#fff;font-size:11.5px;font-weight:700;padding:8px 11px;border-radius:10px;cursor:pointer;'
          : (locked ? 'opacity:.45;' : '');
      };
      chip.addEventListener('click', function () {
        if (locked) {
          toast(chip.title, 'info', 3500);
          return;
        }
        state[mode.key].__model = m.id;
        state[mode.key].__price = m.price || null;
        state[mode.key].__pricePence = (m.pricePence != null) ? m.pricePence : null;
        state[mode.key].__durations = m.durations || null;
        state[mode.key].__quotedSeconds = m.quotedSeconds || null;
        state[mode.key].__unit = m.unit || null;
        Array.prototype.forEach.call(host.children, function (c) { if (c.__paint) c.__paint(); });
        paintPill(); // instant: price + header update in place, prompt and settings untouched
        refreshQuota(sh, mode);
      });
      chip.__paint = function () { paint(); chip.style.flex = 'none'; chip.style.whiteSpace = 'nowrap'; };
      chip.__paint();
      host.appendChild(chip);
    });
    paintPill();
    var on = host.children[list.map(function (m) { return m.id; }).indexOf(state[mode.key].__model)];
    if (on && on.scrollIntoView) setTimeout(function () { try { on.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {} }, 0);
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
      /* A caption that goes out without the referral link earns nothing, so the
         link is appended once, here, rather than left to the creator to remember. */
      var withLink = (shareInfo && shareInfo.refLink && text.indexOf(shareInfo.refLink) === -1)
        ? text + '\n\n' + shareInfo.refLink
        : text;
      if (navigator.share) navigator.share({ text: withLink }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(withLink).then(function () { toast('Copied with your link — paste it anywhere.', 'success', 2500); });
    });
    row.appendChild(share);
    out.appendChild(row);
  }

  function showResult(out, url, mode, jobId) {
    /* Create Studio listens and refreshes its feed. */
    try { document.dispatchEvent(new CustomEvent('sg-squad-create:done', { detail: { mode: mode.key, jobId: jobId } })); } catch (e) {}
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
      /* The clip used to go out as a bare CDN link: the creator posted our
         content and there was nothing in the post to book through. The caption
         and the referral link come from /api/squad-create/library. */
      var caption = (shareInfo && shareInfo.shareText) || 'Made with ScanGym — any gym, £5/day.';
      logEvent(jobId, 'share', 'generated');
      if (navigator.share) {
        navigator.share({ title: 'My ScanGym clip', text: caption, url: abs }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(caption + ' ' + abs)
          .then(function () { toast('Caption and your link copied — paste it in your post.', 'success', 3000); });
      }
    });
    row.appendChild(share);
    var dl = el('a', 'sv-mchip', '⬇ Download');
    dl.href = url;
    dl.download = 'scangym-clip';
    dl.style.textDecoration = 'none';
    dl.addEventListener('click', function () { logEvent(jobId, 'download', 'generated'); });
    row.appendChild(dl);
    if (shareInfo && shareInfo.refLink) {
      var copyCap = el('div', 'sv-mchip', '📋 Caption + link');
      copyCap.addEventListener('click', function () {
        if (navigator.clipboard) {
          navigator.clipboard.writeText(shareInfo.shareText)
            .then(function () { toast('Caption copied — your referral link is in it.', 'success', 3000); });
        }
      });
      row.appendChild(copyCap);
    }
    /* Task 101: the actions sit straight under the result, before Share /
       Download, so a phone shows them without scrolling (they were hidden
       under the tab bar). */
    out.appendChild(nextRow(url, mode, jobId));
    out.appendChild(row);
  }

  /* Task 20: what to do after a result lands, the way Higgsfield/CapCut do it:
     Post, Edit, Recreate, More versions, Extend. Every one reuses a path that
     already exists (the Edit mode, the Generate button, /post-everywhere). */
  function nextRow(url, mode, jobId) {
    var abs = url.indexOf('http') === 0 ? url : location.origin + url;
    var isVid = mode.resultKind === 'video';
    var row = el('div', 'sv-row sv-next');
    row.setAttribute('aria-label', 'What next');
    function chip(label, fn) { var c = el('div', 'sv-mchip', label); c.setAttribute('role', 'button'); c.addEventListener('click', fn); row.appendChild(c); }
    function sheetBits() {
      var sh = document.getElementById(SHEET_ID);
      return { sh: sh, ta: sh && sh.querySelector('.sv-prompt'), gen: sh && sh.querySelector('#sv-gen') };
    }
    /* Task 56 (owner, 2026-10-01): one tap posts to every linked account, here,
       like Viktor does — no new tab. The /post-everywhere page is only opened
       when nothing is linked yet (to link) or the network call fails. */
    chip('🚀 Post', function () {
      var text = (shareInfo && shareInfo.shareText) || 'Made with ScanGym';
      var q = '?media=' + encodeURIComponent(abs) + '&type=' + (isVid ? 'video' : 'image') + '&text=' + encodeURIComponent(text);
      var page = function () { window.open('/post-everywhere/' + q, '_blank', 'noopener'); };
      var c = this;
      /* Task 110: no confirm, no page — one tap posts to your ScanGym profile and
         every linked account, with the name and email you are signed in with. */
      toast('Posting\u2026', 'info', 2000);
      fetch('/api/post-everywhere/post', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text, mediaUrl: abs, mediaType: isVid ? 'video' : 'image', toScanGym: true }) })
        .then(function (r) { if (r.status === 401) return Promise.reject(401); return r.json(); })
        .then(function (o) {
          if (!o || !o.results) { toast((o && o.error) || 'Could not post right now.', 'error', 4000); return; }
          var msg = o.results.map(function (x) { return (x.status === 'posted' ? '\u2705 ' : x.status === 'skipped' ? '\u23ED\uFE0F ' : '\u274C ') + x.appName; }).join('  ');
          toast('Posted to ' + o.posted + '/' + o.results.length + ': ' + msg + (o.noSocials ? ' \u00b7 Link Instagram, YouTube, TikTok\u2026 once in Profile \u203a Connect to post everywhere' : ''), o.posted ? 'success' : 'error', 6500);
        })
        .catch(function (e) { if (e === 401) { if (window.sgAskSignIn) window.sgAskSignIn('post'); else toast('Sign in to post', 'info', 3000); } else page(); });
    });
    chip('✏️ Edit', function () {
      if (isVid) { window.sgSquadCreate.open('edit', '', null, { sourceUrl: abs }); return; }
      var b = sheetBits();
      if (b.ta) { b.ta.focus(); b.ta.select(); toast('Change the words, then tap Generate.', 'info', 2500); }
    });
    chip('🔁 Recreate', function () {
      var b = sheetBits();
      if (b.gen && !b.gen.disabled) b.gen.click();
    });
    chip('➕ More versions', function () {
      var b = sheetBits();
      if (!b.sh || !b.gen || b.gen.disabled) return;
      var keep = b.sh.querySelector('#sv-versions');
      if (!keep) { keep = el('div', 'sv-chips'); keep.id = 'sv-versions'; keep.style.cssText = 'margin-top:8px;gap:6px;'; b.sh.querySelector('#sv-out').before(keep); }
      var t = el('a', 'sv-ver');
      t.href = abs; t.target = '_blank'; t.rel = 'noopener';
      t.style.cssText = 'display:block;width:56px;height:56px;border-radius:10px;overflow:hidden;flex:0 0 auto;';
      t.innerHTML = isVid ? '<video muted playsinline preload="metadata" src="' + abs + '#t=0.1" style="width:100%;height:100%;object-fit:cover"></video>'
        : '<img alt="" src="' + abs + '" style="width:100%;height:100%;object-fit:cover">';
      keep.appendChild(t);
      b.gen.click();
    });
    if (isVid) chip('⏩ Extend', function () {
      window.sgSquadCreate.open('edit', '', null, { sourceUrl: abs, model: 'ltx-extend' });
    });
    /* Task 101 (owner, 2026-10-02): Different model, Reference, Tag, Sell. */
    chip('🔀 Different model', function () { openGrid(mode); });
    if (mode.resultKind === 'image' || isVid) chip('📎 Reference', function () {
      var b = sheetBits(); var keep = b.ta ? b.ta.value : '';
      if (isVid) { window.sgSquadCreate.open('edit', keep, null, { sourceUrl: abs }); toast('Your clip is the reference — say what should change.', 'info', 3000); return; }
      state.image.__ref = abs;
      window.sgSquadCreate.open('image', keep);
      toast('Reference attached — describe the new image.', 'info', 3000);
    });
    chip('🏷️ Tag', function () {
      var cur = (shareInfo && shareInfo.tags) || '';
      var t = window.prompt('Tag people and topics (they go on your post):', cur || '@friend #gym #scangym');
      if (t == null) return;
      t = String(t).replace(/[<>]/g, '').trim().slice(0, 200);
      shareInfo = shareInfo || {};
      var base = (shareInfo.shareText || 'Made with ScanGym').replace(/\n\n[@#][^\n]*$/, '');
      shareInfo.tags = t;
      shareInfo.shareText = t ? base + '\n\n' + t : base;
      toast(t ? 'Tagged — Post and Caption will include: ' + t : 'Tags removed.', 'success', 3000);
    });
    chip('💰 Sell', function () {
      if (typeof window._sgShopOpenSell !== 'function') { location.href = '/shop'; return; }
      window._sgShopOpenSell({ sourceUrl: abs, kind: isVid ? 'video' : mode.resultKind });
    });
    return row;
  }

  // ── My Creations ────────────────────────────────────────────────────────
  /**
   * Everything this creator has made, every mode, newest first.
   *
   * What this replaces: per-mode history, so a creator saw their clips inside
   * the Video sheet and their images inside the Image sheet and nowhere saw
   * their work. Worse, the row carried the url but not the prompt, so a good
   * result could not be run again — the output was effectively disposable.
   * Each row here can be replayed, re-shared with the referral link, or loaded
   * back into the prompt box to tweak.
   * @see server/routes/squad-create.js GET /library
   */
  /**
   * The billing side of the same sheet: is there a card, is anything owed, is
   * Create paused. Cheap, cached per sheet open, and silent for a visitor —
   * a signed-out creator gets 401 and the sign-in note already covers them.
   * @see server/routes/squad-billing.js GET /status
   */
  function loadBilling(sh, mode) {
    if (billing) { refreshQuota(sh, mode); return; }
    fetch('/api/squad-billing/status').then(function (r) {
      return r.status === 401 ? null : r.json();
    }).then(function (d) {
      if (!d) return;
      billing = d;
      refreshQuota(sh, mode);
    }).catch(function () {});
  }

  /**
   * "Add a card" without leaving the sheet where possible.
   *
   * Card handling lives in one place app-wide (window.sgCards), so this hands
   * off to the app's own wallet screen rather than building a second card form
   * that would need its own Stripe wiring and its own bugs.
   */
  function cardPrompt(message) {
    var box = el('div', 'sv-warn');
    box.innerHTML = '💳 ' + (message || 'Add a card to start creating.') + ' ';
    var b = el('span', 'sv-mchip', 'Add a card');
    b.style.cssText = 'display:inline-block;margin-left:6px;background:linear-gradient(135deg,#FF6D00,#E66200);border:none;color:#fff;font-weight:700;';
    b.addEventListener('click', function () {
      if (typeof window._loadWalletScreen === 'function') { window._loadWalletScreen(); return; }
      toast('Open Wallet → Cards to add a card, then come back.', 'info', 4000);
    });
    box.appendChild(b);
    return box;
  }

  function loadHistory(sh, mode) {
    fetch('/api/squad-create/library?limit=12').then(function (r) {
      if (r.status === 401) return null; // signed out: the note already says so
      return r.json();
    }).then(function (d) {
      if (!d) return;
      shareInfo = { refLink: d.refLink, shareText: d.shareText };
      var box = sh.querySelector('#sv-history');
      if (!box) return;
      var items = (d.items || []).filter(function (j) { return j.status === 'done' && (j.url || j.text); });
      if (!items.length) { box.textContent = ''; return; }
      box.innerHTML = '';
      var head = el('div', '', 'My Creations');
      head.style.cssText = 'margin:16px 0 6px;color:#cbd5e1;font-weight:700;text-align:left;';
      box.appendChild(head);
      items.slice(0, 8).forEach(function (j) {
        var icon = { video: '🎬', image: '🖼️', audio: '🎙️', music: '🎵', text: '✍️' }[j.kind] || '✨';
        var row = el('div', 'sv-set');
        row.style.cursor = 'pointer';
        var label = icon + ' ' + (j.prompt || j.kind).slice(0, 34) + ((j.prompt || '').length > 34 ? '…' : '');
        row.appendChild(el('span', '', label));
        var open = el('span', 'sv-val', j.kind === 'text' ? '📋 Copy' : '▶ Open');
        row.appendChild(open);
        row.addEventListener('click', function () {
          var out = sh.querySelector('#sv-out');
          if (j.kind === 'text') { showText(out, j.text || j.prompt); return; }
          /* Show it in whichever player the creation needs, not whichever mode
             the sheet happens to be on. */
          showResult(out, j.url, { resultKind: j.kind === 'image' ? 'image' : (j.kind === 'video' ? 'video' : 'audio') }, j.id);
          var ta = sh.querySelector('.sv-prompt');
          if (ta && !ta.value && j.prompt) ta.value = j.prompt; // tweak-and-rerun
        });
        box.appendChild(row);
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

  // sg-rail-ui.js owns the app's one icon table and exports it; read it here so
  // ScanSquad draws the same white line icons as every other rail instead of its
  // own colour emoji. Resolved at render time, not at load: the table arrives
  // with a deferred script and the emoji stays as the last-resort fallback.
  var ICON_KEYS = {
    text: 'pen', image: 'image', video: 'film', audio: 'mic',
    music: 'music', edit: 'clapper', twin: 'person', clipping: 'scissors', ugc: 'phone'
  };
  // Task 53: each Create button shows its own small animated GIF (made once
  // with ChatGPT gpt-image-1-mini, animated offline, ~30KB each). Falls back to
  // the line icon if the GIF fails to load.
  var GIF_KEYS = { text: 1, image: 1, video: 1, audio: 1, music: 1, edit: 1, twin: 1, clipping: 1, ugc: 1 };
  function iconFor(mode) {
    var table = (typeof window !== 'undefined' && window.SG_ICONS) || {};
    if (GIF_KEYS[mode.key]) {
      return '<img class="sv-gif" src="/img/create-gif/' + mode.key + '.gif?v=1" alt="" width="28" height="28" decoding="async" ' +
        'onerror="this.outerHTML=this.getAttribute(\'data-fb\')||\'\'" data-fb="' +
        String(table[ICON_KEYS[mode.key]] || mode.icon).replace(/"/g, '&quot;') + '">';
    }
    return table[ICON_KEYS[mode.key]] || mode.icon;
  }

  function makeBtn(mode) {
    var b = el('div', BTN_ID);
    b.setAttribute('data-mode', mode.key);
    var live = isConfigured(mode);
    if (!live) b.classList.add('sv-off');
    b.innerHTML = '<div class="sv-circle"><span class="sv-dot ' + (live ? 'live' : 'soon') + '"></span>' +
      iconFor(mode) + '</div><div class="sv-label">' + mode.label + '</div>';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openSheet(mode); });
    b.addEventListener('pointerdown', function () { warmMode(mode); }, { passive: true });
    return b;
  }

  function makeRail(floating) {
    var r = el('div');
    r.id = RAIL_ID;
    if (floating) r.classList.add('sv-float');
    visibleModes().forEach(function (m) { r.appendChild(makeBtn(m)); });
    return r;
  }

  /** Repaint the live/soon dots once the server registry lands. */
  function paintDots() {
    var r = document.getElementById(RAIL_ID);
    if (!r || !modeStatus) return;
    MODES.forEach(function (m) {
      var b = r.querySelector('.' + BTN_ID + '[data-mode="' + m.key + '"]');
      if (!b) return;
      if (isHidden(m)) { b.remove(); return; }
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
      /* Left the tab: drop the sheet without touching history. sync() runs on a
         timer, and a history.back() from a timer would drag the visitor back to
         a page they had just left. */
      closeSheet(true);
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

  /* Voice entry point (chat-agent.js SGScreen open_create): open a mode with the
   * creator's idea already typed in; for text, show the copy the voice tool wrote. */
  window.sgSquadCreate = {
    open: function (key, prompt, result, opts) {
      var mode = null;
      for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) mode = MODES[i];
      if (!mode) return false;
      /* Create Studio hands over the tile that was tapped: preselect that
         model so the sheet opens on it, priced, rather than on the default. */
      if (opts && opts.model) { state[mode.key].__model = opts.model; state[mode.key].__price = null; state[mode.key].__pricePence = null; }
      openSheet(mode);
      var sh = document.getElementById(SHEET_ID);
      if (!sh) return false;
      var ta = sh.querySelector('.sv-prompt');
      if (ta && prompt) ta.value = prompt;
      if (opts && opts.sourceUrl) {
        state[mode.key].__sourceUrl = opts.sourceUrl;
        var src = sh.querySelector('#sv-source-url'); if (src) src.value = opts.sourceUrl;
      }
      if (result) { var out = sh.querySelector('#sv-out'); if (out) showText(out, result); }
      return true;
    },
  };

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    window.addEventListener('popstate', sync);
    setInterval(sync, 800);
    /* Tab changed: drop this tab's rail in the same frame instead of up to 800ms
       later, which showed Create buttons on top of another tab. */
    document.addEventListener('sg:tabchange', function () { sync(); requestAnimationFrame(sync); });
    sync();
    loadModes().then(paintDots).then(openFromUrl);
  }

  /* Arriving from a reel's "Use this prompt" button: /creator?prompt=<text>.
     The reels page navigates rather than posting a message, because it runs both
     inside the app's iframe and standalone. Waits for loadModes() so the sheet
     knows which modes exist, strips the parameter from the URL afterwards (a
     refresh should not reopen the sheet), and opens Video — the mode a reel came
     from. An empty prompt still opens Create, per the owner's call. */
  function openFromUrl() {
    var p, mode;
    try {
      var qs = new URLSearchParams(location.search);
      p = qs.get('prompt');
      /* Chatbots (server/chatbot/create-media.js) and the MCP create_media tool
         send ?mode=image|video|audio|music. Anything else falls back to Video. */
      mode = qs.get('mode');
    } catch (e) { return; }
    if (!/^(image|video|audio|music|text)$/.test(mode || '')) mode = 'video';
    if (p === null) return;
    /* "Share & earn" remix links (/s/<id> → server/lib/share-remix.js) also
       pre-select the model, shape, length and resolution of the original. */
    try {
      var st = state[mode];
      var def = null;
      for (var i = 0; i < MODES.length; i++) if (MODES[i].key === mode) def = MODES[i];
      var pre = { aspectRatio: qs.get('ar'), durationSeconds: qs.get('dur'), resolution: qs.get('res') };
      if (st && def) {
        (def.settings || []).forEach(function (set) {
          var v = pre[set.key];
          if (v == null) return;
          for (var j = 0; j < set.values.length; j++) if (String(set.values[j]) === String(v)) st[set.key] = set.values[j];
        });
        var mdl = qs.get('model');
        if (mdl && /^[a-z0-9._:/-]{1,80}$/i.test(mdl)) st.__model = mdl;
      }
    } catch (e) { /* prefill is a nicety; the prompt still opens */ }
    if (!/^\/creator/.test(location.pathname)) return;
    try {
      var clean = location.pathname + location.hash;
      history.replaceState(null, '', clean);
    } catch (e) { /* keep going: the sheet matters more than the URL */ }
    var open = function () {
      var text = String(p).slice(0, 600);
      if (window.sgSquadCreate && (window.sgSquadCreate.open(mode, text) || window.sgSquadCreate.open('video', text))) return;
      setTimeout(open, 300);
    };
    setTimeout(open, 150);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
