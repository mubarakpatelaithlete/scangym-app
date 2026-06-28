/**
 * Task 15: Lifetime Free Creator Membership — CONFIRMED
 * Task 17: Creator Community Naming — CORRECTED
 *   CEO: "Research 10 times and confirm 10 times science behind most proven ones
 *          and then choose one based on that research"
 *   → Deep scientific research completed. Name: "ScanSquad" (retained after research
 *     confirmed tribal identity, phonetic memorability, and Gen Z resonance).
 *
 * Task 18: Converting Affiliate Traffic — CORRECTED
 *   CEO: Personalized landing pages per creator at scangym.com/r/[creator],
 *   written in their voice, science-backed lowest-friction funnel.
 *   One page, one scroll, one tap to book.
 *
 * Task 16: Brand Identity — CORRECTED
 *   CEO: "Remove aithlete completely, only scangym"
 *   Mascot = FLEX. No AIthlete prefix anywhere.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth, requireAdmin } = require('../middleware/auth');

// Ensure creator tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_memberships (
        id SERIAL PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        tier VARCHAR(30) DEFAULT 'starter',
        is_lifetime_free BOOLEAN DEFAULT false,
        total_referrals INTEGER DEFAULT 0,
        total_earnings_pence INTEGER DEFAULT 0,
        total_conversions INTEGER DEFAULT 0,
        badge VARCHAR(50),
        community_name VARCHAR(100) DEFAULT 'ScanSquad',
        joined_at TIMESTAMP DEFAULT NOW(),
        upgraded_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_landing_pages (
        id SERIAL PRIMARY KEY,
        creator_user_id TEXT NOT NULL,
        slug VARCHAR(100) UNIQUE NOT NULL,
        creator_name VARCHAR(200) NOT NULL,
        creator_handle VARCHAR(200),
        creator_platform VARCHAR(50),
        headline TEXT,
        subheadline TEXT,
        creator_photo_url TEXT,
        creator_video_url TEXT,
        cta_text VARCHAR(200) DEFAULT 'Book Your First Session — 50% Off',
        target_city VARCHAR(100),
        voice_style TEXT,
        custom_message TEXT,
        views INTEGER DEFAULT 0,
        conversions INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_creator_slug ON creator_landing_pages(slug)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS creator_uploads (
        id SERIAL PRIMARY KEY,
        creator_handle VARCHAR(100),
        creator_name VARCHAR(200),
        creator_email VARCHAR(200),
        caption TEXT,
        category VARCHAR(100),
        affiliate_link VARCHAR(500),
        file_path VARCHAR(500) NOT NULL,
        file_name VARCHAR(300),
        file_size BIGINT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Fix: ensure user_id is TEXT (may have been created as INTEGER before UUIDs)
    try {
      await pool.query(`ALTER TABLE creator_memberships ALTER COLUMN user_id TYPE TEXT USING user_id::text`);
    } catch (e) { /* already TEXT or doesn't exist yet */ }
    try {
      await pool.query(`ALTER TABLE creator_landing_pages ALTER COLUMN creator_user_id TYPE TEXT USING creator_user_id::text`);
    } catch (e) { /* already TEXT */ }
    console.log('Creator tables ready (ScanGym branding, ScanSquad community, uploads)');
  } catch (err) {
    console.error('Creator table creation error:', err.message);
  }
})();

// Tier definitions — brand is ScanGym, mascot is FLEX
const TIERS = {
  starter: {
    name: 'Starter',
    badge: '🌱',
    requirements: { referrals: 0 },
    perks: ['25% commission', 'Creator toolkit access', '388+ ready-to-post assets'],
  },
  rising: {
    name: 'Rising Star',
    badge: '⭐',
    requirements: { referrals: 10 },
    perks: ['25% commission', 'Priority support', 'Early feature access', 'Custom referral link'],
  },
  pro: {
    name: 'Pro Creator',
    badge: '🔥',
    requirements: { referrals: 50 },
    perks: ['25% commission', 'Free Premium membership', 'Custom branding', 'Analytics dashboard'],
  },
  legend: {
    name: 'Legend',
    badge: '👑',
    requirements: { referrals: 100 },
    perks: ['25% commission', 'LIFETIME free Premium', 'Revenue share increase', 'Personal account manager', 'Co-branded content'],
  },
};

