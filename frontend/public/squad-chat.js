/**
 * ScanSquad Chat — the creator side of ScanGym as a ChatGPT-style conversation.
 *
 * Same engine as the Partner tab (chat-agent.js), aimed at creators instead of gym
 * owners: earnings, link performance, leaderboard, reels, boosts, giveaways, bundles,
 * scheduling, payouts — one sentence away. Tap a chip, type it, or hold the mic.
 *
 * This file is only the ScanSquad personality. It used to be a 754-line copy of
 * partner-chat.js, which is how the two chats ended up behaving differently.
 */
(function () {
  'use strict';

  if (!window.sgChatAgent) {
    console.warn('[SquadChat] chat-agent.js not loaded');
    return;
  }

  window.sgSquadChat = window.sgChatAgent.create({
    ns: 'schat',
    /**
     * Which URLs count as "the ScanSquad tab" — every spelling the app actually routes
     * to. Missing one of these once made the whole feature invisible and closed the chat
     * a moment after it opened.
     */
    paths: /^\/(creator|creators|scansquad|scansquad-dashboard|creator-earnings|become-a-creator)(\/|$)/,
    endpoint: '/api/squad/agent',

    avatar: '💪',
    title: 'ScanSquad',
    subtitle: 'Your creator assistant',
    fabTitle: 'Ask ScanSquad',

    // The ScanSquad bottom bar is itself an "Ask AI" bar (injected by round2.js), and
    // the squad brand strip also pins to the bottom — both must be measured so the
    // panel and the button sit above them.
    bottomChrome: ['#sg-squad-brand'],

    chips: [
      'How much have I earned?',
      'What should I post next?',
      'Show my reels',
      'Where am I on the leaderboard?',
      'Pay me out',
    ],

    greetSignedIn:
      "Hi — I look after your ScanSquad earnings. Ask me what you've made, what to post " +
      'next, or tell me to boost a reel or pay you out. No menus.',
    greetSignedOut:
      "Hi — I'm your ScanSquad assistant. Sign in and I can show what you've earned, tell " +
      'you which gym your link actually converts on, boost a reel, or get you paid out.',
    signedOutReply: 'Sign in to your ScanGym account and I can help.',

    toolLabels: {
      get_my_squad_profile: 'Checking your ScanSquad status',
      get_my_earnings: 'Checking your earnings',
      get_my_link_performance: 'Looking at what converts',
      get_leaderboard: 'Reading the leaderboard',
      get_my_content: 'Fetching your reels',
      get_my_toolkit: 'Opening the toolkit',
      get_my_schedule: 'Checking your calendar',
      join_squad: 'Signing you up',
      set_my_handle: 'Setting your handle',
      start_giveaway: 'Setting up your giveaway',
      boost_reel: 'Boosting your reel',
      set_bundle_deal: 'Turning on your bundle',
      schedule_post: 'Adding it to your calendar',
      announce_to_followers: 'Messaging your followers',
      request_withdrawal: 'Requesting your payout',
    },

    // Anything that spends the creator's balance or messages their followers is
    // confirmed with the real number first.
    confirmSummary: function (tool, args) {
      switch (tool) {
        case 'join_squad':
          return 'Join ScanSquad? It is free and you earn 25% on every booking through your link.';
        case 'set_my_handle': {
          var handle = String(args.handle || '').replace(/^@+/, '');
          return 'Set your handle to ' + handle +
            '? Your link becomes scangym.com/r/' + handle + '.';
        }
        case 'start_giveaway':
          return 'Run a free pass giveaway? It takes £5 off your available balance and gives you a claim link.';
        case 'boost_reel': {
          var days = Number(args.days) || 1;
          return 'Boost that reel to the top of the feed for ' + days + ' day' + (days > 1 ? 's' : '') +
            '? That is £' + (days * 1).toFixed(2) + ' off your balance.';
        }
        case 'set_bundle_deal':
          return args.preset === '5for20'
            ? 'Turn on your 5 passes for £20 bundle?'
            : 'Turn on your 3 passes for £12 bundle?';
        case 'schedule_post':
          return 'Add this to your calendar for ' + String(args.scheduledAt || '') + '?\n\n"' +
            String(args.caption || '') + '"';
        case 'announce_to_followers':
          return 'Send this to your followers?\n\n"' + String(args.message || '') + '"';
        case 'request_withdrawal':
          return args.amountPounds === undefined
            ? 'Request a payout of your whole available balance?'
            : 'Request a payout of £' + Number(args.amountPounds).toFixed(2) + '?';
        default:
          return null;
      }
    },

    resultLink: function (result) {
      var url = result.claimUrl || result.referralLink;
      return url ? { href: url, label: url } : null;
    },
  });
})();
