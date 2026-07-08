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
            '<p style="color:rgba(255,255,255,.3);font-size:10px">Smart lock integration</p>' +
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
      if (typeof sgToast === 'function') sgToast('📧 Contact hello@scangym.com to set up bank transfers', 'info', 4000);
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
    patchContinueBannerMobile();
    console.log('[ScanGym Patches v6.0] Applied: #4 #5 #17 #18 #19 #26 #35 #49 C1 CH1 CH2 GP1 CR1 CB1');
  }

  /* ── CB1: Fix Continue Banner — prevent Android Google Search hijack ── */
  function patchContinueBannerMobile() {
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

// ═══════════════════════════════════════════════════════════════════════
// ScanGym Patches v6.0 — Speed + Search + Calendar + Pay + Icons
// ═══════════════════════════════════════════════════════════════════════

// ── SRC1: Fix Search — autoLoadGyms on first Book tab visit ──
(function(){
  var _origSwitchTab2 = window.switchTab;
  if (typeof _origSwitchTab2 !== 'function') return;
  var _bookLoaded = false;
  window.switchTab = function(tab) {
    _origSwitchTab2.apply(this, arguments);
    if (tab === 'book' && !_bookLoaded) {
      _bookLoaded = true;
      if (typeof autoLoadGyms === 'function' && (!window.state || !window.state.gyms || window.state.gyms.length === 0)) {
        // state is closure-scoped, try accessing via the function itself
        try {
          if (typeof state !== 'undefined' && state.gyms && state.gyms.length === 0) {
            autoLoadGyms();
            console.log('[SRC1] Auto-loading gyms on first Book tab visit');
          } else if (typeof state !== 'undefined' && (!state.gyms || state.gyms.length === 0)) {
            autoLoadGyms();
            console.log('[SRC1] Auto-loading gyms (state.gyms empty)');
          }
        } catch(e) {
          // state not in scope — call findGyms as fallback
          if (typeof findGyms === 'function') { findGyms(); console.log('[SRC1] findGyms fallback'); }
        }
      } else if (typeof findGyms === 'function') {
        try {
          if (typeof state !== 'undefined' && (!state.gyms || state.gyms.length === 0)) {
            findGyms();
            console.log('[SRC1] findGyms on first Book visit');
          }
        } catch(e) {}
      }
    }
  };
  console.log('[SRC1] Book tab auto-search patch applied');
})();

// ── SPD1: Pay button — skip dark overlay, open white sheet directly ──
(function(){
  // Intercept the TikTok-style pay icon click to bypass the slow openGymDirectOverlay flow
  document.addEventListener('click', function(e) {
    var el = e.target.closest('.tt-action');
    if (!el) return;
    var label = el.querySelector('.tt-action-label');
    if (!label || label.textContent.trim() !== 'Pay') return;
    
    // Found a Pay icon click — prevent default overlay flow
    e.stopPropagation();
    e.preventDefault();
    
    // Get the gym card to set currentGym context
    var card = el.closest('.tt-card');
    if (card) {
      var gid = card.getAttribute('data-gym-id') || card.getAttribute('data-id');
      if (gid && typeof openGymDirectOverlay === 'function') {
        // Set currentGym context without opening overlay
        try {
          if (typeof state !== 'undefined' && state.gyms) {
            var gym = state.gyms.find(function(g) { return (g.place_id || g.placeId || g.id) === gid; });
            if (gym) state.currentGym = gym;
          }
        } catch(ex) {}
      }
    }
    
    // Open pay sheet directly — skip the dark overlay entirely
    if (typeof openPaySheet === 'function') {
      openPaySheet();
      console.log('[SPD1] Pay sheet opened directly (skipped overlay)');
    }
  }, true); // capture phase to intercept before original handler
  console.log('[SPD1] Direct pay sheet patch applied');
})();

// ── SPD2: Prefetch gym data for instant Hours/Reviews/Calendar ──
(function(){
  var _prefetched = new Set();
  var _prefetchQueue = [];
  var _prefetching = false;
  
  function prefetchGym(id) {
    if (!id || _prefetched.has(id)) return;
    _prefetched.add(id);
    _prefetchQueue.push(id);
    drainQueue();
  }
  
  function drainQueue() {
    if (_prefetching || _prefetchQueue.length === 0) return;
    _prefetching = true;
    var id = _prefetchQueue.shift();
    // Use low-priority fetch to not block user interactions
    fetch('/api/live/place/' + encodeURIComponent(id), { priority: 'low' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        // Store in the gym cache so openGymDirectOverlay finds it
        if (data && typeof _gymCache !== 'undefined' && _gymCache.set) {
          _gymCache.set(id, data);
        }
        // Also store in the GYM_CACHE map if it exists
        if (typeof window._sgGymDetailCache === 'undefined') window._sgGymDetailCache = {};
        window._sgGymDetailCache[id] = { data: data, ts: Date.now() };
        // FIX: feed the app's own _gymDataCache in the NORMALIZED shape the
        // overlay expects (opening_hours, reviews_data, ...). This is what
        // makes openGymDirectOverlay's cache-hit path open instantly WITH
        // full data — via _ensureStandaloneOverlay, which actually creates
        // the popup container.
        try {
          if (data && data.gym && window._gymDataCache) {
            var _oh = data.openingHours || {};
            if (data.gym.ownerIsOpen === true) _oh.isOpen = true;
            else if (data.gym.ownerIsOpen === false) _oh.isOpen = false;
            window._gymDataCache[id] = { data: Object.assign({}, data.gym, {
              id: data.gym.dbId || data.gym.placeId,
              place_id: data.gym.placeId,
              photo_url: (data.photos && data.photos[0] && data.photos[0].url) || null,
              photos_list: data.photos || [],
              rating: (data.rating && data.rating.google) || null,
              user_ratings_total: (data.rating && data.rating.googleTotal) || 0,
              formatted_address: data.gym.address,
              vicinity: data.gym.address,
              opening_hours: _oh,
              openNow: (_oh.isOpen !== undefined && _oh.isOpen !== null) ? _oh.isOpen : null,
              reviews_data: data.reviews,
              pricing: data.pricing,
              map: data.map,
              source: 'live'
            }), ts: Date.now() };
          }
        } catch(e) {}
      })
      .catch(function(){})
      .finally(function() {
        _prefetching = false;
        if (_prefetchQueue.length > 0) setTimeout(drainQueue, 200);
      });
  }
  
  // Observe gym cards entering viewport
  if (typeof IntersectionObserver !== 'undefined') {
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (!entry.isIntersecting) return;
        var card = entry.target;
        var gid = card.getAttribute('data-gym-id') || card.getAttribute('data-id');
        if (gid) prefetchGym(gid);
        observer.unobserve(card); // Only prefetch once per card
      });
    }, { rootMargin: '200px 0px' }); // Start prefetching 200px before visible
    
    // Watch for new cards being added
    var bodyObserver = new MutationObserver(function() {
      var cards = document.querySelectorAll('.tt-card:not([data-prefetch-observed])');
      cards.forEach(function(card) {
        card.setAttribute('data-prefetch-observed', '1');
        observer.observe(card);
      });
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    console.log('[SPD2] Gym data prefetch (IntersectionObserver) applied');
  }
  
  // REMOVED (bug fix): the old "instant open" shortcut here called
  // openGymOverlay(section) WITHOUT _ensureStandaloneOverlay(), so when a
  // card had been prefetched the tap silently did nothing (openGymOverlay
  // returns early if #gym-overlay doesn't exist). It also set
  // state.currentGym to the RAW /api/live/place response instead of the
  // normalized gym shape, so hours/reviews showed "not available".
  // The prefetch above now feeds window._gymDataCache in the normalized
  // shape, and the original openGymDirectOverlay's own cache-hit path
  // provides the same instant open — correctly.
})();

