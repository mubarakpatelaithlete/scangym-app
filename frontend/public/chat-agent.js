/**
 * Chat agent engine — ONE ChatGPT-style chat, configured per tab.
 *
 * partner-chat.js and squad-chat.js used to be two ~750-line copies of the same file.
 * They drifted: the Partner copy got the fix that keeps the panel above the bottom
 * navigation (measured `--bottom` inset, z-index 9400), while the ScanSquad copy kept
 * an older version (z-index 8500, a resize listener added on every open) — so the same
 * feature behaved differently depending on which tab you were in.
 *
 * This is the Partner version, parameterised. Everything shared lives here; each tab
 * only supplies its own words, endpoint, tool labels and routes:
 *
 *   window.sgChatAgent.create({
 *     ns, paths, endpoint, avatar, title, subtitle, fabTitle, chips, toolLabels,
 *     confirmSummary(tool, args), greetSignedIn, greetSignedOut, signedOutReply,
 *     resultLink(result), bottomChrome
 *   })  ->  { open, close, ns }
 *
 * `ns` is the CSS/DOM prefix ('pchat', 'schat'). Styles and markup are written once
 * with the `pchat` prefix and re-namespaced at build time by T(), so the two chats
 * cannot collide in the DOM.
 *
 * Self-contained: no framework, no build step, no dependency on app.ctr576.js internals
 * beyond `window.state.user` for the sign-in check.
 */
