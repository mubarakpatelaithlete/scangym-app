/**
 * Profile Rail — chat with ScanGym from the apps you already use.
 *
 * The Profile tab had no right-edge action rail, which every other primary tab
 * has (Reels: Share/Save, Book: Near Me/Search/Date). This adds one, and uses it
 * for the highest-value profile action: opening the ScanGym bot on the customer's
 * own messenger. The full channel list already lives on /channels, but nobody
 * standing in the Profile tab goes hunting for it — the rail puts the three
 * verified-live bots one tap away and previews the two that are still verifying.
 *
 * Style is pixel-matched to the Reels rail (measured off production):
 *   44×44 circle, rgba(0,0,0,.4) bg, 1px rgba(255,255,255,.12) border,
 *   blur(12px) backdrop, 0 2px 10px rgba(0,0,0,.25) shadow,
 *   10px/600 white label, right offset 10px.
 *
 * Channel gating:
 *   - telegram / discord / slack are verified live end-to-end → full colour +
 *     green dot, but only while /api/chatbot/health (cheap, no deep probes)
 *     still reports the credential present. If a token is pulled, the dot and
 *     the button dim on the next load instead of lying.
 *   - msteams / claude are configured but not yet verified inbound → dimmed
 *     with an amber dot. Flip VERIFIED_LIVE below when verification lands;
 *     until then they still work (Teams sideload flow, Claude MCP URL copy),
 *     they just don't claim to be live.
 *
 * Actions reuse the app's existing channel helpers (_sgConnectChannel,
 * _sgOpenDiscord, _sgOpenSlack, _sgOpenMSTeams) so connect-tracking and the
 * real install URLs stay in one place — this file owns pixels, not plumbing.
 *
 * Placement: the logged-in /more hub (and the logged-out /more QR page)
 * already render a native TikTok-style rail (Creator/Partner/Apps…) baked
 * into the app bundle at right:10px/top:50%. Floating a second fixed rail
 * on top of it stacked two button columns over each other. So: when a
 * native rail exists on the page we EXTEND it (append our buttons inside,
 * and let it scroll), and only when there is none (e.g. /more/profile
 * logged out) do we float our own.
 */
