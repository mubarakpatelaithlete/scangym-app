/**
 * Voice, always on — the front door instead of a button.
 *
 * Section 9 of the product vision: "Not 5 clicks, not 4, not 3, not 2, not 1 —
 * you just say it, and the product is delivered, with a human-like voice."
 *
 * Browsers will not open a microphone on a cold page load with no user gesture,
 * so this file gets as close to zero as the web allows and stays there:
 *
 *   • First ever visit — the very first thing you touch anywhere on the page
 *     (a tap, a scroll, a key) arms the voice. Not a dedicated tap on a mic.
 *   • Every visit after that — permission is already granted, so voice arms
 *     itself the moment the page is ready. Zero clicks. You just talk.
 *   • It follows you across tabs: Book, Scan Squad, Partner each hand over to
 *     their own agent while the conversation stays live.
 *   • "End voice" is remembered for a day, so no means no.
 */
(function () {
  'use strict';

  var OPT_OUT_KEY = 'sg_voice_off_until';
  var DAY = 24 * 60 * 60 * 1000;
  var armed = false;
  var arming = false;

  function agents() {
    return [window.sgBookChat, window.sgSquadChat, window.sgPartnerChat].filter(Boolean);
  }

  function current() {
    var list = agents();
    for (var i = 0; i < list.length; i++) {
      if (list[i].onTab && list[i].onTab()) return list[i];
    }
    return null;
  }

  function optedOut() {
    try {
      var until = parseInt(localStorage.getItem(OPT_OUT_KEY) || '0', 10);
      return until > Date.now();
    } catch (e) { return false; }
  }

  function optOut() {
    try { localStorage.setItem(OPT_OUT_KEY, String(Date.now() + DAY)); } catch (e) {}
  }

  function usable() {
    return !!(window.SGVoice && window.SGVoice.canRecord && window.SGVoice.canRecord());
  }

  /** Reels plays audio of its own; a live mic there would only hear the reel. */
  function noisyPage() {
    var v = document.querySelector('video');
    return !!(v && !v.paused && !v.muted && v.volume > 0);
  }

  function live() {
    var a = current();
    return !!(a && a.isLive && a.isLive());
  }

  function arm(reason) {
    if (arming || live() || optedOut() || !usable() || noisyPage()) return;
    var a = current();
    if (!a || !a.startLive) return;
    arming = true;
    window.SGVoice.ready()
      .then(function (on) {
        arming = false;
        if (!on) return;              // permission refused — typing still works
        armed = true;
        a.startLive();
      })
      .catch(function () { arming = false; });
    return reason;
  }

  /** Already granted before? Then no gesture is needed at all — open straight up. */
  function armIfAlreadyTrusted() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      navigator.permissions.query({ name: 'microphone' }).then(function (status) {
        if (status.state === 'granted') arm('granted');
        status.onchange = function () { if (status.state === 'granted') arm('granted'); };
      }).catch(function () {});
    } catch (e) {}
  }

  /** Otherwise: whatever you touch first is the thing that turns voice on. */
  function armOnFirstTouch() {
    var events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    function once() {
      events.forEach(function (ev) { window.removeEventListener(ev, once, true); });
      arm('first-gesture');
    }
    events.forEach(function (ev) {
      window.addEventListener(ev, once, { capture: true, passive: true });
    });
  }

  /** Moving between tabs should hand the live conversation to the new agent. */
  var lastPath = location.pathname;
  function followTabs() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (!armed || optedOut()) return;
    agents().forEach(function (a) {
      if (a.isLive && a.isLive() && a.onTab && !a.onTab() && a.endLive) a.endLive();
    });
    setTimeout(function () { arm('tab-change'); }, 250);
  }

  /** "End voice" means a day off, not five seconds off. */
  function watchOptOut() {
    document.addEventListener('click', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!el) return;
      var id = el.id || '';
      if (/live-(end|type)$/.test(id)) { armed = false; optOut(); }
    }, true);
  }

  function start() {
    if (!usable()) return;
    watchOptOut();
    armIfAlreadyTrusted();
    armOnFirstTouch();
    setInterval(followTabs, 600);
  }

  function boot() {
    // chat-agent.js and the personalities are deferred; wait for them, briefly.
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (current() || tries > 40) { clearInterval(t); start(); }
    }, 150);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.SGVoiceAlways = {
    arm: arm,
    isArmed: function () { return armed; },
    optOut: optOut,
    optedOut: optedOut,
  };
})();
