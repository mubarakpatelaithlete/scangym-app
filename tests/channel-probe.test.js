/**
 * The bug these tests exist for: /api/chatbot/health reported discord: true for
 * weeks while Discord was refusing the token with close code 4004. "A key is
 * set" was being sold as "the channel works". Every assertion below is about
 * refusing to make that claim again.
 */

const assert = require('assert');
const { probeChannels } = require('../server/chatbot/channel-probe');

const realFetch = global.fetch;

/** Route each probe by URL so tests read as "provider says X → we report Y". */
function stubFetch(routes) {
  global.fetch = async (url) => {
    const key = Object.keys(routes).find((k) => String(url).includes(k));
    if (!key) throw new Error(`unexpected fetch: ${url}`);
    const r = routes[key];
    if (typeof r === 'function') return r();
    return {
      ok: r.status === undefined ? true : r.status < 400,
      status: r.status ?? 200,
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
}

const ENV = {
  TELEGRAM_BOT_TOKEN: 't',
  DISCORD_BOT_TOKEN: 'd',
  SLACK_BOT_TOKEN: 's',
  SLACK_SIGNING_SECRET: 'sig',
  TEAMS_APP_ID: 'a',
  TEAMS_APP_PASSWORD: 'p',
  TEAMS_APP_TENANT_ID: 'ten',
  TWILIO_ACCOUNT_SID: 'AC1',
  TWILIO_AUTH_TOKEN: 'auth',
  SENDGRID_API_KEY: 'sg',
  GOOGLE_CHAT_AUDIENCE: 'aud',
};

const HAPPY = {
  'api.telegram.org/botX/getMe': null,
  'getMe': { body: { ok: true, result: { username: 'ScanGymBot' } } },
  'getWebhookInfo': { body: { ok: true, result: { url: 'https://scangym.com/api/chatbot/telegram/webhook', pending_update_count: 0 } } },
  'discord.com/api/v10/users/@me': { body: { id: '1', username: 'ScanGym' } },
  'slack.com/api/auth.test': { body: { ok: true, team: 'Scangym', user: 'scangym' } },
  'login.microsoftonline.com': { body: { access_token: 'tok' } },
  'api.twilio.com': { body: { status: 'active' } },
  'api.sendgrid.com': { body: {} },
};

async function run() {
  // ── The exact production failure: token rejected, gateway down ──────────
  stubFetch({ ...HAPPY, 'discord.com/api/v10/users/@me': { status: 401, body: { message: '401: Unauthorized' } } });
  let out = await probeChannels(ENV, { discordGatewayStatus: () => ({ connected: false, bot: null }) });
  assert.strictEqual(out.discord.live, false, 'a rejected Discord token must never report live');
  assert.strictEqual(out.discord.token, 'rejected');
  assert.match(out.discord.detail, /401/);

  // ── The subtler failure: token is fine, but the socket is down ──────────
  stubFetch(HAPPY);
  out = await probeChannels(ENV, { discordGatewayStatus: () => ({ connected: false, bot: null }) });
  assert.strictEqual(out.discord.live, false, 'a valid token with a dead gateway is not a live channel');
  assert.strictEqual(out.discord.token, 'valid');
  assert.strictEqual(out.discord.gateway, 'disconnected');
  assert.match(out.discord.detail, /restart/);

  // ── Fully healthy ───────────────────────────────────────────────────────
  out = await probeChannels(ENV, { discordGatewayStatus: () => ({ connected: true, bot: { username: 'ScanGym', id: '1' } }) });
  assert.strictEqual(out.discord.live, true);
  assert.strictEqual(out.slack.live, true);
  assert.strictEqual(out.telegram.live, true);
  assert.strictEqual(out.email.live, true);
  assert.strictEqual(out.whatsapp.live, true);

  // ── A valid Telegram token with no webhook receives nothing ─────────────
  stubFetch({ ...HAPPY, 'getWebhookInfo': { body: { ok: true, result: { url: '', pending_update_count: 0 } } } });
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.telegram.live, false, 'no webhook means inbound messages go nowhere');
  assert.match(out.telegram.detail, /webhook/);

  // ── Slack rejecting us must surface the provider's own reason ───────────
  stubFetch({ ...HAPPY, 'slack.com/api/auth.test': { body: { ok: false, error: 'invalid_auth' } } });
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.slack.live, false);
  assert.strictEqual(out.slack.detail, 'invalid_auth');

  // ── Refusing to fail open on unverifiable inbound events ────────────────
  stubFetch(HAPPY);
  out = await probeChannels({ ...ENV, SLACK_SIGNING_SECRET: '' }, {});
  assert.strictEqual(out.slack.live, false, 'events we cannot verify must not count as a live channel');
  assert.match(out.slack.detail, /SLACK_SIGNING_SECRET/);

  // ── Honest "cannot know from here" instead of a confident guess ─────────
  stubFetch(HAPPY);
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.msteams.live, null, 'inbound-only channels must report unknown, not true');
  assert.strictEqual(out.msteams.credentials, 'valid');
  assert.strictEqual(out.googlechat.live, null);

  // ── Bad Teams credentials are knowable, and must be reported ───────────
  stubFetch({ ...HAPPY, 'login.microsoftonline.com': { status: 401, body: { error_description: 'AADSTS7000215: Invalid client secret' } } });
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.msteams.live, false);
  assert.match(out.msteams.detail, /Invalid client secret/);

  // ── Missing config is "not configured", never "live" ────────────────────
  out = await probeChannels({}, {});
  for (const name of ['telegram', 'discord', 'slack', 'msteams', 'whatsapp', 'email']) {
    assert.strictEqual(out[name].configured, false, `${name} must report unconfigured`);
    assert.strictEqual(out[name].live, false, `${name} must never report live without credentials`);
  }

  // ── A provider that hangs or explodes must not take down the check ──────
  stubFetch({ ...HAPPY, 'slack.com/api/auth.test': () => { throw new Error('socket hang up'); } });
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.slack.live, false);
  assert.strictEqual(out.telegram.live, true, 'one broken provider must not affect the others');

  // ── Suspended Twilio accounts still answer 200 ──────────────────────────
  stubFetch({ ...HAPPY, 'api.twilio.com': { body: { status: 'suspended' } } });
  out = await probeChannels(ENV, {});
  assert.strictEqual(out.sms.live, false);
  assert.match(out.sms.detail, /suspended/);

  // ── Never echo a credential into the health payload ─────────────────────
  stubFetch(HAPPY);
  out = await probeChannels(ENV, { discordGatewayStatus: () => ({ connected: true, bot: { username: 'ScanGym', id: '1' } }) });
  const dump = JSON.stringify(out);
  for (const secret of ['sg', 'auth', 'sig']) {
    assert.ok(!dump.includes(`"${secret}"`), 'probe output must not contain credential values');
  }

  console.log('channel-probe: all assertions passed');
}

run()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => { global.fetch = realFetch; });
