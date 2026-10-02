/**
 * Task 105 (owner, 2026-10-02): the Home tab's top tabs, TikTok/YouTube style —
 * For You · Following · Near me · Trending · Drama · Movie · Podcast · Live —
 * each one a real feed a customer can swipe, end to end.
 *
 * Where each feed comes from (the cheapest proven source for each):
 *  - For You    the existing ranked /api/reels/feed (client keeps using it)
 *  - Following  reel_follows (Task 64) matched against every reel's creator key
 *  - Trending   video_performance engagement (views, likes, shares, saves)
 *  - Near me    YouTube Data API search with location + locationRadius,
 *               cached per ~50km grid cell; falls back to the visitor's country
 *  - Drama / Movie / Podcast   YouTube Shorts searches per topic
 *  - Live       YouTube search eventType=live (streams on air right now)
 *
 * YouTube results are stored in social_reels under a "Tab: …" category so
 * they never leak into For You, and refreshed at most every CACHE_HOURS per
 * query: 100 quota units a search, so the whole set costs well under the
 * shared 10k/day key even with many cities.
 */
const pool = require('../middleware/db');

const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY; // same key the Shorts refresh uses
const CACHE_HOURS = { live: 1, nearme: 24, topic: 12 };
const MAX_ITEMS = 60;

const TABS = [
  { key: 'foryou', label: 'For You' },
  { key: 'following', label: 'Following' },
  { key: 'nearme', label: 'Near me' },
  { key: 'trending', label: 'Trending' },
  { key: 'drama', label: 'Drama', queries: ['short drama series episode', 'mini drama shorts'] },
  { key: 'movie', label: 'Movie', queries: ['official trailer', 'new movie trailer 2026'] },
  { key: 'podcast', label: 'Podcast', queries: ['podcast clips shorts', 'fitness podcast clip'] },
  // Live: three broad searches, worldwide — one word in one region found no
  // streams on the first live run (2026-10-02).
  { key: 'live', label: 'Live', queries: ['live stream', 'live workout', 'live music'], live: true, worldwide: true },
];
const TAB_BY_KEY = Object.fromEntries(TABS.map((t) => [t.key, t]));

function tabCategory(key) { return `Tab: ${TAB_BY_KEY[key] ? TAB_BY_KEY[key].label : key}`; }

/** The same creator key the player uses for Follow (reels/index.html creatorOf). */
function creatorKeyOf(v) {
  const c = (v && v.creator) || {};
  return String(c.handle || (v && v.author) || 'scangym').toLowerCase().slice(0, 120);
}

function youtubeParams({ query, live, lat, lng, regionCode, pageToken }) {
  const p = new URLSearchParams({
    part: 'snippet', q: query, type: 'video', videoEmbeddable: 'true',
    maxResults: '25', safeSearch: 'strict', key: GOOGLE_API_KEY || '',
  });
  if (live) { p.set('eventType', 'live'); p.set('order', 'viewCount'); p.set('safeSearch', 'moderate'); }
  else { p.set('videoDuration', 'short'); p.set('order', 'relevance'); }
  if (lat != null && lng != null) { p.set('location', `${lat},${lng}`); p.set('locationRadius', '50km'); }
  if (regionCode) p.set('regionCode', regionCode);
  if (pageToken) p.set('pageToken', pageToken);
  return p;
}

function toRow(item, query, category, live) {
  const id = item.id.videoId;
  return {
    external_id: `yt_${id}`,
    title: item.snippet.title,
    author_name: item.snippet.channelTitle,
    author_url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
    thumbnail_url: (item.snippet.thumbnails && (item.snippet.thumbnails.high || item.snippet.thumbnails.medium || {}).url) || null,
    video_url: live ? `https://www.youtube.com/watch?v=${id}` : `https://www.youtube.com/shorts/${id}`,
    search_query: query,
    category,
  };
}

async function stale(cacheKey, hours) {
  try {
    const { rows } = await pool.query('SELECT last_fetched FROM social_reels_cache WHERE query_key = $1', [cacheKey]);
    if (!rows.length) return true;
    return (Date.now() - new Date(rows[0].last_fetched).getTime()) / 3600000 > hours;
  } catch (e) { return true; }
}

async function markFetched(cacheKey, count) {
  await pool.query(
    `INSERT INTO social_reels_cache (query_key, result_count, last_fetched) VALUES ($1, $2, NOW())
     ON CONFLICT (query_key) DO UPDATE SET result_count = $2, last_fetched = NOW()`,
    [cacheKey, count]
  ).catch(() => {});
}