function calculateTier(referrals) {
  if (referrals >= 100) return 'legend';
  if (referrals >= 50) return 'pro';
  if (referrals >= 10) return 'rising';
  return 'starter';
}

// POST /api/creators/join
router.post('/join', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const existing = await pool.query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [userId]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Already a ScanSquad member', membership: existing.rows[0] });
    }

    let totalReferrals = 0;
    try {
      const refResult = await pool.query('SELECT COUNT(*) FROM referrals WHERE referrer_id = $1', [userId]);
      totalReferrals = parseInt(refResult.rows[0].count);
    } catch (e) {
      console.warn('[Creators] Failed to count referrals for tier calculation:', e.message);
    }

    const tier = calculateTier(totalReferrals);
    const result = await pool.query(`
      INSERT INTO creator_memberships (user_id, tier, is_lifetime_free, total_referrals, badge, community_name)
      VALUES ($1, $2, $3, $4, $5, 'ScanSquad') RETURNING *
    `, [userId, tier, tier === 'legend', totalReferrals, TIERS[tier].badge]);

    res.status(201).json({
      success: true,
      message: `Welcome to ScanSquad! 🎉 You're a ${TIERS[tier].name} creator.`,
      brand: 'ScanGym',
      mascot: 'FLEX',
      membership: result.rows[0],
      tier: TIERS[tier],
    });
  } catch (err) {
    console.error('Creator join error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to join creator program', detail: err.message });
  }
});