// ── CAL1: Calendar picker height fix + user-select on day cells ──
(function(){
  var style = document.createElement('style');
  style.textContent = [
    '#sg-cal-picker { position: fixed !important; inset: 0 !important; z-index: 9050 !important; width: 100vw !important; height: 100vh !important; pointer-events: none; }',
    '#sg-cal-picker > * { pointer-events: auto; }',
    '#sg-cal-picker .sg-cal-overlay { z-index: 9100 !important; }',
    '.sg-cal-day:not(.empty):not(.past) { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; touch-action: manipulation !important; cursor: pointer !important; -webkit-tap-highlight-color: rgba(255,109,0,.3) !important; }',
    '.sg-cal-time { -webkit-user-select: none !important; user-select: none !important; touch-action: manipulation !important; cursor: pointer !important; }',
    '.tt-action { -webkit-user-select: none !important; user-select: none !important; -webkit-touch-callout: none !important; touch-action: manipulation !important; }',
    '.tt-action-btn { -webkit-user-select: none !important; user-select: none !important; pointer-events: none; }',
    '.tt-action-label { -webkit-user-select: none !important; user-select: none !important; pointer-events: none; }'
  ].join('\n');
  document.head.appendChild(style);
  // CAL1b: Add touchend fallback for mobile date selection
  // Some mobile browsers swallow onclick on divs inside height:0 parents
  document.addEventListener('touchend', function(e) {
    var day = e.target.closest('.sg-cal-day:not(.empty):not(.past)');
    if (!day) return;
    var dateStr = day.getAttribute('data-date');
    if (!dateStr) return;
    e.preventDefault();
    // Call the date selector directly
    if (typeof window._calSelectDate === 'function') {
      window._calSelectDate(dateStr, day);
      console.log('[CAL1b] Touch-selected date:', dateStr);
    }
  }, { passive: false });

  // CAL1c: Same for time slots
  document.addEventListener('touchend', function(e) {
    var slot = e.target.closest('.sg-cal-time:not(.past)');
    if (!slot) return;
    var time = slot.textContent.trim();
    if (!time) return;
    e.preventDefault();
    if (typeof window._calSelectTime === 'function') {
      window._calSelectTime(time, slot);
      console.log('[CAL1c] Touch-selected time:', time);
    }
  }, { passive: false });

  console.log('[CAL1+USS1] Calendar height fix + touch handlers + user-select patches applied');
})();

