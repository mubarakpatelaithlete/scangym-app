/**
 * Profile Chat — your passes and account, spoken.
 *
 * The Profile tab is a login gate and then a list. Neither is a conversation, and
 * like Reels it was invisible to voice-always.js: `/more/profile` matched no
 * personality's route pattern, so voice never armed on the tab where the two most
 * urgent questions live — "where is my pass?" and "am I verified?" — which are
 * exactly the questions you ask standing at a gym door with your phone in one hand.
 *
 * Reuses the Book agent, which already owns get_my_bookings. A separate profile
 * agent would mean a second place for booking lookups to drift.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[ProfileChat] chat-agent.js not loaded');
    return;
  }

  window.sgProfileChat = window.sgChatAgent.create({
    ns: 'mchat', // 'pchat' is partner-chat.js; ns keys the DOM ids and storage, so it must be unique
    /**
     * Every spelling the app routes to this tab. areaFor() in route-scripts.js treats
     * /profile, /more/profile and everything under /more as the profile area, so all
     * three are matched here — missing one is how ScanSquad's chat once went invisible.
     */
    paths: /^\/(profile|more)(\/|$)/,
    endpoint: '/api/book/agent',

    avatar: '👤',
    title: 'ScanGym',
    subtitle: 'Your passes and account',
    fabTitle: 'Ask ScanGym',

    chips: [
      'Show my pass',
      'When is my next session?',
      'What have I booked?',
      'Cancel my booking',
    ],

    greetSignedIn:
      'Ask me for your pass, your next session, or anything you have booked — no ' +
      'digging through menus.',
    greetSignedOut:
      'Say your mobile number and I will text you a six-digit code — read it back and ' +
      'you are in. No password, no forms.',
    signedOutReply:
      'Tell me your mobile number or email and I will text you a code to get you in.',

    toolLabels: {
      send_login_code: 'Texting you a code',
      confirm_login_code: 'Signing you in',
      login_with_provider: 'Opening sign-in',
      get_my_bookings: 'Looking up your bookings',
      get_gym: 'Checking the gym',
      today_and_tomorrow: 'Checking the date',
      find_gyms: 'Searching gyms',
      book_gym: 'Booking your session',
      book_and_pay: 'Booking and paying',
      cancel_booking: 'Cancelling your booking',
    },
  });
})();
