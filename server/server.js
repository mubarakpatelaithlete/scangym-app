const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');
const compression = require('compression');

// Import feature routes
const reviewsRouter = require('./routes/reviews');
const chatRouter = require('./routes/chat');
const walletRouter = require('./routes/wallet');
const guestRouter = require('./routes/guest');
const coachRouter = require('./routes/coach');
const gymProfileRouter = require('./routes/gymProfile');
const ownerRouter = require('./routes/owner');
const statsRouter = require('./routes/stats');
const creatorsRouter = require('./routes/creators');
const reelsRouter = require('./routes/reels');
const autoReelsRouter = require('./routes/autoReels');
const videoProxyRouter = require('./routes/videoProxy');
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
const analyticsMiddleware = require('./middleware/analytics');

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy (needed for secure cookies + IP detection)
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
    } else if (reqPath.endsWith('app.js') || /app\.[a-z0-9]+\.js$/.test(reqPath) || reqPath.endsWith('robust-location.js')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (reqPath.endsWith('.js') || reqPath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

// On-the-fly gzip for dynamic responses (API JSON, server-rendered HTML)
app.use(compression({ level: 6, threshold: 256 }));
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
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
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
app.post('/api/payment/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
});

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

// Auto-reel upload needs larger body limit (base64 videos up to 10MB)
app.use('/api/reels/auto-upload', express.json({ limit: '15mb' }));

// -- Health check --
app.get('/api/v2/health', (req, res) => {
  res.json({
    status: 'ok', version: 'v4.5.0', brand: 'ScanGym',
    ts: new Date().toISOString(),
    features: 18, tasks: '24/24 + auth + booking + payment + live-search', ok: true,
    frontend: fs.existsSync(path.join(FRONTEND_DIR, 'index.html')) ? 'v3' : 'none',
  });
});

// -- Config endpoint (public keys for frontend) --
// gymCount = 1,200,000 — the Google Places searchable universe.
// ScanGym uses live Google Places search, so any gym on Earth is bookable.
app.get("/api/config", async (req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || "",
    stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    brand: "ScanGym",
    liveSearch: true,
    gymCount: 1200000,
  });
});

// -- DB Migrations (idempotent — safe to run every startup) --
if (process.env.DATABASE_URL) {
  const _migrationPool = require('./middleware/db');
  _migrationPool.query(`
    ALTER TABLE public.users ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
    CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
  `).then(() => console.log('✅ DB migration: stripe_customer_id ready'))
    .catch(err => console.error('DB migration error:', err.message));
}

// -- Feature Routes (Tasks 1-24 with CEO corrections) --
app.use('/api/reviews', reviewsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/guest', guestRouter);
app.use('/api/coach', coachRouter);
app.use('/api/gym-profile', gymProfileRouter);
app.use('/api/owner', ownerRouter);
app.use('/api/stats', statsRouter);
app.use('/api/creators', creatorsRouter);
app.use('/api/reels', reelsRouter);
app.use('/api/reels', autoReelsRouter);
app.use('/api/video-proxy', videoProxyRouter);
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

  app.use(express.static(FRONTEND_DIR, {
    maxAge: '7d',
    dotfiles: 'allow',
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('app.js') || /app\.[a-z0-9]+\.js$/.test(filePath) || filePath.endsWith('robust-location.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
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

  // FlexSquad Creator Portal — standalone page at /flexsquad
  app.get('/flexsquad', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'flexsquad', 'index.html'));
  });
  app.get('/flexsquad/*', (req, res, next) => {
    const filePath = path.join(FRONTEND_DIR, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'flexsquad', 'index.html'));
  });

  // Reels app — dynamic API-driven feed (replaces static React bundle)
  app.get('/reels', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'reels', 'index.html'));
  });
  app.get('/reels/*', (req, res, next) => {
    const filePath = path.join(FRONTEND_DIR, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return next();
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'reels', 'index.html'));
  });

  // Admin panel — upload review dashboard
  app.get('/admin/uploads', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'admin', 'uploads', 'index.html'));
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
    const perfHints = `<script>window.__geoHint=${geoHint};</script>\n`;
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

// -- Start --
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ScanGym v4.4.0 on :${PORT} | Frontend: ${fs.existsSync(FRONTEND_DIR+'/index.html')?'v3':'proxy'} | Auth: local session | Brotli+gzip pre-compressed`);
});

