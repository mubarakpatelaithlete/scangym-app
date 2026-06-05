/**
 * Addiction Mechanics: Gym Streaks, Leaderboard, Achievements & Variable Rewards
 * 
 * Psychology used:
 * - Loss aversion (Kahneman/Tversky): Streak mechanics make users fear losing progress
 * - Variable ratio reinforcement (Skinner): Random rewards for referrals
 * - Social comparison theory (Festinger): Weekly leaderboard
 * - Zeigarnik effect: Progress bars for wallet/achievements
 * - Endowed progress: Badge system gives users something to lose
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');

// Ensure tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gym_streaks (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) UNIQUE NOT NULL,
        current_streak INTEGER DEFAULT 0,
        longest_streak INTEGER DEFAULT 0,
        last_workout_date DATE,
        streak_freezes INTEGER DEFAULT 1,
        total_workouts INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_streak_user ON gym_streaks(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_badges (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        badge_key VARCHAR(100) NOT NULL,
        earned_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, badge_key)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_badges_user ON user_badges(user_id)`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS weekly_leaderboard (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL,
        week_start DATE NOT NULL,
        workouts INTEGER DEFAULT 0,
        total_minutes INTEGER DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, week_start)
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_leaderboard_week ON weekly_leaderboard(week_start, workouts DESC)`);

    console.log('✅ Addiction mechanics tables ready (streaks, badges, leaderboard)');
  } catch (err) {
    console.error('Streak table creation error:', err.message);
  }
})();

// Badge definitions
const BADGES = {
  first_workout: { name: 'First Sweat', emoji: '💧', desc: 'Complete your first workout' },
  streak_3: { name: 'On Fire', emoji: '🔥', desc: '3-day gym streak' },
  streak_7: { name: 'Week Warrior', emoji: '⚔️', desc: '7-day gym streak' },
  streak_14: { name: 'Unstoppable', emoji: '🚀', desc: '14-day gym streak' },
  streak_30: { name: 'Iron Will', emoji: '🏆', desc: '30-day gym streak' },
  streak_100: { name: 'Legend', emoji: '👑', desc: '100-day gym streak' },
  gyms_3: { name: 'Explorer', emoji: '🗺️', desc: 'Visit 3 different gyms' },
  gyms_10: { name: 'Nomad', emoji: '🌍', desc: 'Visit 10 different gyms' },
  early_bird: { name: 'Early Bird', emoji: '🌅', desc: 'Check in before 7am' },
  night_owl: { name: 'Night Owl', emoji: '🦉', desc: 'Check in after 9pm' },
  weekend_warrior: { name: 'Weekend Warrior', emoji: '🏋️', desc: '4 weekend workouts' },
  referral_1: { name: 'Connector', emoji: '🤝', desc: 'Refer your first friend' },
  referral_5: { name: 'Ambassador', emoji: '📣', desc: 'Refer 5 friends' },
  wallet_50: { name: 'Investor', emoji: '💰', desc: 'Load £50+ into wallet' },
  bookings_10: { name: 'Regular', emoji: '📅', desc: '10 total bookings' },
  bookings_50: { name: 'Gym Rat', emoji: '🐀', desc: '50 total bookings' },
};

router.use(authenticateUser);

// GET /api/streaks — Get user's streak, badges, and leaderboard position
router.get('/', async (req, res) => {
  try {
    const userId = req.user.id;

    // Get or create streak
    let streak = await pool.query('SELECT * FROM gym_streaks WHERE user_id = $1', [userId]);
    if (streak.rows.length === 0) {
      streak = await pool.query(
        `INSERT INTO gym_streaks (user_id) VALUES ($1) RETURNING *`,
        [userId]
      );
    }
    const s = streak.rows[0];

    // Check if streak is still alive (allow 1 day gap)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let streakAlive = true;
    if (s.last_workout_date) {
      const lastDate = new Date(s.last_workout_date);
      lastDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today - lastDate) / (1000 * 60 * 60 * 24));
      if (daysDiff > 1) {
        // Streak broken (unless freeze available)
        if (daysDiff === 2 && s.streak_freezes > 0) {
          // Auto-use freeze
          await pool.query(
            `UPDATE gym_streaks SET streak_freezes = streak_freezes - 1, updated_at = NOW() WHERE user_id = $1`,
            [userId]
          );
          s.streak_freezes -= 1;
        } else if (daysDiff > 1) {
          // Reset streak
          await pool.query(
            `UPDATE gym_streaks SET current_streak = 0, updated_at = NOW() WHERE user_id = $1`,
            [userId]
          );
          s.current_streak = 0;
          streakAlive = false;
        }
      }
    }

    // Get badges
    const badges = await pool.query(
      'SELECT badge_key, earned_at FROM user_badges WHERE user_id = $1 ORDER BY earned_at',
      [userId]
    );

    // Get leaderboard position (this week)
    const weekStart = getWeekStart();
    const leaderboard = await pool.query(
      `SELECT user_id, workouts, total_minutes,
       RANK() OVER (ORDER BY workouts DESC, total_minutes DESC) as rank
       FROM weekly_leaderboard WHERE week_start = $1
       ORDER BY workouts DESC, total_minutes DESC LIMIT 20`,
      [weekStart]
    );

    const myRank = leaderboard.rows.find(r => r.user_id === userId);

    // Wallet progress to next bonus tier
    const wallet = await pool.query('SELECT balance_pence FROM wallets WHERE user_id = $1', [userId]);
    const balancePence = wallet.rows[0]?.balance_pence || 0;
    let walletProgress = null;
    if (balancePence < 2000) {
      walletProgress = { current: balancePence, target: 2000, bonus: '10%', label: `£${((2000 - balancePence) / 100).toFixed(2)} to 10% bonus` };
    } else if (balancePence < 5000) {
      walletProgress = { current: balancePence, target: 5000, bonus: '15%', label: `£${((5000 - balancePence) / 100).toFixed(2)} to 15% bonus` };
    }

    // Next streak milestone
    const milestones = [3, 7, 14, 30, 100];
    const nextMilestone = milestones.find(m => m > s.current_streak) || null;

    // V2: Get recent workout dates for the workout grid
    let recentWorkouts = [];
    try {
      const recentResult = await pool.query(
        `SELECT DISTINCT DATE(created_at) as workout_date FROM gym_streaks
         WHERE user_id = $1 AND last_workout_date IS NOT NULL
         UNION
         SELECT DISTINCT DATE(earned_at) as workout_date FROM user_badges WHERE user_id = $1
         ORDER BY workout_date DESC LIMIT 28`,
        [userId]
      );
      recentWorkouts = recentResult.rows.map(r => ({ date: r.workout_date }));
    } catch (e) { /* table may not have all fields yet */ }

    // V2: Detect broken streak for earn-back
    const streakBroken = !streakAlive && s.current_streak === 0;
    const previousStreak = streakBroken ? (s.longest_streak || 0) : 0;

    res.json({
      success: true,
      currentStreak: s.current_streak,
      totalWorkouts: s.total_workouts || 0,
      streakBroken,
      previousStreak,
      recentWorkouts,
      streak: {
        current: s.current_streak,
        longest: s.longest_streak,
        lastWorkout: s.last_workout_date,
        freezesRemaining: s.streak_freezes,
        totalWorkouts: s.total_workouts,
        alive: streakAlive,
        nextMilestone,
        daysToMilestone: nextMilestone ? nextMilestone - s.current_streak : null,
      },
      badges: {
        earned: badges.rows.map(b => ({
          key: b.badge_key,
          ...BADGES[b.badge_key],
          earnedAt: b.earned_at,
        })),
        available: Object.entries(BADGES)
          .filter(([key]) => !badges.rows.find(b => b.badge_key === key))
          .map(([key, badge]) => ({ key, ...badge })),
        total: Object.keys(BADGES).length,
        earnedCount: badges.rows.length,
      },
      leaderboard: {
        myRank: myRank ? parseInt(myRank.rank) : null,
        myWorkouts: myRank ? myRank.workouts : 0,
        top10: leaderboard.rows.slice(0, 10).map(r => ({
          rank: parseInt(r.rank),
          workouts: r.workouts,
          totalMinutes: r.total_minutes,
          isMe: r.user_id === userId,
        })),
        weekStart,
      },
      walletProgress,
    });
  } catch (err) {
    console.error('Get streaks error:', err);
    res.status(500).json({ error: 'Failed to fetch streak data' });
  }
});