// ── SPD3: Make Hours/Reviews overlays faster with skeleton-first pattern ──
(function(){
  // Patch openGymOverlay to show content from card data immediately (no API wait)
  var _origOpenOverlay = window.openGymOverlay;
  if (typeof _origOpenOverlay !== 'function') return;
  
  window.openGymOverlay = function(section) {
    // For hours: if we have opening_hours data from prefetch cache, use it
    if (section === 'hours' || section === 'reviews') {
      try {
        var gym = state.currentGym;
        if (gym) {
          var gid = gym.place_id || gym.placeId || gym.id;
          var cached = window._sgGymDetailCache && window._sgGymDetailCache[gid];
          if (cached && cached.data) {
            // Merge prefetched data into currentGym for richer content
            if (cached.data.opening_hours && !gym.opening_hours) {
              gym.opening_hours = cached.data.opening_hours;
            }
            if (cached.data.reviews && (!gym.reviews || gym.reviews.length === 0)) {
              gym.reviews = cached.data.reviews;
            }
          }
        }
      } catch(e) {}
    }
    return _origOpenOverlay.apply(this, arguments);
  };
  console.log('[SPD3] Overlay data merge patch applied');
})();

// ── AI1: Enhanced chatbot — intercept and improve webchat responses ──
// (Server-side prompt fix is separate; this is a client-side fallback)
(function(){
  // No client-side chatbot patch needed — server handles AI responses
  console.log('[Patches v6.0] All speed + search + calendar + pay + icon patches loaded');
})();

// ═══════════════════════════════════════════════════════════════
//  v7.0 — CHAT CHANNEL BUTTONS + APP STORE BADGES + FLOATING CHAT
//  Research: Strava (footer app badges), Uber (social+app), Deliveroo
//  (app badges top of footer), Intercom/Peloton (floating chat widget)
// ═══════════════════════════════════════════════════════════════

// ── CH1: Chat channel selector row — REMOVED ──
// Channel buttons removed from Chat tab per request.
// Channels are still accessible via the floating Connect button popup.

