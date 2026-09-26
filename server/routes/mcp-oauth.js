'use strict';
/**
 * "Sign in with ScanGym" for ChatGPT and Claude (OAuth 2.1 + PKCE + dynamic
 * client registration, as both apps require for MCP connectors).
 *
 * Owner request 2026-09-26: ChatGPT and Claude must share the same memory and
 * library as every other chatbot. They can only do that if they know which
 * ScanGym account is talking, so the signed-in connector lives at
 *   /mcp/account   (the open /mcp connector is unchanged and needs no sign-in)
 *
 * Sign-in is the same 6-digit email code the chatbots use (email-login-code.js),
 * on server-rendered pages with no JavaScript. Only existing accounts can sign in.
 *
 * Stateless: client ids, auth codes and tokens are HMAC-signed with a key derived
 * from SESSION_SECRET, so nothing new is stored and restarts don't log anyone out.
 */
const express = require('express');
const crypto = require('crypto');
const emailLogin = require('../lib/email-login-code');

const router = express.Router();
const BASE = () => (process.env.PUBLIC_BASE_URL && /^https:/.test(process.env.PUBLIC_BASE_URL)
  ? process.env.PUBLIC_BASE_URL : 'https://www.scangym.com').replace(/\/$/, '');
const ISSUER = () => `${BASE()}/oauth`;
const RESOURCE = () => `${BASE()}/mcp/account`;
const RESOURCE_METADATA = () => `${BASE()}/.well-known/oauth-protected-resource/mcp/account`;

const ACCESS_TTL = 30 * 24 * 3600;
const REFRESH_TTL = 180 * 24 * 3600;
const CODE_TTL = 5 * 60;

function key() {
  const s = process.env.SESSION_SECRET || process.env.MCP_OAUTH_SECRET;
  if (!s) throw new Error('SESSION_SECRET missing');
  return crypto.createHash('sha256').update('scangym-mcp-oauth:' + s).digest();
}
const b64 = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(crypto.createHmac('sha256', key()).update(body).digest())}`;
}
function verify(token, typ) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', key()).update(body).digest();
    const got = Buffer.from(sig, 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.typ !== typ) return null;
    if (p.exp && p.exp < Math.floor(Date.now() / 1000)) return null;
    return p;
  } catch (_) { return null; }
}
const now = () => Math.floor(Date.now() / 1000);

/** Bearer token → { userId, email, firstName, client } or null. */
function userFromAuthHeader(header) {
  const m = String(header || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const p = verify(m[1].trim(), 'at');
  return p ? { userId: String(p.sub), email: p.em || null, firstName: p.fn || null, client: p.cn || null } : null;
}

function okRedirect(uri) {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    return u.protocol === 'https:' || (u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname));
  } catch (_) { return false; }
}

// ─── Discovery ───────────────────────────────────────────────
function prm(req, res) {
  res.json({
    resource: RESOURCE(),
    authorization_servers: [ISSUER()],
    bearer_methods_supported: ['header'],
    scopes_supported: ['account'],
    resource_name: 'ScanGym (your account)',
  });
}
function asMeta(req, res) {
  res.json({
    issuer: ISSUER(),
    authorization_endpoint: `${ISSUER()}/authorize`,
    token_endpoint: `${ISSUER()}/token`,
    registration_endpoint: `${ISSUER()}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['account'],
  });
}
router.get(['/.well-known/oauth-protected-resource/mcp/account', '/mcp/account/.well-known/oauth-protected-resource'], prm);
router.get([
  '/.well-known/oauth-authorization-server/oauth', '/.well-known/openid-configuration/oauth',
  '/oauth/.well-known/oauth-authorization-server', '/oauth/.well-known/openid-configuration',
], asMeta);

// ─── Dynamic client registration (RFC 7591) ──────────────────
router.post('/oauth/register', express.json({ limit: '32kb' }), (req, res) => {
  const b = req.body || {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(okRedirect)) {
    return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'https redirect_uris required' });
  }
  const name = String(b.client_name || 'AI assistant').slice(0, 60);
  const clientId = sign({ typ: 'cl', r: uris, n: name, iat: now() });
  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: now(),
    client_name: name,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  });
});

