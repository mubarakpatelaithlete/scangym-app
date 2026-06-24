/**
 * Task 3: Rate a Gym / Reviews System
 * 5-star ratings like Uber, with verified bookings and owner responses.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');

// ─── Helper: Resolve gymId param to integer DB id ────────────
// Handles both integer IDs (from DB) and Google Place ID strings (e.g. "ChIJ...")
async function resolveGymId(gymIdParam) {
  const parsed = parseInt(gymIdParam);
  if (!isNaN(parsed)) return parsed;
  // It's a Place ID string — look up the gym by place_id
  const result = await pool.query('SELECT id FROM gyms WHERE place_id = $1 LIMIT 1', [gymIdParam]);
  return result.rows.length > 0 ? result.rows[0].id : null;
}

// GET /api/reviews/gym/:gymId - Public: Get reviews for a gym
router.get('/gym/:gymId', optionalAuth, async (req, res) => {
  try {
    const { gymId: gymIdParam } = req.params;
    const { page = 1, limit = 20, sort = 'newest' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const SORT_OPTIONS = { highest: 'rating DESC', lowest: 'rating ASC', newest: 'created_at DESC' };
    const orderBy = SORT_OPTIONS[sort] || 'created_at DESC';

    const gymId = await resolveGymId(gymIdParam);
    if (gymId === null) {
      // No gym found for this Place ID — return empty reviews (not 500)
      return res.json({
        reviews: [], stats: { totalReviews: 0, averageRating: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } },
        page: parseInt(page), totalPages: 0,
      });
    }

    const reviewsResult = await pool.query(`
      SELECT id, rating, comment, owner_response, created_at, updated_at,
             user_id,
             CASE WHEN booking_id IS NOT NULL THEN true ELSE false END as verified_visit
      FROM reviews
      WHERE gym_id = $1
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
    `, [gymId, parseInt(limit), offset]);

    const statsResult = await pool.query(`
      SELECT COUNT(*) as total_reviews,
             COALESCE(AVG(rating), 0) as average_rating,
             COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
             COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
             COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
             COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
             COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
      FROM reviews WHERE gym_id = $1
    `, [gymId]);

    const stats = statsResult.rows[0];
    res.json({
      reviews: reviewsResult.rows,
      stats: {
        totalReviews: parseInt(stats.total_reviews),
        averageRating: parseFloat(parseFloat(stats.average_rating).toFixed(1)),
        distribution: {
          5: parseInt(stats.five_star),
          4: parseInt(stats.four_star),
          3: parseInt(stats.three_star),
          2: parseInt(stats.two_star),
          1: parseInt(stats.one_star),
        },
      },
      page: parseInt(page),
      totalPages: Math.ceil(parseInt(stats.total_reviews) / parseInt(limit)),
    });
  } catch (err) {
    console.error('Get reviews error:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// POST /api/reviews - Auth: Create a review
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { gymId: gymIdParam, rating, comment, bookingId } = req.body;
    const userId = req.user.id;

    if (!gymIdParam || !rating) {
      return res.status(400).json({ error: 'gymId and rating are required' });
    }
    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    const gymId = await resolveGymId(gymIdParam);
    if (gymId === null) {
      return res.status(404).json({ error: 'Gym not found' });
    }

    const existing = await pool.query(
      'SELECT id FROM reviews WHERE user_id = $1 AND gym_id = $2',
      [userId, gymId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already reviewed this gym', reviewId: existing.rows[0].id });
    }

    if (bookingId) {
      const booking = await pool.query(
        'SELECT id, booking_date FROM bookings WHERE id = $1 AND user_id = $2',
        [parseInt(bookingId), userId]
      );
      if (booking.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid booking ID' });
      }
      // #70: 7-day review window — only allow reviews within 7 days of booking
      const bookingDate = new Date(booking.rows[0].booking_date);
      const daysSinceBooking = (Date.now() - bookingDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceBooking > 7) {
        return res.status(400).json({ error: 'Review window expired — reviews must be submitted within 7 days of your visit' });
      }
    }

    const result = await pool.query(`
      INSERT INTO reviews (gym_id, user_id, booking_id, rating, comment, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `, [gymId, userId, bookingId ? parseInt(bookingId) : null, rating, comment || null]);

    await pool.query(`
      UPDATE gyms SET
        average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE gym_id = $1),
        total_reviews = (SELECT COUNT(*) FROM reviews WHERE gym_id = $1),
        updated_at = NOW()
      WHERE id = $1
    `, [gymId]);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create review error:', err);
    res.status(500).json({ error: 'Failed to create review' });
  }
});

// PUT /api/reviews/:id - Auth: Update your review
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;
    const userId = req.user.id;

    const result = await pool.query(`
      UPDATE reviews SET
        rating = COALESCE($1, rating),
        comment = COALESCE($2, comment),
        updated_at = NOW()
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `, [rating, comment, parseInt(id), userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or not yours' });
    }

    const review = result.rows[0];
    await pool.query(`
      UPDATE gyms SET
        average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE gym_id = $1),
        updated_at = NOW()
      WHERE id = $1
    `, [review.gym_id]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update review error:', err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// DELETE /api/reviews/:id - Auth: Delete your review
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const result = await pool.query(
      'DELETE FROM reviews WHERE id = $1 AND user_id = $2 RETURNING gym_id',
      [parseInt(id), userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found or not yours' });
    }
    await pool.query(`
      UPDATE gyms SET
        average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE gym_id = $1),
        total_reviews = (SELECT COUNT(*) FROM reviews WHERE gym_id = $1),
        updated_at = NOW()
      WHERE id = $1
    `, [result.rows[0].gym_id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete review error:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// POST /api/reviews/:id/respond - Owner: Respond to review
router.post('/:id/respond', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { response } = req.body;
    const userId = req.user.id;

    if (!response) {
      return res.status(400).json({ error: 'Response text is required' });
    }

    const review = await pool.query('SELECT gym_id FROM reviews WHERE id = $1', [parseInt(id)]);
    if (review.rows.length === 0) {
      return res.status(404).json({ error: 'Review not found' });
    }

    const gym = await pool.query(
      'SELECT id FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [review.rows[0].gym_id, userId]
    );
    if (gym.rows.length === 0) {
      return res.status(403).json({ error: 'Only gym owners can respond to reviews' });
    }

    const result = await pool.query(`
      UPDATE reviews SET owner_response = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [response, parseInt(id)]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Owner respond error:', err);
    res.status(500).json({ error: 'Failed to respond to review' });
  }
});

module.exports = router;
