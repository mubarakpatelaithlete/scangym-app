/**
 * Sign-in links: the way in with nothing said out loud.
 *
 * The only spoken step left in the voice funnel was "read me the six digits".
 * A link replaces it with one tap. A link is also a bearer credential sitting in
 * an inbox, so these tests pin the properties that make it safe, not just the
 * happy path:
 *
 *   - the plaintext token never reaches the database
 *   - single use, even when two taps race
 *   - expiry is enforced in SQL, not in a comment
 *   - a delivery failure leaves no usable link and logs nobody in
 *   - GET /login/link cannot log anyone in (mail scanners fetch URLs)
 *   - a crafted ?t= cannot inject script into the landing page
 *   - the landing page never redirects to a URL taken from the query string
 */
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const link = require('../server/lib/login-link');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PAGE = fs.readFileSync(path.join(ROOT, 'frontend', 'public', 'login-link.html'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations', '0005_login_links.sql'), 'utf8');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

/** A pool that records every query and answers from a script of responses. */
function fakePool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return handler(sql, params, calls.length) || { rows: [], command: 'SELECT' };
    },
  };
}

const okFetch = () => async () => ({ ok: true, status: 202, json: async () => ({}) });

/* ── issuing ─────────────────────────────────────────────────────────────── */

test('a mobile number gets a texted link; only the hash is stored', async () => {
  process.env.TWILIO_ACCOUNT_SID = 'ACtest';
  process.env.TWILIO_AUTH_TOKEN = 'tok';
  process.env.TWILIO_PHONE_NUMBER = '+441234567890';

  let sentBody = '';
  const fetchImpl = async (url, opts) => {
    assert.match(String(url), /api\.twilio\.com/);
    sentBody = String(opts.body);
    return { ok: true, status: 201, json: async () => ({}) };
  };
  const pool = fakePool(() => ({ rows: [], command: 'INSERT' }));
  const token = 'T'.repeat(43);

  const res = await link.issueLink({
    contact: '07700 900123', origin: 'https://scangym.com',
    deps: { pool, fetch: fetchImpl, token, now: 1_700_000_000_000 },
  });

  assert.equal(res.ok, true);
  assert.equal(res.channel, 'sms');
  assert.equal(res.to, '+447700900123', 'UK numbers must normalise the same way as the code flow');
  assert.match(sentBody, /login%2Flink%3Ft%3DT+/, 'the text must carry the tap link');

  const insert = pool.calls.find((c) => /INSERT INTO login_links/.test(c.sql));
  assert.ok(insert, 'the link must be recorded');
  assert.ok(insert.params.includes(sha256(token)), 'the hash must be stored');
  assert.ok(!insert.params.some((p) => String(p).includes(token)), 'the plaintext token must never reach the database');
});

test('an email address gets an emailed link', async () => {
  process.env.SENDGRID_API_KEY = 'SG.test';
  let payload = null;
  const fetchImpl = async (url, opts) => {
    assert.match(String(url), /sendgrid/);
    payload = JSON.parse(opts.body);
    return { ok: true, status: 202, json: async () => ({}) };
  };
  const pool = fakePool(() => ({ rows: [] }));
  const res = await link.issueLink({
    contact: ' Owner@Example.COM ', origin: 'https://scangym.com',
    deps: { pool, fetch: fetchImpl, token: 'E'.repeat(43) },
  });
  assert.equal(res.ok, true);
  assert.equal(res.to, 'owner@example.com', 'the address must be normalised');
  assert.equal(payload.personalizations[0].to[0].email, 'owner@example.com');
  assert.match(payload.content[1].value, /https:\/\/scangym\.com\/login\/link\?t=E+/);
});

test('nonsense contacts are refused before anything is sent', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  let sends = 0;
  const fetchImpl = async () => { sends++; return { ok: true, json: async () => ({}) }; };
  for (const bad of ['', '   ', 'my password', 'not-an-email@', '12345']) {
    const res = await link.issueLink({ contact: bad, deps: { pool, fetch: fetchImpl } });
    assert.equal(res.ok, false, `"${bad}" must be refused`);
  }
  assert.equal(sends, 0, 'nothing may be sent for an unusable contact');
  assert.equal(pool.calls.length, 0, 'and nothing may be stored');
});

