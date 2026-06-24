/**
 * Task 9: Conviction Model — CORRECTED
 * CEO: "also implement all 33" — implement ALL 33 Booking.com persuasion techniques.
 *
 * Each technique generates real-time social proof / urgency / trust signals
 * contextualized to the specific gym being viewed.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');

/**
 * ALL 33 Booking.com Persuasion Techniques adapted for ScanGym
 */
const TECHNIQUE_DEFINITIONS = [
  // --- SOCIAL PROOF (1-8) ---
  { id: 1, name: 'recent_bookings', category: 'social_proof', label: 'Recent Activity',
    generate: (d) => d.weeklyBookings > 0 ? `🔥 ${d.weeklyBookings} people booked this gym in the last 7 days` : null },
  { id: 2, name: 'live_visitors', category: 'social_proof', label: 'Live Visitors',
    generate: (d) => d.todayBookings > 0 ? `${d.todayBookings} people visiting today` : null },
  { id: 3, name: 'recent_views', category: 'social_proof', label: 'Popular Now',
    generate: (d) => d.recentViews > 5 ? `👀 ${d.recentViews} people viewed this gym in the last hour` : null },
  { id: 4, name: 'review_count', category: 'social_proof', label: 'Trusted',
    generate: (d) => d.totalReviews > 0 ? `⭐ ${d.avgRating}/5 from ${d.totalReviews} verified reviews` : null },
  { id: 5, name: 'repeat_visitors', category: 'social_proof', label: 'Regulars Love It',
    generate: (d) => d.repeatRate > 20 ? `${d.repeatRate}% of visitors come back again` : null },
  { id: 6, name: 'local_favourite', category: 'social_proof', label: 'Local Favourite',
    generate: (d) => d.cityRank && d.cityRank <= 3 ? `🏆 #${d.cityRank} most booked gym in ${d.city}` : null },
  { id: 7, name: 'just_booked', category: 'social_proof', label: 'Just Booked',
    generate: (d) => d.lastBookingMinsAgo < 60 ? `Someone booked ${d.lastBookingMinsAgo} min ago` : null },
  { id: 8, name: 'community_size', category: 'social_proof', label: 'Community',
    generate: (d) => d.totalMembers > 10 ? `${d.totalMembers} ScanGym members have trained here` : null },

  // --- SCARCITY (9-14) ---
  { id: 9, name: 'limited_slots', category: 'scarcity', label: 'Limited Availability',
    generate: (d) => d.isPeakHour ? `⚡ Peak hours — book now to guarantee your spot` : null },
  { id: 10, name: 'first_visit_discount', category: 'scarcity', label: 'First Visit Deal',
    generate: (d) => d.firstVisitDiscount > 0 && !d.hasVisited ? `🎁 First visit: ${d.firstVisitDiscount}% off — only for new visitors` : null },
  { id: 11, name: 'off_peak_deal', category: 'scarcity', label: 'Off-Peak Deal',
    generate: () => null }, // v4.1: Off-peak discount removed — flat pricing
  { id: 12, name: 'wallet_bonus', category: 'scarcity', label: 'Wallet Bonus',
    generate: (d) => d.hasWallet === false ? `💰 Top up £20+ and get 10% bonus credits for this booking` : null },
  { id: 13, name: 'popular_time', category: 'scarcity', label: 'Popular Time',
    generate: (d) => d.isPeakHour ? `📈 This is a popular time — ${d.todayBookings} people already booked today` : null },
  { id: 14, name: 'seasonal_demand', category: 'scarcity', label: 'High Demand',
    generate: (d) => d.monthlyGrowth > 10 ? `📊 Bookings up ${d.monthlyGrowth}% this month` : null },

  // --- URGENCY (15-20) ---
  { id: 15, name: 'closing_soon', category: 'urgency', label: 'Closing Time',
    generate: (d) => d.hoursUntilClose && d.hoursUntilClose <= 3 ? `⏰ Gym closes in ${d.hoursUntilClose}h — book now for today` : null },
  { id: 16, name: 'price_rising', category: 'urgency', label: 'Price Alert',
    generate: () => null }, // v4.1: No peak/off-peak price difference
  { id: 17, name: 'day_pass_timer', category: 'urgency', label: '24hr Timer',
    generate: () => `⏱️ 24hr day pass — full access from the moment you scan in` },
  { id: 18, name: 'weekend_rush', category: 'urgency', label: 'Weekend Rush',
    generate: (d) => d.isWeekend ? `Weekend sessions fill up fast — secure your spot` : null },
  { id: 19, name: 'new_year_surge', category: 'urgency', label: 'Seasonal Surge',
    generate: (d) => [0, 1].includes(d.month) ? `🎯 New Year fitness season — gyms are busier than usual` : null },
  { id: 20, name: 'same_day_booking', category: 'urgency', label: 'Same Day',
    generate: () => `📱 Book now, scan in today — instant access` },

  // --- TRUST (21-27) ---
  { id: 21, name: 'verified_gym', category: 'trust', label: 'Verified',
    generate: () => `✅ Verified ScanGym partner gym` },
  { id: 22, name: 'secure_payment', category: 'trust', label: 'Secure',
    generate: () => `🔒 Secure payment via Stripe — your data is protected` },
  { id: 23, name: 'money_back', category: 'trust', label: 'Guarantee',
    generate: () => `💯 Not satisfied? Full refund within 2 hours of booking` },
  { id: 24, name: 'no_contract', category: 'trust', label: 'No Commitment',
    generate: () => `📝 No contracts, no memberships — pay per visit` },
  { id: 25, name: 'google_rating', category: 'trust', label: 'Google Verified',
    generate: (d) => d.googleRating ? `Google Maps: ${d.googleRating}⭐ (${d.googleReviewCount} reviews)` : null },
  { id: 26, name: 'insurance_covered', category: 'trust', label: 'Insured',
    generate: () => `🛡️ All partner gyms carry public liability insurance` },
  { id: 27, name: 'qr_access', category: 'trust', label: 'Easy Access',
    generate: () => `📲 QR code entry — no reception queue, scan and go` },

  // --- AUTHORITY (28-30) ---
  { id: 28, name: 'gym_count', category: 'authority', label: 'Network',
    generate: (d) => d.totalGymsOnPlatform > 1 ? `Part of ${d.totalGymsOnPlatform} gyms on ScanGym` : null },
  { id: 29, name: 'city_presence', category: 'authority', label: 'Local',
    generate: (d) => d.cityGymCount > 1 ? `${d.cityGymCount} gyms available in ${d.city}` : null },
  { id: 30, name: 'years_established', category: 'authority', label: 'Established',
    generate: (d) => d.gymAge > 1 ? `Established gym — serving the community for ${d.gymAge}+ years` : null },

  // --- RECIPROCITY/ANCHORING (31-33) ---
  { id: 31, name: 'free_trial_nudge', category: 'reciprocity', label: 'Try Free',
    generate: (d) => !d.hasVisited ? `🆓 Your first visit could be up to 50% off` : null },
  { id: 32, name: 'price_comparison', category: 'anchoring', label: 'Value',
    generate: (d) => d.dayPassPrice ? `£${d.dayPassPrice}/day vs typical gym membership £30-50/month` : null },
  { id: 33, name: 'savings_calculator', category: 'anchoring', label: 'Savings',
    generate: (d) => d.dayPassPrice ? `Visit ${Math.ceil(30 / d.dayPassPrice)}x per month before a membership makes sense — pay only for what you use` : null },
];