// POST /api/streaks/record-workout — Called after QR exit scan
router.post('/record-workout', async (req, res) => {
  try {
    const userId = req.user.id;
    const { durationMinutes, gymId } = req.body;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Get or create streak
    let streak = await pool.query('SELECT * FROM gym_streaks WHERE user_id = $1', [userId]);
    if (streak.rows.length === 0) {
      streak = await pool.query(
        `INSERT INTO gym_streaks (user_id) VALUES ($1) RETURNING *`,
        [userId]
      );
    }
    const s = streak.rows[0];

    // Check if already recorded today
    const lastDate = s.last_workout_date ? new Date(s.last_workout_date).toISOString().split('T')[0] : null;
    if (lastDate === todayStr) {
      return res.json({ success: true, alreadyRecorded: true, streak: s.current_streak });
    }

    // Calculate new streak
    let newStreak = 1;
    if (lastDate) {
      const lastD = new Date(lastDate);
      const daysDiff = Math.floor((today - lastD) / (1000 * 60 * 60 * 24));
      if (daysDiff === 1) {
        newStreak = s.current_streak + 1; // Consecutive day
      } else if (daysDiff === 2 && s.streak_freezes > 0) {
        newStreak = s.current_streak + 1; // Used a freeze
        await pool.query(
          `UPDATE gym_streaks SET streak_freezes = streak_freezes - 1 WHERE user_id = $1`,
          [userId]
        );
      }
      // daysDiff > 2 → streak resets to 1
    }

    const longestStreak = Math.max(newStreak, s.longest_streak);

    await pool.query(`
      UPDATE gym_streaks SET
        current_streak = $1, longest_streak = $2, last_workout_date = $3,
        total_workouts = total_workouts + 1, updated_at = NOW()
      WHERE user_id = $4
    `, [newStreak, longestStreak, todayStr, userId]);

    // Update weekly leaderboard
    const weekStart = getWeekStart();
    await pool.query(`
      INSERT INTO weekly_leaderboard (user_id, week_start, workouts, total_minutes)
      VALUES ($1, $2, 1, $3)
      ON CONFLICT (user_id, week_start)
      DO UPDATE SET workouts = weekly_leaderboard.workouts + 1,
                    total_minutes = weekly_leaderboard.total_minutes + $3,
                    updated_at = NOW()
    `, [userId, weekStart, durationMinutes || 45]);

    // Check for new badges
    const newBadges = [];
    const totalWorkouts = s.total_workouts + 1;

    if (totalWorkouts === 1) newBadges.push('first_workout');
    if (newStreak >= 3) newBadges.push('streak_3');
    if (newStreak >= 7) newBadges.push('streak_7');
    if (newStreak >= 14) newBadges.push('streak_14');
    if (newStreak >= 30) newBadges.push('streak_30');
    if (newStreak >= 100) newBadges.push('streak_100');
    if (totalWorkouts >= 10) newBadges.push('bookings_10');
    if (totalWorkouts >= 50) newBadges.push('bookings_50');

    // Check time-based badges
    const hour = new Date().getHours();
    if (hour < 7) newBadges.push('early_bird');
    if (hour >= 21) newBadges.push('night_owl');
    if ([0, 6].includes(new Date().getDay())) newBadges.push('weekend_warrior');

    // Award new badges
    const actuallyNew = [];
    for (const badge of newBadges) {
      try {
        await pool.query(
          `INSERT INTO user_badges (user_id, badge_key) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING badge_key`,
          [userId, badge]
        );
        const check = await pool.query(
          'SELECT badge_key FROM user_badges WHERE user_id = $1 AND badge_key = $2 AND earned_at > NOW() - INTERVAL \'5 seconds\'',
          [userId, badge]
        );
        if (check.rows.length > 0) {
          actuallyNew.push({ key: badge, ...BADGES[badge] });
        }
      } catch (e) {}
    }

    // Variable reward: random bonus wallet credit (1 in 5 chance)
    let bonusReward = null;
    if (Math.random() < 0.2) {
      const bonusAmounts = [25, 50, 50, 100, 100, 100, 200, 500]; // pence
      const bonusPence = bonusAmounts[Math.floor(Math.random() * bonusAmounts.length)];
      try {
        await pool.query(`
          UPDATE wallets SET balance_pence = balance_pence + $1, updated_at = NOW() WHERE user_id = $2
        `, [bonusPence, userId]);
        await pool.query(`
          INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
          SELECT w.id, $1, 'reward', $2, w.balance_pence, $3, 'workout_bonus', NOW()
          FROM wallets w WHERE w.user_id = $1
        `, [userId, bonusPence, `🎰 Workout bonus! +£${(bonusPence/100).toFixed(2)}`]);
        bonusReward = { amount: bonusPence / 100, display: `£${(bonusPence / 100).toFixed(2)}` };
      } catch (e) {}
    }

    // Generate shareable workout card data
    const workoutCard = {
      streak: newStreak,
      totalWorkouts,
      duration: durationMinutes || 45,
      date: todayStr,
      badges: actuallyNew,
      bonusReward,
      shareText: `🔥 ${newStreak}-day gym streak! Just finished workout #${totalWorkouts} with @ScanGym 💪`,
    };

    res.json({
      success: true,
      streak: newStreak,
      longestStreak,
      totalWorkouts,
      newBadges: actuallyNew,
      bonusReward,
      workoutCard,
    });
  } catch (err) {
    console.error('Record workout error:', err);
    res.status(500).json({ error: 'Failed to record workout' });
  }
});