// ── APP1: App store badges in Profile tab ──
// Adds "Get the App" section with Apple App Store + Google Play badges
(function(){
  var sty2 = document.createElement('style');
  sty2.textContent = `
    .sg-app-badges{position:absolute;bottom:80px;left:16px;right:70px;z-index:10;display:flex;flex-direction:column;gap:6px}
    .sg-app-badges-label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:rgba(255,255,255,.3);text-shadow:0 1px 4px rgba(0,0,0,.8)}
    .sg-app-badges-row{display:flex;gap:8px;flex-wrap:wrap}
    .sg-app-badge{height:36px;border-radius:8px;background:rgba(0,0,0,.6);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.12);padding:6px 12px;display:flex;align-items:center;gap:6px;cursor:pointer;transition:all .15s;text-decoration:none;-webkit-tap-highlight-color:transparent}
    .sg-app-badge:active{transform:scale(.95);background:rgba(0,0,0,.8)}
    .sg-app-badge svg{width:20px;height:20px;flex-shrink:0}
    .sg-app-badge-text{display:flex;flex-direction:column}
    .sg-app-badge-text .sg-abt{font-size:7px;color:rgba(255,255,255,.5);line-height:1;letter-spacing:.3px}
    .sg-app-badge-text .sg-abb{font-size:11px;color:#fff;font-weight:700;line-height:1.2}
  `;
  document.head.appendChild(sty2);

  // Apple App Store badge SVG
  var appleSvg = '<svg viewBox="0 0 24 24" fill="#fff"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>';
  var googleSvg = '<svg viewBox="0 0 24 24"><path d="M3.61 1.81L13.42 12 3.6 22.19A2.4 2.4 0 0 1 2 19.98V4.02a2.4 2.4 0 0 1 1.61-2.21z" fill="#4285F4"/><path d="M16.28 15.05L13.42 12l2.86-3.05L20.56 11a1.38 1.38 0 0 1 0 2l-4.28 2.05z" fill="#FBBC04"/><path d="M16.28 8.95L13.42 12 3.61 1.81c.5-.53 1.3-.6 1.88-.16l10.79 7.3z" fill="#EA4335"/><path d="M16.28 15.05L5.49 22.35c-.58.44-1.38.37-1.88-.16L13.42 12l2.86 3.05z" fill="#34A853"/></svg>';

  // Patch the MoreHubPage to inject app badges
  // We intercept the Profile tab render and inject our badges
  var _origSwitch4 = window.switchTab;
  if (typeof _origSwitch4 !== 'function') return;
  window.switchTab = function(tab) {
    _origSwitch4.apply(this, arguments);
    if (tab === 'more') {
      setTimeout(function(){
        var chatContainer = document.querySelector('.sg-tab-content');
        if (!chatContainer) return;
        // Don't inject twice
        if (document.querySelector('.sg-app-badges')) return;
        
        // Find the bottom overlay area (where stats are)
        var bottomOverlay = chatContainer.querySelector('[style*="bottom:12px"]');
        if (bottomOverlay) {
          // Insert above it
          var badgesDiv = document.createElement('div');
          badgesDiv.className = 'sg-app-badges';
          badgesDiv.innerHTML = '<div class="sg-app-badges-label">📲 Get the app</div>'
            + '<div class="sg-app-badges-row">'
            + '<a class="sg-app-badge" href="https://apps.apple.com/app/scangym" target="_blank" rel="noopener">'
            + appleSvg
            + '<div class="sg-app-badge-text"><span class="sg-abt">Download on the</span><span class="sg-abb">App Store</span></div>'
            + '</a>'
            + '<a class="sg-app-badge" href="https://play.google.com/store/apps/details?id=com.scangym" target="_blank" rel="noopener">'
            + googleSvg
            + '<div class="sg-app-badge-text"><span class="sg-abt">GET IT ON</span><span class="sg-abb">Google Play</span></div>'
            + '</a>'
            + '</div>';
          bottomOverlay.parentElement.insertBefore(badgesDiv, bottomOverlay);
        }
      }, 50);
    }
  };
  console.log('[APP1] App store badges (Profile tab) patch applied');
})();

// ── FAB1: REMOVED per Fatima's request (no floating chat button) ──

