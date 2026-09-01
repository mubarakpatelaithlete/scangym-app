/**
 * Voice, always on — the front door instead of a button.
 *
 * Section 9 of the product vision: "Not 5 clicks, not 4, not 3, not 2, not 1 —
 * you just say it, and the product is delivered, with a human-like voice."
 *
 * Browsers will not open a microphone on a cold page load with no user gesture,
 * so this file gets as close to zero as the web allows and stays there:
 *
 *   • First visit — the first deliberate thing you do (a tap or a key) arms the
 *     voice. Deliberate is the point: scrolling a feed is not a request to be
 *     listened to, and treating it as one is what made this feel invasive.
 *   • Once you have actually held a conversation, voice arms itself on every
 *     later visit with no gesture at all. Zero clicks — earned, not assumed.
 *   • It follows you across tabs: Book, Scan Squad, Partner each hand over to
 *     their own agent, and the conversation so far is handed over with it.
 *   • "End voice" is remembered until you turn it back on. No means no.
 */
(function () {
  'use strict';

  var OPT_OUT_KEY = 'sg_voice_off';          // '1' — no expiry, on purpose
  var LEGACY_OPT_OUT_KEY = 'sg_voice_off_until';
  // Set once the customer has actually spoken to us. Permission alone is not
  // consent to open the microphone on arrival: they may have granted it months ago
  // for something else entirely.
  var USED_KEY = 'sg_voice_used';
  var armed = false;
  var arming = false;

  function agents() {
    return [
      window.sgBookChat,
      window.sgSquadChat,
      window.sgPartnerChat,
      window.sgReelsChat,
      window.sgProfileChat,
    ].filter(Boolean);
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
      if (localStorage.getItem(OPT_OUT_KEY) === '1') return true;
      // Anyone who opted out under the old 24-hour scheme meant it then and still
      // means it now; carry them over instead of surprising them once it lapses.
      var until = parseInt(localStorage.getItem(LEGACY_OPT_OUT_KEY) || '0', 10);
      if (until > 0) {
        localStorage.setItem(OPT_OUT_KEY, '1');
        localStorage.removeItem(LEGACY_OPT_OUT_KEY);
        return true;
      }
      return false;
    } catch (e) { return false; }
  }

  /** Turning voice off stays off until something turns it back on. */
  function optOut() {
    try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch (e) {}
  }

  function optIn() {
    try { localStorage.removeItem(OPT_OUT_KEY); localStorage.removeItem(LEGACY_OPT_OUT_KEY); } catch (e) {}
  }

  /** Has this person ever actually talked to us? Set by chat-agent.js on a spoken turn. */
  function hasUsedVoice() {
    try { return localStorage.getItem(USED_KEY) === '1'; } catch (e) { return false; }
  }

  function usable() {
    return !!(window.SGVoice && window.SGVoice.canRecord && window.SGVoice.canRecord());
  }

  /**
   * Reels plays audio of its own, and a live mic would otherwise hear the reel and
   * transcribe it as if you had said it.
   *
   * This used to refuse to arm at all whenever any video was playing — which meant
   * voice was permanently off on Reels, the tab most visitors land on first. The
   * zero-click promise was being broken on the only screen most people ever saw.
   *
   * So instead of standing down, we duck. Two things this deliberately does NOT do:
   *
   *   • It does not mute. Hard-muting the reel someone is watching, with no visible
   *     cause, reads as the site breaking. We lower the volume and put it back.
   *   • It does not duck merely because a conversation is open. An armed microphone
   *     is not a conversation; only ducking once we are actually thinking or talking
   *     means a silent listener never touches the audio at all.
   */
  var ducked = [];
  var DUCK_TO = 0.15;

  function duckAudio() {
    if (ducked.length) return; // already ducked
    var vids = document.querySelectorAll('video, audio');
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      if (v.muted || v.paused) continue;
      ducked.push({ el: v, volume: v.volume });
      try { v.volume = Math.min(v.volume, DUCK_TO); } catch (e) {}
    }
  }

  function unduckAudio() {
    for (var i = 0; i < ducked.length; i++) {
      // Restore what it was, not 1.0: the customer may have set it themselves.
      try { ducked[i].el.volume = ducked[i].volume; } catch (e) {}
    }
    ducked = [];
  }

  /** True only while the assistant holds the floor — not merely while armed. */
  function holdingFloor() {
    if (!live()) return false;
    if (!window.SGVoice || !window.SGVoice.liveState) return false;
    var st = window.SGVoice.liveState();
    return st === 'thinking' || st === 'speaking';
  }

  /** Keeps the ducking in step with the conversation, whoever started or ended it. */
  var wasHolding = false;
  function followLive() {
    var now = holdingFloor();
    if (now === wasHolding) return;
    wasHolding = now;
    if (now) duckAudio(); else unduckAudio();
  }

  function live() {
    var a = current();
    return !!(a && a.isLive && a.isLive());
  }

  function arm(reason) {
    // A deliberate tap on the mic is also a way of saying "yes, actually".
    if (reason === 'intent') optIn();
    if (arming || live() || optedOut() || !usable()) return;
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

  /**
   * Zero clicks, but only for someone who has already talked to us.
   *
   * Granted permission on its own is not an invitation: browsers keep it for the
   * whole origin, so a customer who allowed the mic once for something else would
   * have had it opened on arrival, silently, forever. Having actually held a
   * conversation is the signal that they want this.
   */
  function armIfAlreadyTrusted() {
    if (!hasUsedVoice()) return;
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      navigator.permissions.query({ name: 'microphone' }).then(function (status) {
        if (status.state === 'granted') arm('granted');
        status.onchange = function () { if (status.state === 'granted') arm('granted'); };
      }).catch(function () {});
    } catch (e) {}
  }

  /**
   * Otherwise: the first *deliberate* thing you do turns voice on.
   *
   * `wheel` and `scroll` used to be in this list, which meant reading the Reels feed
   * opened a microphone. Scrolling is how you look at a page, not how you ask to be
   * heard — those two are gone and must not come back.
   */
  function armOnFirstTouch() {
    var events = ['pointerdown', 'keydown', 'touchstart'];
    function once() {
      events.forEach(function (ev) { window.removeEventListener(ev, once, true); });
      arm('first-gesture');
    }
    events.forEach(function (ev) {
      window.addEventListener(ev, once, { capture: true, passive: true });
    });
  }

  /**
   * Moving between tabs hands the live conversation to the new agent — the
   * conversation, not just the microphone.
   *
   * Each tab has its own agent with its own history, so ending one and starting the
   * next used to drop everything said so far: a half-finished booking became "sorry,
   * which gym?". We carry the transcript across, so the new personality picks up
   * mid-sentence.
   */
  var lastPath = location.pathname;
  function followTabs() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    if (!armed || optedOut()) return;

    var carried = null;
    agents().forEach(function (a) {
      if (a.isLive && a.isLive() && a.onTab && !a.onTab()) {
        if (!carried && a.exportHistory) {
          try { carried = a.exportHistory(); } catch (e) {}
        }
        // 'handover' so the leaving agent does not record this as the customer
        // switching voice off — they only changed tab.
        if (a.endLive) a.endLive('handover');
      }
    });

    setTimeout(function () {
      arm('tab-change');
      if (!carried || !carried.length) return;
      var next = current();
      if (next && next.importHistory) {
        try { next.importHistory(carried); } catch (e) {}
      }
    }, 250);
  }

  /**
   * "End voice" means off until you turn it back on.
   *
   * This click listener is now a backstop, not the mechanism: chat-agent.js calls
   * SGVoiceAlways.optOut() from endLive('user'), which also covers ending voice by
   * closing the panel — a path this listener could never see, and the reason "no"
   * used to stop meaning no 600 ms later.
   */
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
    // Ducking has to be checked more often than tab changes: a reel can start playing
    // in the middle of a sentence, and the user should not have to talk over it.
    setInterval(followLive, 200);
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
    optIn: optIn,
    optedOut: optedOut,
    hasUsedVoice: hasUsedVoice,
    /** chat-agent.js calls this when the customer themselves ended voice. */
    userEnded: function () { armed = false; optOut(); },
    /** chat-agent.js calls this after a spoken turn, which earns the zero-click open. */
    markUsed: function () {
      try { localStorage.setItem(USED_KEY, '1'); } catch (e) {}
    },
  };
})();
