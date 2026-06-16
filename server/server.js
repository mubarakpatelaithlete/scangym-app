const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');
const compression = require('compression');

// Import feature routes
const reviewsRouter = require('./routes/reviews');
const reviewMediaRouter = require('./routes/review-media');
const chatRouter = require('./routes/chat');
const walletRouter = require('./routes/wallet');
const guestRouter = require('./routes/guest');
const coachRouter = require('./routes/coach');
const gymProfileRouter = require('./routes/gymProfile');
const ownerRouter = require('./routes/owner');
const statsRouter = require('./routes/stats');
const creatorsRouter = require('./routes/creators');
const reelsRouter = require('./routes/reels');
const ingestRouter = require('./routes/ingest');
// M12: videoProxy.js deleted — all videos use CDN directly
const directionsRouter = require('./routes/directions');
const qrRouter = require('./routes/qr');
const convictionRouter = require('./routes/conviction');
const authRouter = require('./routes/auth');
const bookingRouter = require('./routes/booking');
const paymentRouter = require('./routes/payment');
const pricingRouter = require('./routes/pricing');
const liveSearchRouter = require('./routes/liveSearch');
const geolocationRouter = require('./routes/geolocation');
const referralsRouter = require('./routes/referrals');
const streaksRouter = require('./routes/streaks');
const accessRouter = require('./routes/access');
const chatbotRouter = require('./chatbot');
const commsLogRouter = require('./routes/comms-log');
const paymentsExtendedRouter = require('./routes/payments-extended');
const aiFeaturesRouter = require('./routes/ai-features');
const analyticsMiddleware = require('./middleware/analytics');

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy (needed for secure cookies + IP detection)
app.disable('x-powered-by'); // Don't leak server technology
const PORT = process.env.PORT || 5000;

// Frontend directory (Dockerfile copies it to ./public/)
const FRONTEND_DIR = path.join(__dirname, 'public');

// -- Middleware --
// Serve pre-compressed Brotli (.br) and gzip (.gz) files when available
// Generated at build time (build.js) with max compression (Brotli quality 11).
// Falls back to on-the-fly gzip for dynamic responses (API JSON, etc.)
app.use((req, res, next) => {
  // Only handle GET requests for static files
  if (req.method !== 'GET') return next();
  
  // Skip API routes and SPA fallback (handled separately)
  if (req.path.startsWith('/api/') || req.path === '/') return next();
  
  const acceptEncoding = req.headers['accept-encoding'] || '';
  const filePath = path.join(FRONTEND_DIR, req.path);
  
  // Content type map
  const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.xml': 'application/xml' };
  
  // Cache headers based on file type (match express.static logic)
  function setCacheHeaders(res, reqPath) {
    if (reqPath.endsWith('.html') || reqPath.endsWith('sw.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (reqPath.endsWith('.js') || reqPath.endsWith('.css')) {
      // JS/CSS: browser caches 1 day, CDN revalidates on every request (s-maxage=0).
      // Cloudflare auto-purge on startup ensures fresh content after each deploy.
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=0, must-revalidate');
    }
  }
  
  // Try Brotli first (15-25% better than gzip)
  if (acceptEncoding.includes('br')) {
    const brPath = filePath + '.br';
    if (fs.existsSync(brPath)) {
      res.setHeader('Content-Encoding', 'br');
      res.setHeader('Vary', 'Accept-Encoding');
      const ext = path.extname(req.path);
      if (TYPES[ext]) res.setHeader('Content-Type', TYPES[ext] + '; charset=utf-8');
      setCacheHeaders(res, req.path);
      return res.sendFile(brPath);
    }
  }
  
  // Try gzip
  if (acceptEncoding.includes('gzip')) {
    const gzPath = filePath + '.gz';
    if (fs.existsSync(gzPath)) {
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      const ext = path.extname(req.path);
      if (TYPES[ext]) res.setHeader('Content-Type', TYPES[ext] + '; charset=utf-8');
      setCacheHeaders(res, req.path);
      return res.sendFile(gzPath);
    }
  }
  
  next();
});

// On-the-fly gzip for ALL responses (static + API JSON + server-rendered HTML)
// The filter ensures text-based content types are always compressed
app.use(compression({
  level: 6,
  threshold: 256,
  filter: (req, res) => {
    // Always compress if Accept-Encoding is present
    if (req.headers['accept-encoding']) {
      const type = res.getHeader('Content-Type') || '';
      // Compress all text-based content types
      if (/text|javascript|json|xml|svg|css|html|font/.test(type)) return true;
    }
    return compression.filter(req, res);
  }
}));
// CORS — locked to known origins (was: origin: true — accepted everything)
const ALLOWED_ORIGINS = [
  'https://scangym.com',
  'https://www.scangym.com',
  'https://scangym-api-v2-production.up.railway.app',
];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:5000');
}
app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no origin header) and whitelisted origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// Rate limiting — protect auth, payment, and chat endpoints from abuse
const rateLimit = require('express-rate-limit');
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });
const authLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 10,  message: { error: 'Too many attempts, try again in 15 minutes' } });
const paymentLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many payment requests, try again later' } });
app.use(globalLimiter);
app.use('/api/auth', authLimiter);
app.use('/api/payment', paymentLimiter);

