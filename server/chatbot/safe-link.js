/**
 * safe-link.js — chat-safe links for created media.
 *
 * fal file URLs often contain "_" (e.g. …/Hk1bqEzuhFVS_U7iEyYo_-Yk29CDDN.jpg).
 * Telegram/Slack/WhatsApp/Discord/Teams treat "_" / "*" / "~" as formatting,
 * strip them and the link 404s ("Specified object does not exist").
 * We hand chats a link made only of letters/digits instead:
 *   https://www.scangym.com/api/chatbot/m/v3b/<hex of path>  → 302 → fal file
 * Only *.fal.media / fal.run storage hosts are allowed (no open redirect).
 */
const BASE = (process.env.BASE_URL || 'https://www.scangym.com').replace(/\/+$/, '');
const FAL_HOST_RE = /^([a-z0-9-]+)\.fal\.media$/i;
const UNSAFE_RE = /[_*~`\[\]()<>|\\]/;

function safeLink(url) {
  if (!url || typeof url !== 'string') return url;
  let u;
  try { u = new URL(url); } catch (_) { return url; }
  if (!UNSAFE_RE.test(url)) return url;
  const m = u.hostname.match(FAL_HOST_RE);
  if (u.protocol !== 'https:' || !m) return url;
  const hex = Buffer.from(u.pathname.replace(/^\/+/, '') + u.search, 'utf8').toString('hex');
  return `${BASE}/api/chatbot/m/${m[1].toLowerCase()}/${hex}`;
}

function resolve(sub, hex) {
  if (!/^[a-z0-9-]{1,40}$/i.test(sub || '') || !/^(?:[0-9a-f]{2}){1,1000}$/i.test(hex || '')) return null;
  const path = Buffer.from(hex, 'hex').toString('utf8');
  if (/^\/|\.\.|\\|@/.test(path) || /[\r\n]/.test(path)) return null;
  return `https://${sub.toLowerCase()}.fal.media/${path}`;
}

function redirectHandler(req, res) {
  const target = resolve(req.params.sub, req.params.hex);
  if (!target) return res.status(404).send('Not found');
  res.set('Cache-Control', 'public, max-age=86400');
  return res.redirect(302, target);
}

module.exports = { safeLink, resolve, redirectHandler };