(function () {
  'use strict';

function createChatAgent(cfg) {
  var NS = cfg.ns;                                  // 'pchat' | 'schat' | …
  var T = function (str) { return String(str).split('pchat').join(NS); };
  var OPEN_CHIPS = cfg.chips || [];
  var TOOL_LABELS = cfg.toolLabels || {};
  var BOTTOM_CHROME = ['.sg-tab-bar', '#sg-continue-banner'].concat(cfg.bottomChrome || []);

  var S = {
    open: false,
    msgs: [],
    busy: false,
    pending: null, // { tool, args } awaiting a Yes
    listening: false,
  };

  // ── styles ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById(T('pchat-styles'))) return;
    var css = T([
      // z-index sits above the partner Continue banner (8999) and the tab bar (9000),
      // and `bottom` is recalculated from their real heights — a 52px circle at
      // bottom:72px was completely buried behind the banner on the Partner tab.
      '#pchat-fab{position:fixed;right:14px;z-index:9100;height:46px;padding:0 16px 0 13px;border-radius:23px;',
      'background:linear-gradient(135deg,#FF6D00,#ff9d4d);border:none;color:#fff;font-size:14px;font-weight:700;',
      'font-family:inherit;cursor:pointer;box-shadow:0 8px 28px rgba(255,109,0,.5);display:none;align-items:center;',
      'gap:7px;white-space:nowrap;-webkit-tap-highlight-color:transparent}',
      '#pchat-fab.show{display:flex}',
      '#pchat-fab:active{transform:scale(.96)}',
      '#pchat-fab .pchat-fab-dot{width:7px;height:7px;border-radius:50%;background:#fff;opacity:.9;',
      'animation:pchatfabp 1.6s ease-in-out infinite}',
      '@keyframes pchatfabp{50%{opacity:.35}}',
      // The chat is a tab, not a modal: it stops above whatever the app has pinned to
      // the bottom (tab bar 56px, plus the Continue banner when it is up), exactly like
      // the Reels tab iframe does. `--pchat-bottom` is measured in syncBottomInset().
      '#pchat{position:fixed;top:0;left:0;right:0;',
      'bottom:var(--pchat-bottom,calc(56px + env(safe-area-inset-bottom,0px)));',
      'z-index:9400;background:#080812;display:none;flex-direction:column}',
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
      // No safe-area padding here any more: the tab bar below already owns that space.
      '.pchat-bar{border-top:1px solid rgba(255,255,255,.08);padding:10px 12px 12px;',
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
      // 4. "Calm screen": replies are rendered, not dumped. Bold, bullets, numbered
      // steps and links get real typography so an answer reads like an answer instead
      // of a paragraph full of asterisks.
      '.pchat-ai strong{color:#fff;font-weight:700}',
      '.pchat-ai em{font-style:italic;opacity:.92}',
      '.pchat-ai code{background:rgba(255,255,255,.09);border-radius:5px;padding:1px 5px;font-size:13px;font-family:ui-monospace,Menlo,monospace}',
      '.pchat-ai ul{margin:6px 0;padding-left:20px;list-style:disc outside}',
      '.pchat-ai ol{margin:6px 0;padding-left:22px;list-style:decimal outside}',
      '.pchat-ai li{line-height:1.45;margin:0 0 4px;display:list-item}',
      '.pchat-ai li::marker{color:#FF6D00}',
      '.pchat-ai p{margin:0 0 8px}',
      '.pchat-ai p:last-child{margin-bottom:0}',
      '.pchat-ai a{color:#ffb87a;text-decoration:underline}',
      '.pchat-ai.rich{white-space:normal}',
      '.pchat-stop{background:#191926;border:1px solid rgba(255,255,255,.18);color:#fff}',
    ].join(''));
    var el = document.createElement('style');
    el.id = T('pchat-styles');
    el.textContent = css;
    document.head.appendChild(el);
  }

  // ── shell ─────────────────────────────────────────────────────────────────
  function build() {
    if (document.getElementById(T('pchat'))) return;
    injectStyles();

    var fab = document.createElement('button');
    fab.id = T('pchat-fab');
    fab.title = cfg.fabTitle || 'Ask ScanGym';
    fab.innerHTML = T('<span class="pchat-fab-dot"></span>Ask AI');
    fab.onclick = open;
    document.body.appendChild(fab);

    var root = document.createElement('div');
    root.id = T('pchat');
    root.innerHTML =
      T('<div class="pchat-top">') +
      T('<div class="pchat-av">') + esc(cfg.avatar || '🏋️') + '</div>' +
      T('<div><div class="pchat-title">') + esc(cfg.title) +
      T('</div><div class="pchat-sub">● ') + esc(cfg.subtitle) + '</div></div>' +
      T('<button class="pchat-x" id="pchat-close">×</button>') +
      '</div>' +
      T('<div class="pchat-scroll" id="pchat-scroll"></div>') +
      T('<div class="pchat-chips" id="pchat-chips"></div>') +
      T('<div class="pchat-hint" id="pchat-hint">Tap, type, or hold the mic — all three work.</div>') +
      T('<div class="pchat-bar">') +
      T('<textarea class="pchat-input" id="pchat-input" rows="1" placeholder="Type or say what you need…"></textarea>') +
      T('<button class="pchat-rnd pchat-mic" id="pchat-mic">🎤</button>') +
      T('<button class="pchat-rnd pchat-send" id="pchat-send">➤</button>') +
      '</div>';
    document.body.appendChild(root);

    document.getElementById(T('pchat-close')).onclick = close;
    document.getElementById(T('pchat-send')).onclick = function () {
      if (S.busy) { stopStream(); return; }
      send(document.getElementById(T('pchat-input')).value);
    };
    document.getElementById(T('pchat-mic')).onclick = toggleMic;

    var input = document.getElementById(T('pchat-input'));
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
    var s = document.getElementById(T('pchat-scroll'));
    if (s) setTimeout(function () { s.scrollTop = s.scrollHeight; }, 20);
  }

  function bubble(cls, text) {
    var d = document.createElement('div');
    d.className = T('pchat-msg ') + cls;
    d.textContent = text || '';
    document.getElementById(T('pchat-scroll')).appendChild(d);
    scrollDown();
    return d;
  }

  function typingOn() {
    var d = document.createElement('div');
    d.className = T('pchat-typing');
    d.id = T('pchat-typing');
    d.innerHTML = '<i></i><i></i><i></i>';
    document.getElementById(T('pchat-scroll')).appendChild(d);
    scrollDown();
  }

  function typingOff() {
    var d = document.getElementById(T('pchat-typing'));
    if (d) d.remove();
  }

  function toolLine(tool) {
    var d = document.createElement('div');
    d.className = T('pchat-tool');
    d.id = T('pchat-tool-') + tool;
    d.innerHTML = T('<span class="pchat-spin"></span>') + (TOOL_LABELS[tool] || 'Working') + '…';
    document.getElementById(T('pchat-scroll')).appendChild(d);
    scrollDown();
  }

  function toolDone(tool, ok) {
    var d = document.getElementById(T('pchat-tool-') + tool);
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
    var h = document.getElementById(T('pchat-hint'));
    if (!h) return;
    if (text === null) { h.style.display = 'none'; return; }
    h.style.display = '';
    h.textContent = text;
  }

  function chips(list) {
    var c = document.getElementById(T('pchat-chips'));
    c.innerHTML = '';
    (list || []).forEach(function (item) {
      var label = typeof item === 'string' ? item : item.label;
      var b = document.createElement('div');
      b.className = T('pchat-chip') + (item.style ? ' ' + item.style : '');
      b.textContent = label;
      b.onclick = typeof item === 'string' ? function () { send(label); } : item.onClick;
      c.appendChild(b);
    });
  }

  // ── confirmation copy — the user must see the number before saying yes ────
  function confirmSummary(tool, args) {
    var text = cfg.confirmSummary ? cfg.confirmSummary(tool, args || {}) : null;
    return text || 'Go ahead with this?';
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
    var btn = document.getElementById(T('pchat-send'));
    if (!btn) return;
    btn.disabled = false;
    btn.classList.toggle(T('pchat-stop'), busy);
    btn.classList.toggle(T('pchat-send'), !busy);
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
    var nodes = document.querySelectorAll(T('.pchat-tool .pchat-spin'));
    for (var i = 0; i < nodes.length; i++) {
      var row = nodes[i].parentNode;
      row.innerHTML = '× ' + row.textContent.replace(/…$/, '') + ' — did not finish';
    }
  }

  function send(text, confirmPayload) {
    text = (text || '').trim();
    if (S.busy) return;
    if (!text && !confirmPayload) return;

    var input = document.getElementById(T('pchat-input'));
    if (input) {
      input.value = '';
      input.style.height = '44px';
    }

    if (text) {
      bubble(T('pchat-me'), text);
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

    fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (res.status === 401) {
          typingOff();
          bubble(T('pchat-ai'), cfg.signedOutReply);
          finish();
          return null;
        }
        if (!res.ok || !res.body) {
          typingOff();
          bubble(T('pchat-ai'), "I couldn't reach the server just then. Try again in a moment.");
          finish();
          return null;
        }
        return readStream(res.body.getReader());
      })
      .catch(function (err) {
        typingOff();
        if (!err || err.name !== 'AbortError') {
          bubble(T('pchat-ai'), 'Connection dropped — nothing was changed.');
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
        if (!aiBubble) aiBubble = bubble(T('pchat-ai'), '');
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
        if (!aiBubble) aiBubble = bubble(T('pchat-ai'), '');
        acc = (acc ? acc + '\n\n' : '') + confirmSummary(data.tool, data.args);
        renderRich(aiBubble, acc);
        scrollDown();
      } else if (event === 'done') {
        var link = cfg.resultLink ? cfg.resultLink(data.result || {}) : null;
        if (link && link.href) {
          var row = document.createElement('div');
          row.className = T('pchat-msg') + ' ' + T('pchat-ai');
          var a = document.createElement('a');
          a.className = T('pchat-link');
          a.href = link.href;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = link.label || link.href;
          row.appendChild(a);
          document.getElementById(T('pchat-scroll')).appendChild(row);
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
              bubble(T('pchat-me'), 'Yes');
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
              bubble(T('pchat-me'), 'No');
              bubble(T('pchat-ai'), 'Left as it was. Anything else?');
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
    var mic = document.getElementById(T('pchat-mic'));

    if (!SR) {
      document.getElementById(T('pchat-hint')).textContent =
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
      document.getElementById(T('pchat-hint')).textContent = 'Listening…';
    };
    recognition.onresult = function (e) {
      var said = e.results[0][0].transcript;
      if (said) send(said);
    };
    recognition.onerror = function (e) {
      document.getElementById(T('pchat-hint')).textContent =
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
          bubble(T('pchat-ai'), "You're in. What do you need?");
          chips(OPEN_CHIPS);
        } else if (tries > 240) {
          clearInterval(poll);
        }
      }, 500);
    } else {
      bubble(T('pchat-ai'), 'Tap Profile at the bottom to sign in, then come back here.');
    }
  }

  function greet() {
    var signedIn = !!(window.state && window.state.user);
    if (!signedIn) {
      bubble(T('pchat-ai'), cfg.greetSignedOut);
      // 1. No dead ends: "sign in" used to be advice with nothing to tap.
      chips([{ label: 'Sign me in', style: 'yes', onClick: openSignIn }]);
      return;
    }
    bubble(T('pchat-ai'), cfg.greetSignedIn);
    chips(OPEN_CHIPS);
  }

  function open() {
    build();
    syncBottomInset();
    var root = document.getElementById(T('pchat'));
    root.classList.add('open');
    S.open = true;
    if (!S.msgs.length && !document.getElementById(T('pchat-scroll')).children.length) greet();
    setTimeout(function () {
      var i = document.getElementById(T('pchat-input'));
      if (i && window.innerWidth > 640) i.focus();
    }, 120);
  }

  function close() {
    var root = document.getElementById(T('pchat'));
    if (root) root.classList.remove('open');
    S.open = false;
  }

  /**
   * Keep the button and the panel clear of whatever the app has pinned to the bottom of
   * the screen: the tab bar (56px) plus any full-width CTA banner. Learned the hard way
   * on the Partner tab, where a hardcoded 72px offset put the button underneath the
   * orange Continue bar and made it invisible.
   */
  /** Total height of everything the app has pinned to the bottom of the screen. */
  function bottomChromeHeight() {
    var h = 0;
    BOTTOM_CHROME.forEach(function (sel) {
      var el = document.querySelector(sel);
      if (!el) return;
      var s = window.getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') return;
      var r = el.getBoundingClientRect().height;
      if (r > 0 && r < 200) h += r;
    });
    return h;
  }

  function positionFab(fab) {
    fab.style.bottom = 'calc(env(safe-area-inset-bottom, 0px) + ' + (bottomChromeHeight() + 12) + 'px)';
  }

  /**
   * Keeps the chat panel sitting on top of the bottom navigation instead of over it,
   * so Reels / Book / ScanSquad / Partner stay tappable while the chat is open — the
   * same behaviour as the Reels tab, which renders inside the same window.
   */
  function syncBottomInset() {
    var h = bottomChromeHeight();
    var val = h
      ? h + 'px'
      : 'calc(56px + env(safe-area-inset-bottom, 0px))';
    document.documentElement.style.setProperty(T('--pchat-bottom'), val);
  }

  // Show the button only on this agent's own tab; open automatically for ?chat=1.
  function syncVisibility() {
    build();
    var onTab = cfg.paths.test(location.pathname);
    // The bottom bar is now itself an "Ask AI" bar, so a floating button beside it
    // would be two doors to the same room. Show the button only when that bar is not
    // on screen.
    var bar = document.querySelector('[data-ai-bar]');
    var barVisible = !!(bar && window.getComputedStyle(bar).display !== 'none');
    var fab = document.getElementById(T('pchat-fab'));
    if (fab) {
      fab.classList.toggle('show', onTab && !barVisible);
      if (onTab && !barVisible) positionFab(fab);
    }
    if (S.open) syncBottomInset();
    if (!onTab && S.open) close();
    if (onTab && /[?&]chat=1/.test(location.search) && !S.open) open();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncVisibility);
  } else {
    syncVisibility();
  }
  window.addEventListener('popstate', syncVisibility);
  window.addEventListener('resize', function () {
    if (S.open) syncBottomInset();
  });
  setInterval(syncVisibility, 800); // the app routes without firing popstate

  return { open: open, close: close, ns: NS };
}

window.sgChatAgent = { create: createChatAgent };
})();