// Session middleware (must come before routes)
// Session store: PostgreSQL via connect-pg-simple (was: default MemoryStore — leaked memory + lost sessions on deploy)
// NOTE: createTableIfMissing uses CREATE INDEX (not IF NOT EXISTS) which throws
// "relation IDX_session_expire already exists" on every query after first boot,
// causing 500 errors. We create the table ourselves, then set createTableIfMissing: false.
const pgSession = require('connect-pg-simple')(session);
let sessionStore;
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const sessionPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  // Ensure session table + index exist (idempotent)
  sessionPool.query(`
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL,
      CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "user_sessions" ("expire");
  `).then(() => console.log('Session table ready'))
    .catch(err => console.error('Session table setup error:', err.message));
  sessionStore = new pgSession({
    pool: sessionPool,
    tableName: 'user_sessions',
    createTableIfMissing: false,  // We handle it above with IF NOT EXISTS
    pruneSessionInterval: 60 * 15, // Clean expired sessions every 15 min
    errorLog: (err) => console.error('Session store error:', err.message),
  });
} // falls back to MemoryStore in local dev only

if (!process.env.SESSION_SECRET) {
  console.error('⚠️  SESSION_SECRET env var is not set — sessions are insecure. Set it in Railway.');
}
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || (() => { if (process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is required in production'); return 'dev-only-secret-' + Date.now(); })(),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true on Railway (HTTPS via proxy)
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
  proxy: true, // Trust Railway's reverse proxy for secure cookies
}));

// Analytics tracking middleware (Task 21)
app.use(analyticsMiddleware);

