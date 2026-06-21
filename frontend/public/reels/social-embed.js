/**
 * Social Reels Frontend Patch
 * ═══════════════════════════
 * 
 * Patches the createReel function to support social reels (YouTube Shorts, TikTok).
 * Instead of a <video> tag, social reels render as embedded iframes that give
 * view credit to the original creator.
 * 
 * Loaded after the main reels script. Self-initializing.
 */
(function() {
  'use strict';

  // Wait for the reels app to initialize
  function patchWhenReady() {
    // Check if createReel exists in the window scope
    if (typeof window._originalCreateReel !== 'undefined') return; // Already patched

    // Monkey-patch: wrap the existing createReel to handle social reels
    var checkInterval = setInterval(function() {
      // The reels app stores allVideos globally — wait for feed to load
      if (typeof allVideos === 'undefined' || allVideos.length === 0) return;
      
      clearInterval(checkInterval);
      console.log('[social-reels] Patching createReel for social embeds...');

      // Store reference to original createReel
      window._originalCreateReel = window.createReel || createReel;

      // Override createReel
      window.createReel = function(video, index) {
        // If not a social reel, use original renderer
        if (video.type !== 'social') {
          return window._originalCreateReel(video, index);
        }

        // ── Social Reel Rendering ──
        var screenH = window.innerHeight;
        var div = document.createElement('div');
        div.className = 'reel reel-social';
        div.style.height = screenH + 'px';
        div.style.top = (index * screenH) + 'px';
        div.dataset.index = index;
        div.dataset.social = video.source; // 'youtube' or 'tiktok'

        // Background (thumbnail)
        if (video.posterUrl || video.thumb) {
          var bg = document.createElement('img');
          bg.src = video.posterUrl || video.thumb;
          bg.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;opacity:0.3;z-index:1;';
          div.appendChild(bg);
        }

        // Embed container
        var embedWrap = document.createElement('div');
        embedWrap.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:5;';

        if (video.source === 'youtube') {
          // YouTube Shorts embed — autoplay, loop, muted
          var videoId = (video.externalId || '').replace('yt_', '');
          var iframe = document.createElement('iframe');
          iframe.src = 'https://www.youtube.com/embed/' + videoId 
            + '?autoplay=1&mute=1&loop=1&controls=0&playsinline=1&playlist=' + videoId
            + '&modestbranding=1&rel=0&showinfo=0';
          iframe.style.cssText = 'width:100%;height:100%;border:none;pointer-events:none;';
          iframe.allow = 'autoplay; encrypted-media';
          iframe.loading = 'lazy';
          embedWrap.appendChild(iframe);
        } else if (video.source === 'tiktok') {
          // TikTok embed
          if (video.embedHtml) {
            embedWrap.innerHTML = video.embedHtml;
            // Style the TikTok embed to fill the reel
            var ttIframe = embedWrap.querySelector('iframe');
            if (ttIframe) {
              ttIframe.style.cssText = 'width:100%;height:100%;border:none;';
            }
          }
        }

        div.appendChild(embedWrap);

        // Platform badge (top-right)
        var badge = document.createElement('div');
        badge.className = 'social-badge';
        var platformIcon = video.source === 'youtube' ? '▶️ YouTube' : '🎵 TikTok';
        badge.innerHTML = '<span style="font-size:11px;font-weight:600;">' + platformIcon + '</span>';
        badge.style.cssText = 'position:absolute;top:16px;right:16px;z-index:25;'
          + 'background:rgba(0,0,0,0.6);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
          + 'padding:4px 10px;border-radius:20px;color:#fff;';
        div.appendChild(badge);

        // Brand circle
        var brandCircle = document.createElement('div');
        brandCircle.className = 'sg-brand-circle';
        div.appendChild(brandCircle);

        // Video info (bottom)
        var info = document.createElement('div');
        info.className = 'reel-info';
        info.innerHTML = '<div class="reel-title">' + (video.name || '') + '</div>'
          + '<div class="reel-category">🎬 ' + (video.category || 'Social') + '</div>'
          + (video.creator ? '<div class="reel-creator">@' + (video.creator.handle || video.creator.name || '') + '</div>' : '');
        div.appendChild(info);

        // "Watch on [Platform]" CTA — tapping opens original (gives creator the view)
        var watchCta = document.createElement('a');
        watchCta.href = video.url || '#';
        watchCta.target = '_blank';
        watchCta.rel = 'noopener';
        watchCta.className = 'creator-cta';
        watchCta.innerHTML = '<span style="font-size:13px;">Watch on ' 
          + (video.source === 'youtube' ? 'YouTube' : 'TikTok') + ' ↗</span>';
        watchCta.style.cssText += 'position:absolute;bottom:80px;left:16px;z-index:25;text-decoration:none;color:#fff;'
          + 'display:flex;align-items:center;gap:8px;padding:8px 14px;'
          + 'background:rgba(255,109,0,0.2);border:1px solid rgba(255,109,0,0.4);border-radius:12px;'
          + 'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);';
        div.appendChild(watchCta);

        // Track analytics
        fetch('/api/social-reels/analytics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ external_id: video.externalId, event: 'view' }),
        }).catch(function() {});

        return { element: div, video: null, index: index, isSocial: true };
      };

      console.log('[social-reels] Patch applied — social reels will render as embeds');
    }, 500);
  }

  // Start patching
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', patchWhenReady);
  } else {
    patchWhenReady();
  }
})();
