/**
 * The email channel reported itself as active while being broken at both ends.
 * Live evidence from the Railway logs on 2026-09-20:
 *
 *   [Email] Send failed: Connection timeout
 *   [404] Unknown API route: GET /api/channels/email/auto-link
 *
 * and the SendGrid API itself answered `401 Maximum credits exceeded`. So a
 * customer could email in and never hear back, and no sender was ever matched
 * to their ScanGym account.
 *
 * Sending now goes over Resend's HTTP API (scangym.com is a verified sending
 * domain there), and the sender lookup is a database query instead of an HTTP
 * call to a route that does not exist.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/chatbot/email.js'), 'utf8');

test('replies go through Resend first', () => {
  const fn = src.slice(src.indexOf('async function sendViaResend'), src.indexOf('async function sendEmailReply'));
  assert.match(fn, /https:\/\/api\.resend\.com\/emails/);
  assert.match(fn, /Bearer \$\{RESEND_API_KEY\}/);
  assert.match(fn, /'In-Reply-To': inReplyTo/, 'threading must survive the switch');
  assert.match(fn, /throw new Error\(`Resend \$\{resp\.status\}/, 'a failed send must be loud, not swallowed');

  const reply = src.slice(src.indexOf('async function sendEmailReply'));
  assert.match(reply, /if \(RESEND_API_KEY\) \{/, 'Resend is tried before the SMTP path');
  assert.ok(
    reply.indexOf('sendViaResend') < reply.indexOf("require('nodemailer')"),
    'SendGrid SMTP stays only as the fallback'
  );
});

test('SendGrid alone is still enough to run, and neither key is fatal only together', () => {
  const reply = src.slice(src.indexOf('async function sendEmailReply'));
  assert.match(reply, /if \(!RESEND_API_KEY && !SENDGRID_API_KEY\)/,
    'the old guard refused to send whenever SENDGRID_API_KEY was missing');
});

test('the sender is matched by a query, not by the 404 route', () => {
  assert.ok(!/fetch\(`\$\{BASE_URL\}\/api\/channels\/email\/auto-link`/.test(src),
    'the call to the dead route must be gone');
  assert.match(src, /SELECT first_name FROM public\.users WHERE lower\(email\) = lower\(\$1\)/);
  assert.match(src, /const pool = require\('\.\.\/middleware\/db'\)/);
});

test('a failed lookup still answers the customer', () => {
  const block = src.slice(src.indexOf('let linkedUserName = senderName;'));
  const guarded = block.slice(0, block.indexOf('handleMessage'));
  assert.match(guarded, /catch \(e\) \{/, 'the query is wrapped, so a DB hiccup cannot drop the email');
});