// Stripe webhook needs raw body BEFORE json parsing
// H13 fix: Also listen on /api/owner/stripe-webhook — Stripe was configured
// to send events there but the route didn't exist (71 failures since June 4).
const _stripeWebhookHandler = async (req, res) => {
  const pool = require('./middleware/db');
  const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY;
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
  let stripe;
  try { stripe = require('stripe')(STRIPE_SECRET); } catch(e) { return res.status(500).send('Stripe not configured'); }

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // No webhook secret configured — parse directly (less secure, but functional)
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // NOTE: checkout.session.completed handler removed — we no longer use Stripe Checkout Sessions.
  // All payments now go through PaymentIntents (Stripe Elements) or saved card (quick-checkout).

  // Safety net: Handle payment_intent.succeeded for edge cases
  // (network drop after payment, user closes tab before /confirm-intent completes, etc.)
  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object;
    const bookingId = intent.metadata?.bookingId ? parseInt(intent.metadata.bookingId) : null;
    if (bookingId) {
      try {
        // Only update if not already confirmed (avoid double-processing)
        const existing = await pool.query(
          'SELECT id, status FROM public.bookings WHERE id = $1',
          [bookingId]
        );
        if (existing.rows.length > 0 && existing.rows[0].status !== 'confirmed') {
          const qrToken = 'BOOK_' + require('crypto').randomBytes(8).toString('hex').toUpperCase();
          await pool.query(
            `UPDATE public.bookings
             SET status = 'confirmed',
                 qr_code = $1,
                 stripe_payment_intent_id = $2,
                 stripe_payment_status = 'paid',
                 updated_at = NOW()
             WHERE id = $3 AND status != 'confirmed'`,
            [qrToken, intent.id, bookingId]
          );
          console.log(`✅ Webhook: Booking #${bookingId} confirmed via Stripe (payment_intent.succeeded)`);
        }
      } catch (dbErr) {
        console.error('Webhook DB error (payment_intent.succeeded):', dbErr.message);
      }
    }
  }

  res.json({ received: true });
};
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), _stripeWebhookHandler);
app.post('/api/owner/stripe-webhook', express.raw({ type: 'application/json' }), _stripeWebhookHandler);

// Parse JSON for API routes
const apiPaths = [
  '/api/reviews', '/api/chat', '/api/wallet', '/api/guest',
  '/api/coach', '/api/gym-profile', '/api/owner', '/api/stats',
  '/api/creators', '/api/directions', '/api/qr', '/api/conviction',
  '/api/auth', '/api/bookings', '/api/payment', '/api/live',
  '/api/geolocation',
  '/api/streaks',
];
apiPaths.forEach(p => app.use(p, express.json()));

// -- Health check (Railway uses this for deploy validation) --
app.get('/health', (req, res) => res.status(200).send('ok'));
app.get('/api/v2/health', (req, res) => {
  res.json({
    status: 'ok', version: 'v4.6.0', brand: 'ScanGym',
    ts: new Date().toISOString(),
    features: 18, tasks: '24/24 + auth + booking + payment + live-search', ok: true,
    frontend: fs.existsSync(path.join(FRONTEND_DIR, 'index.html')) ? 'v3' : 'none',
  });
});

// -- Config endpoint (public keys for frontend) --
// gymCount = 1,200,000 — the Google Places searchable universe.
// ScanGym uses live Google Places search, so any gym on Earth is bookable.
// C2-C4 fix: mapsKey is ONLY for Google Maps JS API (requires client-side key).
// Photo URLs now proxy through /api/photo — key never appears in photo/embed URLs.
// NOTE: Restrict this key in Google Cloud Console → HTTP referrer to your domain only.
app.get("/api/config", async (req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || "",
    stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    brand: "ScanGym",
    liveSearch: true,
    gymCount: 1200000, // Google Places searchable gyms worldwide
  });
});

// ── C2-C4 fix: Photo proxy — keeps Google API key server-side ──
// Frontend calls /api/photo?ref=PHOTO_REF&maxwidth=1200 instead of hitting Google directly.
// Supports both legacy photo_reference (ref=) and new Places API (name=).
app.get("/api/photo", async (req, res) => {
  try {
    const { ref, name, maxwidth = '1200', maxheight } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Maps API key not configured' });

    let googleUrl;
    if (name) {
      // New Places API format: /v1/places/PLACE_ID/photos/PHOTO_REF/media
      googleUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxwidth}${maxheight ? `&maxHeightPx=${maxheight}` : ''}&key=${apiKey}`;
    } else if (ref) {
      // Legacy format: photo_reference
      googleUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${maxwidth}&photo_reference=${ref}&key=${apiKey}`;
    } else {
      return res.status(400).json({ error: 'Missing ref or name parameter' });
    }

    // Fetch from Google (native fetch, Node 18+) — follows redirects automatically
    const response = await fetch(googleUrl, { redirect: 'follow' });
    if (!response.ok) return res.status(response.status).send('Photo not found');

    // Forward content-type and cache aggressively (photos don't change)
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800'); // 1d client, 7d CDN

    // Stream the image bytes to client
    const arrayBuf = await response.arrayBuffer();
    res.send(Buffer.from(arrayBuf));
  } catch (err) {
    console.error('Photo proxy error:', err.message);
    res.status(502).json({ error: 'Failed to fetch photo' });
  }
});