// ─── Sign-in pages ───────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function page(res, { title, body, status = 200 }) {
  res.status(status).set('Cache-Control', 'no-store').type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ScanGym</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0f14;color:#f2f4f7;display:flex;min-height:100vh;align-items:center;justify-content:center}
.c{width:100%;max-width:380px;padding:28px 22px}h1{font-size:22px;margin:0 0 8px}p{color:#a8b0bd;line-height:1.45;font-size:15px}
input{width:100%;box-sizing:border-box;padding:14px;border-radius:12px;border:1px solid #2a3340;background:#121821;color:#fff;font-size:17px;margin:10px 0}
button{width:100%;padding:14px;border:0;border-radius:12px;background:#22c55e;color:#04120a;font-weight:700;font-size:16px}
.e{color:#f87171}.s{font-size:13px;color:#7b8594}a{color:#86efac}</style></head><body><div class="c">
<h1>🏋️ ${esc(title)}</h1>${body}</div></body></html>`);
}
function hidden(q) {
  return ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] || '')}">`).join('');
}
function checkClient(q) {
  const cl = verify(q.client_id, 'cl');
  if (!cl) return { error: 'Unknown app. Please remove and re-add the ScanGym connector.' };
  if (!q.redirect_uri || !cl.r.includes(q.redirect_uri)) return { error: 'This return address is not registered for this app.' };
  if (!q.code_challenge || (q.code_challenge_method && q.code_challenge_method !== 'S256')) return { error: 'Missing PKCE code challenge.' };
  return { cl };
}
function appName(cl, q) {
  let host = '';
  try { host = new URL(q.redirect_uri).hostname; } catch (_) { /* shown blank */ }
  return `${cl.n}${host ? ` (${host})` : ''}`;
}
function emailForm(res, q, cl, msg = '') {
  page(res, {
    title: 'Sign in with ScanGym',
    body: `<p><b>${esc(appName(cl, q))}</b> wants to use your ScanGym account: your library, memory and creating with your saved card (always after you confirm the price).</p>
${msg ? `<p class="e">${esc(msg)}</p>` : ''}
<form method="post" action="/oauth/authorize">${hidden(q)}<input type="hidden" name="step" value="email">
<input name="email" type="email" autocomplete="email" placeholder="Your ScanGym email" required autofocus>
<button type="submit">Email me a 6-digit code</button></form>
<p class="s">No account yet? <a href="${BASE()}" target="_blank">Create one free at scangym.com</a>, then come back.</p>`,
  });
}
function codeForm(res, q, email, msg = '') {
  page(res, {
    title: 'Enter your code',
    body: `<p>We emailed a 6-digit code to <b>${esc(email)}</b> (check spam).</p>${msg ? `<p class="e">${esc(msg)}</p>` : ''}
<form method="post" action="/oauth/authorize">${hidden(q)}<input type="hidden" name="step" value="code"><input type="hidden" name="email" value="${esc(email)}">
<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,8}" placeholder="123456" required autofocus>
<button type="submit">Sign in</button></form>`,
  });
}

router.get('/oauth/authorize', (req, res) => {
  const q = req.query || {};
  if (q.response_type && q.response_type !== 'code') return page(res, { title: 'Sign-in problem', body: '<p class="e">Unsupported response type.</p>', status: 400 });
  const c = checkClient(q);
  if (c.error) return page(res, { title: 'Sign-in problem', body: `<p class="e">${esc(c.error)}</p>`, status: 400 });
  emailForm(res, q, c.cl);
});

const sends = new Map(); // email → [timestamps]
function db() { return require('../middleware/db'); }

router.post('/oauth/authorize', express.urlencoded({ extended: false, limit: '16kb' }), async (req, res) => {
  const q = req.body || {};
  const c = checkClient(q);
  if (c.error) return page(res, { title: 'Sign-in problem', body: `<p class="e">${esc(c.error)}</p>`, status: 400 });
  const email = String(q.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return emailForm(res, q, c.cl, 'Please type a valid email.');
  let user;
  try {
    const { rows } = await db().query('SELECT id, email, first_name FROM public.users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    user = rows[0];
  } catch (e) {
    console.error('[MCP-OAuth] user lookup failed:', e.message);
    return emailForm(res, q, c.cl, 'Something went wrong. Please try again in a minute.');
  }
  if (!user) return emailForm(res, q, c.cl, `There's no ScanGym account for ${email} yet. Create one free at scangym.com first.`);

  if (q.step === 'email') {
    const t = Date.now();
    const list = (sends.get(email) || []).filter((x) => t - x < 3600 * 1000);
    if (list.length >= 5) return emailForm(res, q, c.cl, 'Too many codes this hour. Please check your inbox or try later.');
    const sent = await emailLogin.issueCode({ email });
    if (!sent.ok) return emailForm(res, q, c.cl, 'We could not send the code just now. Please try again.');
    list.push(t); sends.set(email, list);
    return codeForm(res, q, email);
  }

  const checked = emailLogin.checkCode({ email, code: q.code });
  if (!checked.ok) {
    if (/expired|not sent|have not sent/i.test(checked.message || '')) return emailForm(res, q, c.cl, 'That code expired. Type your email for a new one.');
    return codeForm(res, q, email, 'That code was not right. Please try again.');
  }
  const code = sign({
    typ: 'ac', sub: String(user.id), em: user.email, fn: user.first_name || null, cn: c.cl.n,
    cid: crypto.createHash('sha256').update(q.client_id).digest('base64url'),
    ru: q.redirect_uri, cc: q.code_challenge, exp: now() + CODE_TTL, j: crypto.randomUUID(),
  });
  console.log(`[MCP-OAuth] signed in user=${user.id} app=${c.cl.n}`);
  const u = new URL(q.redirect_uri);
  u.searchParams.set('code', code);
  if (q.state) u.searchParams.set('state', q.state);
  u.searchParams.set('iss', ISSUER());
  res.redirect(302, u.toString());
});

// ─── Token endpoint ──────────────────────────────────────────
const usedCodes = new Map(); // jti → exp (single use within this instance)
function tokens(p) {
  const base = { sub: p.sub, em: p.em, fn: p.fn, cn: p.cn, cid: p.cid };
  return {
    access_token: sign({ typ: 'at', ...base, aud: RESOURCE(), exp: now() + ACCESS_TTL }),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    refresh_token: sign({ typ: 'rt', ...base, exp: now() + REFRESH_TTL, j: crypto.randomUUID() }),
    scope: 'account',
  };
}
function tokenError(res, error, desc, status = 400) {
  res.status(status).set('Cache-Control', 'no-store').json({ error, error_description: desc });
}
router.post('/oauth/token', express.urlencoded({ extended: false, limit: '32kb' }), express.json({ limit: '32kb' }), (req, res) => {
  const b = req.body || {};
  let clientId = b.client_id;
  const basic = String(req.headers.authorization || '').match(/^Basic\s+(.+)$/i);
  if (!clientId && basic) clientId = decodeURIComponent(Buffer.from(basic[1], 'base64').toString().split(':')[0]);
  if (!verify(clientId, 'cl')) return tokenError(res, 'invalid_client', 'unknown client', 401);
  const cid = crypto.createHash('sha256').update(String(clientId)).digest('base64url');

  if (b.grant_type === 'authorization_code') {
    const p = verify(b.code, 'ac');
    if (!p || p.cid !== cid) return tokenError(res, 'invalid_grant', 'bad or expired code');
    if (b.redirect_uri && b.redirect_uri !== p.ru) return tokenError(res, 'invalid_grant', 'redirect_uri mismatch');
    const challenge = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
    if (!b.code_verifier || challenge !== p.cc) return tokenError(res, 'invalid_grant', 'PKCE check failed');
    if (usedCodes.has(p.j)) return tokenError(res, 'invalid_grant', 'code already used');
    for (const [j, exp] of usedCodes) if (exp < now()) usedCodes.delete(j);
    usedCodes.set(p.j, p.exp);
    return res.set('Cache-Control', 'no-store').json(tokens(p));
  }
  if (b.grant_type === 'refresh_token') {
    const p = verify(b.refresh_token, 'rt');
    if (!p || p.cid !== cid) return tokenError(res, 'invalid_grant', 'bad or expired refresh token');
    return res.set('Cache-Control', 'no-store').json(tokens(p));
  }
  return tokenError(res, 'unsupported_grant_type', 'use authorization_code or refresh_token');
});

module.exports = router;
module.exports.userFromAuthHeader = userFromAuthHeader;
module.exports.RESOURCE_METADATA = RESOURCE_METADATA;
module.exports._internals = { sign, verify, okRedirect };
