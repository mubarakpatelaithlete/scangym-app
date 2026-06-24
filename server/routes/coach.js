/**
 * Task 1: AI Personal Trainer — CORRECTED
 * CEO: "Only once paid and entered into the gym"
 * AI Coach unlocks ONLY after user has:
 *   1. A paid booking (status = 'completed' or 'confirmed')
 *   2. Checked in at the gym via QR scan (scan_count >= 1)
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Ensure coach tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coach_profiles (
        id SERIAL PRIMARY KEY,
        user_id INTEGER UNIQUE NOT NULL,
        fitness_goals TEXT,
        experience_level VARCHAR(20) DEFAULT 'beginner',
        age INTEGER,
        weight_kg DECIMAL,
        height_cm DECIMAL,
        injuries TEXT,
        preferred_workout_types TEXT,
        available_days VARCHAR(100),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS coach_conversations (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        role VARCHAR(20) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_coach_conv_user ON coach_conversations(user_id, created_at DESC)`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS workout_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        gym_id INTEGER,
        workout_type VARCHAR(100),
        duration_minutes INTEGER,
        exercises JSONB,
        notes TEXT,
        energy_level INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_workout_user ON workout_logs(user_id, created_at DESC)`);
    console.log('Coach tables ready');
  } catch (err) {
    console.error('Coach table creation error:', err.message);
  }
})();

/**
 * CORRECTION: Middleware that checks user has paid + checked in via QR.
 * Checks booking_checkins table for at least 1 entry scan.
 */