/** One YouTube search → rows in social_reels. Never throws: a tab with old rows still works. */
async function fetchInto({ cacheKey, hours, query, live, lat, lng, regionCode, category, fetchImpl = fetch }) {
  if (!GOOGLE_API_KEY || !(await stale(cacheKey, hours))) return 0;
  try {
    const r = await fetchImpl(`https://www.googleapis.com/youtube/v3/search?${youtubeParams({ query, live, lat, lng, regionCode })}`);
    if (!r.ok) { console.warn('[home-tabs] YouTube', r.status, cacheKey); return 0; }
    const data = await r.json();
    const items = (data.items || []).filter((i) => i.id && i.id.videoId && i.snippet);
    if (live) {
      // A stream that ended is a dead slide: drop yesterday's live rows first.
      await pool.query("DELETE FROM social_reels WHERE category = $1 AND search_query = $2", [category, query]).catch(() => {});
    }
    for (const it of items) {
      const row = toRow(it, query, category, live);
      await pool.query(
        `INSERT INTO social_reels (platform, external_id, title, author_name, author_url, thumbnail_url, embed_html, video_url, search_query, category, is_approved)
         VALUES ('youtube', $1, $2, $3, $4, $5, NULL, $6, $7, $8, true)
         ON CONFLICT (external_id) DO UPDATE SET title = EXCLUDED.title, thumbnail_url = EXCLUDED.thumbnail_url,
           search_query = EXCLUDED.search_query, category = EXCLUDED.category, fetched_at = NOW()`,
        [row.external_id, row.title, row.author_name, row.author_url, row.thumbnail_url, row.video_url, row.search_query, row.category]
      ).catch((e) => console.warn('[home-tabs] upsert', e.message));
    }
    await markFetched(cacheKey, items.length);
    return items.length;
  } catch (e) {
    console.warn('[home-tabs] fetch failed', cacheKey, e.message);
    return 0;
  }
}

/** social_reels rows → the slide shape the Home player already renders (type 'social'). */
function toSlide(r) {
  return {
    id: `social_${r.id}`, name: r.title || '', category: r.category, source: 'youtube', type: 'social',
    externalId: r.external_id, url: r.video_url, thumb: r.thumbnail_url, posterUrl: r.thumbnail_url,
    author: r.author_name || '', authorUrl: r.author_url || '', orientation: 'vertical',
    live: r.category === tabCategory('live'),
  };
}

async function rowsFor(where, params) {
  const { rows } = await pool.query(
    `SELECT id, external_id, title, author_name, author_url, thumbnail_url, video_url, category
       FROM social_reels WHERE is_hidden = false AND ${where}
      ORDER BY fetched_at DESC, id DESC LIMIT ${MAX_ITEMS}`, params);
  return rows.map(toSlide);
}

/** ~50km grid so nearby visitors share one cached search. */
function cell(lat, lng) {
  const la = Number(lat), ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) return null;
  return { lat: (Math.round(la * 2) / 2) + 0, lng: (Math.round(ln * 2) / 2) + 0 }; // +0 turns -0 into 0 for the cache key
}

/**
 * Build one tab. `all` is the full For You list (catalog + uploads + social),
 * `perf` the video_performance map, `follows` the signed-in user's creator keys.
 */
async function buildTab(key, { all = [], perf = new Map(), follows = null, lat, lng, country } = {}) {
  const tab = TAB_BY_KEY[key];
  if (!tab || key === 'foryou') return { tab: key, videos: all.slice(0, MAX_ITEMS) };

  if (key === 'following') {
    if (follows == null) return { tab: key, videos: [], needsLogin: true, message: 'Sign in to see creators you follow.' };
    const set = new Set(follows);
    const videos = all.filter((v) => set.has(creatorKeyOf(v))).slice(0, MAX_ITEMS);
    return { tab: key, videos, message: videos.length ? null : 'Follow creators with the + on any reel and their videos land here.' };
  }

  if (key === 'trending') {
    const score = (v) => {
      const p = perf.get(String(v.cdnKey || v.id || '')) || {};
      return (p.views || 0) + 5 * (p.likeCount || 0) + 10 * (p.shareCount || 0) + 8 * (p.saveCount || 0) + (p.score || 0);
    };
    const videos = all.filter((v) => v.type !== 'ad').map((v) => [score(v), v])
      .sort((a, b) => b[0] - a[0]).slice(0, MAX_ITEMS).map((x) => x[1]);
    return { tab: key, videos };
  }

  if (key === 'nearme') {
    const c = cell(lat, lng);
    const region = /^[A-Z]{2}$/.test(String(country || '')) ? country : 'GB';
    const query = 'gym';
    const category = c ? `${tabCategory('nearme')} ${c.lat},${c.lng}` : `${tabCategory('nearme')} ${region}`;
    await fetchInto({ cacheKey: `tab:${category}`, hours: CACHE_HOURS.nearme, query, lat: c && c.lat, lng: c && c.lng, regionCode: region, category });
    const videos = await rowsFor('category = $1', [category]);
    return { tab: key, videos, place: c ? 'near you' : region, message: videos.length ? null : 'No gym videos near you yet.' };
  }

  const category = tabCategory(key);
  for (const q of tab.queries) {
    await fetchInto({ cacheKey: `tab:${key}:${q}`, hours: tab.live ? CACHE_HOURS.live : CACHE_HOURS.topic, query: q, live: !!tab.live,
      regionCode: tab.worldwide ? null : (country && /^[A-Z]{2}$/.test(country) ? country : 'GB'), category });
  }
  const videos = await rowsFor('category = $1', [category]);
  return { tab: key, videos, message: videos.length ? null : `Nothing in ${tab.label} right now — check back soon.` };
}

module.exports = { TABS, TAB_BY_KEY, buildTab, tabCategory, creatorKeyOf, youtubeParams, cell, fetchInto };