test('a delivery failure leaves no usable link and signs nobody in', async () => {
  process.env.SENDGRID_API_KEY = 'SG.test';
  const pool = fakePool(() => ({ rows: [] }));
  const res = await link.issueLink({
    contact: 'owner@example.com',
    deps: { pool, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }), token: 'F'.repeat(43) },
  });
  assert.equal(res.ok, false, 'it must fail closed');
  assert.equal(pool.calls.length, 0, 'a link that was never delivered must not be stored');
});

/* ── redeeming ───────────────────────────────────────────────────────────── */

const USER = { id: 'u-1', phone_number: '+447700900123', email: null, first_name: 'Sam', last_name: null };

test('tapping the link creates the same session a typed login would', async () => {
  const token = 'G'.repeat(43);
  const pool = fakePool((sql) => {
    if (/UPDATE login_links/.test(sql)) return { rows: [{ contact: '+447700900123', channel: 'sms' }] };
    if (/SELECT \* FROM public\.users/.test(sql)) return { rows: [USER] };
    return { rows: [] };
  });
  const session = {};
  const res = await link.redeemLink({ token, session, deps: { pool } });

  assert.equal(res.ok, true);
  assert.equal(session.userId, 'u-1', 'the session must be the ordinary one, keyed on userId');
  assert.equal(session.phone, '+447700900123');

  const spend = pool.calls.find((c) => /UPDATE login_links/.test(c.sql));
  assert.match(spend.sql, /used_at IS NULL/, 'spending must be conditional, so two taps cannot both win');
  assert.match(spend.sql, /expires_at >/, 'expiry must be enforced in the statement, not in the app');
  assert.match(spend.sql, /RETURNING/, 'claim and read must be one atomic statement');
  assert.ok(spend.params.includes(sha256(token)), 'lookup must be by hash');
});

test('a link is single use: the second tap is refused', async () => {
  const token = 'H'.repeat(43);
  let spends = 0;
  const pool = fakePool((sql) => {
    if (/UPDATE login_links/.test(sql)) {
      spends++;
      return { rows: spends === 1 ? [{ contact: 'owner@example.com', channel: 'email' }] : [] };
    }
    if (/SELECT \* FROM public\.users/.test(sql)) return { rows: [{ ...USER, email: 'owner@example.com' }] };
    return { rows: [] };
  });

  const first = await link.redeemLink({ token, session: {}, deps: { pool } });
  const second = await link.redeemLink({ token, session: {}, deps: { pool } });
  assert.equal(first.ok, true);
  assert.equal(second.ok, false, 'a spent link must not work again');
  assert.match(second.message, /already been used|expired/i);
});

test('an expired or unknown link is refused, and no user is touched', async () => {
  const pool = fakePool(() => ({ rows: [] })); // the conditional UPDATE matches nothing
  const session = {};
  const res = await link.redeemLink({ token: 'I'.repeat(43), session, deps: { pool } });
  assert.equal(res.ok, false);
  assert.equal(session.userId, undefined);
  assert.ok(!pool.calls.some((c) => /public\.users/.test(c.sql)), 'no account work for a dead link');
});

test('garbage tokens are rejected without a database round trip', async () => {
  const pool = fakePool(() => ({ rows: [] }));
  for (const bad of ['', 'short', 'x'.repeat(200), "' OR 1=1 --", 'has spaces in it '.repeat(3)]) {
    const res = await link.redeemLink({ token: bad, session: {}, deps: { pool } });
    assert.equal(res.ok, false, `"${String(bad).slice(0, 20)}" must be refused`);
  }
  assert.equal(pool.calls.length, 0, 'the database must not be asked about obvious junk');
});

test('a first-time visitor gets an account created on redemption', async () => {
  let inserted = false;
  const pool = fakePool((sql) => {
    if (/UPDATE login_links/.test(sql)) return { rows: [{ contact: 'new@example.com', channel: 'email' }] };
    if (/SELECT \* FROM public\.users/.test(sql)) return { rows: [] };
    if (/INSERT INTO public\.users/.test(sql)) {
      inserted = true;
      return { rows: [{ id: 'u-new', email: 'new@example.com' }], command: 'INSERT' };
    }
    return { rows: [] };
  });
  const session = {};
  const res = await link.redeemLink({ token: 'J'.repeat(43), session, deps: { pool } });
  assert.equal(res.ok, true);
  assert.ok(inserted, 'the account must be created, exactly as the code flow does');
  assert.equal(session.userId, 'u-new');
});

