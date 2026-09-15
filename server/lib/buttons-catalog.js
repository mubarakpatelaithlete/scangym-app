'use strict';

/**
 * The button catalog — one entry per destination ScanGym can send a customer to.
 *
 * Why this file exists
 * --------------------
 * The 89 "clickable button" cards on the Buttons board were being built one at a
 * time, each one hard-coding its own URL and its own idea of whether it was ready.
 * profile-rail.js already carried a hand-maintained VERIFIED_LIVE map, the Apps
 * page carried another, and the two disagreed. Adding the rest of the board that
 * way means 89 places to edit and 89 chances to ship a dead link.
 *
 * So: one catalog, one truth. Every button is listed here exactly once, with what
 * it needs in order to work. routes/buttons.js computes its live state from the
 * environment at request time, and frontend/public/everything renders the lot.
 *
 * The no-dead-links rule still holds — and is now enforced by construction. A
 * button whose requirement is unmet renders as "Coming soon", visible but not
 * tappable. It turns itself on the moment the credential or listing exists; no
 * code change, no deploy, no card to move.
 *
 * Entry shape
 * -----------
 *   id       stable key, used by the frontend and by tests
 *   card     the Trello card this implements, verbatim, so the board can be
 *            reconciled against the code mechanically
 *   label    what the customer reads
 *   group    section on /everything
 *   type     'route'   in-app SPA route (always live — we ship the app)
 *            'url'     external link
 *            'action'  handled by app JS on the client (install prompt, share…)
 *   href     route/url for the above, or the action name
 *   needsEnv env vars that must be non-empty for this to work at all
 *   needsUrl set when the destination is a third-party listing/profile that must
 *            exist before we may link to it. Held in LISTINGS below so a single
 *            edit flips the button on.
 *   soon     human explanation shown on the disabled state. Customer-facing:
 *            never name an env var here.
 */

/**
 * Third-party destinations that are NOT ours to create with code.
 *
 * `null` means: this listing/profile/account does not exist yet (or is not
 * publicly reachable — e.g. a closed testing track, a login wall, a handle owned
 * by someone else). Fill the URL in when it goes live and the button lights up.
 *
 * Verified 2026-09-14 against the notes already in profile-rail.js.
 */
const LISTINGS = {
  msStore: 'https://apps.microsoft.com/detail/9nh8vrn834dv',
  googlePlay: null,      // closed testing track, public listing 404s
  appleStore: null,      // listing not created
  galaxyStore: null,
  metaStore: null,
  tiktok: 'https://www.tiktok.com/@scangym',
  instagram: 'https://instagram.com/scangym',
  facebook: 'https://facebook.com/scangym',
  twitter: null,         // x.com/scangym belongs to an unrelated account
  youtube: 'https://www.youtube.com/@scangym',  // verified live 2026-09-15: ScanGym channel, correct bio
  linkedin: null,
  snapchat: null,
  chatgptPlugin: null,   // app submission pending
  chatgptGpt: null,      // custom GPT not published
  gemini: null,
  kimi: null,
  grok: null,
  bing: null,
};

