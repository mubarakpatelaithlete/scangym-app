/**
 * ScanSquad Chat — the creator side of ScanGym as a ChatGPT-style conversation.
 *
 * Same idea as partner-chat.js, aimed at creators instead of gym owners. Everything the
 * ScanSquad tab can do — earnings, link performance, leaderboard, reels, boosts,
 * giveaways, bundles, scheduling, payouts — is one sentence away: tap a chip, type it,
 * or hold the mic.
 *
 * Talks to POST /api/squad/agent over Server-Sent Events, so replies stream for real and
 * tool activity ("Checking your earnings…") is visible while it happens. Anything that
 * spends the creator's balance or messages their followers comes back as a `confirm`
 * event and waits for a Yes.
 *
 * Self-contained: no framework, no build step, no dependency on app.ctr576.js internals
 * beyond `window.state.user` for the sign-in check.
 */
(function () {
  'use strict';

  var OPEN_CHIPS = [
    'How much have I earned?',
    'What should I post next?',
    'Show my reels',
    'Where am I on the leaderboard?',
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
    if (document.getElementById('schat-styles')) return;
    var css = [
      // z-index sits above the partner Continue banner (8999) and the tab bar (9000),
      // and `bottom` is recalculated from their real heights — a 52px circle at
      // bottom:72px was completely buried behind the banner on the Partner tab.
      '#schat-fab{position:fixed;right:14px;z-index:9100;height:46px;padding:0 16px 0 13px;border-radius:23px;',
      'background:linear-gradient(135deg,#FF6D00,#ff9d4d);border:none;color:#fff;font-size:14px;font-weight:700;',
      'font-family:inherit;cursor:pointer;box-shadow:0 8px 28px rgba(255,109,0,.5);display:none;align-items:center;',
      'gap:7px;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
      '#schat-fab.show{display:flex}',
      '#schat-fab:active{transform:scale(.96)}',
      '#schat-fab .schat-fab-dot{width:7px;height:7px;border-radius:50%;background:#fff;opacity:.9;',
      'animation:schatfabp 1.6s ease-in-out infinite}',
      '@keyframes schatfabp{50%{opacity:.35}}',
      // The overlay stops above whatever the app keeps pinned to the bottom (tab bar,
      // Continue banner) so the fixed bottom navigation stays visible and tappable
      // while the AI chat is open. `--schat-bottom` is set from real heights on open.
      '#schat{position:fixed;top:0;left:0;right:0;bottom:var(--schat-bottom,0px);z-index:8500;background:#080812;display:none;flex-direction:column}',
      '#schat.open{display:flex}',
      '.schat-top{display:flex;align-items:center;gap:10px;padding:calc(env(safe-area-inset-top,10px) + 10px) 16px 12px;',
      'border-bottom:1px solid rgba(255,255,255,.08);background:linear-gradient(180deg,#14141f,#0b0b14)}',
      '.schat-av{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#FF6D00,#ff9d4d);',
      'display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto}',
      '.schat-title{font-weight:700;font-size:15px;color:#fff;line-height:1.2}',
      '.schat-sub{font-size:11px;color:#4ade80}',
      '.schat-x{margin-left:auto;background:none;border:none;color:rgba(255,255,255,.5);font-size:24px;cursor:pointer;padding:4px 8px}',
      '.schat-scroll{flex:1;overflow-y:auto;padding:16px 14px 8px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch}',
      '.schat-msg{max-width:86%;padding:11px 14px;border-radius:16px;font-size:14.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
      '.schat-ai{background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5;align-self:flex-start;border-bottom-left-radius:5px}',
      '.schat-me{background:#FF6D00;color:#fff;align-self:flex-end;border-bottom-right-radius:5px;font-weight:500}',
      '.schat-tool{align-self:flex-start;font-size:12px;color:rgba(255,255,255,.45);padding:2px 6px;display:flex;align-items:center;gap:6px}',
      '.schat-spin{width:11px;height:11px;border:2px solid rgba(255,109,0,.3);border-top-color:#FF6D00;border-radius:50%;animation:schatspin .7s linear infinite}',
      '@keyframes schatspin{to{transform:rotate(360deg)}}',
      '.schat-typing{align-self:flex-start;display:flex;gap:4px;padding:13px 16px;background:#191926;border-radius:16px}',
      '.schat-typing i{width:6px;height:6px;background:rgba(255,255,255,.4);border-radius:50%;animation:schatb 1s infinite}',
      '.schat-typing i:nth-child(2){animation-delay:.15s}.schat-typing i:nth-child(3){animation-delay:.3s}',
      '@keyframes schatb{50%{transform:translateY(-5px);opacity:.4}}',
      '.schat-chips{display:flex;flex-wrap:wrap;gap:7px;padding:4px 14px 8px}',
      '.schat-chip{background:rgba(255,109,0,.11);border:1px solid rgba(255,109,0,.45);color:#ffb87a;padding:8px 13px;',
      'border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;-webkit-tap-highlight-color:transparent}',
      '.schat-chip:active{background:#FF6D00;color:#fff}',
      '.schat-chip.yes{background:rgba(74,222,128,.14);border-color:rgba(74,222,128,.5);color:#86efac}',
      '.schat-chip.no{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.15);color:rgba(255,255,255,.6)}',
      '.schat-bar{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px calc(env(safe-area-inset-bottom,10px) + 12px);',
      'display:flex;gap:8px;align-items:flex-end;background:#0b0b14}',
      '.schat-input{flex:1;background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5;border-radius:20px;',
      'padding:11px 15px;font-size:15px;font-family:inherit;resize:none;height:44px;max-height:110px;outline:none}',
      '.schat-input:focus{border-color:rgba(255,109,0,.55)}',
      '.schat-rnd{width:44px;height:44px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;',
      'font-size:17px;cursor:pointer;flex:0 0 auto;-webkit-tap-highlight-color:transparent}',
      '.schat-mic{background:#191926;border:1px solid rgba(255,255,255,.08);color:#e9edf5}',
      '.schat-mic.on{background:#ef4444;color:#fff;animation:schatpulse 1s infinite}',
      '@keyframes schatpulse{50%{opacity:.55}}',
      '.schat-send{background:#FF6D00;color:#fff}',
      '.schat-send[disabled]{opacity:.4}',
      '.schat-hint{font-size:11px;color:rgba(255,255,255,.35);text-align:center;padding:0 14px 6px}',
      '.schat-link{color:#FF6D00;text-decoration:underline}',
      // 4. "Calm screen": replies are rendered, not dumped. Bold, bullets, numbered
      // steps and links get real typography so an answer reads like an answer instead
      // of a paragraph full of asterisks.
      '.schat-ai strong{color:#fff;font-weight:700}',
      '.schat-ai em{font-style:italic;opacity:.92}',
      '.schat-ai code{background:rgba(255,255,255,.09);border-radius:5px;padding:1px 5px;font-size:13px;font-family:ui-monospace,Menlo,monospace}',
      '.schat-ai ul{margin:6px 0;padding-left:20px;list-style:disc outside}',
      '.schat-ai ol{margin:6px 0;padding-left:22px;list-style:decimal outside}',
      '.schat-ai li{line-height:1.45;margin:0 0 4px;display:list-item}',
      '.schat-ai li::marker{color:#FF6D00}',
      '.schat-ai p{margin:0 0 8px}',
      '.schat-ai p:last-child{margin-bottom:0}',
      '.schat-ai a{color:#ffb87a;text-decoration:underline}',
      '.schat-ai.rich{white-space:normal}',
      '.schat-stop{background:#191926;border:1px solid rgba(255,255,255,.18);color:#fff}',
    ].join('');
    var el = document.createElement('style');
    el.id = 'schat-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  function build() {
    if (document.getElementById('schat')) return;
    injectStyles();

    var fab = document.createElement('button');
    fab.id = 'schat-fab';
    fab.title = 'Ask ScanSquad';
    fab.innerHTML = '<span class="schat-fab-dot"></span>Ask AI';
    fab.onclick = open;
    document.body.appendChild(fab);

    var root = document.createElement('div');
    root.id = 'schat';
    root.innerHTML =
      '<div class="schat-top">' +
      '<div class="schat-av">💪</div>' +
      '<div><div class="schat-title">ScanSquad</div><div class="schat-sub">● Your creator assistant</div></div>' +
      '<button class="schat-x" id="schat-close">×</button>' +
      '</div>' +
      '<div class="schat-scroll" id="schat-scroll"></div>' +
      '<div class="schat-chips" id="schat-chips"></div>' +
      '<div class="schat-hint" id="schat-hint">Tap, type, or hold the mic — all three work.</div>' +
      '<div class="schat-bar">' +
      '<textarea class="schat-input" id="schat-input" rows="1" placeholder="Type or say what you need…"></textarea>' +
      '<button class="schat-rnd schat-mic" id="schat-mic">🎤</button>' +
      '<button class="schat-rnd schat-send" id="schat-send">➤</button>' +
      '</div>';
    document.body.appendChild(root);

    document.getElementById('schat-close').onclick = close;
    document.getElementById('schat-send').onclick = function () {
      if (S.busy) { stopStream(); return; }
      send(document.getElementById('schat-input').value);
    };
    document.getElementById('schat-mic').onclick = toggleMic;

    var input = document.getElementById('schat-input');
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
    var s = document.getElementById('schat-scroll');
    if (s) setTimeout(function () { s.scrollTop = s.scrollHeight; }, 20);
  }

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = 'schat-msg ' + cls;
    d.textContent = text || '';
    document.getElementById('schat-scroll').appendChild(d);
    scrollDown();
    return d;
  }

  function typingOn() {
    var d = document.createElement('div');
    d.className = 'schat-typing';
    d.id = 'schat-typing';
    d.innerHTML = '<i></i><i></i><i></i>';
    document.getElementById('schat-scroll').appendChild(d);
    scrollDown();
  }

  function typingOff() {
    var d = document.getElementById('schat-typing');
    if (d) d.remove();
  }

  var TOOL_LABELS = {
    get_my_squad_profile: 'Checking your ScanSquad status',
    get_my_earnings: 'Checking your earnings',
    get_my_link_performance: 'Looking at what converts',
    get_leaderboard: 'Reading the leaderboard',
    get_my_content: 'Fetching your reels',
    get_my_toolkit: 'Opening the toolkit',
    get_my_schedule: 'Checking your calendar',
    join_squad: 'Signing you up',
    set_my_handle: 'Setting your handle',
    start_giveaway: 'Setting up your giveaway',
    boost_reel: 'Boosting your reel',
    set_bundle_deal: 'Turning on your bundle',
    schedule_post: 'Adding it to your calendar',
    announce_to_followers: 'Messaging your followers',
    request_withdrawal: 'Requesting your payout',
  };

  function toolLine(tool) {
    var d = document.createElement('div');
    d.className = 'schat-tool';
    d.id = 'schat-tool-' + tool;
    d.innerHTML = '<span class="schat-spin"></span>' + (TOOL_LABELS[tool] || 'Working') + '…';
    document.getElementById('schat-scroll').appendChild(d);
    scrollDown();
  }

  function toolDone(tool, ok) {
    var d = document.getElementById('schat-tool-' + tool);
    if (d) d.innerHTML = (ok ? '✓ ' : '× ') + (TOOL_LABELS[tool] || 'Done');
  }

  /**
   * Markdown-lite renderer.
   *
   * The model naturally writes **bold**, `- ` bullets and numbered steps. Printed as
   * plain text those become literal asterisks and dashes, which is the single biggest
   * reason the chat looked less polished than ChatGPT. This turns the common cases into
   * real HTML while it streams. Deliberately tiny: escape everything first, then only
   * ever add tags we generated ourselves — no library, no innerHTML of model text.
   */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/(https?:\/\/[^\s<]+[^\s<.,)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }

  function renderRich(el, text) {
    var lines = String(text || '').split('\n');
    var html = '';
    var list = null; // 'ul' | 'ol'
    var para = [];

    function flushPara() {
      if (para.length) {
        html += '<p>' + inline(para.join('\n')) + '</p>';
        para = [];
      }
    }
    function flushList() {
      if (list) {
        html += '</' + list + '>';
        list = null;
      }
    }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
      var numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);

      if (bullet) {
        flushPara();
        if (list !== 'ul') { flushList(); html += '<ul>'; list = 'ul'; }
        html += '<li>' + inline(bullet[1]) + '</li>';
      } else if (numbered) {
        flushPara();
        if (list !== 'ol') { flushList(); html += '<ol>'; list = 'ol'; }
        html += '<li>' + inline(numbered[1]) + '</li>';
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara();
    flushList();

    el.classList.add('rich');
    el.innerHTML = html;
  }

  /**
   * 1. "One box, no menus": suggestions belong on an empty thread only. Re-offering the
   * same five chips after every answer is a menu by another name — and it buries the
   * reply. Once the user has said anything, the box speaks for itself.
   */
  function startChips() {
    var spoken = S.msgs.some(function (m) { return m.role === 'user'; });
    return spoken ? [] : OPEN_CHIPS;
  }

  function setHint(text) {
    var h = document.getElementById('schat-hint');
    if (!h) return;
    if (text === null) { h.style.display = 'none'; return; }
    h.style.display = '';
    h.textContent = text;
  }

  function chips(list) {
    var c = document.getElementById('schat-chips');
    c.innerHTML = '';
    (list || []).forEach(function (item) {
      var label = typeof item === 'string' ? item : item.label;
      var b = document.createElement('div');
      b.className = 'schat-chip' + (item.style ? ' ' + item.style : '');
      b.textContent = label;
      b.onclick = typeof item === 'string' ? function () { send(label); } : item.onClick;
      c.appendChild(b);
    });
  }

  // ── confirmation copy — the creator must see the number before saying yes ──
  function confirmSummary(tool, args) {
    switch (tool) {
      case 'join_squad':
        return 'Join ScanSquad? It is free and you earn 25% on every booking through your link.';
      case 'set_my_handle':
        return 'Set your handle to ' + String(args.handle || '').replace(/^@+/, '') +
          '? Your link becomes scangym.com/r/' + String(args.handle || '').replace(/^@+/, '') + '.';
      case 'start_giveaway':
        return 'Run a free pass giveaway? It takes £5 off your available balance and gives you a claim link.';
      case 'boost_reel': {
        var days = Number(args.days) || 1;
        return 'Boost that reel to the top of the feed for ' + days + ' day' + (days > 1 ? 's' : '') +
          '? That is £' + (days * 1).toFixed(2) + ' off your balance.';
      }
      case 'set_bundle_deal':
        return args.preset === '5for20'
          ? 'Turn on your 5 passes for £20 bundle?'
          : 'Turn on your 3 passes for £12 bundle?';
      case 'schedule_post':
        return 'Add this to your calendar for ' + String(args.scheduledAt || '') + '?\n\n"' +
          String(args.caption || '') + '"';
      case 'announce_to_followers':
        return 'Send this to your followers?\n\n"' + String(args.message || '') + '"';
      case 'request_withdrawal':
        return args.amountPounds === undefined
          ? 'Request a payout of your whole available balance?'
          : 'Request a payout of £' + Number(args.amountPounds).toFixed(2) + '?';
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

  /**
   * 3. Turn the send button into a stop button while the model is talking, and back
   * again when it stops. One button, two states — no extra furniture on screen.
   */
  function setBusyUI(busy) {
    var btn = document.getElementById('schat-send');
    if (!btn) return;
    btn.disabled = false;
    btn.classList.toggle('schat-stop', busy);
    btn.classList.toggle('schat-send', !busy);
    btn.innerHTML = busy ? '■' : '➤';
    btn.title = busy ? 'Stop' : 'Send';
  }

  function stopStream() {
    if (S.ctrl) {
      try { S.ctrl.abort(); } catch (_) {}
    }
  }

  // Any tool line still spinning when the turn ends did not report back.
  function resolveStrayTools() {
    var nodes = document.querySelectorAll('.schat-tool .schat-spin');
    for (var i = 0; i < nodes.length; i++) {
      var row = nodes[i].parentNode;
      row.innerHTML = '× ' + row.textContent.replace(/…$/, '') + ' — did not finish';
    }
  }

  function send(text, confirmPayload) {
    text = (text || '').trim();
    if (S.busy) return;
    if (!text && !confirmPayload) return;

    var input = document.getElementById('schat-input');
    if (input) {
      input.value = '';
      input.style.height = '44px';
    }

    if (text) {
      bubble('schat-me', text);
      setHint(null); // 4. calm screen: the how-to-use line has done its job
      
      S.msgs.push({ role: 'user', text: text });
    }
    chips([]);
    S.busy = true;
    typingOn(); // the send button becomes Stop in setBusyUI(true), so it stays tappable

    stream({ message: text, history: history(), confirm: confirmPayload || null });
  }

  function stream(body) {
    var aiBubble = null;
    var acc = '';
    // 2/5. Streaming you can interrupt. ChatGPT's stop button is why long answers
    // never feel like being trapped; aborting mid-stream keeps whatever arrived.
    var ctrl = window.AbortController ? new AbortController() : null;
    S.ctrl = ctrl;
    setBusyUI(true);

    fetch('/api/squad/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (res.status === 401) {
          typingOff();
          bubble('schat-ai', 'Sign in to your ScanGym account and I can help.');
          finish();
          return null;
        }
        if (!res.ok || !res.body) {
          typingOff();
          bubble('schat-ai', "I couldn't reach the server just then. Try again in a moment.");
          finish();
          return null;
        }
        return readStream(res.body.getReader());
      })
      .catch(function (err) {
        typingOff();
        if (!err || err.name !== 'AbortError') {
          bubble('schat-ai', 'Connection dropped — nothing was changed.');
        }
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
        if (!aiBubble) aiBubble = bubble('schat-ai', '');
        acc += data.text;
        renderRich(aiBubble, acc);
        scrollDown();
      } else if (event === 'tool') {
        typingOff();
        if (data.state === 'running') toolLine(data.tool);
        else toolDone(data.tool, data.ok !== false);
      } else if (event === 'confirm') {
        typingOff();
        S.pending = { tool: data.tool, args: data.args };
        if (!aiBubble) aiBubble = bubble('schat-ai', '');
        acc = (acc ? acc + '\n\n' : '') + confirmSummary(data.tool, data.args);
        renderRich(aiBubble, acc);
        scrollDown();
      } else if (event === 'done') {
        var url = data.result && (data.result.claimUrl || data.result.referralLink);
        if (url) {
          var link = document.createElement('div');
          link.className = 'schat-msg schat-ai';
          link.innerHTML =
            '<a class="schat-link" href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
          document.getElementById('schat-scroll').appendChild(link);
          scrollDown();
        }
      }
    }

    function finish() {
      typingOff();
      S.busy = false;
      S.ctrl = null;
      setBusyUI(false);
      // 3. "Shows its work" only works if every step ends. A dropped stream used to
      // leave a spinner turning forever, which reads as "it is still doing it".
      resolveStrayTools();

      if (acc) S.msgs.push({ role: 'ai', text: acc });

      if (S.pending) {
        var p = S.pending;
        chips([
          {
            label: 'Yes, do it',
            style: 'yes',
            onClick: function () {
              S.pending = null;
              bubble('schat-me', 'Yes');
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
              bubble('schat-me', 'No');
              bubble('schat-ai', 'Left as it was. Anything else?');
              chips(startChips());
            },
          },
        ]);
      } else {
        chips(startChips());
      }
    }
  }

  // ── voice ─────────────────────────────────────────────────────────────────
  var recognition = null;

  function toggleMic() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var mic = document.getElementById('schat-mic');

    if (!SR) {
      document.getElementById('schat-hint').textContent =
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
      document.getElementById('schat-hint').textContent = 'Listening…';
    };
    recognition.onresult = function (e) {
      var said = e.results[0][0].transcript;
      if (said) send(said);
    };
    recognition.onerror = function (e) {
      document.getElementById('schat-hint').textContent =
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
  /** Opens the app's own sign-in sheet (it renders above this chat at z-index 9500). */
  function openSignIn() {
    if (typeof window._sgShowAuthSheet === 'function') {
      window._sgShowAuthSheet('book');
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        if (window.state && window.state.user) {
          clearInterval(poll);
          bubble('schat-ai', "You're in. What do you need?");
          chips(OPEN_CHIPS);
        } else if (tries > 240) {
          clearInterval(poll);
        }
      }, 500);
    } else {
      bubble('schat-ai', 'Tap Profile at the bottom to sign in, then come back here.');
    }
  }

  function greet() {
    var signedIn = !!(window.state && window.state.user);
    if (!signedIn) {
      bubble(
        'schat-ai',
        "Hi — I'm your ScanSquad assistant. Sign in and I can show what you've earned, tell you which gym your link actually converts on, boost a reel, or get you paid out."
      );
      // 1. No dead ends: "sign in" used to be advice with nothing to tap.
      chips([{ label: 'Sign me in', style: 'yes', onClick: openSignIn }]);
      return;
    }
    bubble(
      'schat-ai',
      "Hi — I look after your ScanSquad earnings. Ask me what you've made, what to post next, or tell me to boost a reel or pay you out. No menus."
    );
    chips(OPEN_CHIPS);
  }

  /** Total height of the app's fixed bottom chrome (tab bar + banners). */
  function bottomChromeHeight() {
    var h = 0;
    ['.sg-tab-bar', '#partner-continue-banner', '#sg-squad-brand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden') return;
      var eh = el.getBoundingClientRect().height;
      if (eh > 0 && eh < 200) h += eh;
    });
    return h;
  }

  /** Reserve room for the fixed bottom navigation while the chat is open. */
  function applyBottomInset() {
    var root = document.getElementById('schat');
    if (!root) return;
    root.style.setProperty('--schat-bottom', bottomChromeHeight() + 'px');
  }

  function open() {
    build();
    var root = document.getElementById('schat');
    root.classList.add('open');
    applyBottomInset();
    window.addEventListener('resize', applyBottomInset);
    S.open = true;
    if (!S.msgs.length && !document.getElementById('schat-scroll').children.length) greet();
    setTimeout(function () {
      var i = document.getElementById('schat-input');
      if (i && window.innerWidth > 640) i.focus();
    }, 120);
  }

  function close() {
    var root = document.getElementById('schat');
    if (root) root.classList.remove('open');
    S.open = false;
  }

  /**
   * Keep the button clear of whatever the app has pinned to the bottom of the
   * screen — the tab bar, and any full-width CTA banner. Learned the hard way on the
   * Partner tab, where a hardcoded bottom offset put the button underneath the
   * orange Continue bar and made it invisible.
   */
  function positionFab(fab) {
    var offset = 12;
    ['.sg-tab-bar', '#partner-continue-banner', '#sg-squad-brand'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      var h = el.getBoundingClientRect().height;
      if (h > 0 && h < 200) offset += h;
    });
    fab.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + ' + offset + 'px)';
  }

  /**
   * Which URLs count as "the ScanSquad tab".
   *
   * This is the bug that made the whole feature invisible: tapping the ScanSquad tab in
   * the bottom bar runs switchTab('creator'), which pushes `/creator` (singular) — not
   * `/scansquad`. So the button never showed, and worse, the 800ms sync below treated
   * `/creator` as "off tab" and closed the chat again a moment after the Ask AI bar
   * opened it. `/creator` (and `/creator/...`) are now first-class.
   */
  var SQUAD_PATHS = /^\/(creator|creators|scansquad|scansquad-dashboard|creator-earnings|become-a-creator)(\/|$)/;

  // Show the button only on the ScanSquad tab; open automatically for ?chat=1.
  function syncVisibility() {
    build();
    var onSquad = SQUAD_PATHS.test(location.pathname);
    // The creator bottom bar is itself an "Ask AI" bar (round2.js injects it on
    // /creator), so a floating button beside it would be two doors to the same room.
    var bar = document.querySelector('[data-ai-bar]');
    var barVisible = !!(bar && window.getComputedStyle(bar).display !== 'none');
    var fab = document.getElementById('schat-fab');
    if (fab) {
      fab.classList.toggle('show', onSquad && !barVisible);
      if (onSquad && !barVisible) positionFab(fab);
    }
    if (!onSquad && S.open) close();
    if (onSquad && /[?&]chat=1/.test(location.search) && !S.open) open();
  }

  window.sgSquadChat = { open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVisibility);
  } else {
    syncVisibility();
  }
  window.addEventListener('popstate', syncVisibility);
  setInterval(syncVisibility, 800); // the app routes without firing popstate
})();
