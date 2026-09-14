/**
 * AI Coach core — the gate and the brief, shared by routes/coach.js and the voice tool.
 *
 * CEO rule: the coach unlocks only once the customer has paid AND scanned in at the
 * gym. That check used to live only in the route's middleware, so a second entry
 * point (voice) could have drifted from it. Now there is one `checkedInGym()` and one
 * `buildCoachSystemPrompt()`; both callers read them from here.
 */
const pool = require('../middleware/db');

/**
 * { ok:true, gymId } for the gym the customer most recently scanned into on a paid
 * booking; { ok:false } when the coach is locked for them.
 */
async function checkedIn(userId) {
  const { rows } = await pool.query(
    `SELECT b.id, b.gym_id, bc.scan_type
      FROM bookings b
      INNER JOIN booking_checkins bc ON bc.booking_id = b.id
      WHERE b.user_id = $1
        AND b.status IN ('confirmed', 'completed', 'active')
        AND bc.scan_type = 'entry'
      ORDER BY bc.scanned_at DESC
      LIMIT 1`,
    [userId]
  );
  return rows.length ? { ok: true, gymId: rows[0].gym_id || null } : { ok: false };
}

const LOCKED_MESSAGE = 'You need to book a gym session and check in with your QR code before using the AI Coach.';

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

/** Everything the coach should know about this customer, read from their own rows. */
async function coachContext(userId) {
  const profile = (await pool.query('SELECT * FROM coach_profiles WHERE user_id = $1', [userId])).rows[0] || null;
  const workouts = (await pool.query('SELECT * FROM workout_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5', [userId])).rows;
  let bookings = [];
  try {
    bookings = (
      await pool.query(
        'SELECT b.*, g.name as gym_name FROM bookings b LEFT JOIN gyms g ON b.gym_id = g.id WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 5',
        [userId]
      )
    ).rows;
  } catch (e) {
    console.warn('[Coach] Failed to fetch booking history for context:', e.message);
  }
  return { profile, workouts, bookings, systemPrompt: buildCoachSystemPrompt(profile, workouts, bookings) };
}

module.exports = { checkedIn, coachContext, buildCoachSystemPrompt, LOCKED_MESSAGE };
