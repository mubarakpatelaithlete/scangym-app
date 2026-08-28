/**
 * Email login codes — the half of voice sign-in that Twilio would not deliver.
 *
 * voice-login.js offers two fully spoken ways in: a text to your phone, or a code
 * to your email. Asked to log a customer in by email, production answered "that
 * address did not work" every time. The address was fine. Twilio Verify replied
 * `60223 Delivery channel disabled: EMAIL` — the email channel was never turned on
 * for the account, so the email door has been shut since the day it was written.
 *
 * Rather than depend on a Twilio console setting nobody can see from the code, we
 * send the code ourselves through SendGrid, which this app already uses for booking
 * confirmations and already has a working key for. One less thing that can be
 * silently switched off somewhere else.
 *
 * What is deliberately careful here:
 *   - the code is stored as a SHA-256 hash, never in plain text
 *   - it expires in 10 minutes and is destroyed the moment it is used
 *   - 5 wrong guesses burn it, so a six-digit code cannot be brute-forced
 *   - comparison is constant-time
 *   - a send failure returns ok:false and logs nobody in. It never fails open.
 *
 * Codes live in memory, so a deploy mid-login costs the customer one "send it
 * again". That is the right trade for a secret that is worthless in ten minutes,
 * and it keeps this off the database path entirely.
 */
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SWEEP_EVERY = 200;

const codes = new Map();
let sinceSweep = 0;

const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

function key(email) {
  return String(email || '').trim().toLowerCase();
}

function hash(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

/** Six digits from a real random source — Math.random is guessable. */
function newCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function sweep(now) {
  for (const [k, entry] of codes) if (entry.expiresAt <= now) codes.delete(k);
}

function body(code) {
  return {
    text:
      `Your ScanGym code is ${code}\n\n` +
      'It works for the next 10 minutes. If you are talking to the ScanGym assistant, ' +
      'just read the six digits back.\n\n' +
      'If you did not ask to sign in, ignore this — nobody can get in without the code.',
    html:
      '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px">' +
      '<p style="margin:0 0 18px;color:#111">Your ScanGym code is</p>' +
      `<p style="margin:0 0 18px;font-size:34px;letter-spacing:8px;font-weight:700;color:#F97316">${code}</p>` +
      '<p style="margin:0 0 12px;color:#444">It works for the next 10 minutes. If you are talking to the ' +
      'ScanGym assistant, just read the six digits back.</p>' +
      '<p style="margin:0;color:#777;font-size:13px">If you did not ask to sign in, ignore this — nobody ' +
      'can get in without the code.</p></div>',
  };
}

async function sendViaSendGrid(email, code, fetchImpl) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SMTP_FROM || 'book@scangym.com';
  if (!apiKey) return { ok: false, reason: 'no-key' };

  const content = body(code);
  const res = await fetchImpl(SENDGRID_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email }] }],
      from: { email: from, name: 'ScanGym' },
      subject: `${code} is your ScanGym code`,
      content: [
        { type: 'text/plain', value: content.text },
        { type: 'text/html', value: content.html },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await (res.text ? res.text().catch(() => '') : Promise.resolve(''));
    return { ok: false, reason: `sendgrid-${res.status}`, detail: String(detail).slice(0, 200) };
  }
  return { ok: true };
}

/**
 * Issue a code and email it.
 * @returns {{ok: boolean, message: string}} — ok:false means nothing was sent.
 */
async function issueCode({ email, deps = {} } = {}) {
  const to = key(email);
  if (!to) return { ok: false, message: 'I need your email address first.' };

  const now = deps.now || Date.now();
  if (++sinceSweep >= SWEEP_EVERY) { sinceSweep = 0; sweep(now); }

  const code = deps.code || newCode();
  const sent = await sendViaSendGrid(to, code, deps.fetch || fetch);
  if (!sent.ok) {
    console.error('[EmailLogin] send failed:', sent.reason, sent.detail || '');
    return { ok: false, message: 'I could not email you a code just now, so I have not logged you in.' };
  }

  codes.set(to, { hash: hash(code), expiresAt: now + TTL_MS, attempts: 0 });
  return { ok: true, message: `Code sent to ${to}. Read me the six digits when it arrives.` };
}

/**
 * Check a code. Right answers are consumed; wrong ones cost an attempt.
 * @returns {{ok: boolean, message?: string}}
 */
function checkCode({ email, code, deps = {} } = {}) {
  const to = key(email);
  const digits = String(code || '').replace(/\D/g, '');
  const now = deps.now || Date.now();

  const entry = codes.get(to);
  if (!entry) return { ok: false, message: 'I have not sent a code to that address — shall I send one?' };

  if (entry.expiresAt <= now) {
    codes.delete(to);
    return { ok: false, message: 'That code has expired. Shall I send a new one?' };
  }

  if (digits.length !== 6) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) codes.delete(to);
    return { ok: false, message: 'That was not six digits — could you read the whole code?' };
  }

  const given = Buffer.from(hash(digits));
  const want = Buffer.from(entry.hash);
  const match = given.length === want.length && crypto.timingSafeEqual(given, want);

  if (!match) {
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) {
      codes.delete(to);
      return { ok: false, message: 'That code was not right, and it has now expired. Shall I send a new one?' };
    }
    return { ok: false, message: 'That code was not right. Read me the six digits again?' };
  }

  codes.delete(to); // single use
  return { ok: true };
}

/** Tests only — never call from a route. */
function _reset() { codes.clear(); sinceSweep = 0; }

module.exports = { issueCode, checkCode, _reset, TTL_MS, MAX_ATTEMPTS };
