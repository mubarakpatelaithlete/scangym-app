/**
 * AI Trainer Route
 * POST /api/ai-trainer/chat
 * GET  /api/ai-trainer/plan
 * POST /api/ai-trainer/log
 * GET  /api/ai-trainer/progress
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';


function buildTrainerPrompt(p) {
  p = p || {};
  return `You are ScanGym AI Personal Trainer -- an elite, science-backed fitness coach.
Warm, motivating, specific, ALWAYS actionable.

USER: ${p.name||'Athlete'} | Age: ${p.age||'?'} | Gender: ${p.gender||'?'}
Height: ${p.height_cm||'?'}cm | Weight: ${p.weight_kg||'?'}kg
Goal: ${p.goal||'General fitness'} | Level: ${p.fitness_level||'beginner'}
Weakest muscle: ${p.weakest_muscle||'?'} | Diet: ${p.diet_preference||'balanced'}
Sleep: ${p.sleep_hours||7}h | Water: ${p.water_intake||'2L'} | Supplements: ${p.supplements||'none'}
Health issues: ${p.health_conditions||'none'} | City: ${p.city||'Manchester'}
Workout duration: ${p.workout_duration||60}min | Sessions/week: ${p.weekly_sessions||3}

YOUR JOB:
1. Hyper-personalised plans using exact stats
2. Tell them EXACTLY what weight to lift (use their bodyweight as reference)
3. Diagnose why they're not progressing -- specific science-backed reasons
4. Nutrition advice for their goal
5. Book gym: say "Tap here to book -- [BOOK_GYM]"
6. Affiliate: say "[JOIN_AFFILIATE]"

Science: cite mechanisms simply (progressive overload, protein synthesis, mTOR).
Tone: brilliant friend who's a certified PT. No filler. Be direct.

End workout plans with: YOUR STATS: BMI X.X | TDEE X kcal | Target: Xg protein/day`;
}

router.post('/chat', optionalAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ error: 'message required' });

    let userProfile = null;
    if (req.user?.id) {
      try {
        const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (r.rows.length) userProfile = r.rows[0];
      } catch(e) {
        console.warn('[AITrainer] Failed to fetch user profile:', e.message);
      }
    }

    if (!GEMINI_API_KEY) {
      return res.json({
        reply: "Hi! I'm your ScanGym AI Trainer. I need a GEMINI_API_KEY to be set in Railway environment variables to work fully. For now -- what's your main goal? I'll give you a general plan!",
        actions: []
      });
    }

    const contents = [];
    for (const msg of history.slice(-8)) {
      contents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts: [{ text: msg.content }] });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: buildTrainerPrompt(userProfile) }] },
        contents,
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
      }),
    });

    const data = await response.json();
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Tell me your goal and current stats, and I'll create your personalised plan! 💪";

    const actions = [];
    if (reply.includes('[BOOK_GYM]')) actions.push('book_gym');
    if (reply.includes('[JOIN_AFFILIATE]')) actions.push('join_affiliate');

    res.json({ reply: reply.replace(/\[BOOK_GYM\]|\[JOIN_AFFILIATE\]/g, ''), actions });
  } catch (err) {
    console.error('[AI Trainer] Chat error:', err);
    res.json({ reply: "Quick hiccup -- try again! Meanwhile: progressive overload (add 2.5kg/week) is the #1 proven method for muscle gain. 💪", actions: [] });
  }
});

router.get('/plan', optionalAuth, async (req, res) => {
  try {
    let userProfile = null;
    if (req.user?.id) {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      if (r.rows.length) userProfile = r.rows[0];
    }
    const goal = (userProfile?.goal || 'muscle gain').toLowerCase();
    const plans = {
      'muscle gain': { title: 'Muscle Building', frequency: '4 days/week', reps: '6-12 reps, 3-4 sets', rest: '60-90s', tip: 'Add 2.5kg every week you complete all reps (progressive overload)' },
      'weight loss': { title: 'Fat Loss', frequency: '5 days/week', reps: '15-20 reps, 3 sets', rest: '30s', tip: '500kcal deficit/day = 0.5kg lost/week' },
    };
    res.json({ plan: plans[goal] || plans['muscle gain'], goal });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/log', optionalAuth, async (req, res) => {
  try {
    const { gymId, gymName, musclesWorked = [], durationMinutes = 60, notes } = req.body;
    const userId = req.user?.id || 'anonymous';
    const r = await pool.query(
      `INSERT INTO workout_logs (user_id, gym_id, gym_name, muscles_trained, duration_minutes, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
      [userId, gymId, gymName, musclesWorked, durationMinutes, notes]
    );
    res.json({ success: true, log: r.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to log' }); }
});

router.get('/progress', optionalAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.json({ logs: [], streak: 0, totalSessions: 0 });
    const r = await pool.query(
      `SELECT DATE(created_at) AS date, gym_name, muscles_trained, duration_minutes
         FROM workout_logs
        WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '90 days'
        ORDER BY created_at DESC`,
      [userId]
    );
    const logs = r.rows;
    const dates = new Set(logs.map(l => (l.date instanceof Date ? l.date : new Date(l.date)).toISOString().split('T')[0]));
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < 90; i++) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      if (dates.has(d.toISOString().split('T')[0])) streak++;
      else if (i > 0) break;
    }
    res.json({ logs, streak, totalSessions: logs.length });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
