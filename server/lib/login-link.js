/**
 * Sign-in links — the way in that needs nothing said out loud.
 *
 * The voice assistant can already log someone in: Twilio texts six digits and the
 * customer reads them back (voice-login.js / email-login-code.js). That works, and
 * it is the only spoken step left in the whole funnel — the product vision is "you
 * just say it and it happens", and "now read me six digits" is the opposite of that.
 * It is also the step people fail: digits misheard, code expired, "sorry, again?".
 *
 * So: we text or email a link. One tap, no digits, no password, no forms.
 *
 * What is deliberately careful here:
 *   - the token is 32 random bytes from crypto, URL-safe — not guessable
 *   - only its SHA-256 hash is stored, so a database dump cannot be replayed
 *   - single use, enforced by `UPDATE ... WHERE used_at IS NULL RETURNING`, which
 *     is atomic: two simultaneous taps produce exactly one login
 *   - 15 minutes to live, so a link sitting in an inbox stops working
 *   - a send failure logs nobody in and issues no usable link. Never fails open
 *   - redeeming is a POST from a page the human loaded, never the GET in the
 *     message: mail scanners and link previewers fetch URLs, and a GET login
 *     would let them burn (or worse, use) the link before the customer taps it
 *   - the token is never logged, and never put in a redirect the browser keeps
 *
 * Session handling is identical to routes/auth.js — same public.users lookup, same
 * req.session.userId — so a link login and a typed login are the same session.
 */
const crypto = require('crypto');

const TTL_MS = 15 * 60 * 1000;
const TOKEN_BYTES = 32;
const SWEEP_EVERY = 50;
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

let sinceSweep = 0;

/** UK-friendly normalisation, same rule as routes/auth.js and voice-login.js. */
function normalisePhone(phone) {
  const raw = String(phone || '').replace(/[\s()-]/g, '');
  return raw.startsWith('+') ? raw : `+44${raw.replace(/^0/, '')}`;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** What a token looks like coming back from the outside world. */
const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

/** @returns {{channel:'sms'|'email', value:string}|null} */
function classify(contact) {
  const value = String(contact || '').trim();
  if (!value) return null;
  if (value.includes('@')) {
    const email = value.toLowerCase();
    return EMAIL_RE.test(email) ? { channel: 'email', value: email } : null;
  }
  const digits = value.replace(/[^0-9+]/g, '');
  if (digits.replace(/\D/g, '').length < 7) return null;
  return { channel: 'sms', value: normalisePhone(digits) };
}

function newToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function linkUrl(origin, token) {
  const base = String(origin || 'https://scangym.com').replace(/\/+$/, '');
  return `${base}/login/link?t=${token}`;
}

/* ── delivery ─────────────────────────────────────────────────────────────── */

async function sendEmail(to, url, fetchImpl) {
  const apiKey = process.env.SENDGRID_API_KEY;
  // SMTP_FROM holds a display-name address; SendGrid's JSON API needs the bare one.
  const from = require('./mail-from').mailFrom();
  if (!apiKey) return { ok: false, reason: 'no-sendgrid-key' };

  const text =
    'Tap to sign in to ScanGym:\n\n' + url + '\n\n' +
    'The link works once, for the next 15 minutes.\n\n' +
    'If you did not ask to sign in, ignore this — nobody can get in without tapping it.';
  const html =
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:420px">' +
    '<p style="margin:0 0 20px;color:#111;font-size:16px">Tap to sign in to ScanGym.</p>' +
    `<p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:#FF6D00;color:#fff;` +
    'text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;font-size:16px">Sign me in</a></p>' +
    '<p style="margin:0 0 12px;color:#444">The link works once, for the next 15 minutes.</p>' +
    '<p style="margin:0;color:#777;font-size:13px">If you did not ask to sign in, ignore this — nobody can ' +
    'get in without tapping it.</p></div>';

  const res = await fetchImpl(SENDGRID_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from.email, name: from.name },
      subject: 'Tap to sign in to ScanGym',
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });
  if (!res.ok) return { ok: false, reason: `sendgrid-${res.status}` };
  return { ok: true };
}

async function sendSms(to, url, fetchImpl) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_PHONE;
  if (!sid || !token || !from) return { ok: false, reason: 'no-twilio-sms' };

  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: to,
      From: from,
      Body: `Tap to sign in to ScanGym: ${url}\nWorks once, for 15 minutes. Not you? Ignore this.`,
    }).toString(),
  });
  if (!res.ok) return { ok: false, reason: `twilio-${res.status}` };
  return { ok: true };
}