/**
 * Gather real-time data for a gym to feed into conviction techniques
 */
async function gatherGymData(gymId, userId) {
  const data = {
    gymId,
    isPeakHour: false,
    isOffPeak: false,
    isWeekend: false,
    month: new Date().getMonth(),
    hoursUntilClose: null,
    todayBookings: 0,
    weeklyBookings: 0,
    recentViews: 0,
    totalReviews: 0,
    avgRating: 0,
    repeatRate: 0,
    totalMembers: 0,
    lastBookingMinsAgo: null,
    cityRank: null,
    city: null,
    dayPassPrice: null,
    firstVisitDiscount: 50,
    offPeakDiscount: 0,
    hasVisited: false,
    hasWallet: false,
    monthlyGrowth: 0,
    googleRating: null,
    googleReviewCount: 0,
    totalGymsOnPlatform: 0,
    cityGymCount: 0,
    gymAge: null,
  };

  try {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    data.isPeakHour = (hour >= 6 && hour <= 9) || (hour >= 17 && hour <= 20);
    data.isOffPeak = !data.isPeakHour;
    data.isWeekend = day === 0 || day === 6;

    // Gym info
    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1', [gymId]);
    if (gym.rows[0]) {
      const g = gym.rows[0];
      data.city = g.city;
      data.dayPassPrice = g.day_pass_price;
      data.googleRating = g.average_rating;
      data.googleReviewCount = g.total_reviews || 0;
    }

    // Booking stats
    const todayBookings = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE gym_id = $1 AND created_at > CURRENT_DATE`, [gymId]);
    data.todayBookings = parseInt(todayBookings.rows[0].count);

    const weeklyBookings = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE gym_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [gymId]);
    data.weeklyBookings = parseInt(weeklyBookings.rows[0].count);

    // Last booking
    const lastBooking = await pool.query(
      `SELECT created_at FROM bookings WHERE gym_id = $1 ORDER BY created_at DESC LIMIT 1`, [gymId]);
    if (lastBooking.rows[0]) {
      data.lastBookingMinsAgo = Math.round((now - new Date(lastBooking.rows[0].created_at)) / 60000);
    }

    // Reviews
    const reviews = await pool.query(
      `SELECT COUNT(*) as total, COALESCE(AVG(rating), 0) as avg FROM reviews WHERE gym_id = $1`, [gymId]);
    data.totalReviews = parseInt(reviews.rows[0].total);
    data.avgRating = parseFloat(parseFloat(reviews.rows[0].avg).toFixed(1));

    // Unique visitors & repeat rate
    const uniqueVisitors = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as total FROM bookings WHERE gym_id = $1`, [gymId]);
    data.totalMembers = parseInt(uniqueVisitors.rows[0].total);

    const repeats = await pool.query(
      `SELECT COUNT(*) FROM (SELECT user_id FROM bookings WHERE gym_id = $1 GROUP BY user_id HAVING COUNT(*) > 1) t`, [gymId]);
    if (data.totalMembers > 0) {
      data.repeatRate = Math.round((parseInt(repeats.rows[0].count) / data.totalMembers) * 100);
    }

    // Recent views from analytics
    try {
      const views = await pool.query(
        `SELECT COUNT(*) FROM analytics_events WHERE path LIKE $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [`%gym%${gymId}%`]);
      data.recentViews = parseInt(views.rows[0].count);
    } catch (e) {
      console.warn('[Conviction] Failed to fetch recent view count:', e.message);
    }

    // Platform stats
    const totalGyms = await pool.query('SELECT COUNT(*) FROM gyms');
    data.totalGymsOnPlatform = parseInt(totalGyms.rows[0].count);

    if (data.city) {
      const cityGyms = await pool.query('SELECT COUNT(*) FROM gyms WHERE city = $1', [data.city]);
      data.cityGymCount = parseInt(cityGyms.rows[0].count);

      // City rank
      const ranked = await pool.query(`
        SELECT gym_id, COUNT(*) as bk FROM bookings b
        JOIN gyms g ON b.gym_id = g.id WHERE g.city = $1
        GROUP BY gym_id ORDER BY bk DESC`, [data.city]);
      const idx = ranked.rows.findIndex(r => r.gym_id === gymId);
      if (idx >= 0) data.cityRank = idx + 1;
    }

    // Pricing
    try {
      const pricing = await pool.query('SELECT * FROM gym_pricing WHERE gym_id = $1', [gymId]);
      if (pricing.rows[0]) {
        data.firstVisitDiscount = pricing.rows[0].first_visit_discount_pct || 50;
        data.offPeakDiscount = pricing.rows[0].off_peak_discount_pct || 0;
      }
    } catch (e) {
      console.warn('[Conviction] Failed to fetch gym pricing:', e.message);
    }

    // User-specific
    if (userId) {
      const visited = await pool.query(
        'SELECT id FROM bookings WHERE user_id = $1 AND gym_id = $2 LIMIT 1', [userId, gymId]);
      data.hasVisited = visited.rows.length > 0;

      const wallet = await pool.query('SELECT id FROM wallets WHERE user_id = $1', [userId]);
      data.hasWallet = wallet.rows.length > 0;
    }

    // Monthly growth
    const thisMonth = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE gym_id = $1 AND created_at > DATE_TRUNC('month', NOW())`, [gymId]);
    const lastMonth = await pool.query(
      `SELECT COUNT(*) FROM bookings WHERE gym_id = $1 AND created_at > DATE_TRUNC('month', NOW() - INTERVAL '1 month') AND created_at < DATE_TRUNC('month', NOW())`, [gymId]);
    const tm = parseInt(thisMonth.rows[0].count);
    const lm = parseInt(lastMonth.rows[0].count);
    if (lm > 0) data.monthlyGrowth = Math.round(((tm - lm) / lm) * 100);

  } catch (err) {
    console.error('Conviction data gather error:', err.message);
  }

  return data;
}

