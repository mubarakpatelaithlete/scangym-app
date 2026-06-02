/**
 * Video Proxy — Streams video from Google Drive / Convex through the server.
 *
 * Why:
 *   - Google Drive direct links rate-limit client IPs → spinner/retry on the Reels page.
 *   - Convex HTTP actions (.convex.site/video) can timeout for large files.
 *   - This proxy adds response caching, range-request support, and a single stable origin.
 *
 * Route: GET /api/video-proxy?url=<encoded-url>
 *
 * Security:
 *   - Only allows proxying from whitelisted domains (Google Drive, Convex, GCS).
 *   - Rate-limited via global limiter already on the Express app.
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const { URL } = require('url');

// Domains we allow proxying from
const ALLOWED_HOSTS = [
  'drive.google.com',
  'drive.usercontent.google.com',
  'doc-0c-9g-docs.googleusercontent.com',      // GDrive direct download host
  'lh3.googleusercontent.com',
  'storage.googleapis.com',
  'dynamic-labrador-874.convex.site',
  'dynamic-labrador-874.convex.cloud',
];

// Simple in-memory cache for resolved redirect URLs (Google Drive redirects a lot)
const redirectCache = new Map();
const REDIRECT_CACHE_TTL = 10 * 60 * 1000; // 10 min

function isAllowedHost(hostname) {
  return ALLOWED_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h.replace(/^.*?\./, '')));
}

function isAllowedUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    // Also accept any *.googleusercontent.com or *.convex.site
    if (u.hostname.endsWith('.googleusercontent.com')) return true;
    if (u.hostname.endsWith('.convex.site')) return true;
    if (u.hostname.endsWith('.convex.cloud')) return true;
    return isAllowedHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Follow redirects (Google Drive sends 302 → 302 → 200).
 * Returns the final URL after all redirects.
 */
function resolveRedirects(urlStr, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const cached = redirectCache.get(urlStr);
    if (cached && Date.now() - cached.ts < REDIRECT_CACHE_TTL) {
      return resolve(cached.url);
    }

    const parsed = new URL(urlStr);
    const client = parsed.protocol === 'https:' ? https : http;

    const req = client.request(urlStr, { method: 'HEAD', timeout: 8000, headers: { 'User-Agent': 'ScanGym-VideoProxy/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, urlStr).href;
        resolveRedirects(next, maxRedirects - 1).then(resolve).catch(reject);
      } else {
        redirectCache.set(urlStr, { url: urlStr, ts: Date.now() });
        resolve(urlStr);
      }
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

/**
 * GET /api/video-proxy?url=<encoded-url>
 *
 * Streams the video back to the client, supporting Range headers for seeking.
 */
router.get('/', async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  if (!isAllowedUrl(targetUrl)) {
    return res.status(403).json({ error: 'Domain not allowed' });
  }

  try {
    // Resolve any redirects first
    const finalUrl = await resolveRedirects(targetUrl).catch(() => targetUrl);

    if (!isAllowedUrl(finalUrl)) {
      return res.status(403).json({ error: 'Redirect target domain not allowed' });
    }

    const parsed = new URL(finalUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    // Forward range header for seeking support
    const headers = {
      'User-Agent': 'ScanGym-VideoProxy/1.0',
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const proxyReq = client.request(finalUrl, { method: 'GET', timeout: 30000, headers }, (proxyRes) => {
      // If upstream redirects on GET (not just HEAD), follow it
      if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.headers.location) {
        const nextUrl = new URL(proxyRes.headers.location, finalUrl).href;
        if (!isAllowedUrl(nextUrl)) {
          return res.status(403).json({ error: 'Redirect not allowed' });
        }
        // Re-issue the request to the redirect target
        proxyRes.destroy();
        const nextParsed = new URL(nextUrl);
        const nextClient = nextParsed.protocol === 'https:' ? https : http;
        const nextReq = nextClient.request(nextUrl, { method: 'GET', timeout: 30000, headers }, (nextRes) => {
          streamResponse(nextRes, res);
        });
        nextReq.on('error', () => {
          if (!res.headersSent) res.status(502).json({ error: 'Upstream error' });
        });
        nextReq.on('timeout', () => { nextReq.destroy(); if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' }); });
        nextReq.end();
        return;
      }

      streamResponse(proxyRes, res);
    });

    proxyReq.on('error', () => {
      if (!res.headersSent) res.status(502).json({ error: 'Upstream connection error' });
    });
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!res.headersSent) res.status(504).json({ error: 'Upstream timeout' });
    });

    // If client disconnects, abort upstream
    res.on('close', () => { proxyReq.destroy(); });

    proxyReq.end();
  } catch (err) {
    console.error('[video-proxy] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Video proxy error' });
    }
  }
});

function streamResponse(upstream, clientRes) {
  // Map status code
  const status = upstream.statusCode;
  if (status >= 400) {
    if (!clientRes.headersSent) clientRes.status(status).json({ error: `Upstream returned ${status}` });
    return;
  }

  // Set response headers
  const responseHeaders = {};
  if (upstream.headers['content-type']) responseHeaders['Content-Type'] = upstream.headers['content-type'];
  if (upstream.headers['content-length']) responseHeaders['Content-Length'] = upstream.headers['content-length'];
  if (upstream.headers['content-range']) responseHeaders['Content-Range'] = upstream.headers['content-range'];
  if (upstream.headers['accept-ranges']) responseHeaders['Accept-Ranges'] = upstream.headers['accept-ranges'];

  // Cache for 1 hour on CDN/browser
  responseHeaders['Cache-Control'] = 'public, max-age=3600, s-maxage=7200';
  responseHeaders['Access-Control-Allow-Origin'] = '*';

  clientRes.writeHead(status, responseHeaders);
  upstream.pipe(clientRes);
}

// Prune redirect cache every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of redirectCache.entries()) {
    if (now - val.ts > REDIRECT_CACHE_TTL) redirectCache.delete(key);
  }
}, 10 * 60 * 1000);

module.exports = router;
