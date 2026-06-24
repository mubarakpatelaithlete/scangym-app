/**
 * Task 19: Guest Booking Flow + Task 20: Minimize Friction
 * Allow guests to browse, search, and get gym info without logging in.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');
const { parsePagination } = require('../lib/pagination');

// GET /api/guest/gyms - Browse gyms without auth
router.get('/gyms', async (req, res) => {
  try {
    const { city, search, lat, lng, radius = 10, type, amenity, minRating, maxPrice, sortBy } = req.query;
    const { page, limit, offset } = parsePagination(req.query, { limit: 20 });
    let query = 'SELECT * FROM gyms WHERE 1=1';
    const params = [];

    if (city) {
      params.push(`%${city}%`);
      query += ` AND city ILIKE $${params.length}`;
    }
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    // Task 20: Additional filters to minimize friction
    if (type) {
      params.push(`%${type}%`);
      query += ` AND (gym_type ILIKE $${params.length} OR name ILIKE $${params.length})`;
    }
    if (minRating) {
      params.push(parseFloat(minRating));
      query += ` AND average_rating >= $${params.length}`;
    }
    if (maxPrice) {
      params.push(parseFloat(maxPrice));
      query += ` AND (hourly_rate <= $${params.length} OR day_pass_price <= $${params.length})`;
    }
    // Distance filter
    if (lat && lng) {
      params.push(parseFloat(lat), parseFloat(lng), parseFloat(radius));
      query += ` AND (
        6371 * acos(
          cos(radians($${params.length - 2})) * cos(radians(CAST(latitude AS FLOAT)))
          * cos(radians(CAST(longitude AS FLOAT)) - radians($${params.length - 1}))
          + sin(radians($${params.length - 2})) * sin(radians(CAST(latitude AS FLOAT)))
        )
      ) < $${params.length}`;
    }

    // Task 20: Smart sorting
    const orderClause = sortBy === 'price' ? 'hourly_rate ASC NULLS LAST' :
                         sortBy === 'distance' && lat ? 'latitude ASC' :
                         sortBy === 'reviews' ? 'total_reviews DESC NULLS LAST' :
                         'average_rating DESC NULLS LAST';
    query += ` ORDER BY ${orderClause}`;

    params.push(parseInt(limit), offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);
    const countResult = await pool.query('SELECT COUNT(*) FROM gyms');

    res.json({
      gyms: result.rows.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        address: g.address,
        city: g.city,
        latitude: g.latitude,
        longitude: g.longitude,
        hourlyRate: g.hourly_rate,
        dayPassPrice: g.day_pass_price,
        averageRating: g.average_rating,
        totalReviews: g.total_reviews,
        amenities: g.amenities,
        photos: g.photos,
        operatingHours: g.operating_hours,
      })),
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
    });
  } catch (err) {
    console.error('Guest gyms error:', err);
    res.status(500).json({ error: 'Failed to fetch gyms' });
  }
});

// GET /api/guest/gym/:id - Full gym details without auth
router.get('/gym/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const gym = await pool.query('SELECT * FROM gyms WHERE id = $1', [parseInt(id)]);
    if (gym.rows.length === 0) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const reviewStats = await pool.query(`
      SELECT COUNT(*) as total, COALESCE(AVG(rating), 0) as avg_rating
      FROM reviews WHERE gym_id = $1
    `, [parseInt(id)]);

    const latestReviews = await pool.query(`
      SELECT rating, comment, created_at
      FROM reviews WHERE gym_id = $1
      ORDER BY created_at DESC LIMIT 3
    `, [parseInt(id)]);

    const g = gym.rows[0];
    res.json({
      ...g,
      // Task 23: Google Maps direction link
      directionsUrl: g.latitude && g.longitude
        ? `https://www.google.com/maps/dir/?api=1&destination=${g.latitude},${g.longitude}&destination_place_id=${g.place_id || ''}`
        : g.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(g.address)}` : null,
      reviewSummary: {
        total: parseInt(reviewStats.rows[0].total),
        averageRating: parseFloat(parseFloat(reviewStats.rows[0].avg_rating).toFixed(1)),
      },
      latestReviews: latestReviews.rows,
    });
  } catch (err) {
    console.error('Guest gym detail error:', err);
    res.status(500).json({ error: 'Failed to fetch gym details' });
  }
});

// GET /api/guest/featured - Featured gyms (fallback when GPS unavailable)
router.get('/featured', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, city, address, average_rating, total_reviews, photos,
             hourly_rate, day_pass_price, latitude, longitude, description
      FROM gyms WHERE is_active = true
      ORDER BY average_rating DESC NULLS LAST
      LIMIT 20
    `);
    res.json({
      gyms: result.rows.map(g => ({
        id: g.id,
        name: g.name,
        city: g.city,
        address: g.address,
        vicinity: g.address || g.city,
        rating: g.average_rating,
        user_ratings_total: g.total_reviews || 0,
        dayPassPrice: g.day_pass_price || g.hourly_rate || '5.00',
        price_tier: g.day_pass_price || '5.00',
        latitude: g.latitude,
        longitude: g.longitude,
        photo: g.photos ? (Array.isArray(g.photos) ? g.photos[0] : null) : null,
      })),
    });
  } catch (err) {
    console.error('Featured gyms error:', err);
    res.status(500).json({ error: 'Failed to fetch featured gyms' });
  }
});

// GET /api/guest/popular - Popular gyms
router.get('/popular', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, city, average_rating, total_reviews, photos, hourly_rate, day_pass_price
      FROM gyms
      ORDER BY total_reviews DESC, average_rating DESC NULLS LAST
      LIMIT 10
    `);
    res.json({ gyms: result.rows });
  } catch (err) {
    console.error('Popular gyms error:', err);
    res.status(500).json({ error: 'Failed to fetch popular gyms' });
  }
});

// GET /api/guest/cities - Available cities
router.get('/cities', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT city, COUNT(*) as gym_count
      FROM gyms WHERE city IS NOT NULL
      GROUP BY city ORDER BY gym_count DESC
    `);
    res.json({ cities: result.rows });
  } catch (err) {
    console.error('Guest cities error:', err);
    res.status(500).json({ error: 'Failed to fetch cities' });
  }
});

// Task 20: GET /api/guest/quick-search - Fast search for autocomplete
router.get('/quick-search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) {
      return res.json({ results: [] });
    }
    const result = await pool.query(`
      SELECT id, name, city, average_rating, hourly_rate
      FROM gyms
      WHERE name ILIKE $1 OR city ILIKE $1
      ORDER BY average_rating DESC NULLS LAST
      LIMIT 5
    `, [`%${q}%`]);
    res.json({ results: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
