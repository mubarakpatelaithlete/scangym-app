/**
 * Reels Chat — the Reels tab as a conversation.
 *
 * Reels is the tab a first-time visitor lands on, and until now it was the one tab
 * where voice could never turn on: voice-always.js only knew about the Book, Squad
 * and Partner personalities, and `/reels` matched none of their route patterns, so
 * current() returned null and arm() gave up before it started. The front door was
 * the one room with no front door.
 *
 * The personality is deliberately thin. Watching a reel, there is really only one
 * thing you want to say — "book that one" — so this reuses the Book agent and its
 * tools rather than inventing a second booking path that could drift from it.
 *
 * The reel on screen is now threaded through cfg.context(), so "book that one" no
 * longer starts with the agent asking which one.
 *
 * One honesty point that shaped this: a reel is not a gym. The feed is global
 * content ("Tiktok Gym Hopping"), not a listing, so the bookable thing behind a
 * reel is the local offer the CTA already shows — this viewer's city and the
 * cheapest day pass actually visible there, from window._sgLocalOffer(). We pass
 * that, plus which reel is playing, and let the agent's own tools price it. The
 * context never carries a price the agent may quote.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[ReelsChat] chat-agent.js not loaded');
    return;
  }

  /* The player lives in an iframe and posts its status to the app shell. The shell
   * stores it on its own module-scoped `state`, which is not `window.state` — other
   * files already read window.state and get undefined — so rather than rely on a
   * reference that does not exist, listen for the same message directly. */
  var lastStatus = null;
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('message', function (e) {
      if (e && e.data && e.data.type === 'sg-reels-status') lastStatus = e.data;
    });
  }

  window.sgReelsChat = window.sgChatAgent.create({
    ns: 'rchat',
    // Every route the Reels tab serves. /reels/<id> is a deep link to a single reel.
    paths: /^\/reels(\/|$)/,
    endpoint: '/api/book/agent',

    avatar: '🎬',
    title: 'ScanGym',
    subtitle: 'Book what you are watching',
    fabTitle: 'Ask ScanGym',

    chips: [
      'Book that one',
      'How much is this one?',
      'Save that one',
      'Find one like this near me',
    ],

    greetSignedIn:
      'Say "book this one" while you watch and I will find it, tell you the price, ' +
      'and book it when you say yes.',
    greetSignedOut:
      'Tell me which reel you like and I will find the gym and the price. To book it, ' +
      'just say your mobile number and I will text you a link to tap.',
    signedOutReply:
      'Say your mobile number or email and I will send you a link to tap — then I can book it.',

    // Same tools as the Book tab — this is the Book agent wearing a different face.
    toolLabels: {
      find_gyms: 'Finding that gym',
      save_gym: 'Saving it to your list',
      get_saved_gyms: 'Opening your saved list',
      get_gym: 'Checking the gym',
      get_my_bookings: 'Looking up your bookings',
      today_and_tomorrow: 'Checking the date',
      book_gym: 'Booking your session',
      book_and_pay: 'Booking and paying',
      cancel_booking: 'Cancelling your booking',
    },

    /* Read at send time, never cached: they swipe between reels mid-conversation. */
    context: function () {
      var ctx = { tab: 'reels' };

      var offer = null;
      try {
        offer = typeof window._sgLocalOffer === 'function' ? window._sgLocalOffer() : null;
      } catch (e) {
        offer = null;
      }
      if (offer && offer.city) ctx.city = offer.city;
      if (offer && offer.from) ctx.fromPrice = offer.from;

      var status = lastStatus;
      if (status && status.video) {
        if (status.video.name) ctx.reelName = status.video.name;
        if (status.video.category) ctx.reelCategory = status.video.category;
      }
      if (status && typeof status.index === 'number' && status.total) {
        ctx.reelPosition = (status.index + 1) + ' of ' + status.total;
      }

      return ctx;
    },

  });
})();