// POST /api/streaks/buy-freeze — Buy a streak freeze with wallet credits
router.post('/buy-freeze', async (req, res) => {
  try {
    const userId = req.user.id;
    const freezeCostPence = 200; // £2

    // Check wallet
    const wallet = await pool.query('SELECT * FROM wallets WHERE user_id = $1', [userId]);
    if (!wallet.rows[0] || wallet.rows[0].balance_pence < freezeCostPence) {
      return res.status(400).json({ error: 'Insufficient wallet balance. Need £2.00 for a streak freeze.' });
    }

    // Deduct and add freeze
    await pool.query(
      `UPDATE wallets SET balance_pence = balance_pence - $1, total_spent_pence = total_spent_pence + $1, updated_at = NOW() WHERE user_id = $2`,
      [freezeCostPence, userId]
    );
    await pool.query(
      `UPDATE gym_streaks SET streak_freezes = streak_freezes + 1, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    // Record transaction
    await pool.query(`
      INSERT INTO wallet_transactions (wallet_id, user_id, type, amount_pence, balance_after_pence, description, reference_type, created_at)
      SELECT w.id, $1, 'payment', $2, w.balance_pence, 'Streak Freeze ❄️', 'streak_freeze', NOW()
      FROM wallets w WHERE w.user_id = $1
    `, [userId, -freezeCostPence]);

    const streak = await pool.query('SELECT streak_freezes FROM gym_streaks WHERE user_id = $1', [userId]);

    res.json({
      success: true,
      freezesRemaining: streak.rows[0]?.streak_freezes || 0,
      cost: freezeCostPence / 100,
    });
  } catch (err) {
    console.error('Buy freeze error:', err);
    res.status(500).json({ error: 'Failed to buy streak freeze' });
  }
});

// GET /api/streaks/leaderboard — Weekly leaderboard (public)
router.get('/leaderboard', async (req, res) => {
  try {
    const weekStart = getWeekStart();
    const result = await pool.query(`
      SELECT wl.user_id, wl.workouts, wl.total_minutes,
             u.first_name,
             RANK() OVER (ORDER BY wl.workouts DESC, wl.total_minutes DESC) as rank
      FROM weekly_leaderboard wl
      LEFT JOIN users u ON u.id = wl.user_id
      WHERE wl.week_start = $1
      ORDER BY wl.workouts DESC, wl.total_minutes DESC
      LIMIT 50
    `, [weekStart]);

    res.json({
      weekStart,
      entries: result.rows.map(r => ({
        rank: parseInt(r.rank),
        name: r.first_name || 'ScanGym User',
        workouts: r.workouts,
        totalMinutes: r.total_minutes,
        isMe: r.user_id === req.user?.id,
      })),
    });
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

function getWeekStart() {
  const d = new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().split('T')[0];
}

// V2: Earn back a broken streak (Duolingo-style)
router.post('/earn-back', async (req, res) => {
  try {
    const userId = req.user.id;
    const streak = await pool.query('SELECT * FROM gym_streaks WHERE user_id = $1', [userId]);
    if (streak.rows.length === 0) {
      return res.status(404).json({ error: 'No streak found' });
    }
    const s = streak.rows[0];

    // Only allow earn-back if streak was broken within last 24 hours
    if (s.current_streak > 0) {
      return res.json({ success: false, message: 'Streak is still active' });
    }
    const lastWorkout = s.last_workout_date ? new Date(s.last_workout_date) : null;
    if (!lastWorkout) {
      return res.json({ success: false, message: 'No previous workout found' });
    }
    const hoursSinceLast = (Date.now() - lastWorkout.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast > 48) {
      return res.json({ success: false, message: 'Earn-back window expired (48 hours)' });
    }

    // Restore the previous streak (use longest_streak as approximation)
    const restoredStreak = Math.min(s.longest_streak, 30); // Cap at 30 for safety
    await pool.query(
      `UPDATE gym_streaks SET current_streak = $1, last_workout_date = NOW(), updated_at = NOW() WHERE user_id = $2`,
      [restoredStreak, userId]
    );

    console.log(`[Streaks] Earn-back: restored ${restoredStreak}-day streak for user ${userId}`);
    res.json({ success: true, restoredStreak });
  } catch (err) {
    console.error('Earn-back error:', err);
    res.status(500).json({ error: 'Failed to earn back streak' });
  }
});

module.exports = router;
