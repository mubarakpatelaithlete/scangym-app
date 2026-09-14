/**
 * Screen tools — the buttons that move the screen, made sayable.
 *
 * Buttons v1.0 batch 1 (docs/BUTTONS-V1.md): the six tab buttons and Share. None of
 * them reads or writes data; they change what the customer is looking at. So a screen
 * tool does not *do* the thing on the server — it returns a `ui` instruction, the
 * agent route forwards it on the `tool` SSE event, and chat-agent.js performs it in
 * the tab (SGScreen.perform). The model only ever sees the spoken confirmation.
 *
 * Two rules:
 * 1. The `ui` object is a closed vocabulary (action + a few validated fields). The
 *    tab performs exactly those actions and nothing else, so a model cannot be talked
 *    into calling arbitrary functions on the page.
 * 2. Nothing here trusts the model with identity. share_my_link resolves the caller's
 *    own referral handle from their user row, the same way squad-tools does.
 *
 * Shared by every agent (Book, ScanSquad, Partner) so "go to the Book tab" works from
 * any tab — the tools are spread into each catalogue.
 */

const pool = require('../middleware/db');

/** Tab names the app bundle's switchTab() understands, plus what people call them. */
const TABS = ['reels', 'book', 'music', 'photos', 'chat', 'trainer', 'creator', 'partner', 'more'];
const TAB_ALIASES = {
  home: 'reels', videos: 'reels', feed: 'reels',
  map: 'book', maps: 'book', explore: 'book', gyms: 'book', search: 'book',
  playlist: 'music', playlists: 'music',
  gallery: 'photos', pictures: 'photos',
  messages: 'chat', inbox: 'chat',
  coach: 'trainer', 'ai-trainer': 'trainer', 'ai trainer': 'trainer', ai: 'trainer',
  scansquad: 'creator', squad: 'creator', creators: 'creator',
  partners: 'partner', gym: 'partner', owner: 'partner',
  profile: 'more', account: 'more', settings: 'more', me: 'more', wallet: 'more',
};
const TAB_LABEL = {
  reels: 'Reels', book: 'Book', music: 'Music', photos: 'Photos', chat: 'Chat',
  trainer: 'AI Trainer', creator: 'ScanSquad', partner: 'Partner', more: 'Profile',
};

function normaliseTab(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (TABS.includes(t)) return t;
  return TAB_ALIASES[t] || null;
}

const HANDLE_RE = /^[a-z0-9_.-]{2,40}$/i;

/** The caller's own referral handle. Never from the request. */
async function resolveHandle(userId) {
  if (!userId) return null;
  const { rows } = await pool
    .query('SELECT referral_handle FROM public.users WHERE id = $1', [userId])
    .catch(() => ({ rows: [] }));
  const handle = rows[0]?.referral_handle;
  return handle && HANDLE_RE.test(handle) ? handle : null;
}

const tools = {
  go_to_tab: {
    write: false,
    schema: {
      name: 'go_to_tab',
      description:
        'Move the customer to another tab of the app when they ask to go, open, show or switch to it: ' +
        'Reels (home videos), Book (map / find gyms), Music, Photos, Chat, AI Trainer, ScanSquad (creators), Partner (gym owners), Profile (account, wallet, pass). ' +
        'The screen changes for them — do not describe where the button is.',
      parameters: {
        type: 'object',
        properties: {
          tab: {
            type: 'string',
            enum: TABS,
            description: 'Destination tab. Map/explore → book; ScanSquad → creator; profile/account/wallet → more.',
          },
        },
        required: ['tab'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const tab = normaliseTab(args.tab);
      if (!tab) {
        return { ok: false, message: `I don't have a tab called "${String(args.tab || '').slice(0, 30)}". I can open Reels, Book, Music, Photos, Chat, AI Trainer, ScanSquad, Partner or Profile.` };
      }
      return { ok: true, tab, ui: { action: 'go_to_tab', tab }, message: `Opening ${TAB_LABEL[tab]}.` };
    },
  },

  share_my_link: {
    write: false,
    schema: {
      name: 'share_my_link',
      description:
        "Share the customer's own ScanGym referral link when they say share, send my link, invite a friend or copy my link. " +
        'Opens the phone share sheet (or copies the link). They earn commission on bookings made through it.',
      parameters: {
        type: 'object',
        properties: {
          via: {
            type: 'string',
            enum: ['share', 'whatsapp', 'twitter', 'copy'],
            description: 'How they want to share. Default share = the phone share sheet.',
          },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const handle = await resolveHandle(userId);
      if (!handle) {
        return { ok: false, needsHandle: true, message: "You don't have a referral handle yet, so there's no link to share. Set one with set_my_handle, or join ScanSquad first." };
      }
      const via = ['share', 'whatsapp', 'twitter', 'copy'].includes(args.via) ? args.via : 'share';
      const url = `https://scangym.com/r/${handle}`;
      return {
        ok: true,
        url,
        ui: { action: 'share', url, via },
        message: via === 'copy' ? 'Copied your link.' : 'Opening share for your link.',
      };
    },
  },
};

/** Screen tools anyone may call without an account (share needs a user row). */
const PUBLIC_SCREEN_TOOLS = new Set(['go_to_tab']);

module.exports = { tools, PUBLIC_SCREEN_TOOLS, normaliseTab, TABS, resolveHandle };