// GET /api/conviction/gym/:gymId — Get all active conviction signals for a gym
router.get('/gym/:gymId', optionalAuth, async (req, res) => {
  try {
    const gymId = parseInt(req.params.gymId);
    const userId = req.user?.id || null;
    const { category, limit } = req.query;

    const data = await gatherGymData(gymId, userId);

    // Generate all 33 techniques
    let signals = TECHNIQUE_DEFINITIONS.map(tech => {
      const message = tech.generate(data);
      return message ? {
        id: tech.id,
        name: tech.name,
        category: tech.category,
        label: tech.label,
        message,
      } : null;
    }).filter(Boolean);

    // Filter by category if requested
    if (category) {
      signals = signals.filter(s => s.category === category);
    }

    // Limit
    if (limit) {
      signals = signals.slice(0, parseInt(limit));
    }

    // Group by category
    const byCategory = {};
    signals.forEach(s => {
      if (!byCategory[s.category]) byCategory[s.category] = [];
      byCategory[s.category].push(s);
    });

    res.json({
      gymId,
      totalTechniques: 33,
      activeTechniques: signals.length,
      signals,
      byCategory,
      categories: ['social_proof', 'scarcity', 'urgency', 'trust', 'authority', 'reciprocity', 'anchoring'],
      realTimeData: {
        isPeakHour: data.isPeakHour,
        currentLoad: data.todayBookings,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('Conviction error:', err);
    res.status(500).json({ error: 'Failed to generate conviction signals' });
  }
});

// GET /api/conviction/techniques — List all 33 techniques
router.get('/techniques', (req, res) => {
  res.json({
    total: 33,
    source: 'Booking.com persuasion playbook — all 33 adapted for ScanGym',
    techniques: TECHNIQUE_DEFINITIONS.map(t => ({
      id: t.id,
      name: t.name,
      category: t.category,
      label: t.label,
    })),
    categories: {
      social_proof: { count: 8, description: 'Show others are booking/visiting' },
      scarcity: { count: 6, description: 'Limited availability, deals, peak times' },
      urgency: { count: 6, description: 'Time-sensitive triggers' },
      trust: { count: 7, description: 'Verification, security, guarantees' },
      authority: { count: 3, description: 'Platform credibility, network size' },
      reciprocity: { count: 1, description: 'Free trials, discounts as gifts' },
      anchoring: { count: 2, description: 'Price comparisons, value framing' },
    },
  });
});

module.exports = router;
