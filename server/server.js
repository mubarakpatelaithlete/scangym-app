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
const directionsRouter = require('./routes/directions');
const qrRouter = require('./routes/qr');
const convictionRouter = require('./routes/conviction');
const authRouter = require('./routes/auth');
const bookingRouter = require('./routes/booking');
const paymentRouter = require('./routes/payment');
const liveSearchRouter = require('./routes/liveSearch');
const geolocationRouter = require('./routes/geolocation');
const analyticsMiddleware = require('./middleware/analytics');

const app = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy (needed for secure cookies + IP detection)
const PORT = process.env.PORT || 5000;

// Frontend directory (Dockerfile copies it to ./public/)
const FRONTEND_DIR = path.join(__dirname, 'public');

// -- Middleware --
// Gzip/deflate compression — reduces transfer size by 60-80%
app.use(compression({ level: 6, threshold: 256 }));
app.use(cors({ origin: true, credentials: true }));

// Session middleware (must come before routes)
app.use(session({
  secret: process.env.SESSION_SECRET || 'scangym-secret-2026',
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

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    if (session.payment_status === 'paid' && session.metadata?.bookingId) {
      const bookingId = parseInt(session.metadata.bookingId);
      try {
        // Generate QR code token
        const qrToken = 'BOOK_' + require('crypto').randomBytes(8).toString('hex').toUpperCase();
        await pool.query(
          `UPDATE public.bookings
           SET status = 'confirmed',
               qr_code = $1,
               stripe_payment_intent_id = $2,
               stripe_payment_status = 'paid',
               updated_at = NOW()
           WHERE id = $3 AND status != 'confirmed'`,
          [qrToken, session.payment_intent, bookingId]
        );
        console.log(`✅ Webhook: Booking #${bookingId} confirmed via Stripe (checkout.session.completed)`);
      } catch (dbErr) {
        console.error('Webhook DB error:', dbErr.message);
      }
    }
  }

  // Blocker 2 Fix: Handle payment_intent.succeeded as a safety net for the
  // inline Stripe Elements flow. The frontend calls /confirm-intent directly,
  // but this webhook catches any edge cases (network drop after payment, etc.)
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
];
apiPaths.forEach(p => app.use(p, express.json()));

// -- Health check --
app.get('/api/v2/health', (req, res) => {
  res.json({
    status: 'ok', version: 'v4.1.0', brand: 'ScanGym',
    ts: new Date().toISOString(),
    features: 18, tasks: '24/24 + auth + booking + payment + live-search', ok: true,
    frontend: fs.existsSync(path.join(FRONTEND_DIR, 'index.html')) ? 'v3' : 'none',
  });
});

// -- Config endpoint (public keys for frontend) --
// Blocker 1 Fix: Removed gymCount from response so frontend falls back to
// 1,200,000 (the Google Places universe). The DB only has ~4 partner gyms
// but search returns 20+ via Google Places — showing "4" killed credibility.
app.get("/api/config", async (req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || "",
    stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    brand: "ScanGym",
    liveSearch: true,
  });
});

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
app.use('/api/directions', directionsRouter);
app.use('/api/qr', qrRouter);
app.use('/api/conviction', convictionRouter);

// -- Auth, Booking & Payment routes --
app.use('/api/auth', authRouter);
app.use('/api/bookings', bookingRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/live', liveSearchRouter);
app.use('/api/geolocation', geolocationRouter);

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
    res.setHeader('X-Frame-Options', 'DENY');
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

  // Reels app — separate React SPA at /reels
  // Serves reels/index.html for /reels and all sub-routes (e.g. /reels/creator/auth)
  app.get('/reels', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'reels', 'index.html'));
  });
  app.get('/reels/*', (req, res, next) => {
    // Let express.static handle actual files (assets, favicon, etc.)
    const filePath = path.join(FRONTEND_DIR, req.path);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return next();
    }
    // Otherwise serve the reels SPA index.html
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(FRONTEND_DIR, 'reels', 'index.html'));
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

    // Inject geo hint script right before </head>
    const html = _indexHtmlCache.replace('</head>', `<script>window.__geoHint=${geoHint};</script>\n</head>`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
  console.log('Serving frontend from', FRONTEND_DIR);
}

// -- Start --
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ScanGym v4.3.0 on :${PORT} | Frontend: ${fs.existsSync(FRONTEND_DIR+'/index.html')?'v3':'proxy'} | Auth: local session`);
});
