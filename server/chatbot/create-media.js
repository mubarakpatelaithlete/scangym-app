'use strict';
/**
 * "Make me an image / video / voiceover / song" from any chatbot.
 *
 * Every chatbot (Telegram, WhatsApp, Discord, Instagram, Messenger, TikTok,
 * SMS, Gmail, web chat) and the ChatGPT/Claude MCP server can hand a customer
 * straight into ScanSquad Create with the mode picked and the idea typed in.
 *
 * Why a link and not the file in the chat: generation is paid (postpaid, saved
 * card, per-creator limits — lib/gen-billing.js) and chat users are anonymous.
 * Charging whoever typed an email address would let anyone spend anyone's card.
 * So it works like booking: the chat collects the intent, the site is where the
 * customer signs in, sees the exact price and confirms. Same models, same
 * prices, same daily limits and prompt screening as the ScanSquad tab, because
 * it IS the ScanSquad tab.
 */

const BASE = 'https://www.scangym.com';
const MAX_PROMPT = 600; // squad-create.js openFromUrl trims to 600 as well

const KINDS = {
  image: { label: 'image', icon: '🖼️' },
  video: { label: 'video', icon: '🎬' },
  audio: { label: 'voiceover', icon: '🎙️' },
  music: { label: 'music track', icon: '🎵' },
};

/* Word → mode. Order matters: "music video" is a video, "song" is music. */
const KIND_WORDS = [
  ['video', /\b(video|videos|clip|reel|reels|animation|movie)\b/],
  ['music', /\b(music|song|songs|beat|beats|tune|jingle|soundtrack)\b/],
  ['audio', /\b(audio|voice ?over|voiceover|voice|narration|speech|podcast)\b/],
  ['image', /\b(image|images|picture|pictures|pic|pics|photo|photos|poster|drawing|illustration|logo|art|artwork|thumbnail|graphic)\b/],
];

const VERB = /\b(create|make|generate|draw|design|produce|compose|render)\b/;

/**
 * @returns {{kind: 'image'|'video'|'audio'|'music', prompt: string}|null}
 */
function detectCreate(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!VERB.test(lower)) return null;
  const hit = KIND_WORDS.find(([, re]) => re.test(lower));
  if (!hit) return null;
  const kind = hit[0];
  // Booking talk ("make a booking", "create account") never reaches here: it
  // has no media word. "Book a gym video" is still a video request.
  return { kind, prompt: raw.slice(0, MAX_PROMPT) };
}

function createLink(kind, prompt, base) {
  const root = String(base || BASE).replace(/\/+$/, '');
  const k = KINDS[kind] ? kind : 'video';
  const p = String(prompt || '').slice(0, MAX_PROMPT);
  return `${root}/creator?mode=${encodeURIComponent(k)}&prompt=${encodeURIComponent(p)}`;
}

function createReply(kind, prompt, base) {
  const k = KINDS[kind] ? kind : 'video';
  const { label, icon } = KINDS[k];
  const link = createLink(k, prompt, base);
  return {
    text: `${icon} Let's make your ${label}!\n\n` +
      `Tap to open ScanSquad Create with your idea already typed in:\n${link}\n\n` +
      `Sign in, check the price shown and tap Create. It's charged to your saved card, the same as in the app. ` +
      `Your ${label} appears there and stays in your ScanSquad library.\n\n` +
      `💡 Also try: "make an image of…", "make a video of…", "make a voiceover saying…", "make a song about…"`,
    data: { create: { kind: k, prompt: String(prompt || '').slice(0, MAX_PROMPT), link } },
  };
}

module.exports = { detectCreate, createLink, createReply, KINDS };
