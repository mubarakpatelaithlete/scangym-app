/**
 * Deep channel probes.
 *
 * The shallow /health check reports a channel as up when its env var is merely
 * non-empty. Discord sat there reporting `true` while its gateway was being
 * refused with close code 4004 — the token in Railway had been rotated and the
 * replacement was never copied across. A check that cannot tell a live token
 * from a dead one is worse than no check, because it is trusted.
 *
 * Each probe here asks the provider a question only a working credential can
 * answer, and reports one of:
 *   live: true       — the provider answered as us
 *   live: false      — the provider rejected us; `detail` says why
 *   live: null       — cannot be determined from here (inbound-only channels
 *                      whose registration lives in someone else's console)
 *
 * These cost a real API call each, so they run only on ?deep=1 and never on
 * the polling path.
 */

const DEFAULT_TIMEOUT_MS = 6000;

/** Never let one hanging provider hold the whole health check open. */
async function ask(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not all providers answer JSON */ }
    return { ok: resp.ok, status: resp.status, json, text };
  } catch (err) {
    return { ok: false, status: 0, json: null, text: '', error: err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message };
  } finally {
    clearTimeout(timer);
  }
}

const notConfigured = (what) => ({ configured: false, live: false, detail: `${what} is not set` });

/** Trim provider errors so a health page never becomes a credential leak. */
const short = (s) => String(s || '').replace(/\s+/g, ' ').slice(0, 160);

async function probeTelegram(env) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return notConfigured('TELEGRAM_BOT_TOKEN');

  const me = await ask(`https://api.telegram.org/bot${token}/getMe`);
  if (!me.json?.ok) {
    return { configured: true, live: false, detail: short(me.json?.description || me.error || `HTTP ${me.status}`) };
  }

  // A valid token still answers nothing if no webhook points at us.
  const hook = await ask(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const info = hook.json?.result || {};
  const out = {
    configured: true,
    live: !!info.url,
    bot: me.json.result?.username || null,
    webhook: info.url ? 'set' : 'missing',
    pending: info.pending_update_count ?? null,
  };
  if (!info.url) out.detail = 'token is valid but no webhook is registered, so inbound messages go nowhere';
  if (info.last_error_message) out.lastError = short(info.last_error_message);
  return out;
}

async function probeDiscord(env, gatewayStatus) {
  if (!env.DISCORD_BOT_TOKEN) return notConfigured('DISCORD_BOT_TOKEN');

  const me = await ask('https://discord.com/api/v10/users/@me', {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
  });
  const tokenValid = !!me.json?.id;

  // Discord is the one channel where a valid token is not enough: the process
  // holds an outbound WebSocket, and that is what actually receives messages.
  const gateway = typeof gatewayStatus === 'function' ? gatewayStatus() : null;
  const connected = !!gateway?.connected;

  const out = {
    configured: true,
    live: tokenValid && connected,
    token: tokenValid ? 'valid' : 'rejected',
    gateway: connected ? 'connected' : 'disconnected',
    bot: gateway?.bot?.username || me.json?.username || null,
  };
  if (!tokenValid) out.detail = short(me.json?.message || me.error || `HTTP ${me.status}`);
  else if (!connected) out.detail = 'token is valid but the gateway is not connected — the process needs a restart';
  return out;
}

/** True when an xoxb token and a client_id look like the same Slack app. */
function sameSlackApp(botToken, clientId) {
  const tokenPart = String(botToken || '').split('-')[1] || '';
  const idPart = String(clientId || '').split('.')[0] || '';
  if (!tokenPart || !idPart) return true; // nothing to compare — do not cry wolf
  return tokenPart === idPart;
}