// ── CON1: Connect button on Profile tab right-side with chat channel popup ──
// Adds a "Connect" button (TikTok right-side style) that opens channel links
(function(){
  var conStyle = document.createElement('style');
  conStyle.textContent = `
    #sg-connect-popup{display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:calc(100% - 48px);max-width:340px;background:rgba(15,15,28,.98);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.1);border-radius:20px;padding:24px 20px;z-index:9500;animation:sgPopIn .25s ease-out}
    #sg-connect-popup.open{display:block}
    #sg-connect-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9499}
    #sg-connect-backdrop.open{display:block}
    @keyframes sgPopIn{from{opacity:0;transform:translate(-50%,-50%) scale(.9)}to{opacity:1;transform:translate(-50%,-50%) scale(1)}}
    .sg-con-title{font-size:16px;font-weight:800;color:#fff;margin:0 0 4px;text-align:center}
    .sg-con-sub{font-size:12px;color:rgba(255,255,255,.4);margin:0 0 16px;text-align:center}
    .sg-con-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .sg-con-item{display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06);border-radius:14px;cursor:pointer;transition:all .15s;text-decoration:none;-webkit-tap-highlight-color:transparent}
    .sg-con-item:active{transform:scale(.96);background:rgba(255,255,255,.1)}
    .sg-con-item svg{width:22px;height:22px;flex-shrink:0}
    .sg-con-item span{font-size:13px;font-weight:600;color:rgba(255,255,255,.8)}
    .sg-con-close{position:absolute;top:12px;right:12px;width:28px;height:28px;background:rgba(255,255,255,.06);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;color:rgba(255,255,255,.4);font-size:14px}
    .sg-con-close:active{background:rgba(255,255,255,.15)}
  `;
  document.head.appendChild(conStyle);

  // Create backdrop + popup
  var backdrop = document.createElement('div');
  backdrop.id = 'sg-connect-backdrop';
  backdrop.onclick = function(){ _sgCloseConnect(); };
  document.body.appendChild(backdrop);

  var popup = document.createElement('div');
  popup.id = 'sg-connect-popup';
  popup.innerHTML = `
    <button class="sg-con-close" onclick="_sgCloseConnect()">&times;</button>
    <p class="sg-con-title">💬 Connect with us</p>
    <p class="sg-con-sub">Chat on your favourite platform</p>
    <div class="sg-con-grid">
      <a class="sg-con-item" href="https://t.me/ScanGymBot" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="#26A5E4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.28-.02-.12.03-2.02 1.28-5.69 3.77-.54.37-1.03.55-1.47.54-.48-.01-1.41-.27-2.1-.5-.85-.28-1.52-.43-1.46-.91.03-.25.38-.51 1.05-.78 4.12-1.79 6.87-2.97 8.26-3.54 3.93-1.62 4.75-1.9 5.28-1.91.12 0 .37.03.54.17.14.12.18.28.2.47-.01.06.01.24 0 .37z"/></svg>
        <span>Telegram</span>
      </a>
      <a class="sg-con-item" href="#" onclick="_sgOpenWhatsApp();event.preventDefault();" rel="noopener">
        <svg viewBox="0 0 24 24" fill="#25D366"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.82 14.01c-.24.68-1.41 1.3-1.95 1.36-.51.06-1.15.09-1.85-.12-.43-.13-.98-.3-1.69-.58-2.97-1.18-4.91-4.19-5.06-4.39-.14-.2-1.18-1.57-1.18-3 0-1.43.75-2.14 1.01-2.43.27-.29.58-.37.78-.37.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.19-.14.31-.29.47-.14.17-.3.38-.43.51-.14.14-.29.3-.13.58.17.29.74 1.22 1.58 1.97 1.09.97 2 1.27 2.29 1.41.29.14.46.12.63-.07.17-.19.73-.85.92-1.14.19-.29.39-.24.66-.14.27.1 1.7.8 1.99.95.29.14.48.22.56.34.07.12.07.68-.17 1.36z"/></svg>
        <span>WhatsApp</span>
      </a>
      <a class="sg-con-item" href="#" onclick="_sgOpenDiscord();event.preventDefault();" rel="noopener">
        <svg viewBox="0 0 24 24" fill="#5865F2"><path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.45.87-.61 1.26a18.27 18.27 0 0 0-5.49 0 12.64 12.64 0 0 0-.62-1.26.07.07 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C1.29 8.42.47 12.31.91 16.15a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.07.07 0 0 0 .08-.03c.46-.63.87-1.3 1.22-2a.07.07 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.07.07 0 0 1-.01-.12c.13-.09.25-.19.37-.29a.07.07 0 0 1 .07-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .07.01c.12.1.25.2.37.29a.07.07 0 0 1 0 .12c-.6.35-1.22.65-1.87.9a.07.07 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.07.07 0 0 0 .08.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.53-5.47-.87-10.22-3.65-14.43a.06.06 0 0 0-.03-.03zM8.02 13.71c-1.25 0-2.28-1.15-2.28-2.56s1.01-2.56 2.28-2.56c1.28 0 2.3 1.16 2.28 2.56 0 1.41-1.01 2.56-2.28 2.56zm8.44 0c-1.25 0-2.28-1.15-2.28-2.56s1.01-2.56 2.28-2.56c1.28 0 2.3 1.16 2.28 2.56 0 1.41-1 2.56-2.28 2.56z"/></svg>
        <span>Discord</span>
      </a>
      <a class="sg-con-item" href="#" onclick="_sgOpenSlack();event.preventDefault();" rel="noopener">
        <svg viewBox="0 0 24 24"><path d="M5.04 15.16a2.12 2.12 0 0 1-2.12 2.12A2.12 2.12 0 0 1 .8 15.16a2.12 2.12 0 0 1 2.12-2.12h2.12v2.12zm1.07 0a2.12 2.12 0 0 1 2.12-2.12 2.12 2.12 0 0 1 2.12 2.12v5.31a2.12 2.12 0 0 1-2.12 2.12 2.12 2.12 0 0 1-2.12-2.12v-5.31z" fill="#E01E5A"/><path d="M8.23 5.04a2.12 2.12 0 0 1-2.12-2.12A2.12 2.12 0 0 1 8.23.8a2.12 2.12 0 0 1 2.12 2.12v2.12H8.23zm0 1.08a2.12 2.12 0 0 1 2.12 2.12 2.12 2.12 0 0 1-2.12 2.12H2.92A2.12 2.12 0 0 1 .8 8.24a2.12 2.12 0 0 1 2.12-2.12h5.31z" fill="#36C5F0"/><path d="M18.96 8.24a2.12 2.12 0 0 1 2.12-2.12 2.12 2.12 0 0 1 2.12 2.12 2.12 2.12 0 0 1-2.12 2.12h-2.12V8.24zm-1.07 0a2.12 2.12 0 0 1-2.12 2.12 2.12 2.12 0 0 1-2.12-2.12V2.92A2.12 2.12 0 0 1 15.77.8a2.12 2.12 0 0 1 2.12 2.12v5.32z" fill="#2EB67D"/><path d="M15.77 18.96a2.12 2.12 0 0 1 2.12 2.12 2.12 2.12 0 0 1-2.12 2.12 2.12 2.12 0 0 1-2.12-2.12v-2.12h2.12zm0-1.07a2.12 2.12 0 0 1-2.12-2.12 2.12 2.12 0 0 1 2.12-2.12h5.31a2.12 2.12 0 0 1 2.12 2.12 2.12 2.12 0 0 1-2.12 2.12h-5.31z" fill="#ECB22E"/></svg>
        <span>Slack</span>
      </a>
      <a class="sg-con-item" href="#" onclick="_sgOpenMSTeams();event.preventDefault();" rel="noopener">
        <svg viewBox="0 0 24 24" fill="#6264A7"><path d="M20.67 7.5h-2.83V5.17a1 1 0 0 0-1-1h-1.17a2.5 2.5 0 1 0-3.67-1.67 2.5 2.5 0 0 0 .83 1.67H11.5a1 1 0 0 0-1 1V7.5H7.33A1.33 1.33 0 0 0 6 8.83V12a5 5 0 0 0 3.5 4.77V18.5a1.5 1.5 0 0 0 1.5 1.5h2a1.5 1.5 0 0 0 1.5-1.5v-1.73A5 5 0 0 0 18 12V8.83a1.33 1.33 0 0 0-1.33-1.33zm-6.17-3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/></svg>
        <span>Teams</span>
      </a>
      <a class="sg-con-item" style="border-color:rgba(255,109,0,.2);background:rgba(255,109,0,.06)" onclick="switchTab('chat');_sgCloseConnect();event.preventDefault();" href="#">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FF6D00" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
        <span style="color:#FF6D00">AI Chat</span>
      </a>
    </div>
  `;
  document.body.appendChild(popup);

  // Global open/close
  window._sgOpenConnect = function(){
    document.getElementById('sg-connect-backdrop').classList.add('open');
    document.getElementById('sg-connect-popup').classList.add('open');
  };
  window._sgCloseConnect = function(){
    document.getElementById('sg-connect-backdrop').classList.remove('open');
    document.getElementById('sg-connect-popup').classList.remove('open');
  };

  // Inject "Connect" button into Profile tab right-side column after render
  var _origSwitch6 = window.switchTab;
  if (typeof _origSwitch6 !== 'function') return;
  window.switchTab = function(tab) {
    _origSwitch6.apply(this, arguments);
    if (tab === 'more') {
      setTimeout(function(){
        // Find the right-side button column
        var rightCol = document.querySelector('[style*="right:10px"][style*="flex-direction:column"]');
        if (!rightCol) return;
        // Don't inject twice
        if (rightCol.querySelector('#sg-connect-btn')) return;

        // Create the Connect button in TikTok style (same as Edit, Bookings etc)
        var connectBtn = document.createElement('div');
        connectBtn.id = 'sg-connect-btn';
        connectBtn.onclick = function(){ _sgOpenConnect(); };
        connectBtn.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer';
        connectBtn.innerHTML = '<div style="width:46px;height:46px;background:rgba(37,211,102,.12);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:20px;border:1px solid rgba(37,211,102,.25)">💬</div><span style="color:rgba(255,255,255,.7);font-size:9px;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.8)">Connect</span>';
        
        // Insert before the last button (Out/Help)
        var lastBtn = rightCol.lastElementChild;
        rightCol.insertBefore(connectBtn, lastBtn);
      }, 60);
    }
  };
  console.log('[CON1] Connect button (Profile tab right-side) patch applied');
})();