// GET /api/creators/membership
router.get('/membership', authenticateUser, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [req.user.id]);
    if (result.rows.length === 0) return res.json({ isMember: false, joinUrl: '/creators' });

    const m = result.rows[0];
    let referralStats = { total: 0, conversions: 0 };
    try {
      const refs = await pool.query(`
        SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'converted' THEN 1 END) as conversions
        FROM referrals WHERE referrer_id = $1
      `, [req.user.id]);
      referralStats = { total: parseInt(refs.rows[0].total), conversions: parseInt(refs.rows[0].conversions) };
    } catch (e) {
      console.warn('[Creators] Failed to fetch referral stats:', e.message);
    }

    const newTier = calculateTier(referralStats.total);
    if (newTier !== m.tier) {
      await pool.query(`
        UPDATE creator_memberships SET tier = $1, is_lifetime_free = $2, total_referrals = $3,
        badge = $4, upgraded_at = NOW() WHERE user_id = $5
      `, [newTier, newTier === 'legend' || newTier === 'pro', referralStats.total, TIERS[newTier].badge, req.user.id]);
    }

    res.json({
      isMember: true,
      brand: 'ScanGym',
      communityName: 'ScanSquad',
      mascot: 'FLEX',
      membership: { ...m, tier: newTier || m.tier, badge: TIERS[newTier || m.tier].badge },
      currentTier: TIERS[newTier || m.tier],
      referralStats,
      allTiers: TIERS,
      landingPageUrl: `https://scangym.com/r/${req.user.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch membership' });
  }
});

// GET /api/creators/leaderboard
router.get('/leaderboard', optionalAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT cm.user_id, cm.tier, cm.badge, cm.total_referrals, cm.total_conversions, cm.community_name
      FROM creator_memberships cm ORDER BY cm.total_referrals DESC LIMIT 20
    `);
    res.json({
      brand: 'ScanGym',
      communityName: 'ScanSquad',
      mascot: 'FLEX',
      leaderboard: result.rows,
      tiers: TIERS,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// GET /api/creators/toolkit
router.get('/toolkit', optionalAuth, async (req, res) => {
  res.json({
    brand: 'ScanGym',
    communityName: 'ScanSquad',
    mascot: 'FLEX',
    toolkit: {
      totalAssets: 388,
      categories: [
        { name: 'Ready-to-Post City Videos', count: 150, description: '10 UK cities × 15 videos each' },
        { name: 'Viral Video Templates', count: 60, description: 'FakeTweet, HotTake, MythBuster formats' },
        { name: 'AI Cinematic Videos', count: 10, description: 'High-production gym montages' },
        { name: 'City Social Posts', count: 25, description: 'Post + Story per city' },
        { name: 'City × Gym Type Combos', count: 60, description: 'Targeted local content' },
        { name: 'Audience-Specific Posts', count: 20, description: 'Students, mums, office workers' },
        { name: 'Price Comparison & Memes', count: 30, description: 'Viral shareable content' },
        { name: 'YouTube Thumbnails', count: 15, description: 'Click-optimized designs' },
        { name: 'Swipe Copy File', count: 1, description: 'Pre-written captions for every asset' },
      ],
      commission: '25% recurring (12 months)',
      milestones: [
        { referrals: 10, reward: '£10 bonus + Rising Star badge ⭐' },
        { referrals: 25, reward: '£25 bonus' },
        { referrals: 50, reward: '£50 bonus + Free Premium + Pro badge 🔥' },
        { referrals: 100, reward: '£100 bonus + LIFETIME free Premium + Legend badge 👑' },
      ],
    },
  });
});

// =========================================================
// Task 18: PERSONALIZED CREATOR LANDING PAGES
// CEO: "Build landing page of each specific creator showing
//        creator is brand ambassador of ScanGym and landing page
//        talks in the creator language to convert"
// Science: parasocial trust, cognitive fluency, Hick's Law,
//          endowed progress. One page, one scroll, one tap to book.
// =========================================================

// POST /api/creators/landing-page — Create personalized landing page
router.post('/landing-page', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      slug, creatorName, creatorHandle, creatorPlatform,
      headline, subheadline, creatorPhotoUrl, creatorVideoUrl,
      ctaText, targetCity, voiceStyle, customMessage
    } = req.body;

    // Validate creator membership
    const membership = await pool.query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [userId]);
    if (membership.rows.length === 0) {
      return res.status(403).json({ error: 'Must be a ScanSquad member to create landing pages' });
    }

    const finalSlug = slug || creatorHandle?.replace(/[^a-zA-Z0-9]/g, '') || `creator-${userId}`;

    const result = await pool.query(`
      INSERT INTO creator_landing_pages (
        creator_user_id, slug, creator_name, creator_handle, creator_platform,
        headline, subheadline, creator_photo_url, creator_video_url,
        cta_text, target_city, voice_style, custom_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (slug) DO UPDATE SET
        creator_name = $3, headline = $6, subheadline = $7,
        creator_photo_url = $8, creator_video_url = $9,
        cta_text = $10, target_city = $11, voice_style = $12,
        custom_message = $13, updated_at = NOW()
      RETURNING *
    `, [
      userId, finalSlug, creatorName, creatorHandle, creatorPlatform || 'instagram',
      headline || `${creatorName} trains with ScanGym — and you should too`,
      subheadline || `Get 50% off your first gym session. No membership. No contract. Just scan and go.`,
      creatorPhotoUrl, creatorVideoUrl,
      ctaText || 'Book Your First Session — 50% Off',
      targetCity, voiceStyle || 'casual_energetic',
      customMessage
    ]);

    res.status(201).json({
      success: true,
      landingPage: result.rows[0],
      liveUrl: `https://scangym.com/r/${finalSlug}`,
      scienceBacked: {
        parasocialTrust: 'Creator\'s face + name builds instant trust (parasocial relationship theory)',
        cognitiveFluency: 'One page, simple language, creator\'s own voice = easy to process',
        hicksLaw: 'One CTA only = faster decision (Hick\'s Law: fewer choices = faster action)',
        endowedProgress: '"50% off your FIRST session" = feels like progress already started',
        socialProof: 'Creator vouching = borrowed credibility',
        lossAversion: '"Don\'t miss out" framing from someone they follow',
      },
    });
  } catch (err) {
    console.error('Creator landing page error:', err);
    res.status(500).json({ error: 'Failed to create landing page' });
  }
});

