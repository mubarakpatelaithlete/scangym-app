/**
 * Squad Create — "Create Video" on the ScanSquad tab.
 *
 * ElevenLabs-mobile-style flow, in ScanGym dark brand: rail button → bottom
 * sheet → template chips → prompt → model chip → settings → Generate →
 * inline preview → native Share. Backend is /api/squad-video (Veo 3.1 Fast
 * on the server's Gemini key); the sheet asks /api/squad-video/health on
 * open and, when the key can't render video, says so and points at the
 * ready-to-post clip library instead of showing a Generate that would fail.
 *
 * Placement follows the profile-rail.js lesson: the ScanSquad tab (/creator)
 * renders its own native right rail in the app bundle, so the Create button
 * is PREPENDED into that rail when it exists and only floats when it doesn't.
 * Only the Video mode is wired; Image / Lip sync segments and the non-Veo
 * models are visible but marked coming-soon — no dead primary actions.
 *
 * Settings (duration / resolution / audio / aspect) are real controls: they
 * are sent to /generate and the server whitelists them. They used to be a
 * single decorative "8s · audio" label, which is worse than showing nothing —
 * it told the user they had chosen something when nothing was being sent.
 *
 * History comes from /api/squad-video/history, so clips survive a deploy and
 * a new session. Remaining daily renders come from the same payload rather
 * than being discovered by hitting a 429.
 */