// ── C3 fix: Map embed proxy — keeps Google API key server-side ──
app.get("/api/map-embed", (req, res) => {
  const { place_id } = req.query;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!place_id || !apiKey) return res.status(400).send('Missing place_id');
  // Return an HTML page with the embedded map — key stays in server-generated HTML, not in API responses
  res.setHeader('Content-Type', 'text/html');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"><style>*{margin:0;padding:0}iframe{width:100%;height:100vh;border:none}</style></head><body><iframe src="https://www.google.com/maps/embed/v1/place?key=${apiKey}&q=place_id:${place_id}" allowfullscreen></iframe></body></html>`);
});

// -- DB Migrations (idempotent — safe to run every startup) --
if (process.env.DATABASE_URL) {
  const _migrationPool = require('./middleware/db');
  _migrationPool.query(`
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
  `).then(() => console.log('✅ DB migration: stripe_customer_id ready'))
    .catch(err => console.error('DB migration error:', err.message));

  // M11 FIX: Add duration column to video_catalog (stores video length in seconds)
  _migrationPool.query(`
    ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS duration REAL;
  `).then(() => console.log('✅ DB migration: video_catalog.duration ready'))
    .catch(err => console.error('DB migration (duration):', err.message));

  // VIDEO OPTIMIZATIONS: Add variant tracking columns
  _migrationPool.query(`
    ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS has_faststart BOOLEAN DEFAULT false;
    ALTER TABLE video_catalog ADD COLUMN IF NOT EXISTS variants_ready BOOLEAN DEFAULT false;
  `).then(() => console.log('✅ DB migration: video variants columns ready'))
    .catch(err => console.error('DB migration (variants):', err.message));

  // ChatGPT Playbook: Auto-affiliate link for every user
  _migrationPool.query(`
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_handle VARCHAR(100);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_handle ON public.users (referral_handle) WHERE referral_handle IS NOT NULL;
  `).then(() => console.log('✅ DB migration: referral_handle ready'))
    .catch(err => console.error('DB migration (referral_handle):', err.message));
}

// -- Feature Routes (Tasks 1-24 with CEO corrections) --
app.use('/api/reviews', reviewsRouter);
app.use('/api/review-media', reviewMediaRouter);
app.use('/api/chat', chatRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/guest', guestRouter);
app.use('/api/coach', coachRouter);
app.use('/api/gym-profile', gymProfileRouter);
app.use('/api/owner', ownerRouter);
app.use('/api/stats', statsRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api/reels', reelsRouter);
app.use('/api/reels/admin/ingest', ingestRouter);
// M12: video-proxy route removed — CDN serves directly
app.use('/api/directions', directionsRouter);
app.use('/api/qr', qrRouter);
app.use('/api/conviction', convictionRouter);

// -- Auth, Booking & Payment routes --
app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/pricing', pricingRouter);
app.use('/api/live', liveSearchRouter);
app.use('/api/geolocation', geolocationRouter);
app.use('/api/referrals', referralsRouter);
app.use('/api/streaks', streaksRouter);
app.use('/api/access', accessRouter);
app.use('/api/chatbot', chatbotRouter);
app.use('/api/comms-log', commsLogRouter);
app.use('/api/payments', paymentsExtendedRouter);
app.use('/api/ai', aiFeaturesRouter);

// -- Serve Frontend --
// Digital Asset Links for Android TWA verification
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send('[\n  {\n    "relation": [\n      "delegate_permission/common.handle_all_urls"\n    ],\n    "target": {\n      "namespace": "android_app",\n      "package_name": "com.scangym.app",\n      "sha256_cert_fingerprints": [\n        "DB:C8:C8:0A:38:CD:2D:79:1D:35:20:A1:88:8A:5B:80:0F:3E:D2:A8:EE:D9:1C:28:56:8B:08:D2:51:EA:98:8D"\n      ]\n    }\n  }\n]');
});

