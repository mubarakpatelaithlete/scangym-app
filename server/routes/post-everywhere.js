/**
 * Post everywhere (Task 4) — ScanGym users connect their social accounts once,
 * then one post goes out to all of them. Built on Pipedream Connect (the same
 * 3,000+ app connector tech Viktor uses). Pipedream hosts the OAuth screens and
 * stores the tokens; ScanGym stores nothing but the user id mapping
 * (external_user_id = ScanGym user id), so no new tables.
 *
 *   GET    /api/post-everywhere/apps              supported networks
 *   GET    /api/post-everywhere/accounts          my connected accounts
 *   POST   /api/post-everywhere/connect {app}     -> { url } hosted connect page
 *   DELETE /api/post-everywhere/accounts/:id      disconnect
 *   POST   /api/post-everywhere/post {text, mediaUrl, mediaType, link, apps?}
 *
 * Env: PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID,
 *      PIPEDREAM_PROJECT_ENVIRONMENT (development | production).
 */
const express = require('express');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

const PD_API = 'https://api.pipedream.com/v1';
const env = () => process.env.PIPEDREAM_PROJECT_ENVIRONMENT || 'development';
const configured = () => !!(process.env.PIPEDREAM_CLIENT_ID && process.env.PIPEDREAM_CLIENT_SECRET && process.env.PIPEDREAM_PROJECT_ID);

// Supported networks. `needs` = what the post must contain for that network.
const APPS = {
  twitter:            { name: 'X (Twitter)',     needs: 'text' },
  facebook_pages:     { name: 'Facebook Page',   needs: 'text' },
  linkedin:           { name: 'LinkedIn',        needs: 'text' },
  instagram_business: { name: 'Instagram',       needs: 'media' },
  pinterest:          { name: 'Pinterest',       needs: 'image' },
  youtube_data_api:   { name: 'YouTube',         needs: 'video' },
};