async function probeSlack(env) {
  if (!env.SLACK_BOT_TOKEN) return notConfigured('SLACK_BOT_TOKEN');

  const resp = await ask('https://slack.com/api/auth.test', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` },
  });
  if (!resp.json?.ok) {
    return { configured: true, live: false, detail: short(resp.json?.error || resp.error || `HTTP ${resp.status}`) };
  }

  const out = { configured: true, live: true, team: resp.json.team || null, bot: resp.json.user || null };
  // Inbound events are signature-checked; without the secret we would have to
  // fail open, which we refuse to do, so the channel is effectively deaf.
  if (!env.SLACK_SIGNING_SECRET) {
    out.live = false;
    out.detail = 'SLACK_SIGNING_SECRET is not set, so inbound events cannot be verified';
  }
  // A valid bot token says the bot can talk in workspaces it is already in. It
  // says nothing about whether a new customer can install it — that needs the
  // OAuth pair, from the same app as the token. Reported separately, because on
  // 2026-09-01 this channel read healthy while every install died at the
  // callback.
  out.installable = Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
  if (!out.installable) {
    out.installDetail = 'SLACK_CLIENT_ID/SLACK_CLIENT_SECRET are not both set — "Add to Slack" cannot complete';
  } else if (!sameSlackApp(env.SLACK_BOT_TOKEN, env.SLACK_CLIENT_ID)) {
    // Heuristic, but it catches exactly the failure we hit: a bot token from
    // the app we own paired with a client_id from an app we do not. Slack's
    // xoxb token and the client_id share their leading numeric segment.
    out.installable = false;
    out.installDetail = 'SLACK_CLIENT_ID belongs to a different Slack app than SLACK_BOT_TOKEN';
  }
  return out;
}

async function probeTeams(env) {
  const { TEAMS_APP_ID: id, TEAMS_APP_PASSWORD: pw, TEAMS_APP_TENANT_ID: tenant } = env;
  if (!id || !pw) return notConfigured('TEAMS_APP_ID/TEAMS_APP_PASSWORD');

  // Ask Azure AD for the token the bot would use to reply. If this succeeds the
  // credentials are good; whether a Teams app points at us is not visible here.
  const authority = tenant ? `https://login.microsoftonline.com/${tenant}` : 'https://login.microsoftonline.com/botframework.com';
  const resp = await ask(`${authority}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: id,
      client_secret: pw,
      scope: 'https://api.botframework.com/.default',
    }).toString(),
  });

  if (!resp.json?.access_token) {
    return { configured: true, live: false, detail: short(resp.json?.error_description || resp.error || `HTTP ${resp.status}`) };
  }
  return {
    configured: true,
    live: null, // credentials prove we can speak, not that anyone is listening
    credentials: 'valid',
    detail: 'credentials are valid; inbound depends on the messaging endpoint registered in Azure, which cannot be read from here',
  };
}

async function probeTwilio(env) {
  const sid = env.TWILIO_ACCOUNT_SID;
  const auth = env.TWILIO_AUTH_TOKEN;
  if (!sid || !auth) return notConfigured('TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN');

  const resp = await ask(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${auth}`).toString('base64')}` },
  });
  if (!resp.ok) {
    return { configured: true, live: false, detail: short(resp.json?.message || resp.error || `HTTP ${resp.status}`) };
  }
  const status = resp.json?.status || null;
  return {
    configured: true,
    live: status === 'active',
    account: status,
    detail: status === 'active' ? undefined : `Twilio account status is ${status}`,
  };
}

async function probeSendgrid(env) {
  if (!env.SENDGRID_API_KEY) return notConfigured('SENDGRID_API_KEY');
  const resp = await ask('https://api.sendgrid.com/v3/scopes', {
    headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}` },
  });
  if (!resp.ok) {
    return { configured: true, live: false, detail: short(resp.json?.errors?.[0]?.message || resp.error || `HTTP ${resp.status}`) };
  }
  return { configured: true, live: true };
}

function probeGoogleChat(env) {
  const audience = env.GOOGLE_CHAT_AUDIENCE || env.GOOGLE_CHAT_PROJECT_NUMBER;
  if (!audience) {
    return {
      configured: false,
      live: false,
      detail: 'no audience set, so inbound requests cannot be verified as coming from Google',
    };
  }
  // Google Chat hands us no credential to test: the app replies in-band on the
  // request it receives. Configured is as far as this can be taken from here.
  return {
    configured: true,
    live: null,
    detail: 'audience is configured and requests are verified; inbound depends on the app registration in Google Cloud, which cannot be read from here',
  };
}

function probeReddit(env) {
  if (!env.REDDIT_CLIENT_ID || !env.REDDIT_CLIENT_SECRET) return notConfigured('REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET');
  return { configured: true, live: null, detail: 'credentials present; not probed' };
}

/**
 * Probe every channel at once. Never throws: a probe that blows up is reported
 * as not live, because a health check that 500s tells you nothing.
 */
async function probeChannels(env = process.env, deps = {}) {
  const entries = [
    ['telegram', () => probeTelegram(env)],
    ['discord', () => probeDiscord(env, deps.discordGatewayStatus)],
    ['slack', () => probeSlack(env)],
    ['msteams', () => probeTeams(env)],
    ['whatsapp', () => probeTwilio(env)],
    ['sms', () => probeTwilio(env)],
    ['email', () => probeSendgrid(env)],
    ['googlechat', async () => probeGoogleChat(env)],
    ['reddit', async () => probeReddit(env)],
    ['web', async () => ({ configured: true, live: true, detail: 'served by this process' })],
  ];

  const results = await Promise.all(entries.map(async ([name, run]) => {
    try {
      return [name, await run()];
    } catch (err) {
      return [name, { configured: true, live: false, detail: short(`probe failed: ${err.message}`) }];
    }
  }));

  return Object.fromEntries(results);
}

module.exports = { probeChannels };