(function () {
  'use strict';

  var ROUTE = /^\/(profile|more)(\/|$)/; // same area profile-chat.js owns
  var RAIL_ID = 'sg-profile-rail';
  var MCP_URL = 'https://scangym.com/mcp';

  // Channels verified live end-to-end (deep probe, 2026-08-31). Others render
  // dimmed+amber until verified. Health check below can only demote, not promote.
  var VERIFIED_LIVE = { telegram: true, discord: true, slack: true, msstore: true, install: true, tiktok: true };
  // Social: tiktok.com/@scangym verified live (real profile page renders).
  // instagram.com/scangym + facebook.com/scangym sit behind login walls we
  // can't verify through, so they render amber until confirmed. x.com/scangym
  // is owned by an unrelated account ("Nworah jekwu") and youtube/@scangym
  // 404s — both are omitted, same no-dead-links policy as the app stores.
  // App stores: only ones that actually resolve get a button. Google Play is on a
  // closed testing track (public 404) and the Apple listing does not exist yet —
  // same policy as the Apps page: no dead links, they appear here once live.
  var MS_STORE_URL = 'https://apps.microsoft.com/detail/9nh8vrn834dv';

  // ── Styles (injected once) ─────────────────────────────────────────────
  var css = [
    '#' + RAIL_ID + '{position:fixed;top:120px;right:10px;bottom:190px;display:flex;flex-direction:column;gap:11px;align-items:center;z-index:8990;overflow-y:auto;overflow-x:visible;scrollbar-width:none;padding:2px 2px 6px;}',
    '#' + RAIL_ID + '::-webkit-scrollbar{display:none;}',
    '#' + RAIL_ID + ' .sg-pr-sec{font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.35);font-weight:700;text-align:center;width:44px;margin-bottom:-4px;}',
    '#' + RAIL_ID + ' .sg-pr-btn{display:flex;flex-direction:column;align-items:center;gap:2px;width:44px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '#' + RAIL_ID + ' .sg-pr-btn:active .sg-pr-circle{transform:scale(.92);}',
    '#' + RAIL_ID + ' .sg-pr-circle{width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 2px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;position:relative;transition:transform .15s;}',
    '#' + RAIL_ID + ' .sg-pr-circle svg{width:22px;height:22px;}',
    '#' + RAIL_ID + ' .sg-pr-label{font-size:10px;color:#fff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);white-space:nowrap;}',
    '#' + RAIL_ID + ' .sg-pr-dot{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;border:2px solid #0f172a;}',
    '#' + RAIL_ID + ' .sg-pr-dot.live{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.8);}',
    '#' + RAIL_ID + ' .sg-pr-dot.pending{background:#f59e0b;}',
    '#' + RAIL_ID + ' .sg-pr-btn.pending .sg-pr-circle{opacity:.55;}',
    '#' + RAIL_ID + ' .sg-pr-btn.pending .sg-pr-label{color:rgba(255,255,255,.45);}',
    '@media (min-width:768px){#' + RAIL_ID + '{right:max(10px,calc(50vw - 230px));}}',
    // native-rail mode: our buttons adopt the host rail look; host gets a scroll cap
    '.sg-pr-host-capped{max-height:calc(100vh - 240px);overflow-y:auto!important;scrollbar-width:none;padding:2px;}',
    '.sg-pr-host-capped::-webkit-scrollbar{display:none;}',
    '.sg-pr-btn{display:flex;flex-direction:column;align-items:center;gap:2px;width:44px;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.sg-pr-btn:active .sg-pr-circle{transform:scale(.92);}',
    '.sg-pr-circle{width:44px;height:44px;border-radius:50%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 2px 10px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;position:relative;transition:transform .15s;}',
    '.sg-pr-circle svg{width:22px;height:22px;}',
    '.sg-pr-label{font-size:10px;color:#fff;font-weight:600;text-shadow:0 1px 3px rgba(0,0,0,.8);white-space:nowrap;}',
    '.sg-pr-dot{position:absolute;top:-2px;right:-2px;width:12px;height:12px;border-radius:50%;border:2px solid #0f172a;}',
    '.sg-pr-dot.live{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.8);}',
    '.sg-pr-dot.pending{background:#f59e0b;}',
    '.sg-pr-btn.pending .sg-pr-circle{opacity:.55;}',
    '.sg-pr-btn.pending .sg-pr-label{color:rgba(255,255,255,.45);}',
    '.sg-pr-sec{font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.35);font-weight:700;text-align:center;width:44px;}',
  ].join('');

  // ── Brand icons (inline SVG, official palette) ─────────────────────────
  var ICONS = {
    telegram: '<svg viewBox="0 0 24 24" fill="none"><path d="M21.5 4.3L2.8 11.4c-.9.35-.9 1.6.02 1.9l4.7 1.5 1.8 5.5c.25.75 1.2.95 1.7.35l2.5-2.9 4.7 3.5c.6.45 1.5.1 1.65-.65L23.9 5.1c.2-1-.75-1.8-1.7-1.4z" fill="#29b6f6"/></svg>',
    discord: '<svg viewBox="0 0 24 24" fill="none"><path d="M19.5 5.3A17 17 0 0015.3 4l-.25.5a15.7 15.7 0 014 1.3c-2-1-4.2-1.4-6.4-1.4-2.2 0-4.4.4-6.4 1.4a15.7 15.7 0 014-1.3L9.7 4A17 17 0 005.5 5.3C2.9 9 2.2 12.6 2.5 16.2A16 16 0 007.3 19l.6-1a11 11 0 01-1.9-.9l.4-.35c3.6 1.7 7.6 1.7 11.2 0l.4.35c-.6.35-1.2.65-1.9.9l.6 1a16 16 0 004.8-2.8c.4-4.2-.55-7.8-2.6-11zM9.3 14c-.8 0-1.5-.75-1.5-1.7s.65-1.7 1.5-1.7c.85 0 1.55.8 1.5 1.7 0 .95-.65 1.7-1.5 1.7zm5.4 0c-.8 0-1.5-.75-1.5-1.7s.65-1.7 1.5-1.7c.85 0 1.55.8 1.5 1.7 0 .95-.65 1.7-1.5 1.7z" fill="#7289da"/></svg>',
    slack: '<svg viewBox="0 0 24 24"><path d="M5.1 15.1a2.1 2.1 0 11-2.1-2.1h2.1v2.1zm1.05 0a2.1 2.1 0 014.2 0v5.25a2.1 2.1 0 11-4.2 0V15.1z" fill="#e01e5a"/><path d="M8.25 5.1A2.1 2.1 0 116.15 3v2.1H8.25zm0 1.05a2.1 2.1 0 010 4.2H3A2.1 2.1 0 013 6.15h5.25z" fill="#36c5f0"/><path d="M18.9 8.25A2.1 2.1 0 1121 6.15v2.1h-2.1zm-1.05 0a2.1 2.1 0 01-4.2 0V3a2.1 2.1 0 014.2 0v5.25z" fill="#2eb67d"/><path d="M15.75 18.9A2.1 2.1 0 1117.85 21h-2.1v-2.1zm0-1.05a2.1 2.1 0 010-4.2H21a2.1 2.1 0 010 4.2h-5.25z" fill="#ecb22e"/></svg>',
    msteams: '<svg viewBox="0 0 24 24"><path d="M13 6.2h7.2c.44 0 .8.36.8.8v9.9a2.4 2.4 0 01-2.4 2.4h-3A4.8 4.8 0 0013 15V6.2z" fill="#5b5fc7"/><circle cx="17.4" cy="4.6" r="2.2" fill="#5b5fc7"/><rect x="1.5" y="7.5" width="11.5" height="10.5" rx="1" fill="#4b53bc"/><text x="7.2" y="15.2" font-size="8" fill="#fff" text-anchor="middle" font-family="Arial" font-weight="700">T</text></svg>',
    claude: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#d97757"/><path d="M12 6l1.5 3.5L17 11l-3.5 1.5L12 16l-1.5-3.5L7 11l3.5-1.5z" fill="#fff"/></svg>',
    msstore: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8.5" height="8.5" fill="#F25022"/><rect x="12.5" y="3" width="8.5" height="8.5" fill="#7FBA00"/><rect x="3" y="12.5" width="8.5" height="8.5" fill="#00A4EF"/><rect x="12.5" y="12.5" width="8.5" height="8.5" fill="#FFB900"/></svg>',
    install: '<svg viewBox="0 0 24 24" fill="none" stroke="#FF6D00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v10"/><path d="M8 9l4 4 4-4"/><path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M16.6 3c.35 1.9 1.5 3.35 3.4 3.75v3.1c-1.35.05-2.55-.35-3.85-1.15v5.85c0 4.05-3.05 6.05-5.95 5.4-2.55-.55-4.2-2.85-3.85-5.4.4-2.85 3-4.55 5.6-4.1v3.15c-.85-.25-1.75-.1-2.3.6-.9 1.05-.45 2.7.9 3.05 1.25.35 2.45-.55 2.45-2.05V3h3.6z" fill="#fff"/><path d="M16.6 3c.35 1.9 1.5 3.35 3.4 3.75v1.5c-1.9-.4-3.05-1.85-3.4-3.75V3z" fill="#25f4ee"/><path d="M12.35 10.45v1.6c-.85-.25-1.75-.1-2.3.6-.9 1.05-.45 2.7.9 3.05l-.6 1.4c-2.1-.75-2.95-3.35-1.6-5.15.8-1.1 2.2-1.7 3.6-1.5z" fill="#fe2c55"/></svg>',
    instagram: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="5.5" stroke="url(#igg)" stroke-width="2"/><circle cx="12" cy="12" r="4.2" stroke="url(#igg)" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.3" fill="#e1306c"/><defs><linearGradient id="igg" x1="3" y1="21" x2="21" y2="3"><stop stop-color="#fd5949"/><stop offset=".5" stop-color="#d6249f"/><stop offset="1" stop-color="#285AEB"/></linearGradient></defs></svg>',
    facebook: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#1877f2"/><path d="M15.5 12.6h-2.4V20h-2.9v-7.4H8.3v-2.7h1.9V8.3c0-2 1.2-3.1 3-3.1.9 0 1.8.15 1.8.15v2h-1c-1 0-1.3.6-1.3 1.25v1.3h2.3l-.5 2.7z" fill="#fff"/></svg>',
  };

  // PWA install: capture the browser prompt when offered so the Install button
  // can trigger it natively; otherwise fall back to add-to-home-screen steps.
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredInstall = e;
  });

  function toast(msg, kind, ms) {
    if (typeof window.sgToast === 'function') window.sgToast(msg, kind || 'info', ms || 4000);
  }

  // ── Actions ────────────────────────────────────────────────────────────
  var ACTIONS = {
    telegram: function () {
      if (typeof window._sgConnectChannel === 'function') {
        window._sgConnectChannel('telegram', 'https://t.me/ScanGymBot');
      } else {
        window.open('https://t.me/ScanGymBot', '_blank');
      }
    },
    discord: function () {
      if (typeof window._sgConnectChannel === 'function') window._sgConnectChannel('discord');
      if (typeof window._sgOpenDiscord === 'function') window._sgOpenDiscord();
      else window.open('https://discord.com', '_blank');
    },
    slack: function () {
      if (typeof window._sgConnectChannel === 'function') window._sgConnectChannel('slack');
      if (typeof window._sgOpenSlack === 'function') window._sgOpenSlack();
    },
    msteams: function () {
      if (typeof window._sgConnectChannel === 'function') window._sgConnectChannel('msteams');
      if (typeof window._sgOpenMSTeams === 'function') window._sgOpenMSTeams();
    },
    claude: function () {
      // Claude is an MCP connector, not a chat channel: hand the user the MCP
      // URL because Claude's UI is where the connection happens, not ours.
      var done = function () {
        toast('🔗 MCP link copied — in Claude: Settings → Connectors → Add custom connector → paste ' + MCP_URL, 'info', 8000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(MCP_URL).then(done).catch(function () {
          toast('In Claude: Settings → Connectors → Add custom connector → ' + MCP_URL, 'info', 8000);
        });
      } else {
        toast('In Claude: Settings → Connectors → Add custom connector → ' + MCP_URL, 'info', 8000);
      }
    },
    msstore: function () {
      window.open(MS_STORE_URL, '_blank');
    },
    tiktok: function () { window.open('https://www.tiktok.com/@scangym', '_blank'); },
    instagram: function () { window.open('https://instagram.com/scangym', '_blank'); },
    facebook: function () { window.open('https://facebook.com/scangym', '_blank'); },
    install: function () {
      if (deferredInstall) {
        deferredInstall.prompt();
        deferredInstall = null;
      } else if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
        toast('✅ ScanGym is already installed on this device.', 'success', 3000);
      } else {
        toast('📲 Install: open your browser menu → "Add to Home screen" (Android) or Share → "Add to Home Screen" (iPhone).', 'info', 7000);
      }
    },
  };

  // ── Health (cheap endpoint; can only demote a verified channel) ────────
  var health = null;
  function loadHealth() {
    fetch('/api/chatbot/health')
      .then(function (r) { return r.json(); })
      .then(function (d) { health = (d && d.channels) || null; sync(); })
      .catch(function () { health = null; });
  }

  function isLive(key) {
    if (!VERIFIED_LIVE[key]) return false;
    if (health && health.hasOwnProperty(key) && health[key] === false) return false; // credential pulled
    return true;
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function btn(key, label) {
    var live = isLive(key);
    var el = document.createElement('div');
    el.className = 'sg-pr-btn' + (live ? '' : ' pending');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Open ScanGym on ' + label + (live ? '' : ' (verifying)'));
    el.innerHTML =
      '<div class="sg-pr-circle">' +
      '<span class="sg-pr-dot ' + (live ? 'live' : 'pending') + '"></span>' +
      ICONS[key] +
      '</div><div class="sg-pr-label">' + label + '</div>';
    el.addEventListener('click', function () {
      if (!live) toast(label + ' bot is being verified — it may not answer yet.', 'info', 3500);
      ACTIONS[key]();
    });
    return el;
  }

  function sec(text) {
    var el = document.createElement('div');
    el.className = 'sg-pr-sec';
    el.textContent = text;
    return el;
  }

  // The app bundle's own rail: right:10px + top:50% + column flex, not ours.
  function nativeRail() {
    var els = document.querySelectorAll('div[style*="flex-direction:column"]');
    for (var i = 0; i < els.length; i++) {
      var st = els[i].getAttribute('style') || '';
      if (els[i].id !== RAIL_ID && /right:\s*10px/.test(st) && /top:\s*50%/.test(st) && els[i].offsetParent) return els[i];
    }
    return null;
  }

  function buttonList() {
    var frag = document.createDocumentFragment();
    frag.appendChild(sec('Chatbots'));
    frag.appendChild(btn('telegram', 'Telegram'));
    frag.appendChild(btn('discord', 'Discord'));
    frag.appendChild(btn('slack', 'Slack'));
    frag.appendChild(btn('msteams', 'Teams'));
    var ai = sec('AI');
    ai.style.marginTop = '4px';
    frag.appendChild(ai);
    frag.appendChild(btn('claude', 'Claude'));
    var apps = sec('Apps');
    apps.style.marginTop = '4px';
    frag.appendChild(apps);
    frag.appendChild(btn('msstore', 'MS Store'));
    frag.appendChild(btn('install', 'Install'));
    var social = sec('Social');
    social.style.marginTop = '4px';
    frag.appendChild(social);
    frag.appendChild(btn('tiktok', 'TikTok'));
    frag.appendChild(btn('instagram', 'Instagram'));
    frag.appendChild(btn('facebook', 'Facebook'));
    return frag;
  }

  function build() {
    var rail = document.createElement('div');
    rail.id = RAIL_ID;
    rail.appendChild(buttonList());
    return rail;
  }

  // ── Visibility (the app routes without firing popstate; poll like
  //    chat-agent.js does) ─────────────────────────────────────────────────
  var EXT_ID = 'sg-profile-rail-ext';
  function sync() {
    var onProfile = ROUTE.test(location.pathname);
    var floatEl = document.getElementById(RAIL_ID);
    var extEl = document.getElementById(EXT_ID);
    if (!onProfile) {
      if (floatEl) floatEl.remove();
      if (extEl) extEl.remove();
      return;
    }
    var host = nativeRail();
    if (host) {
      // native rail exists: extend it, never float a second column over it
      if (floatEl) floatEl.remove();
      if (extEl && extEl.parentNode !== host) { extEl.remove(); extEl = null; }
      if (extEl && extEl.getAttribute('data-health') !== String(!!health)) { extEl.remove(); extEl = null; }
      if (!extEl) {
        var wrap = document.createElement('div');
        wrap.id = EXT_ID;
        wrap.setAttribute('data-health', String(!!health));
        wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px;align-items:center;margin-top:4px;';
        wrap.appendChild(buttonList());
        host.appendChild(wrap);
        host.classList.add('sg-pr-host-capped');
      }
    } else {
      if (extEl) extEl.remove();
      if (!floatEl) {
        document.body.appendChild(build());
      } else if (floatEl.getAttribute('data-health') !== String(!!health)) {
        floatEl.replaceWith(build());
        var fresh = document.getElementById(RAIL_ID);
        if (fresh) fresh.setAttribute('data-health', String(!!health));
      }
    }
  }

  function init() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    loadHealth();
    window.addEventListener('popstate', sync);
    setInterval(sync, 800);
    sync();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
