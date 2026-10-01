'use strict';
/**
 * Task 56 (owner, 2026-10-01): "post it" from any chatbot, the way Viktor
 * posts for the owner: the customer says "post it everywhere" and their latest
 * creation goes to every social account they linked once (Composio / Pipedream,
 * routes/post-everywhere.js). Linked ScanGym customers only, and nothing is
 * posted until they reply YES.
 */
const CONNECT_URL = 'https://www.scangym.com/post-everywhere/';
const YES = /^\s*(yes|y|yeah|yep|ok|okay|go|confirm|post|post it|do it|sure)\b/i;
const NO = /^\s*(no|n|nope|cancel|stop|don'?t)\b/i;
const NETS = 'instagram|insta|facebook|fb|youtube|pinterest|linkedin|twitter|x|socials?|social media|everywhere|all (my )?(accounts|socials|platforms)';

/** "post it", "post this everywhere", "publish to instagram", "share it on my socials". */
function detectPost(text) {
  const t = String(text || '').toLowerCase().trim();
  if (t.length > 160) return false;
  if (/^(post|publish)\b( (it|this|that|my (last|latest) (one|image|video|creation|post)))?( (to|on) .*)?[.! ]*$/.test(t)) return true;
  if (/\b(post|publish|share)\b/.test(t) && new RegExp('\\b(' + NETS + ')\\b').test(t) && !/\b(gym|booking|code|link to (a|the) gym)\b/.test(t)) return true;
  return false;
}

function deps0(deps) {
  return {
    library: deps.libraryFor || ((uid, o) => require('../lib/gen-jobs').libraryFor(uid, o)),
    pe: deps.postEverywhere || require('../routes/post-everywhere'),
  };
}

/** Latest finished creation with a public URL. */
async function latest(userId, d) {
  const lib = await d.library(userId, { limit: 10 });
  return ((lib && lib.items) || []).find(i => i.url && /^https?:\/\//.test(i.url) && !i.error && (!i.status || /^(done|completed|succeeded|complete)$/i.test(i.status))) || null;
}

function payloadFor(item) {
  const kind = item.kind || 'image';
  const text = (String(item.prompt || '').slice(0, 220) + '\n\nMade with ScanGym 💪 scangym.com').trim();
  if (kind === 'video') return { text, mediaUrl: item.url, mediaType: 'video', link: '' };
  if (kind === 'image') return { text, mediaUrl: item.url, mediaType: 'image', link: '' };
  return { text, mediaUrl: '', mediaType: 'image', link: item.url }; // voiceover / music: post the link
}

/** Step 1: work out what would be posted where, and ask. */
async function askPost(session, userId, deps = {}) {
  const d = deps0(deps);
  if (d.pe.isConfigured && !d.pe.isConfigured()) return { text: '📣 Posting to socials is not switched on yet. Please try again later.' };
  const item = await latest(userId, d);
  if (!item) return { text: '🎨 Nothing to post yet. Create something first, e.g. "make an image of a gym at sunrise", then say "post it".' };
  const accounts = await d.pe.myAccounts(userId);
  if (!accounts.length) {
    return { text: `🔗 Link your social accounts once (Instagram, Facebook, YouTube, Pinterest, LinkedIn, X):\n${CONNECT_URL}\n\nSign in with the same ScanGym account, tap each network, then come back and say "post it".` };
  }
  const names = [...new Set(accounts.map(a => (d.pe.APPS[a.slug] || {}).name || a.slug))];
  session.pendingPost = { item: { kind: item.kind, url: item.url, prompt: item.prompt }, at: Date.now() };
  return {
    text: `🚀 Post your latest ${item.kind || 'creation'} to ${names.join(', ')}?\n\n${item.url}\n\nReply YES to post, or NO to cancel.`,
    data: { options: [{ label: '🚀 Yes, post it', value: 'yes' }, { label: '✋ No', value: 'no' }] },
  };
}

/** Step 2: the YES / NO answer. Returns null when the message is not an answer. */
async function answerPost(session, userId, text, deps = {}) {
  const pp = session.pendingPost;
  if (!pp) return null;
  session.pendingPost = null;
  if (Date.now() - pp.at > 10 * 60 * 1000) return null;
  if (NO.test(text)) return { text: '👍 Not posted.' };
  if (!YES.test(text)) return null;
  const d = deps0(deps);
  const out = await d.pe.postEverywhere(userId, payloadFor(pp.item));
  if (out.error) return { text: `😕 ${out.error}\n${CONNECT_URL}` };
  const lines = out.results.map(r => `${r.status === 'posted' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'} ${r.appName}${r.note ? ' (' + r.note + ')' : ''}`);
  return { text: `📣 Posted to ${out.posted} of ${out.results.length}:\n${lines.join('\n')}` };
}

module.exports = { detectPost, askPost, answerPost, payloadFor, CONNECT_URL };
