/**
 * Partner Chat — the Partner tab as a ChatGPT-style conversation.
 *
 * Gym owners should not have to learn a dashboard. Everything the Partner tab can do
 * (price, hours, bookings, earnings, payouts, door access) is one sentence away here:
 * tap a chip, type it, or hold the mic. Five taps becomes one, or none.
 *
 * Talks to POST /api/partner/agent over Server-Sent Events, so replies stream for real
 * and tool activity ("Updating your price…") is visible while it happens. Writes come
 * back as a `confirm` event and wait for a Yes.
 *
 * Self-contained: no framework, no build step, no dependency on app.ctr576.js internals
 * beyond `window.state.user` for the sign-in check.
 */
(function () {
  'use strict';

  var OPEN_CHIPS = [
    'How much have I made?',
    "This week's bookings",
    'Change my day pass price',
    'Close the gym today',
    'Pay me out',
  ];

  var S = {
    open: false,
    msgs: [],
    busy: false,
    pending: null, // { tool, args } awaiting a Yes
    listening: false,
  };

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pchat-styles')) return;
    var css = [
      '#pchat-fab{position:fixed;right:16px;bottom:72px;z-index:900;width:52px;height:52px;border-radius:50%;',
      'background:linear-gradient(135deg,#FF6D00,#ff9d4d);border:none;color:#fff;font-size:22px;cursor:pointer;',
      'box-shadow:0 6px 24px rgba(255,109,0,.45);display:none;align-items:center;justify-content:center}',
      '#pchat-fab.show{display:flex}',
      '#pchat{position:fixed;inset:0;z-index:1200;background:#080812;display:none;flex-direction:column}',
      '#pchat.open{display:flex}',
      '.pchat-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,10px) + 10px) 16px 12px;',
      'border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#14141f,#0b0b14)}',
      '.pchat-av{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#FF6D00,#ff9d4d);',
      'display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto}',
      '.pchat-title{font-weight:700;font-size:15px;color:#fff;line-height:1.2}',
      '.pchat-sub{font-size:11px;color:#4ade80}',
      '.pchat-x{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.5);font-size:24px;cursor:pointer;padding:4px 8px}',
      '.pchat-scroll{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}',
      '.pchat-msg{max-width:86%;padding:11px 14px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
      '.pchat-ai{background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5;align-self:flex-start;border-bottom-left-radius:5px}',
      '.pchat-me{background:#FF6D00;color:#fff;align-self:flex-end;border-bottom-right-radius:5px;font-weight:500}',
      '.pchat-tool{align-self:flex-start;font-size:12px;color:rgba(255,255,255,.45);padding:2px 6px;display:flex;align-items:center;gap:6px}',
      '.pchat-spin{width:11px;height:11px;border:2px solid rgba(255,109,0,.3);border-top-color:#FF6D00;border-radius:50%;animation:pchatspin .7s linear infinite}',
      '@keyframes pchatspin{to{transform:rotate(360deg)}}',
      '.pchat-typing{align-self:flex-start;display:flex;gap:4px;padding:13px 16px;background:#191926;border-radius:16px}',
      '.pchat-typing i{width:6px;height:6px;background:rgba(255,255,255,.4);border-radius:50%;animation:pchatb 1s infinite}',
      '.pchat-typing i:nth-child(2){animation-delay:.15s}.pchat-typing i:nth-child(3){animation-delay:.3s}',
      '@keyframes pchatb{50%{transform:translateY(-5px);opacity:.4}}',
      '.pchat-chips{display:flex;flex-wrap:wrap;gap:7px;padding:4px 14px 8px}',
      '.pchat-chip{background:rgba(255,109,0,.11);border:1px solid rgba(255,109,0,.45);color:#ffb87a;padding:8px 13px;',
      'border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.pchat-chip:active{background:#FF6D00;color:#fff}',
      '.pchat-chip.yes{background:rgba(74,222,128,.14);border-color:rgba(74,222,128,.5);color:#86efac}',
      '.pchat-chip.no{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.15);color:rgba(255,255,255,.6)}',
      '.pchat-bar{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px calc(env(safe-area-inset-bottom,10px) + 12px);',
      'display:flex;gap:8px;align-items:flex-end;background:#0b0b14}',
      '.pchat-input{flex:1;background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5;border-radius:20px;',
      'padding:11px 15px;font-size:15px;font-family:inherit;resize:none;height:44px;max-height:110px;outline:none}',
      '.pchat-input:focus{border-color:rgba(255,109,0,.55)}',
      '.pchat-rnd{width:44px;height:44px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;',
      'font-size:17px;cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent}',
      '.pchat-mic{background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5}',
      '.pchat-mic.on{background:#ef4444;color:#fff;animation:pchatpulse 1s infinite}',
      '@keyframes pchatpulse{50%{opacity:.55}}',
      '.pchat-send{background:#FF6D00;color:#fff}',
      '.pchat-send[disabled]{opacity:.4}',
      '.pchat-hint{font-size:11px;color:rgba(255,255,255,.35);text-align:center;padding:0 14px 6px}',
      '.pchat-link{color:#FF6D00;text-decoration:underline}',
    ].join('');
    var el = document.createElement('style');
    el.id = 'pchat-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  function build() {
    if (document.getElementById('pchat')) return;
    injectStyles();

    var fab = document.createElement('button');
    fab.id = 'pchat-fab';
    fab.title = 'Ask ScanGym';
    fab.innerHTML = '💬';
    fab.onclick = open;
    document.body.appendChild(fab);

    var root = document.createElement('div');
    root.id = 'pchat';
    root.innerHTML =
      '<div class="pchat-top">' +
      '<div class="pchat-av">🏋️</div>' +
      '<div><div class="pchat-title">ScanGym Partner</div><div class="pchat-sub">● Your gym assistant</div></div>' +
      '<button class="pchat-x" id="pchat-close">×</button>' +
      '</div>' +
      '<div class="pchat-scroll" id="pchat-scroll"></div>' +
      '<div class="pchat-chips" id="pchat-chips"></div>' +
      '<div class="pchat-hint" id="pchat-hint">Tap, type, or hold the mic — all three work.</div>' +
      '<div class="pchat-bar">' +
      '<textarea class="pchat-input" id="pchat-input" rows="1" placeholder="Type or say what you need…"></textarea>' +
      '<button class="pchat-rnd pchat-mic" id="pchat-mic">🎤</button>' +
      '<button class="pchat-rnd pchat-send" id="pchat-send">➤</button>' +
      '</div>';
    document.body.appendChild(root);

    document.getElementById('pchat-close').onclick = close;
    document.getElementById('pchat-send').onclick = function () {
      send(document.getElementById('pchat-input').value);
    };
    document.getElementById('pchat-mic').onclick = toggleMic;

    var input = document.getElementById('pchat-input');
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send(input.value);
      }
    });
    input.addEventListener('input', function () {
      input.style.height = '44px';
      input.style.height = Math.min(input.scrollHeight, 110) + 'px';
    });
  }

  // ── rendering ─────────────────────────────────────────────────────────────
  function scrollDown() {
    var s = document.getElementById('pchat-scroll');
    if (s) setTimeout(function () { s.scrollTop = s.scrollHeight; }, 20);
  }

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = 'pchat-msg ' + cls;
    d.textContent = text || '';
    document.getElementById('pchat-scroll').appendChild(d);
    scrollDown();
    return d;
  }

  function typingOn() {
    var d = document.createElement('div');
    d.className = 'pchat-typing';
    d.id = 'pchat-typing';
    d.innerHTML = '<i></i><i></i><i></i>';
    document.getElementById('pchat-scroll').appendChild(d);
    scrollDown();
  }

  function typingOff() {
    var d = document.getElementById('pchat-typing');
    if (d) d.remove();
  }

  var TOOL_LABELS = {
    get_my_gym: 'Checking your gym',
    get_earnings: 'Checking your earnings',
    get_bookings: 'Looking up bookings',
    get_customers: 'Counting customers',
    search_gyms: 'Searching for your gym',
    set_day_price: 'Updating your price',
    set_bookings_open: 'Updating your listing',
    set_hours_override: "Updating today's hours",
    claim_gym: 'Claiming your gym',
    request_payout: 'Sending your payout',
    connect_payout_method: 'Setting up payouts',
    connect_smart_lock: 'Connecting your door',
  };

  function toolLine(tool) {
    var d = document.createElement('div');
    d.className = 'pchat-tool';
    d.id = 'pchat-tool-' + tool;
    d.innerHTML = '<span class="pchat-spin"></span>' + (TOOL_LABELS[tool] || 'Working') + '…';
    document.getElementById('pchat-scroll').appendChild(d);
    scrollDown();
  }

  function toolDone(tool, ok) {
    var d = document.getElementById('pchat-tool-' + tool);
    if (d) d.innerHTML = (ok ? '✓ ' : '× ') + (TOOL_LABELS[tool] || 'Done');
  }

  function chips(list) {
    var c = document.getElementById('pchat-chips');
    c.innerHTML = '';
    (list || []).forEach(function (item) {
      var label = typeof item === 'string' ? item : item.label;
      var b = document.createElement('div');
      b.className = 'pchat-chip' + (item.style ? ' ' + item.style : '');
      b.textContent = label;
      b.onclick = typeof item === 'string' ? function () { send(label); } : item.onClick;
      c.appendChild(b);
    });
  }

  // ── confirmation copy — the owner must see the number before saying yes ────
  function confirmSummary(tool, args) {
    switch (tool) {
      case 'set_day_price':
        return 'Set your day pass to £' + Number(args.dayPrice).toFixed(2) + '?';
      case 'set_bookings_open':
        return args.open
          ? 'Reopen your gym for ScanGym bookings?'
          : 'Pause new ScanGym bookings?';
      case 'set_hours_override':
        return args.status === 'closed_now'
          ? 'Mark the gym closed for today? Existing bookings stay valid.'
          : args.status === 'open_now'
          ? 'Mark the gym open now, overriding your Google hours?'
          : 'Clear the override and go back to your Google hours?';
      case 'claim_gym':
        return 'Claim this gym for your account?';
      case 'request_payout':
        return 'Pay your available balance out to your bank?';
      case 'connect_payout_method':
        return 'Open Stripe to set up your payouts?';
      case 'connect_smart_lock':
        return 'Connect ' + args.provider + ' to your gym?';
      default:
        return 'Go ahead with this?';
    }
  }

  // ── network ───────────────────────────────────────────────────────────────
  function history() {
    return S.msgs.slice(-10).map(function (m) {
      return { role: m.role, content: m.text };
    });
  }

  function send(text, confirmPayload) {
    text = (text || '').trim();
    if (S.busy) return;
    if (!text && !confirmPayload) return;

    var input = document.getElementById('pchat-input');
    if (input) {
      input.value = '';
      input.style.height = '44px';
    }

    if (text) {
      bubble('pchat-me', text);
      S.msgs.push({ role: 'user', text: text });
    }
    chips([]);
    S.busy = true;
    document.getElementById('pchat-send').disabled = true;
    typingOn();

    stream({ message: text, history: history(), confirm: confirmPayload || null });
  }

  function stream(body) {
    var aiBubble = null;
    var acc = '';

    fetch('/api/partner/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
      .then(function (res) {
        if (res.status === 401) {
          typingOff();
          bubble('pchat-ai', 'Sign in with the phone number on your gym account and I can help.');
          finish();
          return null;
        }
        if (!res.ok || !res.body) {
          typingOff();
          bubble('pchat-ai', "I couldn't reach the server just then. Try again in a moment.");
          finish();
          return null;
        }
        return readStream(res.body.getReader());
      })
      .catch(function () {
        typingOff();
        bubble('pchat-ai', 'Connection dropped — nothing was changed.');
        finish();
      });

    function readStream(reader) {
      var decoder = new TextDecoder();
      var buffer = '';

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            finish();
            return;
          }
          buffer += decoder.decode(r.value, { stream: true });
          var parts = buffer.split('\n\n');
          buffer = parts.pop();
          parts.forEach(handleEvent);
          return pump();
        });
      }
      return pump();
    }

    function handleEvent(block) {
      var event = 'message';
      var dataLines = [];
      block.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) event = line.slice(6).trim();
        else if (line.indexOf('data:') === 0) dataLines.push(line.slice(5).trim());
      });
      if (!dataLines.length) return;

      var data;
      try {
        data = JSON.parse(dataLines.join(''));
      } catch (_) {
        return;
      }

      if (event === 'delta' && data.text) {
        typingOff();
        if (!aiBubble) aiBubble = bubble('pchat-ai', '');
        acc += data.text;
        aiBubble.textContent = acc;
        scrollDown();
      } else if (event === 'tool') {
        typingOff();
        if (data.state === 'running') toolLine(data.tool);
        else toolDone(data.tool, data.ok !== false);
      } else if (event === 'confirm') {
        typingOff();
        S.pending = { tool: data.tool, args: data.args };
        if (!aiBubble) aiBubble = bubble('pchat-ai', '');
        acc = (acc ? acc + '\n\n' : '') + confirmSummary(data.tool, data.args);
        aiBubble.textContent = acc;
        scrollDown();
      } else if (event === 'done') {
        if (data.result && data.result.url) {
          var link = document.createElement('div');
          link.className = 'pchat-msg pchat-ai';
          link.innerHTML =
            '<a class="pchat-link" href="' + data.result.url + '" target="_blank" rel="noopener">Open Stripe setup →</a>';
          document.getElementById('pchat-scroll').appendChild(link);
          scrollDown();
        }
      }
    }

    function finish() {
      typingOff();
      S.busy = false;
      var btn = document.getElementById('pchat-send');
      if (btn) btn.disabled = false;

      if (acc) S.msgs.push({ role: 'ai', text: acc });

      if (S.pending) {
        var p = S.pending;
        chips([
          {
            label: 'Yes, do it',
            style: 'yes',
            onClick: function () {
              S.pending = null;
              bubble('pchat-me', 'Yes');
              chips([]);
              S.busy = true;
              typingOn();
              stream({ confirm: p });
            },
          },
          {
            label: 'No',
            style: 'no',
            onClick: function () {
              S.pending = null;
              bubble('pchat-me', 'No');
              bubble('pchat-ai', 'Left as it was. Anything else?');
              chips(OPEN_CHIPS);
            },
          },
        ]);
      } else {
        chips(OPEN_CHIPS);
      }
    }
  }

  // ── voice ─────────────────────────────────────────────────────────────────
  var recognition = null;

  function toggleMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = document.getElementById('pchat-mic');

    if (!SR) {
      document.getElementById('pchat-hint').textContent =
        'Voice needs Chrome or Safari — typing works everywhere.';
      return;
    }
    if (S.listening && recognition) {
      recognition.stop();
      return;
    }

    recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      S.listening = true;
      mic.classList.add('on');
      document.getElementById('pchat-hint').textContent = 'Listening…';
    };
    recognition.onresult = function (e) {
      var said = e.results[0][0].transcript;
      if (said) send(said);
    };
    recognition.onerror = function (e) {
      document.getElementById('pchat-hint').textContent =
        e.error === 'not-allowed'
          ? 'Microphone blocked — allow it in your browser settings.'
          : "Didn't catch that — try again or type it.";
    };
    recognition.onend = function () {
      S.listening = false;
      mic.classList.remove('on');
    };

    try {
      recognition.start();
    } catch (_) {
      /* already running */
    }
  }

  // ── open / close ──────────────────────────────────────────────────────────
  function greet() {
    var signedIn = !!(window.state && window.state.user);
    if (!signedIn) {
      bubble(
        'pchat-ai',
        "Hi — I'm your ScanGym assistant. Sign in with the number on your gym account and I can set your price, check your earnings, close the gym for a day, or pay you out."
      );
      chips([]);
      return;
    }
    bubble(
      'pchat-ai',
      "Hi — I run your gym's ScanGym listing. Tell me what you need and I'll do it: set your price, close for the day, check what you've earned, get you paid out. No menus."
    );
    chips(OPEN_CHIPS);
  }

  function open() {
    build();
    var root = document.getElementById('pchat');
    root.classList.add('open');
    S.open = true;
    if (!S.msgs.length && !document.getElementById('pchat-scroll').children.length) greet();
    setTimeout(function () {
      var i = document.getElementById('pchat-input');
      if (i && window.innerWidth > 640) i.focus();
    }, 120);
  }

  function close() {
    var root = document.getElementById('pchat');
    if (root) root.classList.remove('open');
    S.open = false;
  }

  // Show the button only on the Partner tab; open automatically for /partner?chat=1.
  function syncVisibility() {
    build();
    var onPartner = /^\/partner(\/|$)/.test(location.pathname);
    var fab = document.getElementById('pchat-fab');
    if (fab) fab.classList.toggle('show', onPartner);
    if (!onPartner && S.open) close();
    if (onPartner && /[?&]chat=1/.test(location.search) && !S.open) open();
  }

  window.sgPartnerChat = { open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVisibility);
  } else {
    syncVisibility();
  }
  window.addEventListener('popstate', syncVisibility);
  setInterval(syncVisibility, 800); // the app routes without firing popstate
})();
