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
    paths: /^\/(book|search|gyms?)(\/|$)|^\/$/,
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
      "Hi — tell me where you want to train and I'll find you a gym. Sign in when you're " +
      'ready to book and I can take care of it.',
    signedOutReply: 'Sign in and I can book that for you.',

    toolLabels: {
      find_gyms: 'Searching gyms',
      get_gym: 'Checking the gym',
      get_my_bookings: 'Looking up your bookings',
      today_and_tomorrow: 'Checking the date',
      book_gym: 'Booking your session',
    },

    // Booking takes money — they must see gym, day, time and price before saying yes.
    confirmSummary: function (tool, args, ctx) {
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