console.log('[Patches v7.1] Chat channels + app store badges + connect button (FAB removed) loaded');

/* ── CSK1: Fix auth sheet Stripe card mount — bridge STRIPE_PK into auth sheet ── */
(function(){
  'use strict';

  // 1. Bridge the Stripe publishable key from /api/config into the auth sheet
  // The main app stores it in a let STRIPE_PK (not window-accessible)
  // The pay sheet accesses it via closure, but auth sheet uses window._sgStripePublishableKey
  // Fix: fetch from /api/config and set it
  function _ensureStripeKey(){
    if(window._sgStripePublishableKey && window._sgStripePublishableKey!=='pk_live_placeholder') return Promise.resolve();
    return fetch('/api/config').then(function(r){return r.json();}).then(function(c){
      if(c.stripeKey){
        window._sgStripePublishableKey=c.stripeKey;
        console.log('[CSK1] Stripe key bridged to auth sheet');
      }
    }).catch(function(){});
  }

  // 2. Ensure Stripe.js is loaded (same as ensureStripeLoaded in main app)
  function _ensureStripeJS(){
    if(window.Stripe) return Promise.resolve();
    return new Promise(function(resolve){
      if(document.querySelector('script[src*="js.stripe.com"]')){
        // Already loading, wait for it
        var tries=0;
        var iv=setInterval(function(){
          tries++;
          if(window.Stripe||tries>40){clearInterval(iv);resolve();}
        },250);
        return;
      }
      var s=document.createElement('script');
      s.src='https://js.stripe.com/v3/';
      s.onload=resolve;
      s.onerror=resolve;
      document.head.appendChild(s);
    });
  }

  // 3. Wrap _sgShowAuthSheet to pre-load Stripe key + Stripe.js
  var _origShow=window._sgShowAuthSheet;
  if(typeof _origShow==='function'){
    window._sgShowAuthSheet=function(mode){
      // Pre-fetch Stripe key and Stripe.js in parallel while auth sheet opens
      Promise.all([_ensureStripeKey(),_ensureStripeJS()]).catch(function(){});
      return _origShow.call(this,mode);
    };
  }

  // 4. Also set key immediately on page load (in case config already loaded)
  _ensureStripeKey();

  console.log('[CSK1] Auth sheet Stripe card fix applied');
})();