/* ── the landing page and its route ──────────────────────────────────────── */

test('GET /login/link cannot log anyone in', () => {
  const route = SERVER.slice(SERVER.indexOf("app.get('/login/link'"));
  const handler = route.slice(0, route.indexOf('\n  });'));
  assert.ok(!/redeemLink/.test(handler), 'the GET must never spend the link — scanners issue GETs');
  assert.match(handler, /TOKEN_RE\.test\(raw\) \? raw : ''/, 'the token must be validated before it is put in HTML');
  assert.match(handler, /Cache-Control', 'no-store'/, 'a page carrying a token must not be cached');
  assert.match(handler, /Referrer-Policy', 'no-referrer'/, 'the token must not leak in a Referer header');
});

test('the landing page posts the token and never redirects off-site', () => {
  assert.match(PAGE, /__SG_LOGIN_TOKEN__/, 'the server must have a placeholder to fill');
  assert.match(PAGE, /method: 'POST'/);
  assert.match(PAGE, /\/api\/auth\/redeem-link/);
  // The "where next" value comes from the URL, so it must be a same-origin path.
  assert.match(PAGE, /\^\\\/\[A-Za-z0-9/, 'the next path must be checked against a same-origin pattern');
  assert.match(PAGE, /history\.replaceState/, 'the token must be dropped from history after use');
  assert.match(PAGE, /noindex/, 'a sign-in page must not be indexed');
});

test('a crafted ?t= cannot break out of the placeholder', () => {
  const nasty = ['"</script><script>alert(1)</script>', '"; fetch("//evil"); //', "' onload='x", 'a'.repeat(500)];
  for (const t of nasty) {
    assert.equal(link.TOKEN_RE.test(t), false, `${t.slice(0, 20)} must not pass validation`);
  }
  // And a real token is accepted, so the check is not simply refusing everything.
  assert.equal(link.TOKEN_RE.test(crypto.randomBytes(32).toString('base64url')), true);
});

/* ── schema and wiring ───────────────────────────────────────────────────── */

test('the table is declared once, in a migration, and is idempotent', () => {
  assert.match(MIGRATION, /CREATE TABLE IF NOT EXISTS login_links/);
  assert.match(MIGRATION, /token_hash\s+TEXT NOT NULL UNIQUE/, 'the hash must be unique — that is half of single-use');
  const routeFiles = fs.readdirSync(path.join(ROOT, 'server', 'routes'));
  for (const f of routeFiles) {
    const sql = fs.readFileSync(path.join(ROOT, 'server', 'routes', f), 'utf8');
    assert.ok(!/CREATE TABLE[^;]*login_links/i.test(sql), `${f} must not create the table itself`);
  }
});

test('the assistant prefers the link and keeps the code as a fallback', () => {
  const tools = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'book-tools.js'), 'utf8');
  assert.match(tools, /send_login_link: \{/);
  assert.match(tools, /PREFERRED way to sign someone in/);
  assert.match(tools, /Fallback sign-in/, 'the code tool must describe itself as the fallback');
  // Both must be usable by someone with no session, or the funnel dead-ends.
  const publicTools = tools.slice(tools.indexOf('const PUBLIC_TOOLS'));
  assert.match(publicTools, /'send_login_link'/);
  assert.match(publicTools, /'send_login_code'/);

  const prompt = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'book-agent.js'), 'utf8');
  assert.match(prompt, /call send_login_link/, 'the agent must be told to send a link first');
});

test('no tab still promises a six-digit code as the way in', () => {
  const pub = path.join(ROOT, 'frontend', 'public');
  for (const f of ['book-chat.js', 'profile-chat.js', 'reels-chat.js', 'partner-chat.js', 'squad-chat.js']) {
    const s = fs.readFileSync(path.join(pub, f), 'utf8');
    const greetings = s.match(/greetSignedOut:[\s\S]{0,400}?signedOutReply:[\s\S]{0,300}?,\n/);
    if (!greetings) continue;
    assert.ok(!/text you a code|text you a six-digit code/i.test(greetings[0]),
      `${f} still offers a code instead of a link`);
  }
});
