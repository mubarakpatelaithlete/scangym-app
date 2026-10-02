/**
 * Post everywhere (Task 4) — ScanGym users connect their social accounts once,
 * then one post goes out to all of them.
 *
 * Provider: Composio (free plan works in production; Pipedream Connect's free
 * plan blocks live actions). Composio hosts the OAuth screens and stores the
 * tokens with its own managed apps for Facebook, Instagram, LinkedIn,
 * Pinterest and YouTube. X has no Composio-managed app, so X stays on
 * Pipedream Connect. ScanGym stores nothing but the user id mapping
 * (user_id / external_user_id = ScanGym user id), so no new tables.
 * Account ids are prefixed "cx:" (Composio) or "pd:" (Pipedream).
 *
 *   GET    /api/post-everywhere/apps              supported networks
 *   GET    /api/post-everywhere/accounts          my connected accounts
 *   POST   /api/post-everywhere/connect {app}     -> { url } hosted connect page
 *   DELETE /api/post-everywhere/accounts/:id      disconnect
 *   POST   /api/post-everywhere/post {text, mediaUrl, mediaType, link, apps?}
 *
 * Env: COMPOSIO_API_KEY; for X: PIPEDREAM_CLIENT_ID, PIPEDREAM_CLIENT_SECRET, PIPEDREAM_PROJECT_ID,
 *      PIPEDREAM_PROJECT_ENVIRONMENT (development | production).
 */
const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const pool = require('../middleware/db');

const router = express.Router();
router.use(express.json({ limit: '64kb' }));

const PD_API = 'https://api.pipedream.com/v1';
const env = () => process.env.PIPEDREAM_PROJECT_ENVIRONMENT || 'development';
const pdConfigured = () => !!(process.env.PIPEDREAM_CLIENT_ID && process.env.PIPEDREAM_CLIENT_SECRET && process.env.PIPEDREAM_PROJECT_ID);
const cxConfigured = () => !!process.env.COMPOSIO_API_KEY;
const configured = () => cxConfigured() || pdConfigured();

// Supported networks. `needs` = what the post must contain for that network.
// `toolkit` = Composio toolkit slug; apps without one use Pipedream.
const APPS = {
  twitter:            { name: 'X (Twitter)',     needs: 'text' },
  facebook_pages:     { name: 'Facebook Page',   needs: 'text',  toolkit: 'facebook' },
  linkedin:           { name: 'LinkedIn',        needs: 'text',  toolkit: 'linkedin' },
  instagram_business: { name: 'Instagram',       needs: 'media', toolkit: 'instagram' },
  pinterest:          { name: 'Pinterest',       needs: 'image', toolkit: 'pinterest' },
  youtube_data_api:   { name: 'YouTube',         needs: 'video', toolkit: 'youtube' },
};
const BY_TOOLKIT = Object.fromEntries(Object.entries(APPS).filter(([, a]) => a.toolkit).map(([slug, a]) => [a.toolkit, slug]));
const available = (slug) => (APPS[slug].toolkit ? cxConfigured() : pdConfigured());

