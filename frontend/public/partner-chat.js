/**
 * Partner Chat — the Partner tab as a ChatGPT-style conversation.
 *
 * Gym owners should not have to learn a dashboard. Everything the Partner tab can do
 * (price, hours, bookings, earnings, payouts, door access) is one sentence away here:
 * tap a chip, type it, or hold the mic. Five taps becomes one, or none.
 *
 * All the machinery (streaming, markdown-lite rendering, mic, confirm chips, keeping
 * clear of the bottom navigation) lives once in chat-agent.js. This file is only the
 * Partner personality: its words, its endpoint, its tools, its routes.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[PartnerChat] chat-agent.js not loaded');
    return;
  }

  window.sgPartnerChat = window.sgChatAgent.create({
    ns: 'pchat',
    paths: /^\/partners?(\/|$)/,
    endpoint: '/api/partner/agent',

    avatar: '🏋️',
    title: 'ScanGym Partner',
    subtitle: 'Your gym assistant',
    fabTitle: 'Ask ScanGym',

    chips: [
      'How much have I made?',
      "This week's bookings",
      'Change my day pass price',
      'Close the gym today',
      'Pay me out',
    ],

    greetSignedIn:
      "Hi — I run your gym's ScanGym listing. Tell me what you need and I'll do it: " +
      "set your price, close for the day, check what you've earned, get you paid out. No menus.",
    greetSignedOut:
      "Hi — I'm your ScanGym assistant. Sign in with the number on your gym account and I " +
      'can set your price, check your earnings, close the gym for a day, or pay you out.',
    signedOutReply:
      'Say the mobile number on your gym account and I will text you a link to tap to get you in.',

    toolLabels: {
      get_my_gym: 'Checking your gym',
      get_earnings: 'Checking your earnings',
      get_bookings: 'Looking up bookings',
      get_customers: 'Counting customers',
      search_gyms: 'Searching for your gym',
      set_day_price: 'Updating your price',
      set_bookings_open: 'Updating your listing',
      set_hours_override: "Updating today's hours",
      claim_gym: 'Claiming your gym',
      request_payout: 'Sending your payout',
      connect_payout_method: 'Setting up payouts',
      connect_smart_lock: 'Connecting your door',
    },

    // The owner must see the number before saying yes.
    confirmSummary: function (tool, args) {
      switch (tool) {
        case 'set_day_price':
          return 'Set your day pass to £' + Number(args.dayPrice).toFixed(2) + '?';
        case 'set_bookings_open':
          return args.open
            ? 'Reopen your gym for ScanGym bookings?'
            : 'Pause new ScanGym bookings?';
        case 'set_hours_override':
          return args.status === 'closed_now'
            ? 'Mark the gym closed for today? Existing bookings stay valid.'
            : args.status === 'open_now'
            ? 'Mark the gym open now, overriding your Google hours?'
            : 'Clear the override and go back to your Google hours?';
        case 'claim_gym':
          return 'Claim this gym for your account?';
        case 'request_payout':
          return 'Pay your available balance out to your bank?';
        case 'connect_payout_method':
          return 'Open Stripe to set up your payouts?';
        case 'connect_smart_lock':
          return 'Connect ' + args.provider + ' to your gym?';
        default:
          return null;
      }
    },

    resultLink: function (result) {
      return result.url ? { href: result.url, label: 'Open Stripe setup →' } : null;
    },
  });
})();
