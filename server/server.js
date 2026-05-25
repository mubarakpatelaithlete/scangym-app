const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const session = require('express-session');

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
const analyticsMiddleware = require('./middleware/analytics');

const app = express();
const PORT = process.env.PORT || 5000;

// Frontend directory (Dockerfile copies it to ./public/)
const FRONTEND_DIR = path.join(__dirname, 'public');

// -- Middleware --
app.use(cors({ origin: true, credentials: true }));

// Session middleware (must come before routes)
app.use(session({
  secret: process.env.SESSION_SECRET || 'scangym-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Railway terminates SSL at proxy
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    sameSite: 'lax',
  },
}));

// Analytics tracking middleware (Task 21)
app.use(analyticsMiddleware);

// Parse JSON for API routes
const apiPaths = [
  '/api/reviews', '/api/chat', '/api/wallet', '/api/guest',
  '/api/coach', '/api/gym-profile', '/api/owner', '/api/stats',
  '/api/creators', '/api/directions', '/api/qr', '/api/conviction',
  '/api/auth', '/api/bookings', '/api/payment',
];
apiPaths.forEach(p => app.use(p, express.json()));

// -- Health check --
app.get('/api/v2/health', (req, res) => {
  res.json({
    status: 'ok', version: 'v3.1', brand: 'ScanGym',
    ts: new Date().toISOString(),
    features: 17, tasks: '24/24 + auth + booking + payment', ok: true,
    frontend: fs.existsSync(path.join(FRONTEND_DIR, 'index.html')) ? 'v3' : 'none',
  });
});

// -- Config endpoint (public keys for frontend) --
app.get("/api/config", (req, res) => {
  res.json({
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || "",
    stripeKey: process.env.STRIPE_PUBLISHABLE_KEY || "",
    brand: "ScanGym",
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

// -- Serve Frontend --
if (fs.existsSync(FRONTEND_DIR)) {
  app.use(express.static(FRONTEND_DIR, { maxAge: '1d' }));

  // SPA fallback - serve index.html for all non-API routes
  app.get('*', (req, res) => {
    const indexPath = path.join(FRONTEND_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({ error: 'Frontend not available' });
    }
  });
  console.log('Serving frontend from', FRONTEND_DIR);
}

// -- Start --
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ScanGym v3.1 on :${PORT} | Frontend: ${fs.existsSync(FRONTEND_DIR+'/index.html')?'v3':'proxy'} | Auth: local session`);
});
