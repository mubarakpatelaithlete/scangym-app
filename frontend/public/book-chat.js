/**
 * Book Chat — the Book tab as a ChatGPT-style conversation.
 *
 * Finding and booking a gym is currently a funnel: search, scroll, open, pick a date,
 * pick a time, pay. This makes it one sentence — "a gym near London Bridge tonight" —
 * and one yes.
 *
 * All the machinery (streaming, markdown-lite rendering, mic, confirm chips, keeping
 * clear of the bottom navigation) lives once in chat-agent.js. This file is only the
 * Book personality: its words, its endpoint, its tools, its routes.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[BookChat] chat-agent.js not loaded');
    return;
  }

  window.sgBookChat = window.sgChatAgent.create({
    ns: 'bchat',
    /**
     * Every route the Book tab actually routes to. getTabForRoute() in app.js sends
     * /nearby, /checkout, /booking-success and /r/<code> to this tab as well, and voice
     * used to fall silent on exactly those pages — including checkout, the money step.
     */
    paths: /^\/(book|explore|nearby|search|checkout|booking-success|gyms?|r)(\/|$)|^\/$/,
    endpoint: '/api/book/agent',

    avatar: '🔎',
    title: 'ScanGym',
    subtitle: 'Find and book a gym',
    fabTitle: 'Ask ScanGym',

    chips: [
      'Find me a gym nearby',
      'Somewhere open 24 hours',
      'Book me in tonight',
      'When is my next session?',
      'Cheapest gym near me',
    ],

    greetSignedIn:
      "Tell me where and when — \"a gym near London Bridge tonight\" — and I'll find it, " +
      "tell you the price, and book it when you say yes.",
    greetSignedOut:
      "Hi — tell me where you want to train and I'll find you a gym. When you want to " +
      'book it, just say your mobile number and I will text you a code.',
    signedOutReply:
      'Say your mobile number or email and I will text you a code — then I can book it.',

    toolLabels: {
      send_login_code: 'Texting you a code',
      confirm_login_code: 'Signing you in',
      login_with_provider: 'Opening sign-in',
      find_gyms: 'Searching gyms',
      get_gym: 'Checking the gym',
      get_my_bookings: 'Looking up your bookings',
      today_and_tomorrow: 'Checking the date',
      book_gym: 'Booking your session',
      cancel_booking: 'Cancelling your booking',
    },

    // Booking takes money — they must see gym, day, time and price before saying yes.
    confirmSummary: function (tool, args, ctx) {
      // Cancelling gives money back rather than taking it, but it is just as
      // irreversible, so it gets the same explicit yes.
      // chat-agent.js calls this with (tool, args) only — there is no page context
      // to name the gym from, so the model's own sentence above carries the detail.
      if (tool === 'cancel_booking') return 'Cancel that booking and refund it?';
      if (tool !== 'book_gym') return null;

      var gymName = (ctx && ctx.lastGymName) || 'this gym';
      var when = args.date || '';
      var time = args.time ? ' at ' + args.time : '';
      return 'Book ' + gymName + ' for ' + when + time + '?';
    },

    resultLink: function (result) {
      return result.booking
        ? { href: '/bookings', label: 'View your booking →' }
        : null;
    },
  });
})();
