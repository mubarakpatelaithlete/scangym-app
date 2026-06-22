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
  // GP1: Enhanced Gym Partner Hub — Get Paid + Access Control + Revenue
  // ====================================================================
  function patchGymPartnerHub() {
    if (typeof window.GymPartnerHubPage !== 'function') return;
    var _origGPHub = window.GymPartnerHubPage;
    window.GymPartnerHubPage = function() {
      return '<div style="max-width:480px;margin:0 auto;padding:20px 16px">' +
        '<div class="sg-more-back" onclick="navigate(\'/more\')">← Back</div>' +
        '<h1 style="font-size:24px;font-weight:900;color:#fff;margin-bottom:4px">🏢 Gym Partner Hub</h1>' +
        '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">Claim, manage and earn from your gym on ScanGym</p>' +

        // Revenue preview banner
        '<div id="gp-revenue-banner" style="background:linear-gradient(135deg,rgba(255,109,0,.12),rgba(255,109,0,.04));border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:16px 18px;margin-bottom:20px;display:none">' +
          '<div style="display:flex;justify-content:space-between;align-items:center">' +
            '<div><p style="color:rgba(255,255,255,.45);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">YOUR REVENUE</p>' +
            '<p id="gp-revenue-amount" style="color:#FF6D00;font-size:28px;font-weight:900;margin:0">£0.00</p></div>' +
            '<div style="text-align:right"><p id="gp-bookings-count" style="color:#fff;font-size:18px;font-weight:800;margin:0">0</p>' +
            '<p style="color:rgba(255,255,255,.35);font-size:11px;margin:0">bookings</p></div>' +
          '</div>' +
          '<div id="gp-stripe-status" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)"></div>' +
        '</div>' +

        // Claim flow
        '<div style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.1);border-radius:16px;padding:24px;margin-bottom:20px;text-align:center">' +
          '<p style="font-size:48px;margin-bottom:12px">🏢</p>' +
          '<h3 style="color:#fff;font-size:18px;font-weight:800;margin-bottom:8px">Claim Your Gym</h3>' +
          '<p style="color:rgba(255,255,255,.4);font-size:14px;line-height:1.5;margin-bottom:16px">Already listed on Google? Claim your gym in 3 steps and start accepting ScanGym bookings.</p>' +
          '<button onclick="navigate(\'/list-your-gym\')" style="background:#FF6D00;color:#fff;border:none;padding:14px 32px;border-radius:12px;font-weight:700;font-size:16px;cursor:pointer;animation:casinoGlow 2s ease-in-out infinite">Claim Now →</button>' +
        '</div>' +

        // 4-tile grid: Owner Controls, Access Control, Get Paid, Analytics
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">' +
          '<div onclick="navigate(\'/owner/controls\')" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(255,109,0,.3)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.06)\'">' +
            '<p style="font-size:28px;margin-bottom:6px">⚙️</p>' +
            '<p style="color:#fff;font-weight:700;font-size:13px;margin-bottom:2px">Owner Controls</p>' +
            '<p style="color:rgba(255,255,255,.3);font-size:10px">Toggle bookings, pricing</p>' +
          '</div>' +
          '<div onclick="sgGymPartnerPayout()" style="background:rgba(16,185,129,.04);border:1px solid rgba(16,185,129,.1);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(16,185,129,.3)\'" onmouseout="this.style.borderColor=\'rgba(16,185,129,.1)\'">' +
            '<p style="font-size:28px;margin-bottom:6px">💰</p>' +
            '<p style="color:#10b981;font-weight:700;font-size:13px;margin-bottom:2px">Get Paid</p>' +
            '<p style="color:rgba(255,255,255,.3);font-size:10px">Set up bank / Stripe</p>' +
          '</div>' +
          '<div onclick="navigate(\'/owner/controls\')" style="background:rgba(59,130,246,.04);border:1px solid rgba(59,130,246,.1);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(59,130,246,.3)\'" onmouseout="this.style.borderColor=\'rgba(59,130,246,.1)\'">' +
            '<p style="font-size:28px;margin-bottom:6px">🔐</p>' +
            '<p style="color:#3b82f6;font-weight:700;font-size:13px;margin-bottom:2px">Access Control</p>' +
            '<p style="color:rgba(255,255,255,.3);font-size:10px">Kisi, Salto, Brivo</p>' +
          '</div>' +
          '<div onclick="navigate(\'/forceo\')" style="background:rgba(168,85,247,.04);border:1px solid rgba(168,85,247,.1);border-radius:14px;padding:16px;cursor:pointer;text-align:center;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(168,85,247,.3)\'" onmouseout="this.style.borderColor=\'rgba(168,85,247,.1)\'">' +
            '<p style="font-size:28px;margin-bottom:6px">📊</p>' +
            '<p style="color:#a855f7;font-weight:700;font-size:13px;margin-bottom:2px">Analytics</p>' +
            '<p style="color:rgba(255,255,255,.3);font-size:10px">Revenue & bookings</p>' +
          '</div>' +
        '</div>' +

        // Quick links
        '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:12px;padding:14px 16px">' +
          '<p style="color:rgba(255,255,255,.3);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px">QUICK LINKS</p>' +
          '<div onclick="navigate(\'/channels\')" style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)">' +
            '<span style="font-size:16px">💬</span><span style="color:rgba(255,255,255,.6);font-size:13px">Customer Chat Channels</span>' +
          '</div>' +
          '<div onclick="navigate(\'/more\')" style="display:flex;align-items:center;gap:10px;padding:8px 0;cursor:pointer">' +
            '<span style="font-size:16px">📋</span><span style="color:rgba(255,255,255,.6);font-size:13px">Help & Support</span>' +
          '</div>' +
        '</div>' +
      '</div>';
    };

    // Load revenue data when on Hub page
    window.sgLoadGymPartnerRevenue = async function() {
      try {
        var r = await fetch('/api/gym-partner/earnings', { credentials: 'include' });
        var d = await r.json();
        if (!d.success) return;
        var banner = document.getElementById('gp-revenue-banner');
        if (!banner) return;
        if (d.gyms && d.gyms.length > 0) {
          banner.style.display = 'block';
          var amt = document.getElementById('gp-revenue-amount');
          var bk = document.getElementById('gp-bookings-count');
          var st = document.getElementById('gp-stripe-status');
          if (amt) amt.textContent = '£' + (d.totalRevenuePence / 100).toFixed(2);
          if (bk) bk.textContent = d.totalBookings;
          if (st) {
            if (d.stripeConnected) {
              st.innerHTML = '<span style="color:#4ade80;font-size:12px;font-weight:600">✅ Stripe Connected — payouts enabled</span>';
            } else {
              st.innerHTML = '<span style="color:#fbbf24;font-size:12px;font-weight:600">⚠️ <a onclick="sgGymPartnerPayout()" style="color:#fbbf24;text-decoration:underline;cursor:pointer">Set up payouts</a> to receive earnings</span>';
            }
          }
        }
      } catch (e) { /* no-op */ }
    };

    // Gym Partner Payout Setup Sheet
    window.sgGymPartnerPayout = function() {
      var existing = document.getElementById('sg-gp-payout-sheet');
      if (existing) existing.remove();
      var sheet = document.createElement('div');
      sheet.id = 'sg-gp-payout-sheet';
      sheet.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:10000;display:flex;flex-direction:column;justify-content:flex-end;';
      sheet.innerHTML =
        '<div onclick="document.getElementById(\'sg-gp-payout-sheet\').remove()" style="flex:1;background:rgba(0,0,0,.6);backdrop-filter:blur(8px)"></div>' +
        '<div style="background:#1a1a2e;border-radius:24px 24px 0 0;padding:24px 20px 36px;max-height:80vh;overflow-y:auto">' +
          '<div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 20px"></div>' +
          '<h2 style="color:#fff;font-size:20px;font-weight:900;margin-bottom:4px">💰 Get Paid</h2>' +
          '<p style="color:rgba(255,255,255,.4);font-size:13px;margin-bottom:20px">Set up how you receive your gym booking revenue</p>' +

          // Option 1: Stripe Connect
          '<div id="gp-payout-stripe" onclick="sgSetupGymStripe()" style="background:rgba(99,102,241,.06);border:1px solid rgba(99,102,241,.15);border-radius:14px;padding:18px;margin-bottom:12px;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(99,102,241,.4)\'" onmouseout="this.style.borderColor=\'rgba(99,102,241,.15)\'">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<span style="font-size:28px">⚡</span>' +
              '<div><p style="color:#fff;font-weight:700;font-size:15px;margin:0 0 2px">Stripe Connect</p>' +
              '<p style="color:rgba(255,255,255,.4);font-size:12px;margin:0">Direct bank deposits · Fast setup · Instant payouts</p></div>' +
            '</div>' +
            '<div style="margin-top:10px;background:#6366f1;color:#fff;border:none;padding:10px;border-radius:10px;text-align:center;font-weight:700;font-size:13px">Connect Stripe →</div>' +
          '</div>' +

          // Option 2: Bank Transfer
          '<div onclick="sgSetupGymBank()" style="background:rgba(16,185,129,.06);border:1px solid rgba(16,185,129,.15);border-radius:14px;padding:18px;margin-bottom:12px;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(16,185,129,.4)\'" onmouseout="this.style.borderColor=\'rgba(16,185,129,.15)\'">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<span style="font-size:28px">🏦</span>' +
              '<div><p style="color:#fff;font-weight:700;font-size:15px;margin:0 0 2px">Bank Transfer</p>' +
              '<p style="color:rgba(255,255,255,.4);font-size:12px;margin:0">Manual payouts · Weekly settlement · Any bank</p></div>' +
            '</div>' +
          '</div>' +

          // Option 3: ScanGym Wallet
          '<div onclick="sgSetupGymWallet()" style="background:rgba(255,109,0,.06);border:1px solid rgba(255,109,0,.15);border-radius:14px;padding:18px;margin-bottom:12px;cursor:pointer;transition:border-color .2s" onmouseover="this.style.borderColor=\'rgba(255,109,0,.4)\'" onmouseout="this.style.borderColor=\'rgba(255,109,0,.15)\'">' +
            '<div style="display:flex;align-items:center;gap:12px">' +
              '<span style="font-size:28px">👛</span>' +
              '<div><p style="color:#fff;font-weight:700;font-size:15px;margin:0 0 2px">ScanGym Wallet</p>' +
              '<p style="color:rgba(255,255,255,.4);font-size:12px;margin:0">Instant · Use for bookings or transfer later</p></div>' +
            '</div>' +
          '</div>' +

          '<p style="color:rgba(255,255,255,.2);font-size:11px;text-align:center;margin-top:12px">ScanGym takes 15% platform fee · Rest goes directly to you</p>' +
        '</div>';
      document.body.appendChild(sheet);
    };

    // Stripe Connect setup for gym partners
    window.sgSetupGymStripe = async function() {
      try {
        if (typeof sgToast === 'function') sgToast('Setting up Stripe Connect...', 'info', 3000);
        var r = await fetch('/api/gym-partner/stripe-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        var d = await r.json();
        if (d.onboardingUrl) {
          window.location.href = d.onboardingUrl;
        } else if (d.stripeConnected) {
          if (typeof sgToast === 'function') sgToast('✅ Stripe already connected!', 'success', 3000);
          var sheet = document.getElementById('sg-gp-payout-sheet');
          if (sheet) sheet.remove();
        } else {
          if (typeof sgToast === 'function') sgToast(d.message || 'Setup initiated - we will be in touch!', 'success', 4000);
          var sheet = document.getElementById('sg-gp-payout-sheet');
          if (sheet) sheet.remove();
        }
      } catch (e) {
        if (typeof sgToast === 'function') sgToast('Network error — try again', 'error', 3000);
      }
    };

    window.sgSetupGymBank = function() {
      if (typeof sgToast === 'function') sgToast('📧 Contact team@scangym.org to set up bank transfers', 'info', 4000);
      var sheet = document.getElementById('sg-gp-payout-sheet');
      if (sheet) sheet.remove();
    };

    window.sgSetupGymWallet = function() {
      if (typeof sgToast === 'function') sgToast('👛 Earnings will auto-deposit to your ScanGym Wallet', 'success', 3000);
      var sheet = document.getElementById('sg-gp-payout-sheet');
      if (sheet) sheet.remove();
    };

    // Auto-load revenue data on hub page
    var _origRender = window._renderInner;
    if (_origRender) {
      window._renderInner = function() {
        _origRender.apply(this, arguments);
        if (window.state && window.state.route === '/gym-partner-hub') {
          setTimeout(function() { window.sgLoadGymPartnerRevenue(); }, 300);
        }
      };
    }

    console.log('[Patches] GP1: Enhanced Gym Partner Hub active');
  }

  // ====================================================================
  // CR1: Creator Earnings Smooth Onboard — auto-show payout setup prompt
  // ====================================================================
  function patchCreatorEarningsOnboard() {
    // After signup, auto-prompt first-time creators to set up payouts
    var interval = setInterval(function() {
      var route = window.state && window.state.route;
      if (route !== '/creator-earnings') return;
      var creator = localStorage.getItem('sg_creator');
      if (!creator) return;
      try { creator = JSON.parse(creator); } catch(e) { return; }
      // Check if first visit (no payout method set)
      var prompted = localStorage.getItem('sg_creator_payout_prompted');
      if (prompted) return;
      // Show a gentle prompt after 1.5s
      setTimeout(function() {
        var withdrawSection = document.querySelector('[onclick*="_quickWithdraw"]');
        if (withdrawSection) {
          withdrawSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash the withdrawal section
          var parent = withdrawSection.closest('div[style*="border"]');
          if (parent) {
            parent.style.transition = 'box-shadow 0.5s';
            parent.style.boxShadow = '0 0 0 2px rgba(255,109,0,.5), 0 0 20px rgba(255,109,0,.15)';
            setTimeout(function() { parent.style.boxShadow = ''; }, 3000);
          }
        }
        localStorage.setItem('sg_creator_payout_prompted', '1');
      }, 1500);
      clearInterval(interval);
    }, 1000);
    console.log('[Patches] CR1: Creator earnings onboard prompt active');
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
    patchGymPartnerHub();
    patchCreatorEarningsOnboard();
    patchContinueBanner();
    console.log('[ScanGym Patches v5.0] Applied: #4 #5 #17 #18 #19 #26 #35 #49 C1 CH1 CH2 GP1 CR1 CB1');
  }

  /* ── CB1: Fix Continue Banner — prevent Android Google Search hijack ── */
  function patchContinueBanner() {
    var banner = document.getElementById('sg-continue-banner');
    if (!banner) return;

    // 1. Inject CSS to kill text selection on banner + all children
    var style = document.createElement('style');
    style.textContent = [
      '#sg-continue-banner,#sg-continue-banner *{',
      '  -webkit-user-select:none!important;',
      '  -moz-user-select:none!important;',
      '  -ms-user-select:none!important;',
      '  user-select:none!important;',
      '  -webkit-touch-callout:none!important;',
      '  pointer-events:auto;',
      '}',
    ].join('');
    document.head.appendChild(style);

    // 2. Add ARIA role so browsers treat it as a real button
    banner.setAttribute('role', 'button');
    banner.setAttribute('tabindex', '0');

    // 3. Block text selection events that trigger Google Smart Select on Android
    banner.addEventListener('selectstart', function(e) { e.preventDefault(); }, { passive: false });
    banner.addEventListener('contextmenu', function(e) { e.preventDefault(); }, { passive: false });

    // 4. Use touchend as backup click — some Android browsers swallow click on divs
    var _touchMoved = false;
    banner.addEventListener('touchstart', function() { _touchMoved = false; }, { passive: true });
    banner.addEventListener('touchmove', function() { _touchMoved = true; }, { passive: true });
    banner.addEventListener('touchend', function(e) {
      if (_touchMoved) return; // was a scroll, not a tap
      e.preventDefault(); // prevent ghost click + Google search
      banner.click(); // fire the existing click handler
    }, { passive: false });

    console.log('[CB1] Continue banner mobile fix applied');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 500);
  }

})();
