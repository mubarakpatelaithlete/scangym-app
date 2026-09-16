/**
 * "Your clip is ready" — because a 4-minute render on a phone is not something
 * anyone watches.
 *
 * Measured on production: Seedance 2.5 takes 226s, WAN 3.0 215s, Kling 3.0 Pro
 * 166s (lib/gen-eta.js). The sheet polled with a spinner and no way to leave,
 * so the likely outcome of pressing Generate on a good clip was: creator
 * switches app, render finishes into a page nobody is looking at, we pay for it
 * anyway. Every abandoned render is money we spent on nothing.
 *
 * So a slow job emails the creator a link when it lands. Only slow ones — an
 * email about a caption that took 1.4 seconds is spam — and only successes,
 * because the useful failure message is on screen where they can retry, and a
 * "your generation failed" email is a support ticket, not a service.
 *
 * Best effort by design: a mail provider being down must never mark a finished
 * render unfinished. Everything is wrapped and logged.
 *
 * @see lib/mail-send.js  provider fan-out (Zoho, then whatever else is keyed)
 */

const pool = require('../middleware/db');
const eta = require('./gen-eta');

const SITE = process.env.PUBLIC_SITE_URL || 'https://www.scangym.com';

const NOUN = {
  video: 'clip',
  image: 'image',
  music: 'track',
  audio: 'voiceover',
  text: 'caption',
};

/**
 * Tell the creator their generation finished, if it is worth telling them.
 *
 * @param job {{id, user_id, kind, model, prompt, video_url, created_at, completed_at}}
 * @param deps injectable for tests: { sendMail, lookupEmail }
 * @returns {{sent:boolean, reason?:string}}
 */
async function notifyReady(job, deps = {}) {
  try {
    if (!job || !job.video_url) return { sent: false, reason: 'nothing_to_send' };
    const seconds = elapsedSeconds(job);
    if (!eta.worthNotifying(seconds)) return { sent: false, reason: 'too_quick' };

    const lookupEmail = deps.lookupEmail || emailFor;
    const email = await lookupEmail(job.user_id);
    if (!email) return { sent: false, reason: 'no_email' };

    const noun = NOUN[job.kind] || 'creation';
    const url = absolute(job.video_url);
    const brief = (job.prompt || '').trim().slice(0, 120);
    const sendMail = deps.sendMail || require('./mail-send').sendMail;

    await sendMail({
      to: email,
      subject: `Your ScanGym ${noun} is ready`,
      text: [
        `Your ${noun} finished rendering (${Math.round(seconds)}s).`,
        brief ? `\nWhat you asked for: ${brief}` : '',
        `\nWatch or download it: ${url}`,
        `\nIt is also saved in My Creations on your ScanSquad tab: ${SITE}/creator`,
        '\n— ScanGym',
      ].join('\n'),
    });
    console.log(`[SquadNotify] told ${job.user_id} their ${job.kind} ${job.id} is ready`);
    return { sent: true };
  } catch (e) {
    console.error('[SquadNotify] could not notify:', e.message);
    return { sent: false, reason: 'error' };
  }
}

function elapsedSeconds(job) {
  const start = job.created_at ? new Date(job.created_at).getTime() : null;
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  if (!start) return 0;
  return Math.max(0, (end - start) / 1000);
}

function absolute(url) {
  return String(url).indexOf('http') === 0 ? url : SITE + url;
}

async function emailFor(userId) {
  try {
    const r = await pool.query('SELECT email FROM users WHERE id::text = $1::text LIMIT 1', [String(userId)]);
    return (r.rows[0] && r.rows[0].email) || null;
  } catch (e) {
    console.error('[SquadNotify] email lookup failed:', e.message);
    return null;
  }
}

module.exports = { notifyReady, _internals: { elapsedSeconds, absolute, emailFor, NOUN } };