const catalog = [
  // ── Tabs ────────────────────────────────────────────────────────────────
  { id: 'tab-reels', card: 'Reels tab clickable button', label: 'Reels', group: 'Tabs', type: 'route', href: '/reels' },
  { id: 'tab-book', card: 'Book tab clickable button', label: 'Book', group: 'Tabs', type: 'route', href: '/explore' },
  { id: 'tab-maps', card: 'Maps tab clickable button', label: 'Maps', group: 'Tabs', type: 'route', href: '/nearby' },
  { id: 'tab-scansquad', card: 'Scansquad tab clickable button', label: 'ScanSquad', group: 'Tabs', type: 'route', href: '/scansquad' },
  { id: 'tab-partner', card: 'Partner tab button clickable button', label: 'Partner', group: 'Tabs', type: 'route', href: '/partner' },
  { id: 'tab-profile', card: 'Profile tab clickable button', label: 'Profile', group: 'Tabs', type: 'route', href: '/more/profile' },

  // ── Booking & account actions ───────────────────────────────────────────
  { id: 'act-search', card: 'Search clickable button', label: 'Search gyms', group: 'Book a gym', type: 'route', href: '/search' },
  { id: 'act-nearme', card: 'Nearme  clickable button', label: 'Near me', group: 'Book a gym', type: 'route', href: '/nearby' },
  { id: 'act-calendar', card: 'Calendar clickable button', label: 'Calendar', group: 'Book a gym', type: 'route', href: '/more/calendar' },
  { id: 'act-bookings', card: 'Bookings clickable button', label: 'My bookings', group: 'Book a gym', type: 'route', href: '/my-bookings' },
  { id: 'act-passes', card: 'Passes clickable button', label: 'My passes', group: 'Book a gym', type: 'route', href: '/more/passes' },
  { id: 'act-payment', card: 'Payment clickable button', label: 'Payment', group: 'Book a gym', type: 'route', href: '/wallet', needsEnv: ['STRIPE_SECRET_KEY'] },
  { id: 'act-pricing', card: 'Pricing clickable button', label: 'Pricing', group: 'Book a gym', type: 'route', href: '/pricing' },
  { id: 'act-hours', card: 'Hours clickable button', label: 'Opening hours', group: 'Book a gym', type: 'route', href: '/explore?panel=hours' },
  { id: 'act-facilities', card: 'Facilities clickable button', label: 'Facilities', group: 'Book a gym', type: 'route', href: '/explore?panel=facilities' },
  { id: 'act-reviews', card: 'Reviews clickable button', label: 'Reviews', group: 'Book a gym', type: 'route', href: '/explore?panel=reviews' },
  { id: 'act-photos', card: 'Photos clickable button🕘', label: 'Photos', group: 'Book a gym', type: 'route', href: '/explore?panel=photos' },
  { id: 'act-share', card: 'Share clickable button', label: 'Share', group: 'Book a gym', type: 'action', href: 'share' },
  { id: 'act-save', card: 'Save clickable button', label: 'Save', group: 'Book a gym', type: 'action', href: 'save' },
  { id: 'act-talk', card: 'Talk clickable button', label: 'Talk to ScanGym', group: 'Book a gym', type: 'action', href: 'talk' },
  { id: 'act-messages', card: 'Messages clickable button🕘', label: 'Messages', group: 'Book a gym', type: 'route', href: '/more/messages' },
  { id: 'act-aicoach', card: 'AI coach clickable button🕘', label: 'AI coach', group: 'Book a gym', type: 'route', href: '/coach' },
  { id: 'act-music', card: 'Music clickable button🕘', label: 'Music', group: 'Book a gym', type: 'route', href: '/more/music' },

  // ── Entry / access ──────────────────────────────────────────────────────
  { id: 'act-verify', card: 'Verify clickable button', label: 'Verify entry (QR)', group: 'Entry & access', type: 'route', href: '/staff/scan' },
  { id: 'act-locks', card: 'Locks clickable button', label: 'Smart locks', group: 'Entry & access', type: 'route', href: '/partner?panel=locks', needsEnv: ['SEAM_API_KEY'] },
  { id: 'act-openclose', card: 'Open close clickable button', label: 'Open / close', group: 'Entry & access', type: 'route', href: '/partner?panel=hours' },
  { id: 'act-onoff', card: 'On off clickable button', label: 'Listing on / off', group: 'Entry & access', type: 'route', href: '/partner?panel=status' },
  { id: 'act-earnings', card: 'Earnings clickable button', label: 'Earnings', group: 'Entry & access', type: 'route', href: '/partner?panel=earnings' },

  // ── Sign in ─────────────────────────────────────────────────────────────
  { id: 'signin-google', card: 'Sign in with Google clickable button', label: 'Sign in with Google', group: 'Sign in', type: 'route', href: '/login?with=google', needsEnv: ['GOOGLE_CLIENT_ID'] },
  { id: 'signin-apple', card: 'Sign in with apple clickable button', label: 'Sign in with Apple', group: 'Sign in', type: 'route', href: '/login?with=apple', needsEnv: ['APPLE_CLIENT_ID'] },
  { id: 'signin-phone', card: 'Sign in with phone clickable button', label: 'Sign in with phone', group: 'Sign in', type: 'route', href: '/login?with=phone', needsEnv: ['TWILIO_ACCOUNT_SID'] },
  { id: 'signin-email', card: 'Sign in with email clickable button', label: 'Sign in with email', group: 'Sign in', type: 'route', href: '/login?with=email' },
  { id: 'signin-sso', card: 'Sign in with sso clickable button', label: 'Sign in with SSO', group: 'Sign in', type: 'route', href: '/login?with=sso', needsEnv: ['SSO_METADATA_URL'], soon: 'Company SSO is being set up.' },

  // ── Chat with ScanGym where you already are ─────────────────────────────
  { id: 'ch-telegram', card: 'Scangym is now in telegram clickable button', label: 'Telegram', group: 'Chat with ScanGym', type: 'url', href: 'https://t.me/ScanGymBot', needsEnv: ['TELEGRAM_BOT_TOKEN'] },
  { id: 'ch-discord', card: 'Scangym is now in discord  clickable button', label: 'Discord', group: 'Chat with ScanGym', type: 'url', href: '/api/channels/discord/invite', needsEnv: ['DISCORD_BOT_TOKEN'] },
  { id: 'ch-slack', card: 'Scangym is now in slack clickable button', label: 'Slack', group: 'Chat with ScanGym', type: 'url', href: '/api/channels/slack/install', needsEnv: ['SLACK_CLIENT_ID'] },
  { id: 'ch-teams', card: 'Scangym is now in teams clickable button', label: 'Microsoft Teams', group: 'Chat with ScanGym', type: 'url', href: '/api/channels/msteams/install', needsEnv: ['TEAMS_APP_ID'] },
  { id: 'ch-googlechat', card: 'Scangym is now in Google chat clickable button', label: 'Google Chat', group: 'Chat with ScanGym', type: 'url', href: '/channels?c=googlechat', needsEnv: ['GOOGLE_CHAT_PROJECT_NUMBER'] },
  { id: 'ch-whatsapp', card: 'Scangym is now in WhatsApp clickable button', label: 'WhatsApp', group: 'Chat with ScanGym', type: 'url', href: '/api/channels/whatsapp/number', needsEnv: ['TWILIO_WHATSAPP_NUMBER'] },
  { id: 'ch-sms', card: 'Scangym is now in SMS clickable button', label: 'SMS', group: 'Chat with ScanGym', type: 'url', href: '/api/channels/sms/number', needsEnv: ['TWILIO_PHONE_NUMBER'] },
  { id: 'ch-gmail', card: 'Scangym is now in Gmail clickable button', label: 'Email', group: 'Chat with ScanGym', type: 'url', href: 'mailto:hello@scangym.com', needsEnv: ['EMAIL_FROM'] },
  { id: 'ch-reddit', card: null, extra: true, label: 'Reddit', group: 'Chat with ScanGym', type: 'url', href: 'https://www.reddit.com/user/scangym', needsEnv: ['REDDIT_CLIENT_ID'] },

  // ── AI assistants ───────────────────────────────────────────────────────
  { id: 'ai-claude', card: 'Scangym is now in Claude clickable button', label: 'Claude', group: 'AI assistants', type: 'route', href: '/claude' },
  { id: 'ai-chatgpt-plugin', card: 'Scangym is now in chatgpt plugin clickable button', label: 'ChatGPT app', group: 'AI assistants', type: 'url', needsUrl: 'chatgptPlugin', soon: 'Waiting on OpenAI app review.' },
  { id: 'ai-chatgpt-gpt', card: 'Scangym is now in chatgpt custom gpt clickable button', label: 'ChatGPT custom GPT', group: 'AI assistants', type: 'url', needsUrl: 'chatgptGpt', soon: 'Custom GPT not published yet.' },
  { id: 'ai-gemini', card: 'Scangym is now in Gemini clickable button', label: 'Gemini', group: 'AI assistants', type: 'url', needsUrl: 'gemini', soon: 'Gemini extension not published yet.' },
  { id: 'ai-kimi', card: 'Scangym is now in Kimi clickable button', label: 'Kimi', group: 'AI assistants', type: 'url', needsUrl: 'kimi', soon: 'Coming soon.' },
  { id: 'ai-grok', card: 'Scangym is now in Grok clickable button', label: 'Grok', group: 'AI assistants', type: 'url', needsUrl: 'grok', soon: 'Coming soon.' },
  { id: 'ai-bing', card: 'Scangym is now in bing clickable button', label: 'Bing / Copilot', group: 'AI assistants', type: 'url', needsUrl: 'bing', soon: 'Coming soon.' },

  // ── Get the app ─────────────────────────────────────────────────────────
  { id: 'app-install', card: null, extra: true, label: 'Install ScanGym', group: 'Get the app', type: 'action', href: 'install' },
  { id: 'app-msstore', card: 'Scangym is now in Microsoft app store clickable button', label: 'Microsoft Store', group: 'Get the app', type: 'url', needsUrl: 'msStore' },
  { id: 'app-google', card: 'Scangym is now in Google app store clickable button', label: 'Google Play', group: 'Get the app', type: 'url', needsUrl: 'googlePlay', soon: 'In closed testing — public listing soon.' },
  { id: 'app-apple', card: 'Scangym is now in Apple app store clickable button', label: 'App Store', group: 'Get the app', type: 'url', needsUrl: 'appleStore', soon: 'iOS listing in review.' },
  { id: 'app-galaxy', card: 'Scangym is now in galaxy app store clickable button', label: 'Galaxy Store', group: 'Get the app', type: 'url', needsUrl: 'galaxyStore', soon: 'Coming soon.' },
  { id: 'app-meta', card: 'Scangym is now in meta app store clickable button', label: 'Meta Store', group: 'Get the app', type: 'url', needsUrl: 'metaStore', soon: 'Coming soon.' },

  // ── Follow ScanGym ──────────────────────────────────────────────────────
  { id: 'soc-tiktok', card: 'Scangym is now in tiktok clickable button', label: 'TikTok', group: 'Follow ScanGym', type: 'url', needsUrl: 'tiktok' },
  { id: 'soc-instagram', card: 'Scangym is now in Instagram clickable button', label: 'Instagram', group: 'Follow ScanGym', type: 'url', needsUrl: 'instagram' },
  { id: 'soc-facebook', card: 'Scangym is now in Facebook clickable button', label: 'Facebook', group: 'Follow ScanGym', type: 'url', needsUrl: 'facebook' },
  { id: 'soc-youtube', card: 'Scangym is now in YouTube clickable button', label: 'YouTube', group: 'Follow ScanGym', type: 'url', needsUrl: 'youtube', soon: 'Channel launching soon.' },
  { id: 'soc-twitter', card: 'Scangym is now in twitter clickable button', label: 'X', group: 'Follow ScanGym', type: 'url', needsUrl: 'twitter', soon: 'Handle being recovered.' },
  { id: 'soc-linkedin', card: 'Scangym is now in linkedin clickable button', label: 'LinkedIn', group: 'Follow ScanGym', type: 'url', needsUrl: 'linkedin', soon: 'Company page coming soon.' },
  { id: 'soc-snapchat', card: 'Scangym is now in Snapchat clickable button', label: 'Snapchat', group: 'Follow ScanGym', type: 'url', needsUrl: 'snapchat', soon: 'Coming soon.' },

  // ── Create (ScanSquad studio) ───────────────────────────────────────────
  { id: 'create-text', card: 'Create text clickable button', label: 'Create text', group: 'Create', type: 'route', href: '/scansquad?create=text', needsEnv: ['GROQ_API_KEY', 'OPENAI_API_KEY'], anyEnv: true },
  { id: 'create-image', card: 'Create image clickable button', label: 'Create image', group: 'Create', type: 'route', href: '/scansquad?create=image', needsEnv: ['CLOUDFLARE_AI_TOKEN', 'HF_API_KEY', 'HUGGINGFACE_API_KEY'], anyEnv: true },
  { id: 'create-audio', card: 'Create audio clickable button', label: 'Create audio', group: 'Create', type: 'route', href: '/scansquad?create=audio', needsEnv: ['AZURE_SPEECH_KEY', 'GROQ_API_KEY'], anyEnv: true },
  { id: 'create-video', card: 'Create video clickable button', label: 'Create video', group: 'Create', type: 'route', href: '/scansquad?create=video', needsEnv: ['GEMINI_API_KEY'] },
  { id: 'create-editing', card: 'Create editing clickable button', label: 'Edit video', group: 'Create', type: 'route', href: '/scansquad?create=edit' },
  { id: 'create-music', card: 'Create music clickable button', label: 'Create music', group: 'Create', type: 'route', href: '/scansquad?create=music', needsEnv: ['SUNO_API_KEY'], soon: 'Music generation is being wired up.' },
  { id: 'create-twin', card: 'Create twin clickable button', label: 'Create your twin', group: 'Create', type: 'route', href: '/scansquad?create=twin', needsEnv: ['HEYGEN_API_KEY'], soon: 'Avatar twins are being wired up.' },

  // ── AI tools inside ScanGym ─────────────────────────────────────────────
  { id: 'tool-elevenlabs', card: 'Elevenlabs AI is now in Scangym clickable button', label: 'ElevenLabs voice', group: 'AI tools inside ScanGym', type: 'route', href: '/scansquad?tool=elevenlabs', needsEnv: ['ELEVENLABS_API_KEY'], soon: 'Being connected.' },
  { id: 'tool-suno', card: 'Suno AI is now in Scangym clickable button', label: 'Suno music', group: 'AI tools inside ScanGym', type: 'route', href: '/scansquad?tool=suno', needsEnv: ['SUNO_API_KEY'], soon: 'Being connected.' },
  { id: 'tool-heygen', card: 'Heygen AI is now in Scangym clickable button', label: 'HeyGen avatars', group: 'AI tools inside ScanGym', type: 'route', href: '/scansquad?tool=heygen', needsEnv: ['HEYGEN_API_KEY'], soon: 'Being connected.' },
  { id: 'tool-runway', card: 'Runway mL AI is now in Scangym clickable button', label: 'Runway video', group: 'AI tools inside ScanGym', type: 'route', href: '/scansquad?tool=runway', needsEnv: ['RUNWAY_API_KEY'], soon: 'Being connected.' },
  { id: 'tool-kling', card: 'klingAI is now in Scangym clickable button', label: 'Kling video', group: 'AI tools inside ScanGym', type: 'route', href: '/scansquad?tool=kling', needsEnv: ['KLING_API_KEY'], soon: 'Being connected.' },
  { id: 'tool-lovable', card: 'Lovable AI i is now in Scangym clickable button', label: 'Lovable', group: 'AI tools inside ScanGym', type: 'url', needsUrl: 'lovable', soon: 'Coming soon.' },
  { id: 'tool-replit', card: 'Replit AI is now in Scangym clickable button', label: 'Replit', group: 'AI tools inside ScanGym', type: 'url', needsUrl: 'replit', soon: 'Coming soon.' },
  { id: 'tool-base44', card: 'Base44 AI  is now in Scangym clickable button', label: 'Base44', group: 'AI tools inside ScanGym', type: 'url', needsUrl: 'base44', soon: 'Coming soon.' },

  // ── Wearables ───────────────────────────────────────────────────────────
  { id: 'wear-watch', card: 'Scangym is now in smart watch clickable button', label: 'Smart watch', group: 'Wearables', type: 'url', needsUrl: 'watch', soon: 'Watch app in development.' },
  { id: 'wear-glasses', card: 'Scangym is now in smart glasses clickable button', label: 'Smart glasses', group: 'Wearables', type: 'url', needsUrl: 'glasses', soon: 'In development.' },
  { id: 'wear-rings', card: 'Scangym is now in smart rings clickable button', label: 'Smart rings', group: 'Wearables', type: 'url', needsUrl: 'rings', soon: 'In development.' },
  { id: 'wear-airpods', card: 'Scangym is now in smart airpods clickable button', label: 'AirPods (voice)', group: 'Wearables', type: 'action', href: 'talk', note: 'Works today: open Talk with AirPods connected.' },

  // ── Advertise with ScanGym (partner-facing) ─────────────────────────────
  { id: 'ads-google', card: 'Google ads clickable button', label: 'Google Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=google', needsEnv: ['ADS_GOOGLE_CUSTOMER_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-meta', card: 'Meta ads clickable button', label: 'Meta Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=meta', needsEnv: ['ADS_META_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-bing', card: 'Bing ads clickable button', label: 'Microsoft Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=bing', needsEnv: ['ADS_BING_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-tiktok', card: 'Tiktok ads clickable button', label: 'TikTok Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=tiktok', needsEnv: ['ADS_TIKTOK_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-twitter', card: 'Twitter ads clickable button', label: 'X Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=x', needsEnv: ['ADS_X_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-spotify', card: 'Spotify ads clickable button', label: 'Spotify Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=spotify', needsEnv: ['ADS_SPOTIFY_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-reddit', card: 'Reddit ads clickable button', label: 'Reddit Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=reddit', needsEnv: ['ADS_REDDIT_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-linkedin', card: 'Linkedin ads clickable button', label: 'LinkedIn Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=linkedin', needsEnv: ['ADS_LINKEDIN_ACCOUNT_ID'], soon: 'Ad account being connected.' },
  { id: 'ads-chatgpt', card: 'Chatgpt ads clickable button', label: 'ChatGPT Ads', group: 'Advertise', type: 'route', href: '/partner?panel=ads&net=chatgpt', needsEnv: ['ADS_CHATGPT_ACCOUNT_ID'], soon: 'Not yet offered by OpenAI.' },
  // Board note, not a button: "LET'S MAKE CODE MORE BETTER AROUND THIS LIKE
  // SNAPCHAT" — a styling instruction for the Snapchat-ish rail, recorded here
  // so the board reconciles 1:1 with the catalog and nothing looks forgotten.
  { id: 'note-snapchat-style', card: "LET'S MAKE CODE MORE BETTER AROUND THIS LIKE SNAPCHAT", label: null, group: null, type: 'note' },
];

/** Does this entry have everything it needs, in this environment? */
function stateOf(entry, env = process.env) {
  if (entry.needsUrl) {
    const url = LISTINGS[entry.needsUrl];
    if (!url) return { ready: false, href: null };
    return { ready: true, href: url };
  }
  if (entry.needsEnv && entry.needsEnv.length) {
    const present = entry.needsEnv.filter((k) => !!(env[k] && String(env[k]).trim()));
    const ok = entry.anyEnv ? present.length > 0 : present.length === entry.needsEnv.length;
    if (!ok) return { ready: false, href: null };
  }
  return { ready: true, href: entry.href || null };
}

/**
 * The catalog, resolved against the current environment.
 * `ready: false` entries are still returned — the hub shows them as "Coming
 * soon" so a customer can see the whole surface — but never with a live href.
 */
function resolve(env = process.env) {
  return catalog.filter((e) => e.type !== 'note').map((e) => {
    const st = stateOf(e, env);
    return {
      id: e.id,
      label: e.label,
      group: e.group,
      type: e.type,
      href: st.href,
      ready: st.ready,
      note: st.ready ? (e.note || null) : (e.soon || 'Coming soon.'),
    };
  });
}

function groups(env = process.env) {
  const out = [];
  const byName = new Map();
  for (const item of resolve(env)) {
    if (!byName.has(item.group)) {
      const g = { name: item.group, items: [] };
      byName.set(item.group, g);
      out.push(g);
    }
    byName.get(item.group).items.push(item);
  }
  return out;
}

module.exports = { catalog, LISTINGS, resolve, groups, stateOf };
