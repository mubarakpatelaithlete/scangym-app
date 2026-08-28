/**
 * One place that sends a transactional email, whoever the supplier is this week.
 *
 * Why this exists: on 28 Aug 2026 Twilio SendGrid refused to activate the account
 * (ticket #29229316 — "unable to proceed with activating your account", no specifics
 * given). Every SendGrid call had been answering 401, so sign-in emails, and the
 * email login code before them, failed silently while the code looked correct. The
 * lesson is not "pick a better supplier", it is that the supplier is a variable and
 * the product should not have to be edited when it changes.
 *
 * So: providers are tried in order of what is configured, and the caller writes one
 * email, once.
 *
 *   1. RESEND_API_KEY      → Resend HTTP API      (signs up with email only, no phone)
 *   2. SENDGRID_API_KEY    → SendGrid HTTP API    (kept: the variable may come back)
 *   3. SMTP_HOST/USER/PASS → any SMTP host        (Postmark, SES, Mailgun, Brevo…)
 *
 * Honest failure is the point. If nothing is configured, or every provider rejects
 * the send, this returns ok:false with a reason, and the caller tells the customer
 * nothing was sent. It must never claim to have emailed someone it did not email.
 *
 * The sender address comes from mail-from.js: the HTTP APIs need the bare address,
 * SMTP is happy with the display-name form.
 */
const { mailFrom } = require('./mail-from');

const RESEND_URL = 'https://api.resend.com/emails';
const SENDGRID_URL = 'https://api.sendgrid.com/v3/mail/send';

function providersConfigured(env = process.env) {
  const list = [];
  if (env.RESEND_API_KEY) list.push('resend');
  if (env.SENDGRID_API_KEY) list.push('sendgrid');
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) list.push('smtp');
  return list;
}

async function viaResend({ to, subject, text, html, from, env, fetchImpl }) {
  const res = await fetchImpl(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${from.name} <${from.email}>`, // Resend takes the header form
      to: [to],
      subject,
      text,
      html,
    }),
  });
  if (!res.ok) return { ok: false, reason: `resend-${res.status}` };
  return { ok: true, provider: 'resend' };
}

async function viaSendgrid({ to, subject, text, html, from, env, fetchImpl }) {
  const res = await fetchImpl(SENDGRID_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from.email, name: from.name }, // bare address, or 400
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html },
      ],
    }),
  });
  if (!res.ok) return { ok: false, reason: `sendgrid-${res.status}` };
  return { ok: true, provider: 'sendgrid' };
}

async function viaSmtp({ to, subject, text, html, from, env, transportFactory }) {
  const nodemailer = transportFactory ? null : require('nodemailer');
  const transport = transportFactory
    ? transportFactory()
    : nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: parseInt(env.SMTP_PORT || '587', 10),
        secure: String(env.SMTP_SECURE || '') === 'true',
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      });
  await transport.sendMail({
    from: `${from.name} <${from.email}>`,
    to,
    subject,
    text,
    html,
  });
  return { ok: true, provider: 'smtp' };
}

/**
 * Send one transactional email through whichever provider is configured.
 * @returns {Promise<{ok:boolean, provider?:string, reason?:string, tried?:string[]}>}
 */
async function sendMail({ to, subject, text, html, deps = {} } = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetch || fetch;
  const from = mailFrom(env.SMTP_FROM);
  const address = String(to || '').trim();

  if (!address) return { ok: false, reason: 'no-recipient' };
  const order = providersConfigured(env);
  if (!order.length) return { ok: false, reason: 'no-email-provider' };

  const tried = [];
  for (const provider of order) {
    tried.push(provider);
    try {
      const args = { to: address, subject, text, html, from, env, fetchImpl, transportFactory: deps.transportFactory };
      const out =
        provider === 'resend' ? await viaResend(args)
        : provider === 'sendgrid' ? await viaSendgrid(args)
        : await viaSmtp(args);
      if (out.ok) return { ...out, tried };
      console.error('[MailSend]', out.reason);
    } catch (err) {
      console.error(`[MailSend] ${provider} threw:`, err.message);
    }
  }
  return { ok: false, reason: `all-providers-failed:${tried.join(',')}`, tried };
}

module.exports = { sendMail, providersConfigured };
