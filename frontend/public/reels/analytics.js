/**
 * FRONTEND PATCH: Enhanced Analytics Tracking for Reels
 * ═══════════════════════════════════════════════════════
 *
 * Add this to the frontend reels player (index.html) to capture
 * the signals the algorithm needs: watch time, skips, likes, shares.
 *
 * The old frontend only sent basic view events.
 * This upgrade sends the full signal set that TikTok/Instagram use.
 */

// ── Session Management ──────────────────────────────────
// Each browser session gets a unique ID (no login needed).
// Persists for the browser tab lifetime.
function getSessionId() {
  if (!window._scanGymSessionId) {
    window._scanGymSessionId =
      'sg_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }
  return window._scanGymSessionId;
}

// ── Event Buffer ────────────────────────────────────────
// Batch events and send every 5 seconds (or on page unload)
// to minimise network requests — same approach as TikTok.
const eventBuffer = [];
let flushTimer = null;

function trackEvent(videoId, action, extra = {}) {
  eventBuffer.push({
    video_id: String(videoId),
    action,      // 'view' | 'skip' | 'like' | 'share' | 'save' | 'complete'
    watch_ms:  extra.watchMs || 0,
    watch_pct: extra.watchPct || 0,
    category:  extra.category || '',
    timestamp: Date.now(),
  });

  // Auto-flush after 5 seconds of inactivity
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushEvents, 5000);
}

async function flushEvents() {
  if (eventBuffer.length === 0) return;

  const events = eventBuffer.splice(0); // Take all buffered events
  try {
    await fetch('/api/reels/analytics', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': getSessionId(),
      },
      body: JSON.stringify({
        session_id: getSessionId(),
        events,
      }),
    });
  } catch (err) {
    // Re-queue failed events (will retry on next flush)
    eventBuffer.unshift(...events);
  }
}

// Flush on page unload (using sendBeacon for reliability)
window.addEventListener('beforeunload', () => {
  if (eventBuffer.length > 0) {
    const payload = JSON.stringify({
      session_id: getSessionId(),
      events: eventBuffer.splice(0),
    });
    navigator.sendBeacon('/api/reels/analytics', new Blob([payload], { type: 'application/json' }));
  }
});

// ── Video Player Integration ────────────────────────────
// Hook into your existing video player to track engagement.
// These functions should be called from your reel player component.

/**
 * Call when a reel starts playing (user swipes to it)
 */
function onReelStart(videoId, category) {
  window._currentReel = {
    videoId,
    category,
    startTime: Date.now(),
    duration: 0, // Will be set from video element
  };
}

/**
 * Call when a reel finishes or user swipes away
 */
function onReelEnd(videoId, videoDurationMs) {
  const reel = window._currentReel;
  if (!reel || reel.videoId !== String(videoId)) return;

  const watchMs = Date.now() - reel.startTime;
  const watchPct = videoDurationMs > 0
    ? Math.round((watchMs / videoDurationMs) * 100)
    : 0;

  // Determine action based on watch behaviour
  let action;
  if (watchMs < 2000 && watchPct < 15) {
    // EARLY SKIP: Watched less than 2 seconds and <15% — strong negative signal
    // (TikTok treats this as the strongest negative signal)
    action = 'skip';
  } else if (watchPct >= 80) {
    // COMPLETION: Watched 80%+ — strong positive signal
    // (TikTok's #1 positive signal)
    action = 'complete';
  } else {
    // PARTIAL VIEW: Watched some but not all
    action = 'view';
  }

  trackEvent(videoId, action, {
    watchMs,
    watchPct: Math.min(watchPct, 100),
    category: reel.category,
  });

  window._currentReel = null;
}

/**
 * Call when user taps the like button
 */
function onReelLike(videoId, category) {
  trackEvent(videoId, 'like', { category });
}

/**
 * Call when user shares a reel (the most valuable signal per Instagram)
 */
function onReelShare(videoId, category) {
  trackEvent(videoId, 'share', { category });
}

/**
 * Call when user saves/bookmarks a reel
 */
function onReelSave(videoId, category) {
  trackEvent(videoId, 'save', { category });
}

// ── Feed Request Enhancement ────────────────────────────
// When requesting the feed, include the session ID so the
// algorithm can adapt in real-time (TikTok-style).

/**
 * Enhanced feed fetch — passes session_id for personalisation.
 * Replace your existing feed fetch call with this.
 */
async function fetchReelFeed(options = {}) {
  const params = new URLSearchParams({
    limit: options.limit || 50,
    offset: options.offset || 0,
    shuffle: 'true',
    session_id: getSessionId(),
    ...(options.category ? { category: options.category } : {}),
    ...(options.seed ? { seed: options.seed } : {}),
  });

  const response = await fetch(`/api/reels/feed?${params}`);
  return response.json();
}

// Export for use in the reel player
window.ScanGymAnalytics = {
  trackEvent,
  flushEvents,
  onReelStart,
  onReelEnd,
  onReelLike,
  onReelShare,
  onReelSave,
  fetchReelFeed,
  getSessionId,
};
