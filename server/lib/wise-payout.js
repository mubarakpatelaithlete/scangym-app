/**
 * Automatic UK bank payouts through the Wise Business API (Task 26, owner
 * picked Wise 2026-09-30). Flow: quote -> recipient -> transfer -> fund from
 * the Wise GBP balance. UK/EEA profiles need Strong Customer Authentication on
 * funding: Wise answers 403 with an x-2fa-approval one-time token, which we sign
 * with our RSA private key (public key uploaded in Wise settings) and retry.
 *
 * Config: WISE_API_TOKEN / WISE_PROFILE_ID / WISE_PRIVATE_KEY env vars, or the
 * app_secrets row name='wise' ({token, profileId, privateKey}).
 */
const crypto = require('node:crypto');
const pool = require('../middleware/db');

const API = 'https://api.wise.com';

async function config(db = pool) {
  let token = process.env.WISE_API_TOKEN;
  let profileId = process.env.WISE_PROFILE_ID;
  let privateKey = process.env.WISE_PRIVATE_KEY;
  if (!token) {
    try {
      const r = await db.query("SELECT value FROM app_secrets WHERE name = 'wise'");
      const v = r.rows[0] && r.rows[0].value;
      if (v) { token = v.token; profileId = profileId || v.profileId; privateKey = privateKey || v.privateKey; }
    } catch (_) { /* table missing = not configured */ }
  }
  return token && profileId ? { token, profileId: String(profileId), privateKey: privateKey || null } : null;
}

async function call(cfg, method, path, body) {
  const headers = { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' };
  const opts = { method, headers, body: body ? JSON.stringify(body) : undefined };
  let r = await fetch(API + path, opts);
  const ott = r.headers.get('x-2fa-approval');
  if (r.status === 403 && ott && cfg.privateKey) {
    const signature = crypto.sign('sha256', Buffer.from(ott), cfg.privateKey).toString('base64');
    r = await fetch(API + path, { ...opts, headers: { ...headers, 'x-2fa-approval': ott, 'X-Signature': signature } });
  }
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (_) { json = { raw: text }; }
  if (!r.ok) {
    const e = new Error(`Wise ${method} ${path} ${r.status}: ${text.slice(0, 200)}`);
    e.status = r.status; throw e;
  }
  return json;
}

/** Stable UUID per payout request, so a retry never creates a second transfer. */
function uuidFor(key) {
  const h = crypto.createHash('sha256').update(`scangym-payout-${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function isUkBank(d) {
  return !!(d && d.accountName && /^\d{6}$/.test(String(d.sortCode || '')) && /^\d{8}$/.test(String(d.accountNumber || '')));
}

/** Sends amountPence to a UK bank. Returns { transferId, status }. Throws on failure. */
async function payUkBank({ amountPence, bank, requestKey, reference = 'ScanGym payout' }, db = pool) {
  const cfg = await config(db);
  if (!cfg) throw new Error('Wise is not configured');
  if (!isUkBank(bank)) throw new Error('Not a UK sort code / account number');
  const pid = cfg.profileId;
  const quote = await call(cfg, 'POST', `/v3/profiles/${pid}/quotes`, {
    sourceCurrency: 'GBP', targetCurrency: 'GBP', targetAmount: amountPence / 100, payOut: 'BANK_TRANSFER',
  });
  const acct = await call(cfg, 'POST', '/v1/accounts', {
    currency: 'GBP', type: 'sort_code', profile: Number(pid), accountHolderName: bank.accountName,
    legalType: 'PRIVATE', details: { sortCode: bank.sortCode, accountNumber: bank.accountNumber },
  });
  const transfer = await call(cfg, 'POST', '/v1/transfers', {
    targetAccount: acct.id, quoteUuid: quote.id, customerTransactionId: uuidFor(requestKey),
    details: { reference: String(reference).slice(0, 18) },
  });
  const pay = await call(cfg, 'POST', `/v3/profiles/${pid}/transfers/${transfer.id}/payments`, { type: 'BALANCE' });
  return { transferId: transfer.id, status: pay.status || 'COMPLETED' };
}

module.exports = { config, payUkBank, isUkBank, uuidFor };
