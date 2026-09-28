/**
 * Channel button pre-warm.
 *
 * Every chatbot button on the Profile tab (Slack, Discord, Teams, WhatsApp,
 * Google Chat) used to do its network work *after* the tap: the handler called
 * /api/channels/<x>/install, waited for the JSON, and only then opened the
 * link. Measured live on www.scangym.com those endpoints answer in 130-230ms,
 * which is exactly what the buttons felt like — Slack 621ms, Google Chat
 * 382ms, Teams 250ms, Telegram 252ms, against ~30ms for every other button in
 * the app.
 *
 * Nothing about those URLs depends on the tap, so they are fetched once at
 * idle after first paint and cached on window.__sgChannelUrls. The open helpers
 * are wrapped so a warm cache opens the window synchronously inside the click
 * — no await, which also means no popup blocker — and a cold cache falls
 * straight through to the original async helper.
 *
 * Contracts this file keeps:
 *  - It never replaces behaviour, only short-circuits it. If the pre-warm
 *    failed, 404'd, or has not landed yet, the original function runs exactly
 *    as before, including its toasts.
 *  - It wraps whatever is on window at idle time, so it does not care whether
 *    app.ctr576.js or profile-rail.js defined the helper.
 *  - Nothing here throws into a caller; every step is guarded.
 */
'use strict';

(function () {
  var CACHE = (window.__sgChannelUrls = window.__sgChannelUrls || {});

  /* endpoint -> [fields to try, in order] */
  var SOURCES = {
    slack: ['/api/channels/slack/install', ['installUrl']],
    discord: ['/api/channels/discord/invite', ['preferredUrl', 'communityUrl', 'userInstallUrl', 'inviteUrl']],
    msteams: ['/api/channels/msteams/install', ['manifestUrl', 'installUrl']],
    whatsapp: ['/api/channels/whatsapp/number', ['number']]
  };

  function prewarm(key) {
    var src = SOURCES[key];
    if (!src || CACHE[key]) return;
    try {
      fetch(src[0], { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          for (var i = 0; i < src[1].length; i++) {
            if (d && d[src[1][i]]) { CACHE[key] = String(d[src[1][i]]); return; }
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function prewarmAll() {
    for (var k in SOURCES) { if (Object.prototype.hasOwnProperty.call(SOURCES, k)) prewarm(k); }
    wrap();
  }

  /** Replace fn with one that opens the cached URL synchronously when warm. */
  function fast(name, key, build) {
    var original = window[name];
    if (typeof original !== 'function' || original.__sgFast) return;
    var wrapped = function () {
      var hit = CACHE[key];
      if (hit) {
        try {
          window.open(build ? build(hit) : hit, '_blank');
          return;
        } catch (e) { /* fall through to the original */ }
      }
      return original.apply(this, arguments);
    };
    wrapped.__sgFast = true;
    window[name] = wrapped;
  }

  function wrap() {
    fast('_sgOpenSlack', 'slack');
    fast('_sgOpenDiscord', 'discord');
    fast('_sgOpenMSTeams', 'msteams');
    fast('_sgOpenWhatsApp', 'whatsapp', function (num) {
      var n = String(num).replace(/[^0-9]/g, '') || '12052094512';
      return 'https://wa.me/' + n + '?text=Hi%20ScanGym!%20I%20want%20to%20find%20gyms%20near%20me';
    });
  }

  /* The helpers are defined by deferred scripts, so wrap again a moment later
     in case this file won the race. Cheap, bounded, idempotent. */
  function start() {
    prewarmAll();
    setTimeout(wrap, 1200);
    setTimeout(wrap, 4000);
  }

  function idle() {
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 400);
  }

  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle);
})();