// ── Composio ────────────────────────────────────────────────────────────────
const CX_API = 'https://backend.composio.dev/api/v3';
async function cx(method, path, body, query) {
  const url = new URL(CX_API + path);
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method,
    headers: { 'x-api-key': process.env.COMPOSIO_API_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let j; try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
  if (!r.ok) { const e = new Error((j.error && (j.error.message || j.error)) || j.message || `Composio ${r.status}`); e.status = r.status; throw e; }
  return j;
}
const authConfigs = {};
async function authConfigId(toolkit) {
  if (authConfigs[toolkit]) return authConfigs[toolkit];
  const j = await cx('GET', '/auth_configs', null, { toolkit_slug: toolkit });
  const hit = (j.items || []).find(a => (a.toolkit && a.toolkit.slug) === toolkit && !a.is_disabled && a.status !== 'DISABLED');
  const id = hit ? hit.id : (await cx('POST', '/auth_configs', { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth' } })).auth_config.id;
  authConfigs[toolkit] = id;
  return id;
}
async function cxAccounts(userId) {
  if (!cxConfigured()) return [];
  const j = await cx('GET', '/connected_accounts', null, { user_ids: String(userId), limit: '100' });
  return (j.items || [])
    .filter(a => a.status === 'ACTIVE' && a.toolkit && BY_TOOLKIT[a.toolkit.slug] && String(a.user_id) === String(userId))
    .map(a => ({ id: 'cx:' + a.id, raw: a.id, provider: 'cx', slug: BY_TOOLKIT[a.toolkit.slug], name: a.alias || a.word_id || '', healthy: !a.is_disabled }));
}
async function tool(userId, account, slug, args) {
  const j = await cx('POST', `/tools/execute/${slug}`, { connected_account_id: account.raw, user_id: String(userId), arguments: args });
  if (j.successful === false || j.error) throw new Error(String(j.error || 'failed').slice(0, 200));
  return j.data;
}
// First object in a tool response that has an id (page, board, profile...).
function firstId(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 6) return null;
  if (Array.isArray(o)) { for (const x of o) { const v = firstId(x, depth + 1); if (v) return v; } return null; }
  if (o.id && (typeof o.id === 'string' || typeof o.id === 'number')) return String(o.id);
  for (const k of Object.keys(o)) { const v = firstId(o[k], depth + 1); if (v) return v; }
  return null;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function cxPost(userId, account, p) {
  const isVideo = p.mediaType === 'video';
  const text = [p.text, p.link].filter(Boolean).join('\n').trim();
  switch (account.slug) {
    case 'facebook_pages': {
      const page_id = firstId(await tool(userId, account, 'FACEBOOK_GET_USER_PAGES', { fields: 'id,name' }));
      if (!page_id) throw new Error('No Facebook Page on this account');
      if (p.mediaUrl && isVideo) return tool(userId, account, 'FACEBOOK_CREATE_VIDEO_POST', { page_id, file_url: p.mediaUrl, description: text, published: true });
      if (p.mediaUrl) return tool(userId, account, 'FACEBOOK_CREATE_PHOTO_POST', { page_id, url: p.mediaUrl, message: text, published: true });
      return tool(userId, account, 'FACEBOOK_CREATE_POST', { page_id, message: p.text || text, link: p.link || undefined, published: true });
    }
    case 'linkedin': {
      const me = await tool(userId, account, 'LINKEDIN_GET_MY_INFO', {});
      const d = (me && (me.response_dict || me)) || {};
      const aid = String(d.author_id || d.sub || '');
      if (!aid) throw new Error('Could not read the LinkedIn profile');
      const author = aid.startsWith('urn:') ? aid : `urn:li:person:${aid}`;
      return tool(userId, account, 'LINKEDIN_CREATE_LINKED_IN_POST', { author, commentary: text || p.mediaUrl, visibility: 'PUBLIC', lifecycleState: 'PUBLISHED' });
    }
    case 'instagram_business': {
      if (!p.mediaUrl) return { skipped: 'Instagram needs a photo or video' };
      const info = await tool(userId, account, 'INSTAGRAM_GET_USER_INFO', {});
      const ig_user_id = firstId(info);
      if (!ig_user_id) throw new Error('No Instagram business account found');
      const c = await tool(userId, account, 'INSTAGRAM_CREATE_MEDIA_CONTAINER', isVideo
        ? { ig_user_id, video_url: p.mediaUrl, media_type: 'REELS', caption: text }
        : { ig_user_id, image_url: p.mediaUrl, caption: text });
      const creation_id = firstId(c);
      if (!creation_id) throw new Error('Instagram did not accept the media');
      // Videos need processing before they can be published.
      for (let i = 0; ; i++) {
        try { return await tool(userId, account, 'INSTAGRAM_CREATE_POST', { ig_user_id, creation_id }); } catch (e) {
          if (!isVideo || i >= 8) throw e;
          await sleep(6000);
        }
      }
    }
    case 'pinterest': {
      if (!p.mediaUrl || isVideo) return { skipped: 'Pinterest needs a photo' };
      const board_id = firstId(await tool(userId, account, 'PINTEREST_LIST_BOARDS', { page_size: 1 }));
      if (!board_id) throw new Error('Create a Pinterest board first');
      return tool(userId, account, 'PINTEREST_CREATE_PIN', { board_id, title: (p.text || 'ScanGym').slice(0, 100), description: (p.text || '').slice(0, 800), link: p.link || 'https://www.scangym.com', media_source: { source_type: 'image_url', url: p.mediaUrl } });
    }
    case 'youtube_data_api': {
      if (!p.mediaUrl || !isVideo) return { skipped: 'YouTube needs a video' };
      return tool(userId, account, 'YOUTUBE_UPLOAD_VIDEO', { title: (p.text || 'ScanGym').slice(0, 100), description: text || 'Posted from ScanGym', tags: ['ScanGym'], categoryId: '17', privacyStatus: 'public', videoFilePath: p.mediaUrl });
    }
    default:
      return { skipped: 'not supported' };
  }
}

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

async function pdAccounts(userId) {
  if (!pdConfigured()) return [];
  const j = await pd('GET', '/accounts', null, { external_user_id: String(userId), limit: '100' });
  return (j.data || []).filter(a => a.app && APPS[a.app.name_slug] && !APPS[a.app.name_slug].toolkit)
    .map(a => ({ id: 'pd:' + a.id, raw: a.id, provider: 'pd', slug: a.app.name_slug, name: a.name || '', healthy: a.healthy !== false, pd: a }));
}
async function myAccounts(userId) {
  const [c, p] = await Promise.all([cxAccounts(userId).catch(e => { console.error('[post-everywhere] composio', e.message); return []; }),
    pdAccounts(userId).catch(e => { console.error('[post-everywhere] pipedream', e.message); return []; })]);
  return c.concat(p);
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
async function postTo(userId, acc, p) {
  if (acc.provider === 'cx') return cxPost(userId, acc, p);
  const account = acc.pd;
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
  res.json({ configured: configured(), environment: env(), apps: Object.entries(APPS).filter(([slug]) => available(slug)).map(([slug, a]) => ({ slug, name: a.name, needs: a.needs, provider: a.toolkit ? 'composio' : 'pipedream' })) });
});

router.use(authenticateUser);

/* Task 160/161 (owner, 2026-10-02): "is it in my studio?" — the videos you
   posted to ScanGym (linked through your own Create job), each with the Shop
   product it sells. Works even when no social posting provider is set up. */
router.get('/mine', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT vc.id, vc.name, vc.url, vc.active, vc.shop_product_id, sp.title AS product_title, sp.price_pence AS product_price
         FROM video_catalog vc
         JOIN squad_video_jobs j ON vc.cdn_key = 'creation:' || j.id
         LEFT JOIN shop_products sp ON sp.id = vc.shop_product_id
        WHERE j.user_id = $1 AND vc.source = 'creation'
        ORDER BY vc.id DESC LIMIT 50`, [String(req.user.id)]);
    res.json({ posts: rows.map(r => ({ id: r.id, title: r.name, url: r.url, live: r.active !== false,
      product: r.shop_product_id ? { id: r.shop_product_id, title: r.product_title, price: r.product_price != null ? '£' + (r.product_price / 100).toFixed(2) : '' } : null })) });
  } catch (e) { res.status(500).json({ error: 'Could not load your posts' }); }
});
router.use((req, res, next) => configured() ? next() : res.status(503).json({ error: 'Post everywhere is not set up yet' }));

router.get('/accounts', async (req, res) => {
  try {
    const list = await myAccounts(req.user.id);
    res.json({ accounts: list.map(a => ({ id: a.id, app: a.slug, appName: APPS[a.slug].name, name: a.name, healthy: a.healthy })) });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

router.post('/connect', async (req, res) => {
  const app = String((req.body || {}).app || '');
  if (!APPS[app] || !available(app)) return res.status(400).json({ error: 'Unknown app' });
  try {
    if (APPS[app].toolkit) {
      const j = await cx('POST', '/connected_accounts/link', {
        auth_config_id: await authConfigId(APPS[app].toolkit), user_id: String(req.user.id),
        callback_url: 'https://www.scangym.com/post-everywhere/?connected=' + app,
      });
      return res.json({ url: j.redirect_url, expiresAt: j.expires_at });
    }
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
    const a = mine.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (a.provider === 'cx') await cx('DELETE', `/connected_accounts/${encodeURIComponent(a.raw)}`);
    else await pd('DELETE', `/accounts/${encodeURIComponent(a.raw)}`);
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
    productId: Number.parseInt(b.productId, 10) || null,
  };
  if (!p.text && !p.mediaUrl) return res.status(400).json({ error: 'Write something or add a photo/video link' });
  /* Task 160: 1-click Post — AI writes the title, caption and hashtags from
     what was made, so the creator never types anything. The referral line the
     client sent is kept at the end so the post still earns. */
  let meta = null;
  if (b.autoMeta && p.mediaUrl) {
    meta = await writeMeta(req.user.id, p.mediaUrl).catch((e) => { console.warn('[PostEverywhere] meta', e.message); return null; });
    if (meta) {
      p.title = meta.title;
      p.text = [meta.caption, meta.hashtags.join(' '), p.text].filter(Boolean).join('\n\n').slice(0, 2200);
    }
  }
  const now = Date.now(), k = String(req.user.id);
  const bk = buckets.get(k) && now - buckets.get(k).start < 3600e3 ? buckets.get(k) : { start: now, count: 0 };
  if (++bk.count > 20) return res.status(429).json({ error: 'Limit is 20 posts per hour' });
  buckets.set(k, bk);
  try {
    /* Task 110: one tap also publishes to the creator's own ScanGym profile
       (Home feed), using the name we already have — and works with no socials
       linked yet, so Post is never a dead end. */
    const sg = b.toScanGym ? await postToScanGym(req.user, p).catch((e) => ({ status: 'failed', note: e.message })) : null;
    const out = sg
      ? await postEverywhere(req.user.id, p, b.apps).catch((e) => ({ error: e.message, results: [], posted: 0 }))
      : await postEverywhere(req.user.id, p, b.apps);
    if (sg) {
      const row = { app: 'scangym', appName: 'ScanGym', account: displayName(req.user), ...sg };
      const results = [row].concat(out.results || []);
      return res.json({ ...out, error: undefined, noSocials: !!out.error, results, meta, text: p.text, posted: (out.posted || 0) + (sg.status === 'posted' ? 1 : 0) });
    }
    if (out.error) return res.status(400).json({ error: out.error });
    res.json(out);
  } catch (e) { res.status(502).json({ error: e.message }); }
});

/** Task 160: title + caption + hashtags for the creator's own creation, from its prompt. */
async function writeMeta(userId, mediaUrl) {
  const llm = require('../lib/llm');
  const { rows: [job] } = await pool.query(
    "SELECT prompt, kind FROM squad_video_jobs WHERE user_id = $1 AND video_url = $2 AND status = 'done' LIMIT 1",
    [String(userId), mediaUrl]);
  if (!job || !job.prompt) return null;
  /* Live check 2026-10-02: the AI sometimes returns nothing usable (reasoning
     models spend small token budgets thinking), and the post went out with no
     title or hashtags. Bigger budget, and a plain fallback built from the
     prompt so every 1-click post still gets a title, caption and hashtags. */
  const fallback = () => {
    const words = String(job.prompt).replace(/[|].*$/, '').replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 3);
    const stop = new Set(['with', 'that', 'this', 'from', 'into', 'over', 'vertical', 'cinematic', 'dramatic']);
    const tags = [...new Set(words.map((w) => w.toLowerCase()).filter((w) => !stop.has(w)))].slice(0, 5).map((w) => '#' + w);
    const t = String(job.prompt).replace(/[|].*$/, '').split(/[,.]/)[0].trim().slice(0, 60);
    return { title: t, caption: t + ' \uD83D\uDCAA Made with ScanGym', hashtags: [...tags, '#gym', '#ScanGym'] };
  };
  if (!llm.configured()) return fallback();
  let completion;
  try {
    ({ completion } = await llm.chat('PostMeta', {
    temperature: 0.8, max_tokens: 1200,
    messages: [
      { role: 'system', content: 'You write social posts for TikTok, Instagram Reels and YouTube Shorts for ScanGym, a "book any gym for £5 a day" fitness app. Reply with JSON only: {"title": max 60 chars, "caption": 1-2 punchy lines with 1-2 emoji, "hashtags": 5-8 relevant hashtags each starting with #, always include #ScanGym}. No quotes around the JSON, no markdown.' },
      { role: 'user', content: `This ${job.kind || 'video'} was made with the prompt: ${String(job.prompt).slice(0, 600)}` },
    ],
  }));
  } catch (e) { return fallback(); }
  const raw = String(completion?.choices?.[0]?.message?.content || '').replace(/^```(json)?|```$/g, '').trim();
  let j; try { j = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch (e) { console.warn('[PostMeta] unusable AI reply, using fallback'); return fallback(); }
  const tags = (Array.isArray(j.hashtags) ? j.hashtags : String(j.hashtags || '').split(/\s+/))
    .map((t) => '#' + String(t).replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter((t) => t.length > 1).slice(0, 8);
  if (!tags.some((t) => /^#scangym$/i.test(t))) tags.push('#ScanGym');
  const title = String(j.title || '').trim().slice(0, 60);
  const caption = String(j.caption || '').trim().slice(0, 300);
  if (!title && !caption) return fallback();
  return { title: title || caption.slice(0, 60), caption, hashtags: tags };
}

function displayName(u) {
  const n = [u && u.first_name, u && u.last_name ? String(u.last_name)[0] + '.' : ''].filter(Boolean).join(' ');
  return n || (u && u.email ? String(u.email).split('@')[0] : 'ScanGym creator');
}
/** Publish the caller's own finished video creation to ScanGym Home. */
async function postToScanGym(user, p) {
  if (p.mediaType !== 'video' || !p.mediaUrl) return { status: 'skipped', note: 'Home shows videos only' };
  const { rows: [job] } = await pool.query(
    "SELECT id FROM squad_video_jobs WHERE user_id = $1 AND video_url = $2 AND status = 'done' LIMIT 1",
    [String(user.id), p.mediaUrl]);
  if (!job) return { status: 'skipped', note: 'Only your own creations can go on ScanGym' };
  const name = (p.title || p.text || 'New creation').split('\n')[0].slice(0, 90) + ' \u00b7 by ' + displayName(user);
  /* Task 161: sell one of your own active Shop products inside the video. */
  let productId = null;
  if (p.productId) {
    const { rows: [pr] } = await pool.query(
      "SELECT id FROM shop_products WHERE id = $1 AND creator_user_id::text = $2 AND status = 'active'", [p.productId, String(user.id)]);
    productId = pr ? pr.id : null;
  }
  const r = await pool.query(
    `INSERT INTO video_catalog (name, category, source, url, cdn_key, orientation, dopamine_tier, active, shop_product_id)
     VALUES ($1, 'ScanGym creators', 'creation', $2, $3, 'vertical', 3, true, $4)
     ON CONFLICT (cdn_key) DO UPDATE SET shop_product_id = COALESCE(EXCLUDED.shop_product_id, video_catalog.shop_product_id),
       name = CASE WHEN $5 THEN EXCLUDED.name ELSE video_catalog.name END
     RETURNING id, (xmax = 0) AS inserted`, [name, p.mediaUrl, 'creation:' + job.id, productId, !!p.title]);
  const row = r.rows[0];
  if (!row) return { status: 'skipped', note: 'Already on ScanGym' };
  if (!row.inserted) return (productId || p.title) ? { status: 'posted', id: row.id, productId, note: productId ? 'Product added to your video' : 'Title updated' } : { status: 'skipped', note: 'Already on ScanGym' };
  return { status: 'posted', id: row.id, productId };
}

/** One post to every connected account (or just `apps`). Shared by the
 *  route above, the Create tab's one-tap Post and every chatbot (Task 56). */
async function postEverywhere(userId, p, apps) {
  let accounts = await myAccounts(userId);
  if (Array.isArray(apps) && apps.length) accounts = accounts.filter(a => apps.includes(a.slug));
  if (!accounts.length) return { error: 'Connect at least one account first', results: [], posted: 0 };
  const results = await Promise.all(accounts.map(async a => {
    const base = { app: a.slug, appName: APPS[a.slug].name, account: a.name || '' };
    try {
      const r = await postTo(userId, a, p);
      if (r && r.skipped) return { ...base, status: 'skipped', note: r.skipped };
      return { ...base, status: 'posted' };
    } catch (e) { return { ...base, status: 'failed', note: e.message.slice(0, 200) }; }
  }));
  return { results, posted: results.filter(r => r.status === 'posted').length };
}

module.exports = router;
module.exports.APPS = APPS;
module.exports.postEverywhere = postEverywhere;
module.exports.myAccounts = myAccounts;
module.exports.isConfigured = configured;
module.exports._internals = { postToScanGym, displayName };
module.exports.writeMeta = writeMeta;
