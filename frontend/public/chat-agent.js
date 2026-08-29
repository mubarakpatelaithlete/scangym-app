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

  /* The Book agent is the only one that answers anonymous callers, and it is the
     one that knows how to log someone in by voice. Any personality that gets a 401
     hands that turn to it rather than dead-ending on "please sign in". */
  var LOGIN_ENDPOINT = '/api/book/agent';
  var OPEN_CHIPS = cfg.chips || [];
  var TOOL_LABELS = cfg.toolLabels || {};
  var BOTTOM_CHROME = ['.sg-tab-bar', '#sg-continue-banner'].concat(cfg.bottomChrome || []);

  var S = {
    open: false,
    msgs: [],
    busy: false,
    pending: null, // { tool, args } awaiting a Yes
    listening: false,
    voice: false,  // true once the customer has spoken: then we speak back
    live: false,   // hands-free: it listens, answers out loud, listens again
    spoken: 0,     // how much of the streaming answer has been sent to be said
    // One login hand-off per conversation. Set when a 401 sends a turn to the Book
    // agent so it can sign the customer in; without it a fallback that also 401s
    // would bounce between endpoints forever.
    loginHandoffUsed: false,
  };

  /**
   * Turns an answer into something worth hearing. Links, markdown scaffolding and
   * bullet glyphs read as noise out loud ("asterisk asterisk Fitness First").
   */
  function speakable(text) {
    return String(text || '')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/[*_`#>]/g, '')
      .replace(/^\s*[-•]\s*/gm, '')
      .replace(/https?:\/\/\S+/g, 'the link on screen')
      .replace(/\n{2,}/g, '. ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 700);
  }

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
      // Live voice. The product promise is that you say it and it happens, so the
      // hands-free surface is the whole panel, not a button you keep pressing.
      '.pchat-live{position:absolute;inset:0;z-index:5;display:none;flex-direction:column;align-items:center;',
      'justify-content:center;gap:22px;background:radial-gradient(120% 90% at 50% 20%,#151527 0%,#0b0b14 62%)}',
      '.pchat-live.on{display:flex}',
      '.pchat-orb{position:relative;width:132px;height:132px;border-radius:50%;',
      'background:radial-gradient(circle at 34% 30%,#ffb87a 0%,#FF6D00 46%,#c23c00 100%);',
      'box-shadow:0 0 46px rgba(255,109,0,.42);transition:transform .09s linear}',
      '.pchat-orb::after{content:"";position:absolute;inset:-16px;border-radius:50%;',
      'border:2px solid rgba(255,109,0,.32);animation:pchatring 2.1s ease-out infinite}',
      '@keyframes pchatring{0%{transform:scale(.86);opacity:.85}100%{transform:scale(1.28);opacity:0}}',
      '.pchat-live.thinking .pchat-orb{background:radial-gradient(circle at 34% 30%,#cfd6e6 0%,#7c8296 55%,#3a3f4f 100%);box-shadow:0 0 34px rgba(160,170,200,.3)}',
      '.pchat-live.speaking .pchat-orb{background:radial-gradient(circle at 34% 30%,#9ff5c8 0%,#22c55e 52%,#0f7a3d 100%);box-shadow:0 0 46px rgba(34,197,94,.4)}',
      '.pchat-live-state{font-size:15px;font-weight:600;color:#e9edf5;letter-spacing:.2px}',
      '.pchat-live-sub{font-size:12.5px;color:rgba(255,255,255,.45);text-align:center;padding:0 34px;line-height:1.5}',
      '.pchat-live-acts{display:flex;gap:10px;margin-top:4px}',
      '.pchat-live-btn{background:#191926;border:1px solid rgba(255,255,255,.14);color:#e9edf5;border-radius:22px;',
      'padding:10px 18px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}',
      '.pchat-live-btn.end{background:#ef4444;border-color:#ef4444;color:#fff}',
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
    // The pill is now the single orange element on the screen, so it has to say
    // what the product actually wants you to do. "Ask AI" described a chat box;
    // this is a microphone that books gyms. Say so.
    fab.innerHTML = T('<span class="pchat-fab-dot"></span>Talk');
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
      T('<div class="pchat-hint" id="pchat-hint">Tap the mic and just talk — or type. Both work.</div>') +
      T('<div class="pchat-bar">') +
      T('<textarea class="pchat-input" id="pchat-input" rows="1" placeholder="Type or say what you need…"></textarea>') +
      T('<button class="pchat-rnd pchat-mic" id="pchat-mic">🎤</button>') +
      T('<button class="pchat-rnd pchat-send" id="pchat-send">➤</button>') +
      '</div>' +
      T('<div class="pchat-live" id="pchat-live">') +
      T('<div class="pchat-orb" id="pchat-orb"></div>') +
      T('<div class="pchat-live-state" id="pchat-live-state">Listening…</div>') +
      T('<div class="pchat-live-sub" id="pchat-live-sub">Just say what you need — stop talking and I\'ll answer. Talk over me any time.</div>') +
      T('<div class="pchat-live-acts">') +
      T('<button class="pchat-live-btn" id="pchat-live-type">⌨ Type instead</button>') +
      T('<button class="pchat-live-btn end" id="pchat-live-end">End voice</button>') +
      '</div></div>';
    document.body.appendChild(root);

    document.getElementById(T('pchat-close')).onclick = close;
    document.getElementById(T('pchat-send')).onclick = function () {
      if (S.busy) { stopStream(); return; }
      send(document.getElementById(T('pchat-input')).value);
    };
    document.getElementById(T('pchat-mic')).onclick = toggleMic;
    document.getElementById(T('pchat-live-end')).onclick = endLive;
    document.getElementById(T('pchat-live-type')).onclick = endLive;

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
  // The server sends the line for anything that moves money, priced by the pricing engine
  // rather than by the model, and marks it `spoken:true`. Prefer it: a tab's own copy
  // cannot know the amount (book_and_pay's args are only gymId, date and time), and the
  // last-resort 'Go ahead with this?' asks for a yes to a number nobody has said.
  function confirmSummary(tool, args, evt) {
    if (evt && evt.spoken && evt.summary) return evt.summary;
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

  // ── saying "yes" is the confirmation ────────────────────────────────────────
  // The promise is zero taps. A pending booking used to need a tap on "Yes, do it",
  // which is exactly the one click we said nobody should have to make. Spoken (or
  // typed) agreement now carries the same weight as the chip.
  var YES = /^(?:ok(?:ay)?|yes|yeah|yep|yup|sure|correct|confirm(?:ed|\s+it)?|go\s+ahead|do\s+it|book\s+it|please\s+do|that'?s\s+right|sounds?\s+good|let'?s\s+do\s+it)\b[\s.!,]*$/i;
  var NO = /^(?:no|nope|nah|cancel|stop|don'?t|do\s+not|not\s+now|never\s+mind|nevermind|forget\s+it|wait)\b[\s.!,]*$/i;

  function confirmByWord(text) {
    if (!S.pending) return false;
    var t = (text || '').trim();
    if (YES.test(t)) {
      var p = S.pending;
      S.pending = null;
      bubble(T('pchat-me'), t);
      chips([]);
      S.busy = true;
      S.spoken = 0;
      typingOn();
      stream({ confirm: p });
      return true;
    }
    if (NO.test(t)) {
      S.pending = null;
      bubble(T('pchat-me'), t);
      chips(startChips());
      var line = 'Left as it was. Anything else?';
      bubble(T('pchat-ai'), line);
      if (S.voice && window.SGVoice && window.SGVoice.say) {
        window.SGVoice.say(line);
        if (window.SGVoice.endSay) {
          window.SGVoice.endSay().then(function () {
            if (S.live && window.SGVoice.isLive && window.SGVoice.isLive()) {
              liveState('listening');
              window.SGVoice.resumeLive();
            }
          });
        }
      }
      return true;
    }
    // Anything else: they changed their mind mid-flight. Drop the stale booking
    // rather than let a later "yes" confirm a price they have moved on from.
    S.pending = null;
    return false;
  }

  function send(text, confirmPayload) {
    text = (text || '').trim();
    if (S.busy) return;
    if (!text && !confirmPayload) return;
    if (!confirmPayload && text && confirmByWord(text)) return;

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
    S.spoken = 0;
    typingOn(); // the send button becomes Stop in setBusyUI(true), so it stays tappable

    stream({ message: text, history: history(), confirm: confirmPayload || null });
  }

  /* What the customer is looking at right now.
   *
   * Until this existed, every tab's agent was blind to its own screen: on Reels
   * "book that one" could only be answered by asking which one, which is the
   * conversation the tab exists to avoid. A personality supplies cfg.context()
   * and the server folds it into the prompt as context, never as instructions. */
  function pageContext() {
    if (typeof cfg.context !== 'function') return null;
    try {
      var ctx = cfg.context();
      return ctx && typeof ctx === 'object' ? ctx : null;
    } catch (e) {
      return null; // a broken personality must never break sending a message
    }
  }

  function withContext(body) {
    var ctx = pageContext();
    if (!ctx) return body;
    var out = {};
    for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
    out.context = ctx;
    return out;
  }

  function stream(body, endpointOverride) {
    var endpoint = endpointOverride || cfg.endpoint;
    var aiBubble = null;
    var acc = '';
    // 2/5. Streaming you can interrupt. ChatGPT's stop button is why long answers
    // never feel like being trapped; aborting mid-stream keeps whatever arrived.
    var ctrl = window.AbortController ? new AbortController() : null;
    S.ctrl = ctrl;
    setBusyUI(true);

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(withContext(body)),
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (res.status === 401) {
          /* Signing in must never be a dead end.
           *
           * The Partner and ScanSquad agents sit behind authenticateUser, so an
           * anonymous visitor got 401 and this handler printed a static "sign in
           * first" line and stopped. There was no way to sign in by voice on those
           * tabs at all -- the one moment the product hands you back to tapping.
           *
           * The Book agent is public and already knows how to log someone in by
           * voice: it asks for a number, calls send_login_code, and takes the six
           * digits back. So instead of giving up, hand this turn to it. Once the
           * session exists the original agent answers normally on the next turn.
           *
           * Guarded by loginHandoffUsed so a 401 from the fallback itself cannot
           * loop, and skipped when this personality already is the Book agent. */
          if (!S.loginHandoffUsed && endpoint !== LOGIN_ENDPOINT) {
            S.loginHandoffUsed = true;
            stream(body, LOGIN_ENDPOINT);
            return null;
          }
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
        sayReady(acc); // start talking on the first finished sentence, not the last
      } else if (event === 'tool') {
        typingOff();
        if (data.state === 'running') toolLine(data.tool);
        else toolDone(data.tool, data.ok !== false);
      } else if (event === 'confirm') {
        typingOff();
        S.pending = { tool: data.tool, args: data.args };
        if (!aiBubble) aiBubble = bubble(T('pchat-ai'), '');
        acc = (acc ? acc + '\n\n' : '') + confirmSummary(data.tool, data.args, data);
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

      // Speech out. The promise of the product is that you hear the answer, not that
      // you read it — but audio is a bonus layer: it never blocks or breaks the chat.
      if (acc && S.voice && window.SGVoice) {
        sayReady(acc, true);
        if (window.SGVoice.endSay) {
          window.SGVoice.endSay().then(function () {
            if (S.live && window.SGVoice.isLive && window.SGVoice.isLive()) {
              liveState('listening');
              window.SGVoice.resumeLive();
            }
          });
        }
      } else if (S.live && window.SGVoice && window.SGVoice.isLive && window.SGVoice.isLive()) {
        liveState('listening');
        window.SGVoice.resumeLive();
      }

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
  // Two paths. Preferred: record with MediaRecorder and transcribe on our server
  // (works in every browser and inside the Android shell, and hears British gym
  // names properly). Fallback: the browser's own SpeechRecognition, which only
  // Chrome and Safari have. Either way one tap starts, one tap stops.
  var recognition = null;

  function micEl() {
    return document.getElementById(T('pchat-mic'));
  }

  function micOn(on) {
    var mic = micEl();
    if (mic) mic.classList[on ? 'add' : 'remove']('on');
    S.listening = on;
  }

  /**
   * Sends whole sentences to be spoken as they arrive. Waiting for the full
   * answer adds a second of silence to every reply; a sentence is enough to
   * start, and the queue keeps the order honest.
   */
  function sayReady(acc, flush) {
    if (!S.voice || !window.SGVoice || !window.SGVoice.say) return;
    var rest = acc.slice(S.spoken);
    if (!rest) return;
    if (flush) {
      var tail = speakable(rest);
      S.spoken = acc.length;
      if (tail) window.SGVoice.say(tail);
      return;
    }
    var cut = -1;
    var m = /[.!?…](\s|$)|\n/g;
    var hit;
    while ((hit = m.exec(rest)) !== null) cut = hit.index + 1;
    // Every chunk costs one request against a 10-per-minute provider limit, so only the
    // opening line is allowed to be short — that one buys time-to-first-audio and is worth
    // the request. After that, wait for a decent mouthful rather than spending a request
    // on "Sure." and another on "OK." Anything left over is flushed at the end regardless.
    var first = S.spoken === 0;
    if (cut < (first ? 12 : 80)) return;
    var chunk = speakable(rest.slice(0, cut));
    S.spoken += cut;
    if (chunk) window.SGVoice.say(chunk);
  }

  // ── hands-free ────────────────────────────────────────────────────────────
  function liveEl(id) { return document.getElementById(T(id)); }

  var LIVE_COPY = {
    listening: ['Listening…', 'Just say what you need — stop talking and I\'ll answer.'],
    heard: ['Listening…', 'Go on, I\'m with you.'],
    thinking: ['Thinking…', 'One moment.'],
    speaking: ['Speaking…', 'Talk over me any time and I\'ll stop.'],
  };

  function liveState(state) {
    var panel = liveEl('pchat-live');
    if (!panel) return;
    panel.classList.remove('thinking', 'speaking');
    if (state === 'thinking' || state === 'speaking') panel.classList.add(state);
    var copy = LIVE_COPY[state] || LIVE_COPY.listening;
    var label = liveEl('pchat-live-state');
    var sub = liveEl('pchat-live-sub');
    if (label) label.textContent = copy[0];
    if (sub) sub.textContent = copy[1];
  }

  // One utterance may wait for the current turn to finish. The newest wins — if you
  // talk over yourself twice, the last thing you said is the thing you meant.
  var livePending = null;
  var livePolling = false;

  function sendWhenIdle(said) {
    livePending = said;
    if (livePolling) return;
    livePolling = true;
    var tries = 0;
    (function poll() {
      if (!S.busy) {
        livePolling = false;
        var text = livePending;
        livePending = null;
        if (text) send(text);
        return;
      }
      if (++tries > 40) { // ~2s, then say so rather than swallowing it
        livePolling = false;
        livePending = null;
        setHint('That did not go through — say it again.');
        return;
      }
      setTimeout(poll, 50);
    })();
  }

  function startLive() {
    if (!window.SGVoice || !window.SGVoice.startLive) { toggleMicClassic(); return; }
    var panel = liveEl('pchat-live');
    if (panel) panel.classList.add('on');
    liveState('listening');
    S.live = true;
    S.voice = true;
    micOn(true);

    var _live = window.SGVoice
      .startLive({
        onState: function (state) {
          if (state === 'thinking') liveState('thinking');
          else if (state === 'listening') liveState('listening');
          else if (state === 'speaking') liveState('speaking');
        },
        onHeard: function () { liveState('heard'); },
        onLevel: function (level) {
          var orb = liveEl('pchat-orb');
          if (orb) orb.style.transform = 'scale(' + (1 + Math.min(level * 3.2, 0.42)).toFixed(3) + ')';
        },
        onBargeIn: function () {
          // You talked over it: stop the answer coming as well as the audio.
          liveState('listening');
          if (S.busy) stopStream();
        },
        onFinal: function (said) {
          liveState('thinking');
          S.spoken = 0;
          S.voice = true;
          // Interrupting aborts the previous turn, but the abort unwinds a moment
          // later — so this used to arrive while still busy and be dropped on the
          // floor, which is exactly what made it feel like it ignored you. Hold it
          // until the turn ends instead. Never two turns at once: that could book twice.
          if (S.busy) { sendWhenIdle(said); return; }
          send(said);
        },
      })
      .catch(function (err) {
        endLive();
        if (S.deferOpen) {
          // Never opened, so there is nothing to explain: leave the visitor on the tab.
          S.deferOpen = false;
          console.log('[ChatAgent] voice unavailable — staying out of the way:', (err && err.message) || '');
          return;
        }
        setHint((err && err.message) || 'Voice is not available here — typing works.');
      });
    if (_live && _live.then) {
      _live.then(function () {
        if (S.deferOpen) { S.deferOpen = false; open(); }
      });
    }
  }

  function endLive() {
    S.live = false;
    micOn(false);
    var panel = liveEl('pchat-live');
    if (panel) panel.classList.remove('on');
    if (window.SGVoice && window.SGVoice.stopLive) window.SGVoice.stopLive();
  }

  function toggleMic() {
    if (S.live) { endLive(); return; }
    if (window.SGVoice && window.SGVoice.startLive && window.SGVoice.canRecord()) {
      window.SGVoice.ready().then(function (on) {
        if (on) startLive();
        else toggleMicClassic();
      });
      return;
    }
    toggleMicClassic();
  }

  function toggleMicClassic() {
    // Barge-in: if it is talking and you touch the mic, it stops talking at once.
    if (window.SGVoice && window.SGVoice.isSpeaking()) window.SGVoice.shutUp();

    if (S.listening) {
      if (window.SGVoice && window.SGVoice.isListening()) window.SGVoice.stopListening();
      else if (recognition) recognition.stop();
      return;
    }

    if (window.SGVoice && window.SGVoice.canRecord()) {
      window.SGVoice.ready().then(function (on) {
        if (on) serverListen();
        else browserListen();
      });
      return;
    }
    browserListen();
  }

  function serverListen() {
    window.SGVoice
      .listen({
        onStart: function () {
          micOn(true);
          setHint('Listening… tap again when you\'re done.');
        },
        onThinking: function () {
          micOn(false);
          setHint('One moment…');
        },
      })
      .then(function (said) {
        setHint(null);
        if (!said) {
          setHint("Didn't catch that — try again or type it.");
          return;
        }
        S.voice = true; // they spoke, so answer out loud
        send(said);
      })
      .catch(function (err) {
        micOn(false);
        setHint((err && err.message) || "Didn't catch that — try again or type it.");
      });
  }

  function browserListen() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setHint('Voice needs Chrome or Safari here — typing works everywhere.');
      return;
    }

    recognition = new SR();
    recognition.lang = 'en-GB';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = function () {
      micOn(true);
      setHint('Listening…');
    };
    recognition.onresult = function (e) {
      var said = e.results[0][0].transcript;
      if (said) {
        S.voice = true;
        send(said);
      }
    };
    recognition.onerror = function (e) {
      setHint(
        e.error === 'not-allowed'
          ? 'Microphone blocked — allow it in your browser settings.'
          : "Didn't catch that — try again or type it."
      );
    };
    recognition.onend = function () {
      micOn(false);
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
    endLive(); // never leave a microphone running behind a closed panel
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

  return {
    open: open,
    close: close,
    ns: NS,
    // Used by voice-always.js so voice can be the front door, not a button.
    onTab: function () { return cfg.paths.test(location.pathname); },
    isLive: function () { return !!S.live; },
    isOpen: function () { return !!S.open; },
    /**
     * Voice as the front door must not become a door in the way. If the microphone is
     * blocked or missing, opening the sheet leaves an empty chat panel covering the whole
     * Book tab — which is exactly what a visitor with no mic permission saw. So build it,
     * try the mic, and only take over the screen once voice is genuinely live.
     */
    startLive: function () { build(); S.deferOpen = !S.open; startLive(); },
    endLive: function () { endLive(); },
  };
}

window.sgChatAgent = { create: createChatAgent };
})();