/* ── issue ────────────────────────────────────────────────────────────────── */

/**
 * Create a single-use link and send it.
 * @returns {{ok:boolean, channel?:string, to?:string, message:string}}
 */
async function issueLink({ contact, origin, ip, deps = {} } = {}) {
  const pool = deps.pool || require('../middleware/db');
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || Date.now();

  const who = classify(contact);
  if (!who) {
    return { ok: false, message: 'I need a mobile number or an email address to send the link to.' };
  }

  const token = deps.token || newToken();
  const url = linkUrl(origin, token);

  // Send first. If delivery fails there must be no usable link left behind.
  const sent = who.channel === 'email'
    ? await sendEmail(who.value, url, fetchImpl)
    : await sendSms(who.value, url, fetchImpl);
  if (!sent.ok) {
    console.error('[LoginLink] send failed:', sent.reason);
    return {
      ok: false,
      message: who.channel === 'email'
        ? 'I could not email you a link just now, so I have not signed you in.'
        : 'I could not text you a link just now, so I have not signed you in.',
    };
  }

  try {
    await pool.query(
      `INSERT INTO login_links (token_hash, contact, channel, created_ip, expires_at)
       VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000.0))`,
      [hashToken(token), who.value, who.channel, ip || null, now + TTL_MS]
    );
  } catch (err) {
    console.error('[LoginLink] could not store link:', err.message);
    return { ok: false, message: 'Something went wrong on my side, so I have not signed you in.' };
  }

  if (++sinceSweep >= SWEEP_EVERY) {
    sinceSweep = 0;
    pool.query("DELETE FROM login_links WHERE created_at < NOW() - INTERVAL '1 day'").catch(() => {});
  }

  return {
    ok: true,
    channel: who.channel,
    to: who.value,
    message: who.channel === 'email'
      ? `Link sent to ${who.value}. Tap it and I will carry straight on — nothing to read out.`
      : `Link texted to ${who.value}. Tap it and I will carry straight on — nothing to read out.`,
  };
}

/* ── redeem ───────────────────────────────────────────────────────────────── */

/**
 * Spend a link and log the person in. Never called from a GET — see the header.
 * @returns {{ok:boolean, user?:object, message:string}}
 */
async function redeemLink({ token, session, deps = {} } = {}) {
  const pool = deps.pool || require('../middleware/db');
  const now = deps.now || Date.now();

  if (!TOKEN_RE.test(String(token || ''))) {
    return { ok: false, message: 'That sign-in link is not valid. Ask me for a new one.' };
  }

  // Atomic spend: the row is claimed and returned in one statement, so a link
  // tapped twice (or previewed and tapped) can only log in once.
  let claimed;
  try {
    claimed = await pool.query(
      `UPDATE login_links
          SET used_at = NOW()
        WHERE token_hash = $1
          AND used_at IS NULL
          AND expires_at > to_timestamp($2 / 1000.0)
      RETURNING contact, channel`,
      [hashToken(token), now]
    );
  } catch (err) {
    console.error('[LoginLink] redeem failed:', err.message);
    return { ok: false, message: 'Something went wrong on my side. Ask me for a new link.' };
  }

  if (!claimed.rows || claimed.rows.length === 0) {
    return { ok: false, message: 'That link has already been used or has expired. Ask me for a new one.' };
  }

  const { contact, channel } = claimed.rows[0];
  const column = channel === 'email' ? 'email' : 'phone_number';

  let found;
  try {
    found = await pool.query(`SELECT * FROM public.users WHERE ${column} = $1`, [contact]);
    if (!found.rows.length) {
      found = await pool.query(
        `INSERT INTO public.users (id, ${column}, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, NOW(), NOW()) RETURNING *`,
        [contact]
      );
    } else {
      await pool.query(`UPDATE public.users SET updated_at = NOW() WHERE ${column} = $1`, [contact]);
    }
  } catch (err) {
    console.error('[LoginLink] user lookup failed:', err.message);
    return { ok: false, message: 'Something went wrong on my side. Ask me for a new link.' };
  }

  const u = found.rows[0];
  if (session) {
    session.userId = u.id;
    if (u.phone_number) session.phone = u.phone_number;
  }

  return {
    ok: true,
    user: {
      id: u.id,
      phone: u.phone_number || null,
      email: u.email || null,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ') || null,
    },
    message: 'You are in.',
  };
}

module.exports = { issueLink, redeemLink, classify, normalisePhone, TOKEN_RE, TTL_MS };