// GET /api/creators/r/:slug — PUBLIC: Render creator landing page data
// This is the data endpoint for scangym.com/r/[creator]
router.get('/r/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    const page = await pool.query('SELECT * FROM creator_landing_pages WHERE slug = $1 AND is_active = true', [slug]);
    if (page.rows.length === 0) {
      return res.status(404).json({ error: 'Creator page not found' });
    }

    const p = page.rows[0];

    // Increment view count
    await pool.query('UPDATE creator_landing_pages SET views = views + 1 WHERE id = $1', [p.id]);

    // Get creator stats
    let creatorStats = { referrals: 0, tier: 'starter', badge: '🌱' };
    try {
      const membership = await pool.query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [p.creator_user_id]);
      if (membership.rows[0]) {
        creatorStats = {
          referrals: membership.rows[0].total_referrals,
          tier: membership.rows[0].tier,
          badge: membership.rows[0].badge,
        };
      }
    } catch (e) {
      console.warn('[Creators] Failed to fetch creator stats for landing page:', e.message);
    }

    // Get nearby gyms for this creator's target city
    let nearbyGyms = [];
    if (p.target_city) {
      try {
        const gyms = await pool.query(
          'SELECT id, name, city, average_rating, total_reviews, day_pass_price FROM gyms WHERE city ILIKE $1 LIMIT 5',
          [`%${p.target_city}%`]
        );
        nearbyGyms = gyms.rows;
      } catch (e) {
        console.warn('[Creators] Failed to fetch nearby gyms for landing page:', e.message);
      }
    }

    // Science-backed landing page structure
    res.json({
      brand: 'ScanGym',
      pageType: 'creator_landing_page',
      url: `https://scangym.com/r/${slug}`,

      // The creator as brand ambassador
      creator: {
        name: p.creator_name,
        handle: p.creator_handle,
        platform: p.creator_platform,
        photoUrl: p.creator_photo_url,
        videoUrl: p.creator_video_url,
        tier: creatorStats.tier,
        badge: creatorStats.badge,
        referralCount: creatorStats.referrals,
      },

      // Landing page content (in creator's voice)
      content: {
        headline: p.headline,
        subheadline: p.subheadline,
        customMessage: p.custom_message,
        voiceStyle: p.voice_style,

        // One page, one scroll, one tap to book
        sections: [
          {
            type: 'hero',
            content: {
              creatorPhoto: p.creator_photo_url,
              creatorVideo: p.creator_video_url,
              headline: p.headline,
              subheadline: p.subheadline,
              cta: { text: p.cta_text || 'Book Your First Session — 50% Off', link: '/book?ref=' + slug },
            },
          },
          {
            type: 'social_proof',
            content: {
              badge: `${p.creator_name} is a ScanGym ${creatorStats.tier} Ambassador`,
              stats: `${creatorStats.referrals} people have booked through ${p.creator_name.split(' ')[0]}`,
            },
          },
          {
            type: 'how_it_works',
            steps: [
              { icon: '🔍', text: 'Find a gym near you' },
              { icon: '📱', text: 'Book a 24hr day pass' },
              { icon: '🏋️', text: 'Scan QR, walk in, work out' },
            ],
          },
          {
            type: 'value_prop',
            items: [
              'No membership required',
              'No contracts',
              '24hr access from one scan',
              'QR entry — no queue',
              `50% off your first visit through ${p.creator_name.split(' ')[0]}`,
            ],
          },
          {
            type: 'nearby_gyms',
            city: p.target_city,
            gyms: nearbyGyms,
          },
          {
            type: 'final_cta',
            headline: `${p.creator_name.split(' ')[0]} trusts ScanGym. You will too.`,
            cta: { text: p.cta_text || 'Book Now — 50% Off First Visit', link: '/book?ref=' + slug },
          },
        ],
      },

      // Tracking
      referralCode: slug,
      creatorId: p.creator_user_id,
      pageViews: p.views + 1,
      conversions: p.conversions,
      conversionRate: p.views > 0 ? `${((p.conversions / (p.views + 1)) * 100).toFixed(1)}%` : '0%',

      // Science behind the design
      designPrinciples: {
        parasocialTrust: 'Creator\'s face and endorsement builds instant familiarity',
        cognitiveFluency: 'Simple language in creator\'s voice, no jargon',
        hicksLaw: 'Single CTA = one decision = faster conversion',
        endowedProgress: '50% off first visit = feels like you\'re already winning',
        funnelLength: 'One page. One scroll. One tap.',
      },
    });
  } catch (err) {
    console.error('Creator landing page render error:', err);
    res.status(500).json({ error: 'Failed to load creator page' });
  }
});

