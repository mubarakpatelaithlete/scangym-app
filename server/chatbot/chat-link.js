'use strict';
/**
 * Link a chat to a ScanGym account without leaving the chat.
 *
 * Owner request 2026-09-26: "make it end to end from inside the chatbot, for every
 * chatbot". Before this, an unlinked chat was sent to scangym.com/profile to link.
 *
 * Flow: customer asks to create (or types LINK) → bot asks for their ScanGym email →
 * we email a 6-digit code (email-login-code.js, 10 min, 5 tries) → they type it →
 * user_channels row (same table as Profile → Chatbots) → the waiting creation is
 * priced and they reply YES.
 *
 * Safe because only the owner of the mailbox sees the code, and only chats whose
 * sender the platform proves (meta.verified) may start this — otherwise someone
 * could link a chat id they don't own. Only existing accounts are linked.
 */

const emailLogin = require('../lib/email-login-code');
const { _linkCache, PLATFORM_LABEL } = require('./customer-memory');

const EMAIL_RE = /[^@\s<>()]+@[^@\s<>()]+\.[^@\s<>()]+/;
const LINK_ASK = /^\s*(link|connect)(\s+(my\s+)?(account|scangym|telegram|whatsapp|sms|discord|slack|messenger|instagram|chat))?\s*[.!]?\s*$/i;
const CANCEL = /^\s*(cancel|stop|no|nevermind|never mind|quit|exit)\s*[.!]?\s*$/i;
const TTL_MS = 15 * 60 * 1000;
const MAX_SENDS_PER_HOUR = 3;

const CHANNEL_OF = {
  telegram: 'telegram', whatsapp: 'whatsapp', sms: 'sms', discord: 'discord', slack: 'slack',
  googlechat: 'googlechat', instagram: 'instagram', messenger: 'messenger', facebook: 'messenger',
};

function db(deps) { return (deps && deps.pool) || require('../middleware/db'); }

function parseChat(chatId) {
  const m = String(chatId || '').match(/^([a-z]+):(.+)$/i);
  if (!m) return null;
  const channel = CHANNEL_OF[m[1].toLowerCase()];
  return channel ? { channel, id: m[2], platform: m[1].toLowerCase() } : null;
}

/** Can this chat link itself in-chat? */
function canLink(chatId, meta = {}) {
  return !!meta.verified && !!parseChat(chatId);
}

function mask(email) {
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

/** Begin: remember what they wanted and ask for their email. */
function start(session, { create = null } = {}) {
  session.pendingLink = { stage: 'email', create, at: Date.now() };
  const what = create ? 'make it right here in the chat' : 'link this chat';
  return `🔗 To ${what}, I just need your ScanGym account email.\n\n` +
    `✉️ Type your email and I'll send you a 6-digit code.\n(Type CANCEL to stop.)`;
}

function wantsLink(text) { return LINK_ASK.test(String(text || '')); }

/**
 * Handle a reply while a link is in progress.
 * @returns {null | {text: string, linked?: {userId, email, firstName}, create?: object}}
 *   null = not our message (flow expired), caller carries on normally.
 */
async function handle(session, chatId, text, deps = {}) {
  const pl = session.pendingLink;
  if (!pl) return null;
  if (Date.now() - pl.at > TTL_MS) { session.pendingLink = null; return null; }
  const t = String(text || '').trim();
  if (CANCEL.test(t)) { session.pendingLink = null; return { text: '👍 Cancelled — nothing was linked or charged.' }; }
  const codeSvc = deps.emailLogin || emailLogin;

  const emailMatch = t.match(EMAIL_RE);
  if (emailMatch) {
    const email = emailMatch[0].toLowerCase();
    const now = Date.now();
    session.linkSends = (session.linkSends || []).filter((x) => now - x < 60 * 60 * 1000);
    if (session.linkSends.length >= MAX_SENDS_PER_HOUR) {
      return { text: '⏳ I have sent 3 codes this hour. Please check your inbox (and spam) or try again later.' };
    }
    const sent = await codeSvc.issueCode({ email, deps });
    if (!sent.ok) return { text: '😕 I could not send the code just now. Please check the email and try again.' };
    session.linkSends.push(now);
    session.pendingLink = { ...pl, stage: 'code', email, at: now };
    return { text: `📩 Code sent to ${mask(email)}.\n\nType the 6 digits here (check spam if it's not there in a minute).` };
  }

  if (pl.stage === 'code' && /^\D*(\d\D*){6}$/.test(t) && t.replace(/\D/g, '').length === 6) {
    const checked = codeSvc.checkCode({ email: pl.email, code: t, deps });
    if (!checked.ok) {
      const gone = /expired|not sent/i.test(checked.message || '');
      if (gone) session.pendingLink = { ...pl, stage: 'email', at: Date.now() };
      return { text: gone ? '⌛ That code expired. Type your email again for a new one.' : '❌ That code was not right. Please type the 6 digits again.' };
    }
    const p = parseChat(chatId);
    let user;
    try {
      const { rows } = await db(deps).query(
        'SELECT id, email, first_name FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1', [pl.email]);
      user = rows[0];
      if (!user) {
        session.pendingLink = null;
        return { text: `🙋 There's no ScanGym account for ${pl.email} yet.\n\nCreate one free at https://www.scangym.com (1 minute), then type LINK here.` };
      }
      await db(deps).query(
        `INSERT INTO user_channels (user_id, channel, channel_user_id, channel_username, metadata, is_active, connected_at)
         VALUES ($1, $2, $3, NULL, $4, true, NOW())
         ON CONFLICT (user_id, channel)
         DO UPDATE SET channel_user_id = $3, metadata = $4, is_active = true, connected_at = NOW()`,
        [String(user.id), p.channel, p.id, JSON.stringify({ linkedIn: 'chat', at: new Date().toISOString() })]);
    } catch (e) {
      console.error('[ChatLink] link failed:', e.message);
      return { text: '😕 Something went wrong linking your account. Please try again in a minute.' };
    }
    _linkCache.delete(chatId);
    session.pendingLink = null;
    const name = PLATFORM_LABEL[p.platform] || 'This chat';
    const hi = user.first_name ? `, ${user.first_name}` : '';
    return {
      text: `✅ Linked${hi}! ${name} is now connected to your ScanGym account — your library and memory are shared with every chatbot.`,
      linked: { userId: String(user.id), email: user.email, firstName: user.first_name || null },
      create: pl.create || null,
    };
  }

  // Anything else: nudge, keep the flow alive.
  return { text: pl.stage === 'code'
    ? '🔢 Please type the 6-digit code from your email (or your email again for a new code, or CANCEL).'
    : '✉️ Please type your ScanGym account email (or CANCEL).' };
}

module.exports = { canLink, start, handle, wantsLink, parseChat, mask };
