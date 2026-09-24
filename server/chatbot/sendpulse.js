/**
 * SendPulse chatbot bridge (Facebook Messenger / Instagram via SendPulse Free).
 * SendPulse bot webhook "incoming_message" → POST /api/chatbot/sendpulse/webhook
 * → shared message-handler → reply via SendPulse API (sendText).
 * Env: SENDPULSE_ID, SENDPULSE_SECRET
 */
const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const API = 'https://api.sendpulse.com';
let token = null, tokenExp = 0;
const recent = [];
function log(e) { recent.unshift({ at: new Date().toISOString(), ...e }); recent.length = Math.min(recent.length, 20); }

async function getToken() {
  if (token && Date.now() < tokenExp) return token;
  const r = await fetch(`${API}/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.SENDPULSE_ID, client_secret: process.env.SENDPULSE_SECRET }),
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
  const svc = service === 'instagram' ? 'instagram' : 'messenger';
  for (const part of chunks(text)) {
    const body = svc === 'messenger'
      ? { contact_id: contactId, message_type: 'RESPONSE', message_tag: 'ACCOUNT_UPDATE', text: part }
      : { contact_id: contactId, messages: [{ type: 'text', message: { text: part } }] };
    const path = svc === 'messenger' ? '/messenger/contacts/sendText' : '/instagram/contacts/send';
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify(body) });
    const j = await r.text();
    log({ type: 'send', status: r.status, resp: j.slice(0, 300) });
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
      const response = await handleMessage(`${service}:${contactId}`, String(text).trim(), {
        userName: ev?.contact?.name || 'Messenger user', platform: service,
      });
      if (response?.text) await sendText(service, contactId, response.text);
    } catch (e) { log({ type: 'error', msg: e.message }); console.error('[sendpulse]', e); }
  }
});

router.get('/debug', (req, res) => res.json({ configured: !!(process.env.SENDPULSE_ID && process.env.SENDPULSE_SECRET), recent }));

module.exports = router;
