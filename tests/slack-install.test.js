/**
 * The bug: /api/channels/slack/install carried a hardcoded client_id (split
 * across an array so it did not read as a literal) belonging to a Slack app
 * this account does not own, with no matching secret anywhere.
 *
 * Verified end to end on 2026-09-01, signed in as a customer: Profile → Slack →
 * a real Slack consent screen for an app called "ScanGym" → Allow → back to
 * scangym.com/channels?toast=Slack%20is%20not%20fully%20configured%20yet.
 * Slack did its part. We could not exchange the code, and never could have:
 * you cannot hold the secret for someone else's app.
 *
 * A fallback that renders a convincing screen and then fails is worse than an
 * honest "being set up", so these tests pin the rule: no OAuth pair, no
 * install URL, and never a client_id we did not get from the environment.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'server', 'routes', 'channels.js'), 'utf8');

/** Load the route table fresh. Env is applied by `withEnv` around the call. */
function loadRoutes() {
  const routePath = require.resolve('../server/routes/channels.js');
  delete require.cache[routePath];
  return require(routePath);
}

/** Run fn with exactly these Slack env vars set, then restore the real ones. */
async function withEnv(env, fn) {
  const keys = ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET', 'SLACK_APP_ID'];
  const saved = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/** Drive the GET handler for one path and capture what it answers. */
async function callRoute(router, routePath) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods.get);
  assert.ok(layer, `no GET route for ${routePath}`);
  let payload = null;
  const req = { query: {}, session: {}, protocol: 'https', get: () => 'scangym.com' };
  const res = {
    json: (body) => { payload = body; return res; },
    redirect: (url) => { payload = { redirect: url }; return res; },
    status: () => res,
  };
  await layer.route.stack[0].handle(req, res, () => {});
  return payload;
}

test('no OAuth pair → no install URL, so the rail says "being set up"', async () => {
  const body = await withEnv({}, () => callRoute(loadRoutes(), '/slack/install'));
  assert.ok(!body.installUrl, 'an unconfigured install must not hand out a URL');
  assert.strictEqual(body.configured, false);
  assert.match(body.detail, /SLACK_CLIENT_ID/);
});

test('a client_id with no secret is still not an install URL', async () => {
  // This was the exact production state: an id, no secret, a dead callback.
  const body = await withEnv({ SLACK_CLIENT_ID: '123.456' },
    () => callRoute(loadRoutes(), '/slack/install'));
  assert.ok(!body.installUrl, 'half-configured OAuth must not be offered to a customer');
});

test('a full pair produces a correct authorize URL', async () => {
  const body = await withEnv({ SLACK_CLIENT_ID: '123.456', SLACK_CLIENT_SECRET: 'shh' },
    () => callRoute(loadRoutes(), '/slack/install'));
  assert.ok(body.installUrl.startsWith('https://slack.com/oauth/v2/authorize?'));
  assert.ok(body.installUrl.includes('client_id=123.456'));
  assert.ok(body.installUrl.includes(
    encodeURIComponent('https://scangym.com/api/channels/slack/callback')),
    'the redirect_uri must match the one registered on the Slack app');
  assert.ok(!body.installUrl.includes('shh'), 'the secret must never reach the browser');
});

test('the callback refuses to run without both halves', async () => {
  const body = await withEnv({}, () => callRoute(loadRoutes(), '/slack/callback'));
  assert.ok(body.redirect, 'the callback must redirect rather than 500');
});

test('no Slack app identifier is hardcoded in the source any more', () => {
  // Both fallbacks pointed at apps we do not own: a client_id assembled from
  // an array, and a SLACK_APP_ID default. Neither can come back.
  assert.ok(!/1145263420|11461400621316/.test(SRC), 'the foreign client_id is back');
  assert.ok(!/A0BDKBSJ99A/.test(SRC), 'the foreign app id fallback is back');
  assert.ok(!/\['\d{6,}'/.test(SRC), 'a credential is being assembled from string pieces');
});
