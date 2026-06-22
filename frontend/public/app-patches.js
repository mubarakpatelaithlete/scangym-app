/**
 * ScanGym App Patches v2.0
 * Applied after app.ctr576.js loads
 * 
 * Implements:
 *  #4  -- "30 gyms in 30 days" USP messaging
 *  #5  -- Anti-subscription messaging
 *  #17 -- 24/7 filter button in filter sheet
 *  #18 -- Self-service entry filter button
 *  #19 -- Manchester as default city
 *  #26 -- Uber-style Mapbox map in gym overlay (no Google link)
 *  #35 -- Continue button casino/dopamine pulsing glow (NEW)
 *  #49 -- Reels -> inline booking overlay -> QR (no tab switch) (NEW)
 *  C1  -- Auto-play fix: ensure videos play on Reels page
 * 
 * All patches are idempotent.
 */

(function() {
  'use strict';

  // ====================================================================
  // #35: Casino glow on Continue banner (dopamine CTA)
  // ====================================================================
  function patchContinueBanner() {
    var styleId = 'sg-casino-continue-style';
    if (document.getElementById(styleId)) return;
    var s = document.createElement('style');
    s.id = styleId;
    s.textContent = [
      '@keyframes sgCasinoGlow{',
        '0%,100%{box-shadow:0 -4px 20px rgba(255,109,0,.45),0 4px 20px rgba(255,109,0,.45),inset 0 0 20px rgba(255,109,0,.1);background-position:0% 50%}',
        '50%{box-shadow:0 -6px 35px rgba(255,109,0,.8),0 6px 35px rgba(255,109,0,.8),inset 0 0 40px rgba(255,109,0,.25);background-position:100% 50%}',
      '}',
      '#sg-continue-banner{',
        'background:linear-gradient(135deg,#FF6D00 0%,#ff8534 33%,#FF6D00 66%,#E66200 100%);',
        'background-size:300% 300%;',
        'animation:sgCasinoGlow 1.8s ease-in-out infinite!important;',
        'border-top:1px solid rgba(255,255,255,.25);',
      '}',
      '#sg-continue-banner .sg-cb-text{',
        'text-shadow:0 0 12px rgba(255,255,255,.6),0 2px 4px rgba(0,0,0,.3);',
        'letter-spacing:.5px;',
      '}',
    ].join('');
    document.head.appendChild(s);
    console.log('[Patches] #35: Casino glow applied to Continue banner');
  }

  // ====================================================================
  // C1 Fix: Auto-play reels videos (muted required by browser policy)
  // ====================================================================
  function fixVideoAutoplay() {
    function tryPlay(video) {
      if (!video._sgAutoplayAttempted) {
        video._sgAutoplayAttempted = true;
        video.muted = true;
        video.setAttribute('muted', '');
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.play().catch(function() {});
      }
    }
    document.querySelectorAll('video').forEach(tryPlay);
    var vidObserver = new MutationObserver(function(muts) {
      muts.forEach(function(m) {
        m.addedNodes.forEach(function(node) {
          if (!node) return;
          if (node.tagName === 'VIDEO') tryPlay(node);
          if (node.querySelectorAll) node.querySelectorAll('video').forEach(tryPlay);
        });
      });
    });
    vidObserver.observe(document.body, { childList: true, subtree: true });
    var retried = false;
    document.addEventListener('touchstart', function() {
      if (retried) return; retried = true;
      document.querySelectorAll('video').forEach(function(v) {
        if (v.paused) { v.muted = true; v.play().catch(function(){}); }
      });
    }, { once: false, passive: true });
    console.log('[Patches] C1: Video autoplay fix active');
  }

  // ====================================================================
  // #49: Reels -> inline booking overlay (no tab switch)
  // ====================================================================
  function patchReelsBooking() {
    var styleId = 'sg-reel-book-style';
    if (!document.getElementById(styleId)) {
      var s = document.createElement('style');
      s.id = styleId;
      s.textContent = [
        '.sg-reel-book-overlay{position:fixed;inset:0;z-index:99999;background:rgba(5,8,22,.96);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);display:flex;flex-direction:column;transform:translateY(100%);transition:transform .35s cubic-bezier(.4,0,.2,1);overflow-y:auto;-webkit-overflow-scrolling:touch;}',
        '.sg-reel-book-overlay.open{transform:translateY(0)}',
        '.sg-rbo-header{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 12px;flex-shrink:0;border-bottom:1px solid rgba(255,255,255,.08);}',
        '.sg-rbo-close{width:36px;height:36px;background:rgba(255,255,255,.08);border:none;border-radius:50%;color:#fff;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
        '.sg-rbo-title{color:#fff;font-size:16px;font-weight:700;flex:1;text-align:center;margin:0 8px}',
        '.sg-rbo-content{flex:1;padding:0 16px 100px}',
        '.sg-rbo-gym-name{color:#fff;font-size:20px;font-weight:800;margin:16px 0 4px}',
        '.sg-rbo-gym-addr{color:rgba(255,255,255,.5);font-size:12px;margin-bottom:16px}',
        '.sg-rbo-pass-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}',
        '.sg-rbo-pass{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px 12px;cursor:pointer;transition:all .15s;-webkit-tap-highlight-color:transparent;}',
        '.sg-rbo-pass.selected{background:rgba(255,109,0,.15);border-color:rgba(255,109,0,.5);}',
        '.sg-rbo-pass-name{color:#fff;font-size:13px;font-weight:700;margin-bottom:2px}',
        '.sg-rbo-pass-price{color:#FF6D00;font-size:16px;font-weight:800}',
        '.sg-rbo-pass-sub{color:rgba(255,255,255,.4);font-size:10px}',
        '.sg-rbo-cta{position:fixed;bottom:calc(56px + env(safe-area-inset-bottom,0px));left:0;right:0;padding:12px 16px;background:rgba(5,8,22,.95);border-top:1px solid rgba(255,255,255,.06);z-index:100000;}',
        '.sg-rbo-book-btn{width:100%;padding:14px;border:none;border-radius:14px;background:linear-gradient(135deg,#FF6D00,#ff8534,#FF6D00);background-size:200% 200%;color:#fff;font-size:16px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(255,109,0,.4);animation:sgCasinoGlow 1.8s ease-in-out infinite;-webkit-tap-highlight-color:transparent;}',
      ].join('');
      document.head.appendChild(s);
    }

    function getOrCreateOverlay() {
      var ov = document.getElementById('sg-reel-book-overlay');
      if (ov) return ov;
      ov = document.createElement('div');
      ov.id = 'sg-reel-book-overlay';
      ov.className = 'sg-reel-book-overlay';
      document.body.appendChild(ov);
      return ov;
    }

    window.sgOpenReelBooking = function(gymId, gymName, gymAddr, gymPrice, gymCurrency) {
      var ov = getOrCreateOverlay();
      var sym = gymCurrency || (window.sgSymbol ? window.sgSymbol() : '£');
      var price = gymPrice || (window.sgPrice ? window.sgPrice('day').amount : 4.49);
      var pd = sym + parseFloat(price).toFixed(2);
      ov.innerHTML = [
        '<div class="sg-rbo-header">',
          '<button class="sg-rbo-close" onclick="window.sgCloseReelBooking()">✕</button>',
          '<span class="sg-rbo-title">Book a Day Pass</span>',
          '<div style="width:36px"></div>',
        '</div>',
        '<div class="sg-rbo-content">',
          '<div class="sg-rbo-gym-name">' + (gymName || 'Gym') + '</div>',
          '<div class="sg-rbo-gym-addr">📍 ' + (gymAddr || '') + '</div>',
          '<div style="color:rgba(255,255,255,.4);font-size:11px;font-weight:600;margin-bottom:10px">SELECT PASS</div>',
          '<div class="sg-rbo-pass-grid">',
            '<div class="sg-rbo-pass selected" data-pass="day" onclick="sgSelectReelPass(this,\'day\')"><div class="sg-rbo-pass-name">Day Pass</div><div class="sg-rbo-pass-price">' + pd + '</div><div class="sg-rbo-pass-sub">24h access</div></div>',
            '<div class="sg-rbo-pass" data-pass="3day" onclick="sgSelectReelPass(this,\'3day\')"><div class="sg-rbo-pass-name">3-Day Pass</div><div class="sg-rbo-pass-price">' + sym + (parseFloat(price)*2.67).toFixed(2) + '</div><div class="sg-rbo-pass-sub">Save 20%</div></div>',
            '<div class="sg-rbo-pass" data-pass="weekly" onclick="sgSelectReelPass(this,\'weekly\')"><div class="sg-rbo-pass-name">Weekly</div><div class="sg-rbo-pass-price">' + sym + (parseFloat(price)*5).toFixed(2) + '</div><div class="sg-rbo-pass-sub">Save 43%</div></div>',
            '<div class="sg-rbo-pass" data-pass="monthly" onclick="sgSelectReelPass(this,\'monthly\')"><div class="sg-rbo-pass-name">Monthly</div><div class="sg-rbo-pass-price">' + sym + (parseFloat(price)*10).toFixed(2) + '</div><div class="sg-rbo-pass-sub">Best value</div></div>',
          '</div>',
          '<div style="background:rgba(255,255,255,.04);border-radius:14px;padding:14px;margin-bottom:16px">',
            '<div style="color:#fff;font-size:13px;font-weight:600;margin-bottom:8px">✅ Whats included</div>',
            '<div style="color:rgba(255,255,255,.5);font-size:12px;line-height:1.8">⚡ Instant QR code entry<br>🔒 Secure Stripe payment<br>↩️ Free cancellation<br>🏋️ Full gym access</div>',
          '</div>',
        '</div>',
        '<div class="sg-rbo-cta"><button class="sg-rbo-book-btn" id="sg-rbo-proceed-btn" onclick="sgProceedReelBooking(' + JSON.stringify(gymId) + ',' + JSON.stringify(gymName) + ')">Book Now — ' + pd + '</button></div>',
      ].join('');
      ov.dataset.gymId = gymId || '';
      ov.dataset.gymName = gymName || '';
      ov.dataset.selectedPass = 'day';
      ov.dataset.price = price;
      ov.dataset.sym = sym;
      requestAnimationFrame(function() { ov.classList.add('open'); });
    };

    window.sgSelectReelPass = function(btn, pass) {
      var ov = document.getElementById('sg-reel-book-overlay');
      if (!ov) return;
      document.querySelectorAll('.sg-rbo-pass').forEach(function(p) { p.classList.remove('selected'); });
      btn.classList.add('selected');
      ov.dataset.selectedPass = pass;
      var price = parseFloat(ov.dataset.price || 4.49);
      var sym = ov.dataset.sym || '£';
      var mults = { day:1, '3day':2.67, weekly:5, monthly:10 };
      var fp = (price * (mults[pass] || 1)).toFixed(2);
      var names = { day:'Day Pass', '3day':'3-Day Pass', weekly:'Weekly', monthly:'Monthly' };
      var pb = document.getElementById('sg-rbo-proceed-btn');
      if (pb) pb.textContent = 'Book Now — ' + sym + fp;
    };

    window.sgProceedReelBooking = function(gymId, gymName) {
      if (window.openGymDirectOverlay) {
        window.sgCloseReelBooking();
        setTimeout(function() { window.openGymDirectOverlay(gymId, true, 'passes'); }, 350);
      } else {
        window.sgCloseReelBooking();
        var bt = document.querySelector('.sg-tab-item:nth-child(2)');
        if (bt) { bt.click(); setTimeout(function() { if(window.openGymDirectOverlay) window.openGymDirectOverlay(gymId, true, 'passes'); }, 500); }
      }
    };

    window.sgCloseReelBooking = function() {
      var ov = document.getElementById('sg-reel-book-overlay');
      if (!ov) return;
      ov.classList.remove('open');
      setTimeout(function() { ov.innerHTML = ''; }, 350);
    };

    function patchContinueBannerClick() {
      var cb = document.getElementById('sg-continue-banner');
      if (!cb || cb._sgReelPatched) return;
      cb._sgReelPatched = true;
      cb.addEventListener('click', function(e) {
        var reelsActive = document.querySelector('.sg-tab-item.active:first-child, [aria-label*="Reels"].active');
        var gym = window.state && window.state.currentGym;
        if (reelsActive && gym) {
          e.stopImmediatePropagation();
          var sym = gym.currencySymbol || (window.sgSymbol ? window.sgSymbol() : '£');
          var price = gym.dayPassPrice || (window.sgPrice ? window.sgPrice('day').amount : 4.49);
          window.sgOpenReelBooking(gym.placeId || gym.id, gym.name, gym.address || gym.vicinity, price, sym);
        }
      }, true);
    }

    patchContinueBannerClick();
    new MutationObserver(patchContinueBannerClick).observe(document.body, { childList: true, subtree: false });

    setInterval(function() {
      document.querySelectorAll('[data-gym-id]:not([data-reel-book-patched])').forEach(function(card) {
        card.setAttribute('data-reel-book-patched','1');
        var gid = card.dataset.gymId;
        if (!gid) return;
        card.addEventListener('dblclick', function(e) {
          var gym = window._ttCards && window._ttCards.find(function(c){return c.id===gid;});
          if (gym) { e.preventDefault(); e.stopPropagation(); window.sgOpenReelBooking(gym.id, gym.name, gym.addr, gym.gym&&gym.gym.dayPassPrice, gym.gym&&gym.gym.currencySymbol); }
        });
      });
    }, 2000);

    console.log('[Patches] #49: Reels inline booking ready');
  }

  // ====================================================================
  // #19: Manchester default
  // ====================================================================
  function patchManchesterDefault() {
    var orig = window.searchGyms;
    if (orig && !orig._sgPatched) {
      window.searchGyms = function(query, isExplicit, triggerLayer) {
        if (!query || query === 'gyms in London') query = 'gyms in Manchester, UK';
        return orig.call(this, query, isExplicit, triggerLayer);
      };
      window.searchGyms._sgPatched = true;
    }
  }

  // ====================================================================
  // #17/#18: Filter sheet
  // ====================================================================
  function ensureFilterSheet() {
    if (document.getElementById('tt-filter-sheet')) return;
    var fs = document.createElement('div'); fs.id='tt-filter-sheet'; fs.className='tt-filter-sheet';
    fs.innerHTML='<span style="font-size:10px;color:rgba(255,255,255,.4);font-weight:700;width:100%;margin-bottom:6px;display:block">FILTER GYMS</span>'+
      '<button class="sg-filter-pill" data-filter="24h" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'24h\');window.searchGyms&&searchGyms(window.state&&window.state.searchQuery||\'gyms in Manchester, UK\')">⏰ 24/7 Only</button>'+
      '<button class="sg-filter-pill" data-filter="self-service" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'self-service\');window.searchGyms&&searchGyms(window.state&&window.state.searchQuery||\'gyms in Manchester, UK\')">🔓 Self Entry</button>'+
      '<button class="sg-filter-pill" data-filter="open" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'open\')">🟢 Open Now</button>'+
      '<button class="sg-filter-pill" data-filter="rating" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'rating\')">⭐ 4.0+</button>'+
      '<button class="sg-filter-pill" data-filter="near" onclick="event.stopPropagation();window.sgToggleFilter&&sgToggleFilter(this,\'near\')">📍 Nearest</button>';
    document.body.appendChild(fs);
  }

  function injectFilterButton() {
    var done=false;
    var inj=function(){
      var a=document.querySelector('.tt-actions');
      if(a&&!a.querySelector('[data-filter-toggle]')){
        var b=document.createElement('div'); b.className='tt-action'; b.setAttribute('data-filter-toggle','1');
        b.innerHTML='<div class="tt-action-btn">⚙️</div><div class="tt-action-label">Filter</div>';
        b.addEventListener('click',function(e){e.stopPropagation();ensureFilterSheet();var fs=document.getElementById('tt-filter-sheet');if(fs){fs.classList.toggle('open');var c=a.closest('.tt-card');if(c&&fs.parentElement!==c)c.appendChild(fs);}});
        var sv=Array.from(a.children).find(function(el){return el.textContent.includes('Save');});
        a.insertBefore(b,sv||null); done=true;
      }
    };
    inj();
    var obs=new MutationObserver(function(){if(!done)inj();});
    obs.observe(document.body,{childList:true,subtree:true});
    setTimeout(function(){obs.disconnect();},30000);
  }

  // ====================================================================
  // #26: Remove Google Maps link + add Mapbox map
  // ====================================================================
  function patchGymOverlay() {
    var pa=function(el){
      if(el._sgMapPatched)return; el._sgMapPatched=true;
      el.style.cursor='default'; el.removeAttribute('onclick'); el.onclick=null;
      var ds=el.querySelector('span'); if(ds&&ds.textContent.includes('Directions'))ds.style.display='none';
      var gym=window.state&&window.state.currentGym; if(!gym)return;
      var lat=gym.latitude||gym.lat, lng=gym.longitude||gym.lng; if(!lat||!lng)return;
      var tok=window._sgMapboxToken||''; if(!tok)return;
      var md=document.createElement('div'); md.style.cssText='margin-top:10px;border-radius:14px;overflow:hidden;height:140px;background:#1a2035;position:relative';
      var img=document.createElement('img');
      img.src='https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/pin-s+FF6D00('+lng+','+lat+')/'+lng+','+lat+',14,0/400x180@2x?attribution=false&logo=false&access_token='+tok;
      img.alt=(gym.name||'Gym')+' location'; img.style.cssText='width:100%;height:100%;object-fit:cover'; img.onerror=function(){md.style.display='none';};
      var badge=document.createElement('div'); badge.style.cssText='position:absolute;bottom:8px;left:12px;color:rgba(255,255,255,.5);font-size:9px;font-weight:600';
      badge.textContent='📍 '+(gym.vicinity||gym.address||'').split(',').slice(-2).join(',').trim();
      md.appendChild(img); md.appendChild(badge); el.parentElement&&el.parentElement.insertBefore(md,el.nextSibling);
    };
    new MutationObserver(function(muts){muts.forEach(function(m){m.addedNodes.forEach(function(node){
      if(node.nodeType!==1)return;
      (node.querySelectorAll?node.querySelectorAll('.gym-info-addr[onclick*="google.com"]'):[]).forEach(pa);
      if(node.classList&&node.classList.contains('gym-info-addr')&&(node.getAttribute('onclick')||'').includes('google.com'))pa(node);
    });});}).observe(document.body,{childList:true,subtree:true});
  }

  // ====================================================================
  // #4/#5: USP messaging
  // ====================================================================
  function addUSPMessaging() {
    setTimeout(function(){
      if(document.getElementById('sg-usp-banner'))return;
      var b=document.createElement('div'); b.id='sg-usp-banner';
      b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:10500;background:linear-gradient(90deg,rgba(255,109,0,.95),rgba(230,98,0,.95));padding:6px 12px;text-align:center;font-size:11px;font-weight:700;color:#fff;display:flex;align-items:center;justify-content:center;gap:8px';
      b.innerHTML='🏋️ <span>30 gyms in 30 days — No subscription. Pay only when you go.</span> <span onclick="this.parentElement.style.display=\'none\'" style="opacity:.6;font-size:14px;cursor:pointer;margin-left:8px">✕</span>';
      document.body.insertBefore(b,document.body.firstChild);
      setTimeout(function(){if(b.parentElement){b.style.transition='opacity 1s';b.style.opacity='0';setTimeout(function(){b.remove();},1000);}},5000);
    },2000);
  }

  // ====================================================================
  // CH1: Chat tab — route gym queries through universal chatbot handler
  // so the Chat tab works EXACTLY like Telegram/Discord/Slack/Teams
  // ====================================================================
  function patchChatUniversalHandler() {
    // Wrap the original _sgChatSend to route gym/booking queries
    // through /api/chatbot/web/message (same handler as all channels)
    var origSend = window._sgChatSend;
    if (!origSend || origSend._sgUniversalPatched) return;

    window._sgChatSend = async function(msgText) {
      var chat = window._sgChat;
      if (!chat || chat.typing) return;
      var msg = msgText || (document.getElementById('sg-chat-input') ? document.getElementById('sg-chat-input').value.trim() : '');
      if (!msg) return;

      // Detect if this is a gym/booking/ScanGym query → route to universal handler
      var lower = msg.toLowerCase();
      var isGymQuery = /\b(gym|gyms|book|booking|cancel|price|pricing|cost|find|search|near|nearby|qr|scangym|day pass|membership|refund|channel|telegram|whatsapp|discord|slack|teams)\b/.test(lower);
      // Also catch city names that look like gym searches
      var isCitySearch = /^[a-z][a-z\s,'-]{1,35}$/i.test(lower) && !lower.includes('?') &&
        !['yes','no','ok','okay','sure','thanks','thank you','cool','great','nice','good','bad','bye','lol','haha'].includes(lower.trim());
      // Also greetings
      var isGreeting = /^(hi|hey|hello|hola|yo|sup|hiya|morning|good morning|good evening|good afternoon)[\s!.?]*$/i.test(lower);

      if (isGymQuery || isCitySearch || isGreeting) {
        // Clear input
        var inp = document.getElementById('sg-chat-input');
        if (inp) { inp.value = ''; inp.style.height = '44px'; }

        // Add user message to chat
        chat.msgs.push({ role: 'user', text: msg, ts: Date.now() });
        chat.typing = true;
        if (window.render) window.render();
        if (window._sgScrollBottom) window._sgScrollBottom();

        try {
          var userId = 'web:' + ((window.state && window.state.user && window.state.user.id) || 'anon');
          var userName = (window.state && window.state.user && window.state.user.name) || 'User';
          var resp = await fetch('/api/chatbot/web/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, userId: userId, userName: userName })
          });
          if (!resp.ok) throw new Error('API error ' + resp.status);
          var data = await resp.json();
          chat.typing = false;
          // Stream the response for nice UX
          if (window._sgChatStream) {
            window._sgChatStream(data.text || 'Sorry, I couldn\'t process that. Try again!');
          } else {
            chat.msgs.push({ role: 'ai', text: data.text || 'Sorry, try again!', ts: Date.now() });
            if (window.render) window.render();
          }
        } catch (err) {
          console.error('[Chat] Universal handler error:', err);
          chat.typing = false;
          // Fallback to original handler
          origSend.call(window, msg);
          return;
        }
        if (window._sgChatSave) window._sgChatSave();
        return;
      }

      // Non-gym query → use original fitness AI handler
      return origSend.call(window, msgText);
    };
    window._sgChatSend._sgUniversalPatched = true;
    console.log('[Patches] CH1: Chat tab now uses universal chatbot handler for gym queries');
  }

  // ====================================================================
  // CH2: Channels page — show real-time bot status badges
  // ====================================================================
  function patchChannelsLiveStatus() {
    // Add live status indicators to channel cards
    async function updateChannelStatus() {
      try {
        var resp = await fetch('/api/chatbot/health');
        if (!resp.ok) return;
        var data = await resp.json();
        var channels = data.channels || {};

        // Update channel cards with live status
        document.querySelectorAll('[data-channel-id]').forEach(function(card) {
          var chId = card.dataset.channelId;
          var isLive = false;
          if (chId === 'telegram') isLive = channels.telegram;
          else if (chId === 'whatsapp') isLive = channels.whatsapp;
          else if (chId === 'discord') isLive = channels.discord;
          else if (chId === 'sms') isLive = channels.sms;
          else if (chId === 'email') isLive = channels.email;
          else if (chId === 'slack') isLive = channels.slack;
          else if (chId === 'msteams') isLive = channels.msteams;

          // Add or update live badge
          var badge = card.querySelector('.sg-ch-live-badge');
          if (!badge) {
            badge = document.createElement('span');
            badge.className = 'sg-ch-live-badge';
            badge.style.cssText = 'font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;margin-left:auto;flex-shrink:0';
            card.appendChild(badge);
          }
          if (isLive) {
            badge.textContent = '● LIVE';
            badge.style.color = '#22c55e';
            badge.style.background = 'rgba(34,197,94,.1)';
          } else {
            badge.textContent = '○ Setup needed';
            badge.style.color = 'rgba(255,255,255,.3)';
            badge.style.background = 'rgba(255,255,255,.04)';
          }
        });
      } catch (e) {}
    }

    // Run on Channels page load and periodically
    setInterval(function() {
      if (window.location.pathname === '/channels' || (window.state && window.state.route === '/channels')) {
        updateChannelStatus();
      }
    }, 5000);
    // Also run immediately
    setTimeout(updateChannelStatus, 1000);
    console.log('[Patches] CH2: Channel live status badges active');
  }

  // ====================================================================
  // INIT
  // ====================================================================
  function init() {
    patchContinueBanner();
    fixVideoAutoplay();
    patchManchesterDefault();
    ensureFilterSheet();
    injectFilterButton();
    patchGymOverlay();
    addUSPMessaging();
    patchReelsBooking();
    patchChatUniversalHandler();
    patchChannelsLiveStatus();
    console.log('[ScanGym Patches v3.0] Applied: #4 #5 #17 #18 #19 #26 #35 #49 C1 CH1 CH2');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

})();
