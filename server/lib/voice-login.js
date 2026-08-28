/**
 * Voice login — how someone who is not logged in gets logged in without a screen.
 *
 * Three kinds of customer, and only two of them can finish by voice:
 *
 *   phone  → Twilio Verify texts a 6-digit code, they say it back.       (fully spoken)
 *   email  → the same Verify service, email channel, same 6 digits.      (fully spoken)
 *   Google / Apple / SSO → an OAuth redirect owned by Google or Apple.   (one tap, then voice resumes)
 *
 * The hard rule, and the reason this file is small: the agent never asks anyone to say a
 * password or a card number out loud. Spoken audio is transcribed, logged and retained;
 * a one-time code is worthless a minute later, a password is not. If a customer starts
 * reciting a password, the agent stops them and offers a code instead.
 *
 * Session handling is identical to routes/auth.js — the same Twilio Verify service, the
 * same public.users lookup, the same req.session.userId — so a voice login and a typed
 * login produce exactly the same session.
 */
const pool = require('../middleware/db');
const emailLogin = require('./email-login-code');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_VERIFY_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

/** UK-friendly normalisation, same as routes/auth.js. */
function normalisePhone(phone) {
  const raw = String(phone || '').replace(/[\s()-]/g, '');
  return raw.startsWith('+') ? raw : `+44${raw.replace(/^0/, '')}`;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function twilioReady() {
  return !!(TWILIO_SID && TWILIO_TOKEN && TWILIO_VERIFY_SID);
}

async function twilio(path, params, fetchImpl = fetch) {
  const res = await fetchImpl(`https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SID}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

/**
 * Send a one-time code to a phone number or an email address.
 * @returns {{ok: boolean, channel?: 'sms'|'email', to?: string, message: string}}
 */
async function sendCode({ contact, deps = {} } = {}) {
  const value = String(contact || '').trim();
  if (!value) return { ok: false, message: 'I need your mobile number or your email address first.' };

  if (/password/i.test(value)) {
    return { ok: false, message: 'I never take passwords out loud. Give me your mobile or email and I will send you a code.' };
  }

  const isEmail = EMAIL_RE.test(value);
  const to = isEmail ? value.toLowerCase() : normalisePhone(value);
  const channel = isEmail ? 'email' : 'sms';

  /* Email does not go through Twilio. Verify answered every email request with
   * `60223 Delivery channel disabled: EMAIL`, so this door was shut for as long as
   * it has existed. We send it ourselves through SendGrid instead. */
  if (isEmail) {
    const sent = await (deps.emailLogin || emailLogin).issueCode({ email: to, deps });
    return sent.ok ? { ok: true, channel, to, message: sent.message } : { ok: false, message: sent.message };
  }

  if (!twilioReady() && !deps.twilio) {
    return { ok: false, message: 'I cannot send a login code right now, so I have not logged you in.' };
  }

  const call = deps.twilio || twilio;
  const { ok, data } = await call('Verifications', { To: to, Channel: channel });
  if (!ok) {
    console.error('[VoiceLogin] send failed:', data?.message);
    return { ok: false, message: 'That number or address did not work — could you say it again?' };
  }

  return {
    ok: true,
    channel,
    to,
    message: isEmail
      ? `Code sent to ${to}. Read me the six digits when it arrives.`
      : `Code sent to ${to}. Read me the six digits.`,
  };
}

/**
 * Check the spoken code and, if it is right, log the customer in on this session.
 * Digits said aloud arrive in all sorts of shapes ("four two, double one, oh nine"),
 * so anything that is not a digit is stripped before checking.
 */
async function verifyCode({ contact, code, session, deps = {} } = {}) {
  const value = String(contact || '').trim();
  const digits = String(code || '').replace(/\D/g, '');

  if (!value || !digits) return { ok: false, message: 'I need the number I sent the code to, and the six digits.' };
  if (digits.length !== 6) return { ok: false, message: 'That was not six digits — could you read the whole code?' };

  const isEmail = EMAIL_RE.test(value);
  const to = isEmail ? value.toLowerCase() : normalisePhone(value);

  if (isEmail) {
    const checked = (deps.emailLogin || emailLogin).checkCode({ email: to, code: digits, deps });
    if (!checked.ok) return { ok: false, message: checked.message };
  } else {
    const call = deps.twilio || twilio;
    const { ok, data } = await call('VerificationCheck', { To: to, Code: digits });
    if (!ok || data?.status !== 'approved') {
      return { ok: false, message: 'That code was not right, or it has expired. Shall I send a new one?' };
    }
  }

  const db = deps.pool || pool;
  const column = isEmail ? 'email' : 'phone_number';

  let found = await db.query(`SELECT * FROM public.users WHERE ${column} = $1`, [to]);
  if (found.rows.length === 0) {
    found = await db.query(
      `INSERT INTO public.users (id, ${column}, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, NOW(), NOW()) RETURNING *`,
      [to]
    );
  }

  const user = found.rows[0];
  if (session) {
    session.userId = user.id;
    if (!isEmail) session.phone = user.phone_number;
  }

  return {
    ok: true,
    userId: user.id,
    isNew: found.command === 'INSERT',
    message: 'You are logged in. Where would you like to train?',
  };
}

/**
 * Send a tap-to-sign-in link instead of a code.
 *
 * This is the preferred way in now. A code has to be spoken back, and "read me the
 * six digits" is the one moment in the whole product where the customer has to do
 * the app's work for it. A link is one tap, nothing said, nothing misheard. The
 * code flow stays for anyone who cannot or will not open a link.
 */
async function sendLoginLink({ contact, origin, deps = {} } = {}) {
  const value = String(contact || '').trim();
  if (!value) return { ok: false, message: 'I need your mobile number or your email address first.' };
  if (/password/i.test(value)) {
    return { ok: false, message: 'I never take passwords out loud. Give me your mobile or email and I will send you a link to tap.' };
  }
  const { issueLink } = deps.loginLink || require('./login-link');
  return issueLink({ contact: value, origin: origin || process.env.PUBLIC_BASE_URL || 'https://scangym.com', deps });
}

/**
 * What to say when the customer wants Google, Apple or a company SSO login.
 * These are OAuth redirects: nobody can complete them by voice, and asking for a
 * Google password aloud would get the account locked. One tap, then voice resumes.
 */
function handoffFor(provider) {
  const p = String(provider || '').toLowerCase();
  const known = {
    google: { label: 'Continue with Google', url: 'https://scangym.com/login?provider=google' },
    apple: { label: 'Continue with Apple', url: 'https://scangym.com/login?provider=apple' },
    sso: { label: 'your company SSO', url: 'https://scangym.com/login?provider=sso' },
  };
  const choice = known[p];
  if (!choice) return null;

  return {
    ok: true,
    handoff: true,
    provider: p,
    url: choice.url,
    message: `${p === 'sso' ? 'Your company login' : choice.label} needs one tap — I have put the button on your screen. Tap it and I will carry straight on with the booking.`,
  };
}

module.exports = { sendCode, sendLoginLink, verifyCode, handoffFor, normalisePhone };
