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
 * Note: chat-agent.js has no hook for passing page context to the model, so "that
 * gym" is resolved by the agent asking, not by the reel on screen. Threading the
 * current reel through is the obvious next step and wants an engine change.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[ReelsChat] chat-agent.js not loaded');
    return;
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
      'Book this gym',
      'How much is this one?',
      'Is it open now?',
      'Find one like this near me',
    ],

    greetSignedIn:
      'Say "book this one" while you watch and I will find it, tell you the price, ' +
      'and book it when you say yes.',
    greetSignedOut:
      'Tell me which reel you like and I will find the gym and the price. To book it, ' +
      'just say your mobile number and I will text you a code.',
    signedOutReply:
      'Say your mobile number or email and I will text you a code — then I can book it.',

    // Same tools as the Book tab — this is the Book agent wearing a different face.
    toolLabels: {
      find_gyms: 'Finding that gym',
      get_gym: 'Checking the gym',
      get_my_bookings: 'Looking up your bookings',
      today_and_tomorrow: 'Checking the date',
      book_gym: 'Booking your session',
      book_and_pay: 'Booking and paying',
    },

  });
})();