async function requireCheckedIn(req, res, next) {
  try {
    const userId = req.user.id;

    // Check for any active/completed booking with a QR check-in
    const result = await pool.query(`
      SELECT b.id, b.gym_id, bc.scan_type
      FROM bookings b
      INNER JOIN booking_checkins bc ON bc.booking_id = b.id
      WHERE b.user_id = $1
        AND b.status IN ('confirmed', 'completed', 'active')
        AND bc.scan_type = 'entry'
      ORDER BY bc.scanned_at DESC
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.status(403).json({
        error: 'AI Coach locked',
        message: 'You need to book a gym session and check in with your QR code before using the AI Coach.',
        hint: 'Book a session → Scan QR at the gym entrance → AI Coach unlocks',
        requiresBooking: true,
        requiresCheckin: true,
      });
    }

    req.activeGymId = result.rows[0].gym_id;
    next();
  } catch (err) {
    // If tables don't exist yet, fall back to checking just bookings
    try {
      const bookings = await pool.query(
        `SELECT id FROM bookings WHERE user_id = $1 AND status IN ('confirmed', 'completed', 'active') LIMIT 1`,
        [req.user.id]
      );
      if (bookings.rows.length === 0) {
        return res.status(403).json({
          error: 'AI Coach locked',
          message: 'You need a paid booking to use the AI Coach.',
          requiresBooking: true,
        });
      }
      next();
    } catch (e) {
      console.error('Check-in verification error:', e.message);
      return res.status(500).json({ error: 'Failed to verify check-in status' });
    }
  }
}

function buildCoachSystemPrompt(profile, recentWorkouts, bookingHistory) {
  let prompt = `You are ScanGym's AI Personal Trainer — a friendly, knowledgeable fitness coach.
You are ONLY available to users who have paid for a gym session and checked in at the gym.
You remember everything the user has told you and use it to give personalized advice.

USER PROFILE:
`;
  if (profile) {
    prompt += `- Goals: ${profile.fitness_goals || 'Not set'}
- Experience: ${profile.experience_level || 'beginner'}
- Age: ${profile.age || 'Unknown'}
- Weight: ${profile.weight_kg ? profile.weight_kg + 'kg' : 'Unknown'}
- Height: ${profile.height_cm ? profile.height_cm + 'cm' : 'Unknown'}
- Injuries/Limitations: ${profile.injuries || 'None reported'}
- Preferred workouts: ${profile.preferred_workout_types || 'Any'}
- Available days: ${profile.available_days || 'Flexible'}
`;
  } else {
    prompt += `- New user — no profile yet. Ask about their goals and experience level.\n`;
  }

  if (recentWorkouts && recentWorkouts.length > 0) {
    prompt += `\nRECENT WORKOUTS (last 5):\n`;
    recentWorkouts.forEach(w => {
      prompt += `- ${w.workout_type || 'Workout'} on ${new Date(w.created_at).toLocaleDateString()} (${w.duration_minutes || '?'}min, energy: ${w.energy_level || '?'}/10)\n`;
    });
  }

  if (bookingHistory && bookingHistory.length > 0) {
    prompt += `\nGYM VISITS (recent bookings):\n`;
    bookingHistory.forEach(b => {
      prompt += `- ${b.gym_name || 'Gym'} on ${new Date(b.created_at).toLocaleDateString()}\n`;
    });
  }

  prompt += `
GUIDELINES:
- Give specific, actionable advice based on their profile
- If they're new, help them set up their profile first
- Suggest workouts appropriate to their level and goals
- Track progress and celebrate wins
- Warn about overtraining or injury risks
- Keep responses concise (under 200 words) unless they ask for detailed plans
- Be motivating and supportive`;

  return prompt;
}

// POST /api/coach/message — GATED: requires paid booking + QR check-in
router.post('/message', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const userId = req.user.id;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const profileResult = await pool.query('SELECT * FROM coach_profiles WHERE user_id = $1', [userId]);
    const profile = profileResult.rows[0] || null;

    const workoutsResult = await pool.query(
      'SELECT * FROM workout_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [userId]
    );

    let bookingHistory = [];
    try {
      const bookingsResult = await pool.query(
        'SELECT b.*, g.name as gym_name FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 5',
        [userId]
      );
      bookingHistory = bookingsResult.rows;
    } catch (e) {
      console.warn('[Coach] Failed to fetch booking history for context:', e.message);
    }

    await pool.query(
      'INSERT INTO coach_conversations (user_id, role, content) VALUES ($1, $2, $3)',
      [userId, 'user', message]
    );

    const historyResult = await pool.query(
      'SELECT role, content FROM coach_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    );
    const history = historyResult.rows.reverse();

    const systemPrompt = buildCoachSystemPrompt(profile, workoutsResult.rows, bookingHistory);
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content })),
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 500,
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0]?.message?.content || "I'm having trouble right now. Let's try again!";

    await pool.query(
      'INSERT INTO coach_conversations (user_id, role, content) VALUES ($1, $2, $3)',
      [userId, 'assistant', aiResponse]
    );

    res.json({
      message: { role: 'assistant', content: aiResponse, timestamp: new Date().toISOString() },
      hasProfile: !!profile,
      checkedInAt: req.activeGymId || null,
    });
  } catch (err) {
    console.error('Coach message error:', err);
    if (err.status === 401 || err.code === 'invalid_api_key') {
      return res.status(503).json({ error: 'AI service temporarily unavailable' });
    }
    res.status(500).json({ error: 'Failed to get coach response' });
  }
});

// GET /api/coach/status — Check if user can access AI Coach
router.get('/status', authenticateUser, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check for paid booking
    let hasBooking = false;
    try {
      const bookings = await pool.query(
        `SELECT id FROM bookings WHERE user_id = $1 AND status IN ('confirmed', 'completed', 'active') LIMIT 1`,
        [userId]
      );
      hasBooking = bookings.rows.length > 0;
    } catch (e) {
      console.warn('[Coach] Failed to check booking status:', e.message);
    }

    // Check for QR check-in
    let hasCheckedIn = false;
    try {
      const checkins = await pool.query(
        `SELECT bc.id FROM booking_checkins bc
         INNER JOIN bookings b ON bc.booking_id = b.id
         WHERE b.user_id = $1 AND bc.scan_type = 'entry'
         LIMIT 1`,
        [userId]
      );
      hasCheckedIn = checkins.rows.length > 0;
    } catch (e) {
      console.warn('[Coach] Failed to check check-in status:', e.message);
    }

    const unlocked = hasBooking && hasCheckedIn;

    res.json({
      unlocked,
      hasBooking,
      hasCheckedIn,
      message: unlocked
        ? 'AI Coach is ready! Start chatting.'
        : !hasBooking
          ? 'Book a gym session first to unlock AI Coach.'
          : 'Check in at the gym with your QR code to unlock AI Coach.',
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check coach status' });
  }
});

// GET /api/coach/history — GATED
router.get('/history', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await pool.query(
      'SELECT role, content, created_at FROM coach_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.user.id, parseInt(limit), offset]
    );
    res.json({ messages: result.rows.reverse() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// PUT /api/coach/profile — GATED
router.put('/profile', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const userId = req.user.id;
    const { fitnessGoals, experienceLevel, age, weightKg, heightCm, injuries, preferredWorkoutTypes, availableDays } = req.body;

    const result = await pool.query(`
      INSERT INTO coach_profiles (user_id, fitness_goals, experience_level, age, weight_kg, height_cm, injuries, preferred_workout_types, available_days, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (user_id) DO UPDATE SET
        fitness_goals = COALESCE($2, coach_profiles.fitness_goals),
        experience_level = COALESCE($3, coach_profiles.experience_level),
        age = COALESCE($4, coach_profiles.age),
        weight_kg = COALESCE($5, coach_profiles.weight_kg),
        height_cm = COALESCE($6, coach_profiles.height_cm),
        injuries = COALESCE($7, coach_profiles.injuries),
        preferred_workout_types = COALESCE($8, coach_profiles.preferred_workout_types),
        available_days = COALESCE($9, coach_profiles.available_days),
        updated_at = NOW()
      RETURNING *
    `, [userId, fitnessGoals, experienceLevel, age, weightKg, heightCm, injuries, preferredWorkoutTypes, availableDays]);

    res.json({ profile: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// GET /api/coach/profile — GATED
router.get('/profile', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM coach_profiles WHERE user_id = $1', [req.user.id]);
    res.json({ profile: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// POST /api/coach/workout — GATED
router.post('/workout', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const { gymId, workoutType, durationMinutes, exercises, notes, energyLevel } = req.body;
    const result = await pool.query(`
      INSERT INTO workout_logs (user_id, gym_id, workout_type, duration_minutes, exercises, notes, energy_level)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [req.user.id, gymId || req.activeGymId || null, workoutType, durationMinutes, exercises ? JSON.stringify(exercises) : null, notes, energyLevel]);
    res.status(201).json({ workout: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to log workout' });
  }
});

// GET /api/coach/workouts — GATED
router.get('/workouts', authenticateUser, requireCheckedIn, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const result = await pool.query(
      'SELECT * FROM workout_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [req.user.id, parseInt(limit), offset]
    );
    res.json({ workouts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch workouts' });
  }
});

module.exports = router;