(function () {
  'use strict';

  var ROUTE = /^\/(creator|scansquad)(\/|$)/;
  var BTN_ID = 'sg-sv-btn';
  var SHEET_ID = 'sg-sv-sheet';
  var POLL_MS = 4000;

  var TEMPLATES = [
    { label: '🏋️ Gym tour', prompt: 'Smooth cinematic walkthrough of a modern gym: squat racks, cardio zone, bright clean lighting, energetic people training, upbeat feel, vertical 9:16' },
    { label: '⚡ £5/day promo', prompt: 'High-energy promo: text "Any gym. £5/day. No membership." over fast cuts of people training in different gyms, bold orange accents, vertical 9:16' },
    { label: '🔥 Transformation', prompt: 'Motivational fitness transformation montage: early morning workouts, sweat, determination, sunrise through gym windows, inspiring tone, vertical 9:16' },
  ];

  var MODELS = [
    { key: 'veo-fast', name: 'Veo 3.1 Fast', desc: 'Fast, audio-backed, great motion — best for gym reels.', enabled: true, badge: 'DEFAULT' },
    { key: 'gemini-omni', name: 'Gemini Omni Flash', desc: 'Physics-aware, up to 4K.', enabled: false, badge: 'SOON' },
    { key: 'minimax', name: 'MiniMax H3', desc: 'Near-instant, strong aesthetics.', enabled: false, badge: 'SOON' },
    { key: 'sora', name: 'Sora 2', desc: 'Cinematic, longer shots.', enabled: false, badge: 'SOON' },
  ];

  var health = null; // null=unknown, {available:bool,...}
  var job = null; // {id, timer}

  function toast(m, k, t) { if (typeof window.sgToast === 'function') window.sgToast(m, k || 'info', t || 3000); }

  // ── styles ──────────────────────────────────────────────────────────────
  var css = [
    '#' + BTN_ID + '{display:flex;flex-direction:column;align-items:center;gap:2px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '#' + BTN_ID + ' .sv-circle{width:44px;height:44px;border-radius:50%;background:rgba(255,109,0,.18);border:1px solid rgba(255,109,0,.5);backdrop-filter:blur(12px);box-shadow:0 0 14px rgba(255,109,0,.3);display:flex;align-items:center;justify-content:center;font-size:19px;transition:transform .15s;}',
    '#' + BTN_ID + ':active .sv-circle{transform:scale(.92);}',
    '#' + BTN_ID + ' .sv-label{font-size:10px;color:#fff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);}',
    '#' + BTN_ID + '.sv-float{position:fixed;top:120px;right:10px;z-index:8990;}',
    '#sg-sv-overlay{position:fixed;inset:0;background:rgba(3,6,12,.6);z-index:9490;opacity:0;transition:opacity .25s;}',
    '#sg-sv-overlay.open{opacity:1;}',
    '#' + SHEET_ID + '{position:fixed;left:0;right:0;bottom:0;max-height:82vh;overflow-y:auto;background:#101a2e;border-radius:20px 20px 0 0;border-top:1px solid #24344f;box-shadow:0 -12px 40px rgba(0,0,0,.6);z-index:9491;padding:10px 16px calc(20px + env(safe-area-inset-bottom,0px));transform:translateY(100%);transition:transform .3s cubic-bezier(.32,.72,0,1);scrollbar-width:none;}',
    '#' + SHEET_ID + '::-webkit-scrollbar{display:none;}',
    '#' + SHEET_ID + '.open{transform:translateY(0);}',
    '.sv-handle{width:38px;height:4px;border-radius:2px;background:#33415c;margin:2px auto 12px;}',
    '.sv-seg{display:flex;background:#0b1424;border-radius:11px;padding:3px;margin-bottom:12px;}',
    '.sv-seg div{flex:1;text-align:center;font-size:12px;color:#7d8ba3;padding:7px 0;border-radius:9px;font-weight:600;cursor:pointer;}',
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
    '.sv-gen:disabled{opacity:.5;box-shadow:none;}',
    '.sv-note{font-size:11.5px;color:#94a3b8;text-align:center;margin-top:10px;line-height:1.45;}',
    '.sv-warn{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35);border-radius:12px;padding:10px 12px;color:#fbbf24;font-size:12px;margin-bottom:10px;line-height:1.45;}',
    '.sv-video{width:100%;border-radius:14px;margin-top:12px;background:#000;max-height:52vh;}',
    '.sv-mitem{display:flex;gap:10px;padding:10px 2px;border-bottom:1px solid #1a2740;align-items:flex-start;cursor:pointer;}',
    '.sv-mitem.off{opacity:.45;}',
    '.sv-mitem b{color:#fff;font-size:12.5px;}',
    '.sv-mitem p{color:#7d8ba3;font-size:10.5px;margin:2px 0 0;}',
    '.sv-badge{font-size:8px;background:#1e2c47;color:#93a4bd;padding:2px 6px;border-radius:6px;font-weight:700;margin-left:6px;}',
    '.sv-badge.sel{background:rgba(255,109,0,.18);color:#FF6D00;}',
    '.sv-prog{display:flex;align-items:center;gap:10px;margin-top:14px;color:#cbd5e1;font-size:12.5px;}',
    '.sv-spin{width:18px;height:18px;border:2px solid rgba(255,255,255,.2);border-top-color:#FF6D00;border-radius:50%;animation:svspin .7s linear infinite;flex-shrink:0;}',
    '@keyframes svspin{to{transform:rotate(360deg)}}',
  ].join('');

  // ── sheet ───────────────────────────────────────────────────────────────
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  var state = { aspectRatio: '9:16', durationSeconds: 8, resolution: '720p', generateAudio: true };
  var quota = null;

  var SETTINGS = [
    { key: 'aspectRatio', label: 'Aspect ratio', values: ['9:16', '16:9'] },
    { key: 'durationSeconds', label: 'Duration', values: [4, 6, 8], fmt: function (v) { return v + 's'; } },
    { key: 'resolution', label: 'Resolution', values: ['720p', '1080p'] },
    { key: 'generateAudio', label: 'Generate audio', values: [true, false], fmt: function (v) { return v ? 'On' : 'Off'; } },
  ];

  /** Tap a value to cycle to the next allowed one — no nested pickers on mobile. */
  function cycle(setting) {
    var vals = setting.values;
    var i = vals.indexOf(state[setting.key]);
    state[setting.key] = vals[(i + 1) % vals.length];
  }

  function shown(setting) {
    var v = state[setting.key];
    return setting.fmt ? setting.fmt(v) : String(v);
  }

  function openSheet() {
    closeSheet();
    var ov = el('div', '', '');
    ov.id = 'sg-sv-overlay';
    ov.addEventListener('click', closeSheet);
    document.body.appendChild(ov);

    var sh = el('div');
    sh.id = SHEET_ID;
    sh.appendChild(el('div', 'sv-handle'));

    var seg = el('div', 'sv-seg');
    ['Image', 'Video', 'Lip sync'].forEach(function (t) {
      var d = el('div', t === 'Video' ? 'on' : '', t);
      if (t !== 'Video') d.addEventListener('click', function () { toast(t + ' is coming soon — Video is live now.', 'info', 2500); });
      seg.appendChild(d);
    });
    sh.appendChild(seg);

    var warn = el('div', 'sv-warn');
    warn.style.display = 'none';
    warn.id = 'sv-warn';
    sh.appendChild(warn);

    var chips = el('div', 'sv-chips');
    TEMPLATES.forEach(function (t) {
      var c = el('div', 'sv-chip', t.label);
      c.addEventListener('click', function () {
        sh.querySelector('.sv-prompt').value = t.prompt;
      });
      chips.appendChild(c);
    });
    sh.appendChild(chips);

    var ta = el('textarea', 'sv-prompt');
    ta.placeholder = 'Describe your gym video…';
    sh.appendChild(ta);

    var row = el('div', 'sv-row');
    var mchip = el('div', 'sv-mchip', '🎞 Veo 3.1 Fast ›');
    mchip.addEventListener('click', function () { toggleModels(sh); });
    row.appendChild(mchip);
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
    SETTINGS.forEach(function (st) {
      var line = el('div', 'sv-set');
      line.appendChild(el('span', '', st.label));
      var val = el('span', 'sv-val', shown(st));
      val.addEventListener('click', function () {
        cycle(st);
        val.textContent = shown(st);
        refreshSummary(sh);
      });
      line.appendChild(val);
      settings.appendChild(line);
    });
    sh.appendChild(settings);

    var models = el('div');
    models.id = 'sv-models';
    models.style.display = 'none';
    MODELS.forEach(function (m) {
      var it = el('div', 'sv-mitem' + (m.enabled ? '' : ' off'),
        '<div><b>' + m.name + '<span class="sv-badge' + (m.enabled ? ' sel' : '') + '">' + m.badge + '</span></b><p>' + m.desc + '</p></div>');
      it.addEventListener('click', function () {
        if (!m.enabled) { toast(m.name + ' is coming soon.', 'info', 2200); return; }
        toggleModels(sh);
      });
      models.appendChild(it);
    });
    sh.appendChild(models);

    var gen = el('button', 'sv-gen', '⚡ Generate video');
    gen.addEventListener('click', function () { startJob(sh, ta, gen); });
    sh.appendChild(gen);

    var out = el('div');
    out.id = 'sv-out';
    sh.appendChild(out);
    var note = el('div', 'sv-note', 'Renders in ~1 min · 5 per day · then share straight to your socials');
    note.id = 'sv-note';
    sh.appendChild(note);

    var hist = el('div', 'sv-note');
    hist.id = 'sv-history';
    sh.appendChild(hist);

    refreshSummary(sh);
    loadHistory(sh);

    document.body.appendChild(sh);
    requestAnimationFrame(function () { ov.classList.add('open'); sh.classList.add('open'); });

    // runtime truth: can this deployment actually render?
    fetch('/api/squad-video/health').then(function (r) { return r.json(); }).then(function (d) {
      health = d;
      if (d.quota) { quota = d.quota; refreshQuota(sh); }
      if (d.available && quota && quota.remaining <= 0) {
        warn.style.display = 'block';
        warn.innerHTML = '\u23f3 You have used all <b>' + quota.limit + '</b> renders for today. Fresh batch tomorrow — or grab one of the ready-to-post clips in your library below.';
        gen.disabled = true;
      }
      if (!d.available) {
        warn.style.display = 'block';
        warn.innerHTML = '⏳ AI video rendering is still being switched on for this account (' + (d.reason || 'unavailable') + '). Meanwhile: <b>440+ ready-to-post clips</b> are in your ScanSquad library below.';
        gen.disabled = true;
      }
    }).catch(function () {});
  }

  function toggleModels(sh) {
    var m = sh.querySelector('#sv-models');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }

  function toggleSettings(sh) {
    var m = sh.querySelector('#sv-settings');
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
  }

  /** The one-line echo of the current settings, so the sheet reads at a glance. */
  function refreshSummary(sh) {
    var n = sh.querySelector('#sv-summary');
    if (!n) return;
    n.textContent = state.aspectRatio + ' · ' + state.durationSeconds + 's · ' + state.resolution +
      (state.generateAudio ? ' · 🔊' : ' · 🔇');
  }

  /** "2 of 5 left today", straight from the server rather than guessed. */
  function refreshQuota(sh) {
    var n = sh.querySelector('#sv-note');
    if (!n || !quota) return;
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
  function startJob(sh, ta, gen) {
    var prompt = (ta.value || '').trim();
    if (!prompt) { toast('Describe the video first — or tap a template.', 'info', 2500); return; }
    gen.disabled = true;
    var out = sh.querySelector('#sv-out');
    out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span>Sending to Veo 3.1 Fast…</span></div>';

    fetch('/api/squad-video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        aspectRatio: state.aspectRatio,
        durationSeconds: state.durationSeconds,
        resolution: state.resolution,
        generateAudio: state.generateAudio,
      }),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok || !res.d.jobId) throw new Error(res.d.error || 'could not start');
        if (res.d.quota) { quota = res.d.quota; refreshQuota(sh); }
        var start = Date.now();
        out.innerHTML = '<div class="sv-prog"><div class="sv-spin"></div><span id="sv-prog-t">Rendering… usually under a minute.</span></div>';
        job = { id: res.d.jobId };
        job.timer = setInterval(function () {
          fetch('/api/squad-video/status/' + job.id).then(function (r) { return r.json(); }).then(function (st) {
            if (st.status === 'done') {
              clearInterval(job.timer);
              showResult(out, st.videoUrl);
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

  function showResult(out, url) {
    out.innerHTML = '';
    var v = document.createElement('video');
    v.className = 'sv-video';
    v.src = url;
    v.controls = true;
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    out.appendChild(v);
    var row = el('div', 'sv-row');
    var share = el('div', 'sv-mchip', '📤 Share');
    share.style.cssText = 'background:linear-gradient(135deg,#FF6D00,#E66200);border:none;color:#fff;';
    share.addEventListener('click', function () {
      var abs = url.indexOf('http') === 0 ? url : location.origin + url;
      if (navigator.share) {
        navigator.share({ title: 'My ScanGym clip', text: 'Made with ScanGym — any gym, £5/day.', url: abs }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(abs).then(function () { toast('Video link copied!', 'success', 2500); });
      }
    });
    row.appendChild(share);
    var dl = el('a', 'sv-mchip', '⬇ Download');
    dl.href = url;
    dl.download = 'scangym-clip.mp4';
    dl.style.textDecoration = 'none';
    row.appendChild(dl);
    out.appendChild(row);
  }

  // ── history ─────────────────────────────────────────────────────────────
  /**
   * Past clips for this user. Only finished ones are offered as links: a row
   * still 'running' after a deploy is real, but there is nothing to play yet.
   */
  function loadHistory(sh) {
    fetch('/api/squad-video/history').then(function (r) { return r.json(); }).then(function (d) {
      if (d.quota) { quota = d.quota; refreshQuota(sh); }
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
        a.addEventListener('click', function () { showResult(sh.querySelector('#sv-out'), j.video_url); });
        box.appendChild(a);
      });
    }).catch(function () {});
  }

  // ── rail button placement (native-rail-first, profile-rail.js lesson) ──
  function nativeRail() {
    var els = document.querySelectorAll('div[style*="flex-direction:column"]');
    for (var i = 0; i < els.length; i++) {
      var st = els[i].getAttribute('style') || '';
      if (/right:\s*(6|8|10|12|14|16)px/.test(st) && /top:\s*50%/.test(st) && els[i].getClientRects().length && !els[i].closest('#' + SHEET_ID)) return els[i];
    }
    return null;
  }

  function makeBtn(floating) {
    var b = el('div');
    b.id = BTN_ID;
    if (floating) b.classList.add('sv-float');
    b.innerHTML = '<div class="sv-circle">🎬</div><div class="sv-label">Create</div>';
    b.addEventListener('click', function (ev) { ev.stopPropagation(); openSheet(); });
    return b;
  }

  function sync() {
    var on = ROUTE.test(location.pathname);
    var btn = document.getElementById(BTN_ID);
    if (!on) {
      if (btn) btn.remove();
      closeSheet();
      return;
    }
    var host = nativeRail();
    if (host) {
      if (btn && (btn.parentNode !== host || btn.classList.contains('sv-float'))) { btn.remove(); btn = null; }
      if (!btn) host.insertBefore(makeBtn(false), host.firstChild);
    } else {
      if (btn && !btn.classList.contains('sv-float')) { btn.remove(); btn = null; }
      if (!btn) document.body.appendChild(makeBtn(true));
    }
  }

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    window.addEventListener('popstate', sync);
    setInterval(sync, 800);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