let tokenCache = { value: null, exp: 0 };
async function pdToken() {
  if (tokenCache.value && Date.now() < tokenCache.exp - 60000) return tokenCache.value;
  const r = await fetch(`${PD_API}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: process.env.PIPEDREAM_CLIENT_ID, client_secret: process.env.PIPEDREAM_CLIENT_SECRET }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('Pipedream auth failed');
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return tokenCache.value;
}

async function pd(method, path, body, query) {
  const url = new URL(`${PD_API}/connect/${process.env.PIPEDREAM_PROJECT_ID}${path}`);
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await pdToken()}`, 'x-pd-environment': env(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) { const e = new Error(j.error || j.message || `Pipedream ${r.status}`); e.status = r.status; throw e; }
  return j;
}

async function myAccounts(userId) {
  const j = await pd('GET', '/accounts', null, { external_user_id: String(userId), limit: '100' });
  return (j.data || []).filter(a => a.app && APPS[a.app.name_slug]);
}

// First option of a remote-options prop (Facebook page, IG account, Pinterest board).
async function firstOption(userId, action, propName, appProp, accountId) {
  const j = await pd('POST', '/components/configure', {
    id: action, external_user_id: String(userId), prop_name: propName,
    configured_props: { [appProp]: { authProvisionId: accountId } },
  });
  const opts = j.options || (j.string_options || []).map(v => ({ value: v }));
  if (!opts.length) throw new Error(`no ${propName} found on this account`);
  const o = opts[0];
  return o && typeof o === 'object' && 'value' in o ? o.value : o;
}

async function run(userId, id, props) {
  const j = await pd('POST', '/actions/run', { id, external_user_id: String(userId), configured_props: props });
  return j.ret !== undefined ? j.ret : j.exports;
}

// One network, one post. Returns { ok, skipped?, error? }.
async function postTo(userId, account, p) {
  const slug = account.app.name_slug;
  const auth = { authProvisionId: account.id };
  const isVideo = p.mediaType === 'video';
  const text = [p.text, p.link].filter(Boolean).join('\n').trim();
  switch (slug) {
    case 'twitter': {
      const props = { app: auth, text: text.slice(0, 280) };
      if (p.mediaUrl && !isVideo) {
        const m = await run(userId, 'twitter-upload-media', { app: auth, filePath: p.mediaUrl });
        const mid = m && (m.media_id_string || m.id || m.media_id);
        if (mid) props.mediaIds = [String(mid)];
      }
      return run(userId, 'twitter-create-tweet', props);
    }
    case 'facebook_pages': {
      const page = await firstOption(userId, 'facebook_pages-create-post', 'page', 'facebookPages', account.id);
      return run(userId, 'facebook_pages-create-post', { facebookPages: auth, page, message: p.text || '', link: p.link || p.mediaUrl || undefined });
    }
    case 'linkedin':
      return run(userId, 'linkedin-create-text-post-user', { linkedin: auth, visibility: 'PUBLIC', text: text || p.mediaUrl });
    case 'instagram_business': {
      if (!p.mediaUrl) return { skipped: 'Instagram needs a photo or video' };
      const page = await firstOption(userId, 'instagram_business-create-post', 'page', 'instagram', account.id);
      return run(userId, 'instagram_business-create-post', { instagram: auth, page, mediaType: isVideo ? 'REELS' : 'IMAGE', url: p.mediaUrl });
    }
    case 'pinterest': {
      if (!p.mediaUrl || isVideo) return { skipped: 'Pinterest needs a photo' };
      const boardId = await firstOption(userId, 'pinterest-create-pin', 'boardId', 'pinterest', account.id);
      return run(userId, 'pinterest-create-pin', { pinterest: auth, boardId, title: (p.text || 'ScanGym').slice(0, 100), description: p.text || '', link: p.link || 'https://www.scangym.com', media: p.mediaUrl });
    }
    case 'youtube_data_api': {
      if (!p.mediaUrl || !isVideo) return { skipped: 'YouTube needs a video' };
      return run(userId, 'youtube_data_api-upload-video', { youtubeDataApi: auth, title: (p.text || 'ScanGym').slice(0, 100), description: text || 'Posted from ScanGym', filePath: p.mediaUrl, privacyStatus: 'public' });
    }
    default:
      return { skipped: 'not supported' };
  }
}

router.get('/apps', (req, res) => {
  res.json({ configured: configured(), environment: env(), apps: Object.entries(APPS).map(([slug, a]) => ({ slug, ...a })) });
});

router.use(authenticateUser);
router.use((req, res, next) => configured() ? next() : res.status(503).json({ error: 'Post everywhere is not set up yet' }));

router.get('/accounts', async (req, res) => {
  try {
    const list = await myAccounts(req.user.id);
    res.json({ accounts: list.map(a => ({ id: a.id, app: a.app.name_slug, appName: APPS[a.app.name_slug].name, name: a.name || '', healthy: a.healthy !== false })) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/connect', async (req, res) => {
  const app = String((req.body || {}).app || '');
  if (!APPS[app]) return res.status(400).json({ error: 'Unknown app' });
  try {
    const origin = `${req.protocol}://${req.get('host')}`;
    const j = await pd('POST', '/tokens', { external_user_id: String(req.user.id), allowed_origins: [origin, 'https://www.scangym.com', 'https://scangym.com'] });
    const url = new URL(j.connect_link_url);
    url.searchParams.set('app', app);
    res.json({ url: url.toString(), token: j.token, expiresAt: j.expires_at });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.delete('/accounts/:id', async (req, res) => {
  try {
    const mine = await myAccounts(req.user.id);
    if (!mine.some(a => a.id === req.params.id)) return res.status(404).json({ error: 'Not found' });
    await pd('DELETE', `/accounts/${encodeURIComponent(req.params.id)}`);
    res.json({ ok: true });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

const buckets = new Map(); // userId -> { start, count } — 20 posts / hour
router.post('/post', async (req, res) => {
  const b = req.body || {};
  const p = {
    text: String(b.text || '').slice(0, 2200).trim(),
    mediaUrl: /^https?:\/\//i.test(b.mediaUrl || '') ? String(b.mediaUrl) : '',
    mediaType: b.mediaType === 'video' ? 'video' : 'image',
    link: /^https?:\/\//i.test(b.link || '') ? String(b.link) : '',
  };
  if (!p.text && !p.mediaUrl) return res.status(400).json({ error: 'Write something or add a photo/video link' });
  const now = Date.now(), k = String(req.user.id);
  const bk = buckets.get(k) && now - buckets.get(k).start < 3600e3 ? buckets.get(k) : { start: now, count: 0 };
  if (++bk.count > 20) return res.status(429).json({ error: 'Limit is 20 posts per hour' });
  buckets.set(k, bk);
  try {
    let accounts = await myAccounts(req.user.id);
    if (Array.isArray(b.apps) && b.apps.length) accounts = accounts.filter(a => b.apps.includes(a.app.name_slug));
    if (!accounts.length) return res.status(400).json({ error: 'Connect at least one account first' });
    const results = await Promise.all(accounts.map(async a => {
      const base = { app: a.app.name_slug, appName: APPS[a.app.name_slug].name, account: a.name || '' };
      try {
        const r = await postTo(req.user.id, a, p);
        if (r && r.skipped) return { ...base, status: 'skipped', note: r.skipped };
        return { ...base, status: 'posted' };
      } catch (e) { return { ...base, status: 'failed', note: e.message.slice(0, 200) }; }
    }));
    res.json({ results, posted: results.filter(r => r.status === 'posted').length });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

module.exports = router;
module.exports.APPS = APPS;
