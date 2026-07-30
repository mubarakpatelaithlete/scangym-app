/**
 * Task 24: Per-Gym Stats + Supplier Partnerships — CORRECTED
 * Task 21: CEO Analytics Dashboard — CORRECTED
 *
 * CEO corrections:
 * - "I want to know traffic volume and conversion of that traffic"
 *   → Full funnel: Visitor → Search → Profile → Checkout → Paid Booking = X%
 *   → One screen: traffic in, money out
 *
 * Task 24 Supplier partnerships (Uber playbook):
 * (1) Vending machine partnerships for 1.2M gyms
 * (2) Free QR scanner hardware for gyms without one
 * (3) Gym opening loans / upgrade financing
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

const PERIOD_INTERVALS = { '24h': '1 day', '7d': '7 days', '30d': '30 days' };
function safeInterval(period) {
  return PERIOD_INTERVALS[period] || '7 days';
}

// GET /api/stats/live-visitors — Real "people browsing now" count (public)
// Honest social proof: distinct visitors in the last 5 minutes (in-memory,
// no PII). The frontend ticker only shows the label when count >= 5 so a
// quiet moment never reads "1 person here" (which signals a dead product).
const liveVisitors = require('../middleware/live-visitors');
router.get('/live-visitors', (req, res) => {
  const count = liveVisitors.getCount();
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    count,
    label: count >= 5 ? `\u{1F525} ${count} people browsing now` : null
  });
});

// GET /api/stats/gym/:gymId — Public stats summary
router.get('/gym/:gymId', optionalAuth, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const reviewStats = await pool.query(`
      SELECT COUNT(*) as total_reviews, COALESCE(AVG(rating), 0) as avg_rating,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as recent_reviews
      FROM reviews WHERE gym_id = $1
    `, [gymId]);

    const bookingStats = await pool.query(`
      SELECT COUNT(*) as total_bookings,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as monthly,
             COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as weekly
      FROM bookings WHERE gym_id = $1
    `, [gymId]);

    res.json({
      gymId,
      gymName: gym.rows[0].name,
      stats: {
        reviews: {
          total: parseInt(reviewStats.rows[0].total_reviews),
          averageRating: parseFloat(parseFloat(reviewStats.rows[0].avg_rating).toFixed(1)),
          last30Days: parseInt(reviewStats.rows[0].recent_reviews),
        },
        bookings: {
          total: parseInt(bookingStats.rows[0].total_bookings),
          last30Days: parseInt(bookingStats.rows[0].monthly),
          last7Days: parseInt(bookingStats.rows[0].weekly),
        },
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/stats/owner/:gymId — Owner detailed stats (Task 24)
router.get('/owner/:gymId', authenticateUser, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const userId = req.user.id;

    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text', [gymId, userId]);
    if (gym.rows.length === 0) return res.status(403).json({ error: 'You do not own this gym' });

    const bookingTrend = await pool.query(`
      SELECT DATE_TRUNC('day', created_at) as date, COUNT(*) as bookings,
             COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
             COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled
      FROM bookings WHERE gym_id = $1 AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE_TRUNC('day', created_at) ORDER BY date
    `, [gymId]);

    const revenueStats = await pool.query(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN status = 'completed' THEN 1 END) as paid
      FROM bookings WHERE gym_id = $1
    `, [gymId]);

    const reviewDist = await pool.query(`
      SELECT rating, COUNT(*) as count FROM reviews WHERE gym_id = $1 GROUP BY rating ORDER BY rating DESC
    `, [gymId]);

    const peakHours = await pool.query(`
      SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as bookings
      FROM bookings WHERE gym_id = $1 GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY bookings DESC LIMIT 5
    `, [gymId]);

    const uniqueVisitors = await pool.query(`SELECT COUNT(DISTINCT user_id) as u FROM bookings WHERE gym_id = $1`, [gymId]);
    const returnRate = await pool.query(`
      SELECT COUNT(*) as r FROM (SELECT user_id FROM bookings WHERE gym_id = $1 GROUP BY user_id HAVING COUNT(*) > 1) t
    `, [gymId]);

    const g = gym.rows[0];
    const rate = g.day_pass_price || 5;
    const paid = parseInt(revenueStats.rows[0].paid);
    const uniqueU = parseInt(uniqueVisitors.rows[0].u);

    res.json({
      gymId,
      gymName: g.name,
      overview: {
        totalBookings: parseInt(revenueStats.rows[0].total),
        paidBookings: paid,
        estimatedRevenue: `£${(paid * rate * 0.75).toFixed(2)}`,
        scanGymCommission: '25%',
        uniqueVisitors: uniqueU,
        returnRate: uniqueU > 0 ? `${((parseInt(returnRate.rows[0].r) / uniqueU) * 100).toFixed(0)}%` : '0%',
      },
      bookingTrend: bookingTrend.rows,
      peakHours: peakHours.rows,
      reviewDistribution: reviewDist.rows,
      pricingModel: '24hr_day_pass',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch owner stats' });
  }
});

// GET /api/stats/ceo — CORRECTED: CEO Dashboard
// "I want to know traffic volume and conversion of that traffic"
// One screen: traffic in, money out. Full funnel conversion.
router.get('/ceo', authenticateUser, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const interval = safeInterval(period);

    // ========= TRAFFIC VOLUME =========
    let traffic = { total: 0, pageViews: 0, apiCalls: 0, uniqueVisitors: 0, sources: [] };
    try {
      const trafficData = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN event_type = 'page_view' THEN 1 END) as views,
               COUNT(CASE WHEN event_type = 'api_call' THEN 1 END) as api_calls,
               COUNT(DISTINCT ip_address) as unique_ips
        FROM analytics_events WHERE created_at > NOW() - INTERVAL '${interval}'
      `);
      traffic.total = parseInt(trafficData.rows[0].total);
      traffic.pageViews = parseInt(trafficData.rows[0].views);
      traffic.apiCalls = parseInt(trafficData.rows[0].api_calls);
      traffic.uniqueVisitors = parseInt(trafficData.rows[0].unique_ips);

      // Traffic sources (referrers)
      const sources = await pool.query(`
        SELECT
          CASE
            WHEN referrer IS NULL OR referrer = '' THEN 'Direct'
            WHEN referrer ILIKE '%google%' THEN 'Google'
            WHEN referrer ILIKE '%instagram%' THEN 'Instagram'
            WHEN referrer ILIKE '%tiktok%' THEN 'TikTok'
            WHEN referrer ILIKE '%facebook%' THEN 'Facebook'
            WHEN referrer ILIKE '%twitter%' OR referrer ILIKE '%x.com%' THEN 'Twitter/X'
            WHEN referrer ILIKE '%youtube%' THEN 'YouTube'
            ELSE 'Other'
          END as source,
          COUNT(*) as visits,
          COUNT(DISTINCT ip_address) as unique_visitors
        FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY source ORDER BY visits DESC
      `);
      traffic.sources = sources.rows;
    } catch (e) {
      console.warn('[Stats] Failed to fetch traffic data:', e.message);
    }

    // Daily traffic trend
    let dailyTraffic = [];
    try {
      const daily = await pool.query(`
        SELECT DATE_TRUNC('day', created_at) as date,
               COUNT(*) as total,
               COUNT(DISTINCT ip_address) as unique_visitors
        FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
        GROUP BY DATE_TRUNC('day', created_at) ORDER BY date
      `);
      dailyTraffic = daily.rows;
    } catch (e) {
      console.warn('[Stats] Failed to fetch daily traffic trend:', e.message);
    }

    // ========= CONVERSION FUNNEL =========
    // Visitor → Search → Profile View → Checkout → Paid Booking
    let funnel = {
      visitors: 0,
      searched: 0,
      viewedProfile: 0,
      startedCheckout: 0,
      completedBooking: 0,
      paidBooking: 0,
      conversionRate: '0%',
    };

    try {
      // Step 1: Total unique visitors
      const visitors = await pool.query(`
        SELECT COUNT(DISTINCT ip_address) FROM analytics_events
        WHERE created_at > NOW() - INTERVAL '${interval}'
      `);
      funnel.visitors = parseInt(visitors.rows[0].count);

      // Step 2: Searched (hit /api/guest/gyms or /api/guest/quick-search)
      const searched = await pool.query(`
        SELECT COUNT(DISTINCT ip_address) FROM analytics_events
        WHERE (path LIKE '%/guest/gyms%' OR path LIKE '%/guest/quick-search%' OR path LIKE '%/guest/cities%')
        AND created_at > NOW() - INTERVAL '${interval}'
      `);
      funnel.searched = parseInt(searched.rows[0].count);

      // Step 3: Viewed a gym profile
      const profileViews = await pool.query(`
        SELECT COUNT(DISTINCT ip_address) FROM analytics_events
        WHERE (path LIKE '%/gym-profile/%' OR path LIKE '%/guest/gym/%')
        AND created_at > NOW() - INTERVAL '${interval}'
      `);
      funnel.viewedProfile = parseInt(profileViews.rows[0].count);

      // Step 4: Started checkout (hit booking/payment endpoints)
      const checkout = await pool.query(`
        SELECT COUNT(DISTINCT ip_address) FROM analytics_events
        WHERE (path LIKE '%/booking%' OR path LIKE '%/payment%' OR path LIKE '%/checkout%' OR path LIKE '%/wallet/spend%')
        AND method = 'POST'
        AND created_at > NOW() - INTERVAL '${interval}'
      `);
      funnel.startedCheckout = parseInt(checkout.rows[0].count);
    } catch (e) {
      console.warn('[Stats] Failed to fetch conversion funnel data:', e.message);
    }

    // Step 5: Completed bookings (from DB)
    try {
      const bookings = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN status IN ('confirmed', 'completed', 'active') THEN 1 END) as paid
        FROM bookings WHERE created_at > NOW() - INTERVAL '${interval}'
      `);
      funnel.completedBooking = parseInt(bookings.rows[0].total);
      funnel.paidBooking = parseInt(bookings.rows[0].paid);
    } catch (e) {
      console.warn('[Stats] Failed to fetch booking counts for funnel:', e.message);
    }

    // Overall conversion: Visitor → Paid Booking
    if (funnel.visitors > 0) {
      funnel.conversionRate = `${((funnel.paidBooking / funnel.visitors) * 100).toFixed(2)}%`;
    }

    // Step-by-step conversion rates
    const stepConversions = {
      visitorToSearch: funnel.visitors > 0 ? `${((funnel.searched / funnel.visitors) * 100).toFixed(1)}%` : '0%',
      searchToProfile: funnel.searched > 0 ? `${((funnel.viewedProfile / funnel.searched) * 100).toFixed(1)}%` : '0%',
      profileToCheckout: funnel.viewedProfile > 0 ? `${((funnel.startedCheckout / funnel.viewedProfile) * 100).toFixed(1)}%` : '0%',
      checkoutToPaid: funnel.startedCheckout > 0 ? `${((funnel.paidBooking / funnel.startedCheckout) * 100).toFixed(1)}%` : '0%',
      overallConversion: funnel.conversionRate,
    };

    // ========= REVENUE =========
    let revenue = { totalBookings: 0, estimatedRevenue: '£0.00', avgBookingValue: '£0.00' };
    try {
      const rev = await pool.query(`
        SELECT COUNT(*) as total, b.gym_id, g.day_pass_price
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed', 'completed', 'active')
        AND b.created_at > NOW() - INTERVAL '${interval}'
        GROUP BY b.gym_id, g.day_pass_price
      `);
      let totalRevenue = 0;
      let totalPaid = 0;
      rev.rows.forEach(r => {
        const price = r.day_pass_price || 5;
        totalRevenue += parseInt(r.total) * price;
        totalPaid += parseInt(r.total);
      });
      revenue = {
        totalBookings: totalPaid,
        estimatedRevenue: `£${totalRevenue.toFixed(2)}`,
        scanGymShare: `£${(totalRevenue * 0.25).toFixed(2)}`,
        gymOwnerShare: `£${(totalRevenue * 0.75).toFixed(2)}`,
        avgBookingValue: totalPaid > 0 ? `£${(totalRevenue / totalPaid).toFixed(2)}` : '£0.00',
      };
    } catch (e) {
      console.warn('[Stats] Failed to fetch revenue data:', e.message);
    }

    // ========= PLATFORM STATS =========
    let platform = { gyms: 0, users: 0, bookings: 0, cities: 0 };
    try {
      const gyms = await pool.query('SELECT COUNT(*) FROM gyms');
      const users = await pool.query('SELECT COUNT(*) FROM users');
      const bookings = await pool.query('SELECT COUNT(*) FROM bookings');
      const cities = await pool.query('SELECT COUNT(DISTINCT city) FROM gyms WHERE city IS NOT NULL');
      platform = {
        gyms: parseInt(gyms.rows[0].count),
        users: parseInt(users.rows[0].count),
        bookings: parseInt(bookings.rows[0].count),
        cities: parseInt(cities.rows[0].count),
      };
    } catch (e) {
      console.warn('[Stats] Failed to fetch platform stats:', e.message);
    }

    // Top pages
    let topPages = [];
    try {
      const pages = await pool.query(`
        SELECT path, COUNT(*) as hits FROM analytics_events
        WHERE event_type = 'page_view' AND created_at > NOW() - INTERVAL '${interval}'
        GROUP BY path ORDER BY hits DESC LIMIT 10
      `);
      topPages = pages.rows;
    } catch (e) {
      console.warn('[Stats] Failed to fetch top pages:', e.message);
    }

    res.json({
      dashboard: 'ScanGym CEO Dashboard',
      period,
      generatedAt: new Date().toISOString(),

      // ONE SCREEN: traffic in, money out
      trafficIn: {
        totalHits: traffic.total,
        uniqueVisitors: traffic.uniqueVisitors,
        pageViews: traffic.pageViews,
        sources: traffic.sources,
        dailyTrend: dailyTraffic,
      },

      conversionFunnel: {
        funnel: {
          '1_visitors': funnel.visitors,
          '2_searched': funnel.searched,
          '3_viewed_profile': funnel.viewedProfile,
          '4_started_checkout': funnel.startedCheckout,
          '5_paid_booking': funnel.paidBooking,
        },
        stepConversions,
        overallConversion: funnel.conversionRate,
      },

      moneyOut: revenue,
      platform,
      topPages,
    });
  } catch (err) {
    console.error('CEO dashboard error:', err);
    res.status(500).json({ error: 'Failed to generate CEO dashboard' });
  }
});

// GET /api/stats/analytics — Backward-compatible analytics endpoint
router.get('/analytics', authenticateUser, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const interval = safeInterval(period);

    let analytics = { pageViews: 0, apiCalls: 0, uniqueVisitors: 0, topPages: [] };
    try {
      const data = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(CASE WHEN event_type = 'page_view' THEN 1 END) as views,
               COUNT(CASE WHEN event_type = 'api_call' THEN 1 END) as api_calls,
               COUNT(DISTINCT ip_address) as unique_ips
        FROM analytics_events WHERE created_at > NOW() - INTERVAL '${interval}'
      `);
      const topPages = await pool.query(`
        SELECT path, COUNT(*) as hits FROM analytics_events
        WHERE event_type = 'page_view' AND created_at > NOW() - INTERVAL '${interval}'
        GROUP BY path ORDER BY hits DESC LIMIT 10
      `);
      analytics = {
        pageViews: parseInt(data.rows[0].views),
        apiCalls: parseInt(data.rows[0].api_calls),
        uniqueVisitors: parseInt(data.rows[0].unique_ips),
        topPages: topPages.rows,
        period,
      };
    } catch (e) {
      console.warn('[Stats] Failed to fetch analytics data:', e.message);
    }

    const gymCount = await pool.query('SELECT COUNT(*) FROM gyms');
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const bookingCount = await pool.query('SELECT COUNT(*) FROM bookings');

    res.json({
      analytics,
      platform: {
        totalGyms: parseInt(gymCount.rows[0].count),
        totalUsers: parseInt(userCount.rows[0].count),
        totalBookings: parseInt(bookingCount.rows[0].count),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// GET /api/stats/suppliers — Task 24: Supplier partnerships (Uber playbook)
router.get('/suppliers', async (req, res) => {
  res.json({
    supplierPartnerships: {
      description: 'ScanGym Supplier Partnerships — Uber playbook: partner with suppliers to remove barriers for gyms joining the platform.',

      // (1) Vending Machines — partner with vending companies for 1.2M gyms
      vendingMachines: {
        title: '🥤 Vending Machine Partnership',
        strategy: 'Partner with vending machine companies to install machines in all partner gyms that don\'t have one — just like JD Gyms. Revenue share model.',
        targetGyms: 'All 1.2 million gyms globally that lack vending machines',
        uberPlaybook: 'Like Uber partnered with financial banks to support new drivers who don\'t have cars — ScanGym partners with vending suppliers to enhance gyms.',
        partnerTypes: [
          { type: 'Protein/Sports drinks', examples: ['Myprotein Vending', 'WOW Hydrate', 'Grenade'] },
          { type: 'Healthy snacks', examples: ['Graze', 'KIND Bars', 'Trek'] },
          { type: 'Full-service vending', examples: ['Selecta', 'Aramark', 'Compass Group'] },
        ],
        revenueModel: 'ScanGym negotiates bulk rates → places machines in partner gyms → revenue split: 50% gym, 30% supplier, 20% ScanGym',
        gymBenefit: 'Free vending machine installation, zero upfront cost, ongoing revenue',
        link: '/partners/vending',
        cta: 'Get a Free Vending Machine for Your Gym',
      },

      // (2) QR Scanners — free hardware for gyms
      qrScanners: {
        title: '📱 Free QR Scanner Hardware',
        strategy: 'Any gym from the 1.2 million that doesn\'t have a QR code scanning machine — ScanGym provides it free. All cost on us.',
        targetGyms: 'All partner gyms without QR scanning capability',
        offer: '100% FREE — ScanGym covers all hardware costs',
        hardware: [
          { name: 'ScanGym Entry Scanner', description: 'Wall-mounted QR reader for gym entrance', cost: 'FREE (covered by ScanGym)' },
          { name: 'ScanGym Exit Scanner', description: 'Wall-mounted QR reader for exit', cost: 'FREE (covered by ScanGym)' },
          { name: 'Tablet Stand Kit', description: 'iPad/tablet with ScanGym scanner app', cost: 'FREE (covered by ScanGym)' },
        ],
        howItWorks: [
          '1. Gym signs up on ScanGym',
          '2. ScanGym ships free QR scanner hardware',
          '3. Simple plug-and-play setup (5 minutes)',
          '4. Gym is ready to accept ScanGym bookings',
          '5. No monthly fees, no maintenance costs',
        ],
        qrPolicy: '2-scan system: entry + exit, then QR expires (JD Gym model)',
        link: '/partners/qr-hardware',
        cta: 'Get Free QR Scanners for Your Gym',
      },

      // (3) Gym Opening Loans — financial partnerships
      gymLoans: {
        title: '🏦 Gym Opening & Upgrade Loans',
        strategy: 'Partner with financial institutions to help people open new gyms or upgrade existing ones — following the Uber model of partnering with banks to support new drivers.',
        uberPlaybook: 'Uber partnered with financial banks to help drivers who don\'t have cars get car loans. ScanGym does the same for gym entrepreneurs.',
        loanTypes: [
          {
            type: 'New Gym Opening Loan',
            description: 'For entrepreneurs who want to open a new gym',
            typicalAmount: '£50,000 — £500,000',
            use: 'Premises lease, equipment, fit-out, initial marketing',
          },
          {
            type: 'Gym Upgrade Loan',
            description: 'For existing gym owners who want to modernize their old gym into a new facility',
            typicalAmount: '£10,000 — £200,000',
            use: 'New equipment, renovation, technology upgrades, QR systems',
          },
          {
            type: 'Equipment Finance',
            description: 'Lease-to-own gym equipment',
            typicalAmount: '£5,000 — £100,000',
            use: 'Treadmills, weights, functional training rigs',
          },
        ],
        potentialPartners: [
          { name: 'Funding Circle', type: 'Business loans', url: 'https://www.fundingcircle.com' },
          { name: 'iwoca', type: 'Flexible business credit', url: 'https://www.iwoca.co.uk' },
          { name: 'Capify', type: 'Business cash advance', url: 'https://www.capify.co.uk' },
          { name: 'NatWest', type: 'High street bank SME lending', url: 'https://www.natwest.com/business' },
          { name: 'Liberis', type: 'Revenue-based finance', url: 'https://www.liberis.com' },
        ],
        scanGymRole: 'ScanGym provides booking revenue data to help gyms qualify for loans, acts as referral partner, may earn referral commission',
        link: '/partners/gym-loans',
        cta: 'Explore Gym Financing Options',
      },
    },

    // Footer links for every gym page
    footerLinks: [
      { label: '🥤 Vending Machines', href: '/partners/vending', description: 'Get a free vending machine for your gym' },
      { label: '📱 QR Scanners', href: '/partners/qr-hardware', description: 'Free QR scanning hardware — all cost on us' },
      { label: '🏦 Gym Opening Loans', href: '/partners/gym-loans', description: 'Finance to open a new gym or upgrade yours' },
    ],

    // Legacy supplier links (equipment)
    equipmentSuppliers: [
      { name: 'Gym Gear', url: 'https://www.gymgear.com', category: 'Equipment & Machines' },
      { name: 'Powerhouse Fitness', url: 'https://www.powerhousefitness.co.uk', category: 'Free Weights & Racks' },
      { name: 'Physical Company', url: 'https://www.physicalcompany.co.uk', category: 'Functional Training' },
      { name: 'Jordan Fitness', url: 'https://www.jordanfitness.com', category: 'Commercial Equipment' },
    ],
  });
});

// GET /api/stats/ceo/creators — Creator affiliate breakdown for CEO dashboard
router.get('/ceo/creators', authenticateUser, async (req, res) => {
  try {
    const { period = '7d' } = req.query;
    const interval = safeInterval(period);

    // Total creators
    let totalCreators = 0, totalReferrals = 0, totalEarnings = 0, totalConversions = 0;
    let creators = [];
    try {
      const totals = await pool.query(`
        SELECT COUNT(*) as total,
               COALESCE(SUM(total_referrals), 0) as referrals,
               COALESCE(SUM(total_earnings_pence), 0) as earnings,
               COALESCE(SUM(total_conversions), 0) as conversions
        FROM creator_memberships
      `);
      totalCreators = parseInt(totals.rows[0].total);
      totalReferrals = parseInt(totals.rows[0].referrals);
      totalEarnings = parseInt(totals.rows[0].earnings);
      totalConversions = parseInt(totals.rows[0].conversions);
    } catch (e) {
      console.warn('[Stats] Failed to fetch creator totals:', e.message);
    }

    // Per-creator breakdown
    try {
      const perCreator = await pool.query(`
        SELECT cm.id, cm.user_id, cm.tier, cm.badge, cm.total_referrals as referrals,
               cm.total_earnings_pence as earnings_pence, cm.total_conversions as conversions,
               cm.joined_at,
               COALESCE(u.first_name || ' ' || u.last_name, 'Creator #' || cm.id) as name,
               clp.slug as handle
        FROM creator_memberships cm
        LEFT JOIN users u ON u.id::text = cm.user_id::text
        LEFT JOIN creator_landing_pages clp ON clp.creator_user_id = cm.user_id
        ORDER BY cm.total_referrals DESC
        LIMIT 50
      `);
      creators = perCreator.rows;
    } catch (e) {
      console.warn('[Stats] Failed to fetch per-creator breakdown:', e.message);
    }

    // New creators in period
    let newCreators = 0;
    try {
      const nc = await pool.query(`
        SELECT COUNT(*) FROM creator_memberships WHERE joined_at > NOW() - INTERVAL '${interval}'
      `);
      newCreators = parseInt(nc.rows[0].count);
    } catch (e) {
      console.warn('[Stats] Failed to fetch new creators count:', e.message);
    }

    res.json({
      totalCreators,
      newCreators,
      totalReferrals,
      totalCreatorRevenue: `£${(totalEarnings / 100).toFixed(2)}`,
      totalConversions,
      creators,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch creator stats' });
  }
});

// ─────────────────────────────────────────────────────────────────
//  GET /api/stats/admin-status
//  Combined endpoint for the Admin tab — health, revenue, payouts,
//  platform status in one call for fast dashboard loading
// ─────────────────────────────────────────────────────────────────
router.get('/admin-status', authenticateUser, async (req, res) => {
  try {
    const result = {
      isLive: true,
      checkedAt: new Date().toISOString(),
      revenue: { today: '£0', total: '£0', todayPence: 0, totalPence: 0 },
      payouts: { toCreators: '£0', toPartners: '£0', creatorsPence: 0, partnersPence: 0 },
      platforms: {},
      seamStatus: 'connected',
    };

    // Revenue: Today
    try {
      const todayRev = await pool.query(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(g.day_pass_price), 0) as total
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
        AND b.created_at >= CURRENT_DATE
      `);
      const todayPence = Math.round(parseFloat(todayRev.rows[0].total || 0) * 100);
      result.revenue.todayPence = todayPence;
      result.revenue.today = '£' + (todayPence / 100).toFixed(2);
    } catch (e) {
      console.warn('[Stats] Failed to fetch today revenue:', e.message);
    }

    // Revenue: All time
    try {
      const allRev = await pool.query(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(g.day_pass_price), 0) as total
        FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id
        WHERE b.status IN ('confirmed','completed','active')
      `);
      const totalPence = Math.round(parseFloat(allRev.rows[0].total || 0) * 100);
      result.revenue.totalPence = totalPence;
      result.revenue.total = '£' + (totalPence / 100).toFixed(2);
    } catch (e) {
      console.warn('[Stats] Failed to fetch total revenue:', e.message);
    }

    // Payouts: To creators (commissions)
    try {
      const creatorPayouts = await pool.query(`
        SELECT COALESCE(SUM(commission_pence), 0) as total
        FROM creator_referrals WHERE status = 'converted'
      `);
      const cp = parseInt(creatorPayouts.rows[0].total);
      result.payouts.creatorsPence = cp;
      result.payouts.toCreators = '£' + (cp / 100).toFixed(2);
    } catch (e) {
      console.warn('[Stats] Failed to fetch creator payouts:', e.message);
    }

    // Payouts: To partners (gym owner share = 75% of revenue)
    try {
      const partnerPence = Math.round(result.revenue.totalPence * 0.75);
      result.payouts.partnersPence = partnerPence;
      result.payouts.toPartners = '£' + (partnerPence / 100).toFixed(2);
    } catch (e) {
      console.warn('[Stats] Failed to calculate partner payouts:', e.message);
    }

    // Platform counts
    try {
      const users = await pool.query('SELECT COUNT(*) FROM users');
      const bookings = await pool.query('SELECT COUNT(*) FROM bookings');
      const gyms = await pool.query('SELECT COUNT(*) FROM gyms');
      result.platforms = {
        users: parseInt(users.rows[0].count),
        bookings: parseInt(bookings.rows[0].count),
        gyms: parseInt(gyms.rows[0].count),
      };
    } catch (e) {
      console.warn('[Stats] Failed to fetch platform counts:', e.message);
    }

    // Seam status
    try {
      const seamGyms = await pool.query(`
        SELECT COUNT(*) FROM gyms WHERE access_system IS NOT NULL AND access_system != ''
      `);
      result.seamStatus = parseInt(seamGyms.rows[0].count) > 0 ? 'connected' : 'no_gyms';
      result.seamGymCount = parseInt(seamGyms.rows[0].count);
    } catch (e) {
      result.seamStatus = 'unknown';
    }

    res.json(result);
  } catch (err) {
    console.error('[Stats] Admin status error:', err.message);
    res.status(500).json({ error: 'Failed to get admin status' });
  }
});

module.exports = router;