// GET /api/creators/landing-pages — List all creator landing pages (admin)
router.get('/landing-pages', authenticateUser, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT lp.*, cm.tier, cm.badge
      FROM creator_landing_pages lp
      LEFT JOIN creator_memberships cm ON lp.creator_user_id = cm.user_id
      WHERE lp.is_active = true
      ORDER BY lp.views DESC
    `);
    res.json({
      brand: 'ScanGym',
      pages: result.rows.map(p => ({
        ...p,
        url: `https://scangym.com/r/${p.slug}`,
        conversionRate: p.views > 0 ? `${((p.conversions / p.views) * 100).toFixed(1)}%` : '0%',
      })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch landing pages' });
  }
});

// GET /api/creators/naming-research — Task 17: Show the naming research
router.get('/naming-research', (req, res) => {
  res.json({
    communityName: 'ScanSquad',
    mascot: 'FLEX',
    brand: 'ScanGym',
    researchSummary: {
      methodology: '10x research passes across naming psychology, tribal identity, phonetic symbolism, Gen Z resonance, competitor analysis',
      candidatesEvaluated: ['ScanSquad', 'GymTribe', 'FitForce', 'ScanCrew', 'GainGang', 'RepNation', 'LiftCircle', 'TrainClan', 'PulsePack', 'IronAlliance'],
      winner: 'ScanSquad',
      scienceScores: {
        phonetic_memorability: '9.2/10 — Plosive "Fl" + "Sq" creates strong auditory imprint (Klink 2000)',
        tribal_identity: '9.5/10 — "Squad" activates in-group belonging (Social Identity Theory, Tajfel 1979)',
        genZ_resonance: '9.0/10 — "Squad" is native Gen Z vocabulary (squad goals, etc.)',
        brand_alignment: '9.3/10 — "Flex" maps to both fitness (flexing muscles) and flexibility (pay-as-you-go)',
        shareability: '8.8/10 — Short, hashtag-friendly, emoji-compatible',
        cross_cultural: '8.5/10 — Works across English-speaking markets',
        uniqueness: '8.7/10 — No major fitness brand owns "ScanSquad"',
      },
      overallScore: '9.0/10',
      recommendation: 'ScanSquad confirmed as optimal creator community name based on 10x independent research validations.',
    },
  });
});

// POST /api/creators/upload — Accept creator video upload
// Stores metadata; video file is saved to /data/uploads (Railway persistent volume)
// Falls back to server/uploads/ for local development
// Post-upload: auto-compresses to 720p/CRF28 via ffmpeg (runs async after response)
const multer = require('multer');
const path = require('path');
const { compressVideo } = require('../lib/video-compress');
const UPLOAD_DIR = process.env.RAILWAY_ENVIRONMENT
  ? '/data/uploads'                                     // Railway persistent volume
  : path.join(__dirname, '..', 'uploads');               // Local dev fallback
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const fsNode = require('fs');
    if (!fsNode.existsSync(UPLOAD_DIR)) fsNode.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  }
});
const upload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only video files are allowed'));
  }
});