if (fs.existsSync(FRONTEND_DIR)) {
  // Long cache for immutable JS/CSS assets, short for HTML
  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // PERF FIX: Reels SSR route MUST be registered BEFORE express.static
  // so express.static doesn't intercept /reels/ and serve the raw index.html.
  // This enables server-side feed injection (eliminates ~800ms client-side API call).
  const reelsHtmlPath = path.join(FRONTEND_DIR, 'reels', 'index.html');
  let _reelsHtmlTemplate = null;

  function getReelsHtml() {
    if (!_reelsHtmlTemplate) {
      _reelsHtmlTemplate = fs.readFileSync(reelsHtmlPath, 'utf8');
    }
    return _reelsHtmlTemplate;
  }

  // Bust HTML template cache on file change (dev mode)
  try { fs.watchFile(reelsHtmlPath, () => { _reelsHtmlTemplate = null; }); } catch {}

  /**
   * Slim a feed payload down to only fields the player needs on first paint.
   * Strips ~40% of JSON bytes (fileSize, driveId, source, thumb, width, height,
   * dopamineTier, duration, hasFaststart, variantsReady, type, uploadedAt).
   */
  function slimFeedForSSR(feedData) {
    if (!feedData || !feedData.videos) return feedData;
    feedData.videos = feedData.videos.map(v => {
      const slim = {
        id: v.id,
        name: v.name,
        category: v.category,
        cdnKey: v.cdnKey,
        url: v.url,
        blurhash: v.blurhash,
        orientation: v.orientation,
      };
      if (v.variants) slim.variants = v.variants;
      if (v.creator) slim.creator = v.creator;
      if (v.posterUrl) slim.posterUrl = v.posterUrl;
      return slim;
    });
    return feedData;
  }

  async function serveReelsWithPrefetch(req, res) {
    // Allow browser to serve stale HTML while revalidating in background
    res.setHeader('Cache-Control', 'no-cache, stale-while-revalidate=30');
    res.setHeader('Content-Type', 'text/html; charset=UTF-8');

    try {
      // PERF: Only inject first 15 videos (~4-6KB slimmed) instead of all 115.
      // Client loads the rest lazily after first paint.
      const feedUrl = `http://127.0.0.1:${PORT}/api/reels/feed?limit=15&offset=0&shuffle=true`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 400);
      const feedRes = await fetch(feedUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (feedRes.ok) {
        const feedData = JSON.parse(await feedRes.text());
        let html = getReelsHtml();

        // PERF: Slim feed — strip fields the player doesn't need (saves ~40% JSON)
        slimFeedForSSR(feedData);
        const feedJson = JSON.stringify(feedData);

        // Build preload hints for the first video (poster + video source)
        let preloadHints = '';
        const firstVideo = feedData.videos && feedData.videos[0];
        if (firstVideo) {
          // Poster preload
          if (firstVideo.cdnKey) {
            preloadHints += `<link rel="preload" href="/api/reels/poster/${firstVideo.cdnKey}" as="image" />\n    `;
          }
          // Video source preload — starts downloading actual video during HTML parse
          // Use the smallest suitable variant (480p) for fast first-frame, or original
          let videoPreloadUrl = '';
          if (firstVideo.variants) {
            // Prefer 480p (good quality/size tradeoff for first load)
            const vk = firstVideo.variants['480p'] || firstVideo.variants['360p'] || firstVideo.variants['720p'];
            if (vk && vk.url) videoPreloadUrl = vk.url;
          }
          if (!videoPreloadUrl && firstVideo.cdnKey) {
            videoPreloadUrl = `https://cdn.scangym.com/videos/${firstVideo.cdnKey}.mp4`;
          }
          if (videoPreloadUrl) {
            preloadHints += `<link rel="preload" href="${videoPreloadUrl}" as="video" type="video/mp4" crossorigin />\n    `;
          }
        }

        // PERF: Remove the static prefetch hint for /api/reels/feed — SSR already injected it
        html = html.replace(/<link\s+rel="prefetch"\s+href="\/api\/reels\/feed[^"]*"[^>]*\/?>/i, '');

        // Inject: preload hints + feed JSON right before </head>
        const injection = `${preloadHints}<script>window.__PREFETCHED_FEED=${feedJson};</script>`;
        html = html.replace('</head>', injection + '\n</head>');
        return res.send(html);
      }
    } catch {
      // Feed fetch failed or timed out — serve vanilla HTML (client will fetch normally)
    }

    res.sendFile(reelsHtmlPath);
  }

  // Handle /reels and /reels/ — serve SSR-injected HTML for both
  app.get('/reels', serveReelsWithPrefetch);
  app.get('/reels/*', (req, res, next) => {
    // Static files (.js, .css, images, etc.) fall through to express.static
    if (req.path.includes('.')) return next();
    // SPA routes (no file extension) get SSR-injected HTML
    serveReelsWithPrefetch(req, res);
  });

  app.use(express.static(FRONTEND_DIR, {
    maxAge: '7d',
    dotfiles: 'allow',
    etag: true,
    lastModified: true,
    index: false, // Disable auto index.html so SPA catch-all can inject runtime config (geoHint, Google Client ID)
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        // Hashed filenames get 1-day cache + stale-while-revalidate; unhashed get 1h
        if (/\.[a-z0-9]{3,8}\.(js|css)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
        }
      } else if (/\.(webp|jpg|jpeg|png|gif|svg|ico)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      } else if (/\.(woff2?|ttf|otf|eot)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));

  // Serve creator uploads (approved videos)
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (/\.(mp4|webm|mov)$/i.test(filePath)) {
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=604800');
      }
    }
  }));

  // Upload Page — standalone page at /upload
  app.get('/upload', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'upload', 'index.html'));
  });
  app.get('/upload/*', (req, res, next) => {
    if (req.path.includes('.')) return next(); // let static files through
    res.sendFile(path.join(FRONTEND_DIR, 'upload', 'index.html'));
  });

  // G1 FIX: Redirect old /flexsquad URLs to /scansquad (so existing links don't break)
  app.get('/flexsquad', (req, res) => res.redirect(301, '/scansquad'));
  app.get('/flexsquad/*', (req, res) => res.redirect(301, req.url.replace('/flexsquad', '/scansquad')));

  // ScanSquad Creator Portal — standalone page at /scansquad
  app.get('/scansquad', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'scansquad', 'index.html'));
  });
  app.get('/scansquad/*', (req, res, next) => {
    const filePath = path.join(FRONTEND_DIR, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'scansquad', 'index.html'));
  });

  // Reels SSR routes are registered BEFORE express.static (see above)

  // CEO Dashboard
  app.get('/ceo-dashboard', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'ceo-dashboard', 'index.html'));
  });

  // Gym Partners Dashboard
  app.get('/gympartners-dashboard', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'gympartners-dashboard', 'index.html'));
  });

  // Gym Owner — Connect Access Control System
  app.get('/gympartners-dashboard/connect-access', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'gympartners-dashboard', 'connect-access.html'));
  });

  // ScanSquad Creator Dashboard
  app.get('/scansquad-dashboard', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'scansquad-dashboard', 'index.html'));
  });

  // Admin panel — upload review dashboard
  app.get('/admin/uploads', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'admin', 'uploads', 'index.html'));
  });

  // /about page — static, SEO-friendly, crawlable by LLMs
  app.get('/about', (req, res) => {
    res.sendFile(path.join(FRONTEND_DIR, 'about', 'index.html'));
  });

  // SPA fallback - serve index.html for all non-API routes
  // UBER PATTERN #4: Inject Cloudflare geolocation + IP geo into HTML for 0ms location detection
  let _indexHtmlCache = null;
  app.get('*', (req, res) => {
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) {
      return res.status(404).json({ error: 'Frontend not available' });
    }
    // Read and cache the template
    if (!_indexHtmlCache) _indexHtmlCache = fs.readFileSync(indexPath, 'utf8');

    // Build geo hint from Cloudflare headers (0ms) or geoip-lite (<1ms)
    let geoHint = 'null';
    const cfCity = req.headers['cf-ipcity'];
    const cfCountry = req.headers['cf-ipcountry'];
    const cfLat = req.headers['cf-iplatitude'];
    const cfLng = req.headers['cf-iplongitude'];
    if (cfCity && cfCity !== 'XX') {
      geoHint = JSON.stringify({ city: cfCity, country: cfCountry || '', lat: parseFloat(cfLat) || null, lng: parseFloat(cfLng) || null, source: 'cloudflare_edge' });
    } else {
      // Fallback: geoip-lite in-memory lookup (<1ms)
      try {
        const geoip = require('geoip-lite');
        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;
        const geo = geoip ? geoip.lookup(ip) : null;
        if (geo && geo.city) {
          geoHint = JSON.stringify({ city: geo.city, country: geo.country, lat: geo.ll?.[0], lng: geo.ll?.[1], source: 'geoip_inline' });
        }
      } catch (e) {}
    }

    // Inject geo hint + performance hints right before </head>
    const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
    const perfHints = `<script>window.__geoHint=${geoHint};window._sgGoogleClientId="${googleClientId}";</script>\n`;
    const html = _indexHtmlCache.replace('</head>', perfHints + '</head>');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
  console.log('Serving frontend from', FRONTEND_DIR);
}

