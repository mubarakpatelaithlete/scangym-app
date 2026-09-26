/**
 * SendPulse chatbot bridge (Facebook Messenger / Instagram / TikTok via SendPulse Free).
 * SendPulse bot webhook "incoming_message" → POST /api/chatbot/sendpulse/webhook
 * → shared message-handler → reply via SendPulse API (sendText).
 * Env: SENDPULSE_ID / SENDPULSE_SECRET (or SENDPULSE_API_ID / SENDPULSE_API_SECRET)
 */
const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const API = 'https://api.sendpulse.com';
const SP_ID = () => process.env.SENDPULSE_ID || process.env.SENDPULSE_API_ID;
const SP_SECRET = () => process.env.SENDPULSE_SECRET || process.env.SENDPULSE_API_SECRET;
let token = null, tokenExp = 0;
const recent = [];
function log(e) { recent.unshift({ at: new Date().toISOString(), ...e }); recent.length = Math.min(recent.length, 20); }

async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const r = await fetch(`${API}/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: SP_ID(), client_secret: SP_SECRET() }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('SendPulse token failed: ' + JSON.stringify(j).slice(0, 200));
  token = j.access_token; tokenExp = Date.now() + (j.expires_in - 60) * 1000;
  return token;
}

function chunks(text, max = 1900) {
  const out = []; let t = String(text || '');
  while (t.length > max) { let i = t.lastIndexOf('\n', max); if (i < 200) i = max; out.push(t.slice(0, i)); t = t.slice(i); }
  if (t.trim()) out.push(t);
  return out;
}

async function sendText(service, contactId, text) {
  const tk = await getToken();
  const svc = service === 'instagram' ? 'instagram' : service === 'tiktok' ? 'tiktok' : 'messenger';
  for (const part of chunks(text)) {
    const body = svc === 'messenger'
      ? { contact_id: contactId, message_type: 'RESPONSE', message_tag: 'ACCOUNT_UPDATE', text: part }
      : svc === 'tiktok'
        ? { contact_id: contactId, messages: [{ type: 'text', text: { text: part } }] }
        : { contact_id: contactId, messages: [{ type: 'text', message: { text: part } }] };
    const path = svc === 'messenger' ? '/messenger/contacts/sendText' : `/${svc}/contacts/send`;
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
    const j = await r.text();
    log({ type: 'send', status: r.status, resp: j.slice(0, 300) });
  }
}

/**
 * Did this contact really just send this text? The webhook has no signature, so we
 * ask SendPulse's own API (our token) for the contact's recent messages and look for
 * the same inbound text in the last 10 minutes. Only then may the chat act as a
 * ScanGym account (link in chat, library, create). Fails closed.
 */
async function confirmInbound(service, contactId, text, fetchImpl = fetch) {
  try {
    const svc = service === 'instagram' ? 'instagram' : service === 'tiktok' ? 'tiktok' : 'messenger';
    const tk = await getToken();
    const r = await fetchImpl(`${API}/${svc}/chats/messages?contact_id=${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return false;
    const j = await r.json();
    const want = JSON.stringify(String(text).trim()).slice(1, -1);
    const since = Date.now() - 10 * 60 * 1000;
    return (j.data || []).some((m) => m && m.direction === 1 && String(m.contact_id) === String(contactId)
      && (!m.created_at || Date.parse(m.created_at) >= since)
      && JSON.stringify(m.data || {}).includes(want));
  } catch (e) {
    log({ type: 'verify-error', msg: e.message });
    return false;
  }
}

function pickText(ev) {
  const m = ev?.info?.message || ev?.message || {};
  return m?.channel_data?.message?.text || m?.channel_data?.text || m?.text || ev?.text
    || m?.channel_data?.postback?.title || m?.channel_data?.postback?.payload || '';
}

router.post('/webhook', async (req, res) => {
  res.json({ ok: true });
  const events = Array.isArray(req.body) ? req.body : [req.body];
  for (const ev of events) {
    try {
      const title = ev?.title || ev?.event;
      const service = ev?.service || 'messenger';
      const contactId = ev?.contact?.id || ev?.contact_id;
      const text = pickText(ev);
      log({ type: 'in', title, service, contactId, text: String(text).slice(0, 100), keys: Object.keys(ev || {}) });
      if (!contactId || !text || (title && !/incoming/i.test(title))) continue;
      const verified = await confirmInbound(service, contactId, text);
      log({ type: 'verified', contactId, verified });
      const response = await handleMessage(`${service}:${contactId}`, String(text).trim(), {
        userName: ev?.contact?.name || (service === 'tiktok' ? 'TikTok user' : 'Messenger user'), platform: service,
        verified, // proven via SendPulse API → in-chat link, library, create
        push: (msg) => sendText(service, contactId, msg).catch(() => {}),
      });
      if (response?.text) await sendText(service, contactId, response.text);
    } catch (e) { log({ type: 'error', msg: e.message }); console.error('[sendpulse]', e); }
  }
});

router.get('/debug', (req, res) => res.json({ configured: !!(SP_ID() && SP_SECRET()), recent }));

module.exports = router;
module.exports.confirmInbound = confirmInbound;