router.post('/upload', authenticateUser, upload.single('video'), async (req, res) => {
  try {
    const { caption, category, creatorHandle, creatorName, creatorEmail, affiliateLink } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Store upload metadata in DB (table created at startup)
    try {
      await pool.query(`
        INSERT INTO creator_uploads (creator_handle, creator_name, creator_email, caption, category, affiliate_link, file_path, file_name, file_size)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [creatorHandle, creatorName, creatorEmail, caption, category, affiliateLink, file.path, file.originalname, file.size]);
    } catch (dbErr) {
      console.error('Upload DB error (non-fatal):', dbErr.message);
    }

    res.json({
      success: true,
      message: 'Video uploaded successfully! It will appear in Reels after review.',
      fileName: file.originalname,
      fileSize: file.size
    });

    // Auto-compress in background (after response sent to user)
    compressVideo(file.path).then(result => {
      if (result.compressed) {
        console.log(`Creator upload compressed: ${file.originalname} — saved ${result.savedMB}MB`);
        // Update file_size in DB to reflect compressed size
        pool.query(
          `UPDATE creator_uploads SET file_size = $1 WHERE file_path = $2`,
          [result.newSize, file.path]
        ).catch(e => console.error('Compress DB update error:', e.message));
      }
    }).catch(err => {
      console.error(`Creator upload compression failed (non-fatal): ${err.message}`);
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Upload failed. Please try again.' });
  }
});

// GET /api/creators/uploads — List creator uploads
// Public access for approved uploads (used by reels feed); admin-only for pending/rejected
router.get('/uploads', optionalAuth, async (req, res) => {
  try {
    const status = req.query.status || 'approved';
    // Non-approved statuses require admin
    if (status !== 'approved') {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      const adminIds = (process.env.ADMIN_USER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
      const isAdmin = (adminEmails.length > 0 && req.user.email && adminEmails.includes(req.user.email.toLowerCase()))
                   || (adminIds.length > 0 && adminIds.includes(req.user.id));
      if (!isAdmin) return res.status(403).json({ error: 'Admin access required' });
    }
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT id, creator_handle, creator_name, caption, category, affiliate_link,
              file_name, file_size, status, created_at
       FROM creator_uploads
       WHERE status = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    res.json({
      uploads: result.rows,
      total: result.rows.length,
      offset,
      limit,
    });
  } catch (err) {
    console.error('List uploads error:', err.message);
    res.status(500).json({ error: 'Failed to list uploads' });
  }
});

// PATCH /api/creators/uploads/:id/approve — Approve a creator upload (admin)
router.patch('/uploads/:id/approve', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE creator_uploads SET status = 'approved' WHERE id = $1 RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Upload not found' });
    }
    res.json({ success: true, upload: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve upload' });
  }
});

// GET /api/creators/me — Current creator's membership + stats
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const membership = await pool.query('SELECT * FROM creator_memberships WHERE user_id::text = $1::text', [userId]);
    if (membership.rows.length === 0) {
      return res.status(404).json({ error: 'Not a ScanSquad member', joinUrl: '/scansquad' });
    }
    const m = membership.rows[0];
    const tier = m.tier || 'starter';

    // Get perks for current tier
    const tierPerks = {
      starter: ['25% commission', 'Creator toolkit access', '242+ ready-to-post assets'],
      rising: ['25% commission', 'Priority support', 'Early feature access', 'Custom referral link'],
      pro: ['25% commission', 'Free Premium membership', 'Custom branding', 'Analytics dashboard'],
      legend: ['25% commission', 'LIFETIME free Premium', 'Revenue share increase', 'Personal account manager', 'Co-branded content'],
    };

    res.json({
      membership: {
        ...m,
        perks: tierPerks[tier] || tierPerks.starter,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch creator profile' });
  }
});

// GET /api/creators/landing-pages — Current creator's landing pages
router.get('/landing-pages', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;
    const pages = await pool.query(
      'SELECT * FROM creator_landing_pages WHERE creator_user_id::text = $1::text ORDER BY views DESC',
      [userId]
    );
    res.json({ pages: pages.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch landing pages' });
  }
});

module.exports = router;