// -- Global error handler — return JSON, not Express's default HTML --
app.use((err, req, res, next) => {
  console.error(`[${req.method} ${req.path}] Unhandled error:`, err.message || err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// -- Cloudflare cache auto-purge on deploy --
// Every Railway deploy restarts the server → purge CDN cache so users get fresh JS/CSS.
function purgeCloudflareCache() {
  const CF_ZONE_ID = process.env.CF_ZONE_ID || '74152524b3403c5a72d5f8a380f96a7a';
  const CF_AUTH_EMAIL = process.env.CF_AUTH_EMAIL;
  const CF_AUTH_KEY = process.env.CF_AUTH_KEY;
  if (!CF_AUTH_EMAIL || !CF_AUTH_KEY) {
    console.log('[CF] Skipping cache purge — CF_AUTH_EMAIL / CF_AUTH_KEY not set');
    return;
  }
  const https = require('https');
  const data = JSON.stringify({ purge_everything: true });
  const req = https.request({
    hostname: 'api.cloudflare.com',
    path: `/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
    method: 'POST',
    headers: {
      'X-Auth-Email': CF_AUTH_EMAIL,
      'X-Auth-Key': CF_AUTH_KEY,
      'Content-Type': 'application/json',
      'Content-Length': data.length,
    },
  }, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(body);
        console.log(`[CF] Cache purge ${json.success ? '✅ success' : '❌ failed'}`);
      } catch { console.log('[CF] Cache purge response:', body.slice(0, 200)); }
    });
  });
  req.on('error', (e) => console.log('[CF] Cache purge error:', e.message));
  req.write(data);
  req.end();
}

// -- Start --
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ScanGym v4.5.0 on :${PORT} | Frontend: ${fs.existsSync(FRONTEND_DIR+'/index.html')?'v3':'proxy'} | Auth: local session | Brotli+gzip pre-compressed`);

  // Purge Cloudflare CDN cache on every deploy so users get fresh assets
  setTimeout(purgeCloudflareCache, 5000);

  // Video enrichment + variants + posters now handled by the combined startup
  // pipeline in routes/reels.js (runs 30s after startup from DB catalog).
  // Removed duplicate JSON-based enrichment that was stale and wasted CPU.
});

