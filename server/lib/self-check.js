/**
 * Self-check: notice a dead key before a customer does.
 *
 * Why this exists: on 31 Jul 2026 the OpenAI key on production was revoked. The
 * app kept booting, kept serving pages, and only failed when a human asked the
 * assistant a question — we found out from a screenshot. Keys die silently
 * (revoked, expired, out of quota), so something has to poke them on a timer.
 *
 * What it does: every CHECK_INTERVAL it pokes each configured dependency with
 * the cheapest read that proves the credential works. It remembers the previous
 * verdict and only shouts on a *transition* (ok -> broken, or broken -> ok), so
 * a long outage does not spam. Shouting = console + one email, if an email
 * transport is configured. Nothing here can break a request: every probe is
 * wrapped, failures are recorded, never thrown.
 */

const CHECK_INTERVAL_MS = Number(process.env.SELF_CHECK_INTERVAL_MS || 15 * 60 * 1000);
const FIRST_CHECK_DELAY_MS = Number(process.env.SELF_CHECK_DELAY_MS || 30 * 1000);
const ALERT_TO = process.env.ALERT_EMAIL || 'help1@scangym.org';

let state = { lastRun: null, checks: {} };
let timer = null;

/* ── probes: each returns {ok, detail} and never throws ───────────────────── */

async function probeOpenAI() {
  if (!process.env.OPENAI_API_KEY) return { skipped: true, detail: 'OPENAI_API_KEY not set' };
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10000 });
  await client.models.list();
  return { detail: 'key accepted' };
}

async function probeGroq() {
  if (!process.env.GROQ_API_KEY) return { skipped: true, detail: 'GROQ_API_KEY not set' };
  const OpenAI = require('openai');
  const client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
    timeout: 10000,
  });
  await client.models.list();
  return { detail: 'key accepted' };
}

async function probeStripe() {
  const key = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET;
  if (!key) return { skipped: true, detail: 'STRIPE_SECRET_KEY not set' };
  const stripe = require('stripe')(key, { timeout: 10000 });
  const balance = await stripe.balance.retrieve();
  return { detail: 'key accepted, livemode=' + !!balance.livemode };
}

async function probeDatabase(pool) {
  if (!pool) return { skipped: true, detail: 'no pool' };
  await pool.query('SELECT 1');
  return { detail: 'query ok' };
}

/* ── runner ──────────────────────────────────────────────────────────────── */

/**
 * Act on the verdict, do not just email it.
 *
 * Finding out a key is dead and then letting customers discover it again one at a time is
 * only half a check. lib/llm.js benches a provider for five minutes *after* a live request
 * fails, so a key that stays revoked costs one real customer a slow answer every five
 * minutes. We already know better, here, on a timer, for free — so tell it.
 *
 * Benched until a little past the next probe: if the key is still dead the next run renews
 * it, and if it recovers the same run clears it. The bench never outlives our knowledge.
 */
function applyVerdictToLLM(name, result) {
  if (name !== 'openai' && name !== 'groq') return;
  try {
    const llm = require('./llm');
    if (typeof llm.bench !== 'function') return;
    if (result.status === 'broken') {
      llm.bench(name, CHECK_INTERVAL_MS + 60 * 1000);
    } else if (result.status === 'ok') {
      llm.bench(name, 0);
    }
  } catch (err) {
    // A self-check must never be able to break the thing it is checking.
    console.error('[SelfCheck] could not update provider bench:', err.message);
  }
}

async function runProbe(name, fn, notify) {
  const previous = state.checks[name];
  let result;
  try {
    const out = await fn();
    result = out && out.skipped
      ? { status: 'skipped', detail: out.detail, at: new Date().toISOString() }
      : { status: 'ok', detail: (out && out.detail) || 'ok', at: new Date().toISOString() };
  } catch (err) {
    result = { status: 'broken', detail: (err && err.message) || String(err), at: new Date().toISOString() };
  }
  state.checks[name] = result;
  applyVerdictToLLM(name, result);

  const was = previous && previous.status;
  if (was && was !== result.status && (was === 'ok' || result.status === 'ok')) {
    const line = result.status === 'ok'
      ? `[SelfCheck] RECOVERED: ${name} works again`
      : `[SelfCheck] ALERT: ${name} is ${result.status} — ${result.detail}`;
    (result.status === 'ok' ? console.log : console.error)(line);
    if (notify) await notify(name, result, line);
  } else if (result.status === 'broken' && !was) {
    console.error(`[SelfCheck] ALERT (first run): ${name} is broken — ${result.detail}`);
    if (notify) await notify(name, result, `[SelfCheck] ALERT: ${name} is broken — ${result.detail}`);
  }
  return result;
}

async function sendAlertEmail(name, result, line) {
  if (!process.env.SENDGRID_API_KEY && !process.env.SMTP_HOST) return;
  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport(
      process.env.SENDGRID_API_KEY
        ? { host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } }
        : {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || '587'),
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          }
    );
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'ScanGym <help1@scangym.org>',
      to: ALERT_TO,
      subject: `ScanGym ${result.status === 'ok' ? 'recovered' : 'ALERT'}: ${name}`,
      text: `${line}\n\nChecked at ${result.at}\nHost: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'unknown'}\n`,
    });
  } catch (err) {
    console.error('[SelfCheck] could not send alert email:', err.message);
  }
}

/** Run every probe once. Exported so a test can drive it with fake probes. */
async function runAll({ pool, probes, notify } = {}) {
  const p = probes || {
    openai: probeOpenAI,
    groq: probeGroq,
    stripe: probeStripe,
    database: () => probeDatabase(pool),
  };
  for (const [name, fn] of Object.entries(p)) {
    await runProbe(name, fn, notify === undefined ? sendAlertEmail : notify);
  }
  state.lastRun = new Date().toISOString();
  return snapshot();
}

function snapshot() {
  const checks = state.checks;
  const broken = Object.keys(checks).filter((k) => checks[k].status === 'broken');
  return { lastRun: state.lastRun, healthy: broken.length === 0, broken, checks };
}

function start({ pool } = {}) {
  if (timer) return snapshot();
  setTimeout(() => { runAll({ pool }).catch(() => {}); }, FIRST_CHECK_DELAY_MS).unref?.();
  timer = setInterval(() => { runAll({ pool }).catch(() => {}); }, CHECK_INTERVAL_MS);
  timer.unref?.();
  console.log(`[SelfCheck] watching keys every ${Math.round(CHECK_INTERVAL_MS / 60000)} min; alerts to ${ALERT_TO}`);
  return snapshot();
}

function _resetForTests() { state = { lastRun: null, checks: {} }; if (timer) clearInterval(timer); timer = null; }

module.exports = { start, runAll, snapshot, _resetForTests };
