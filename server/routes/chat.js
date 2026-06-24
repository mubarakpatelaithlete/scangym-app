/**
 * Task 6: AI Gym Receptionist Chat — GEMINI FLASH 2.0
 * Migrated from OpenAI to Google Gemini (free tier: 15 RPM, 1M tokens/day)
 * Hybrid: AI chatbot handles common questions; when it can't help, it
 * escalates to the gym owner with SMS (Twilio) + email notification.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');

// Gemini API config
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Twilio config for SMS escalation
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Nodemailer for email escalation
const nodemailer = require('nodemailer');
const emailTransport = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Ensure escalation table exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_escalations (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER NOT NULL,
        gym_id INTEGER NOT NULL,
        user_message TEXT NOT NULL,
        escalation_reason TEXT,
        owner_notified_sms BOOLEAN DEFAULT false,
        owner_notified_email BOOLEAN DEFAULT false,
        owner_response TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP
      )
    `);
    console.log('Chat escalation table ready');
  } catch (err) {
    console.error('Chat escalation table error:', err.message);
  }
})();

/**
 * Call Gemini API
 */
async function callGemini(messages, maxTokens = 300) {
  // Convert OpenAI-style messages to Gemini format
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));

  const body = {
    contents,
    generationConfig: {
      maxOutputTokens: maxTokens,
      temperature: 0.7,
    }
  };

  // Add system instruction if present
  if (systemMsg) {
    body.systemInstruction = { parts: [{ text: systemMsg.content }] };
  }

  const response = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    console.error('Gemini API error:', response.status, err);
    throw new Error(`Gemini API error: ${response.status} - ${err?.error?.message || 'Unknown'}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '[ESCALATE] Unable to process the question.';
}

/**
 * Send SMS to gym owner via Twilio
 */
async function sendOwnerSMS(ownerPhone, gymName, userMessage) {
  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_PHONE || !ownerPhone) return false;
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
    const body = new URLSearchParams({
      To: ownerPhone,
      From: TWILIO_PHONE,
      Body: `[ScanGym] New customer question for ${gymName}:\n"${userMessage.substring(0, 160)}"\n\nReply at scangym.com/owner/messages`,
    });
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64') },
      body,
    });
    return response.ok;
  } catch (err) {
    console.error('SMS send error:', err.message);
    return false;
  }
}

/**
 * Send email to gym owner
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendOwnerEmail(ownerEmail, gymName, userMessage, conversationId) {
  if (!ownerEmail || !process.env.SMTP_USER) return false;
  try {
    const safeGymName = escapeHtml(gymName);
    const safeMessage = escapeHtml(userMessage);
    const safeConvoId = encodeURIComponent(conversationId);
    await emailTransport.sendMail({
      from: `"ScanGym" <${process.env.SMTP_USER || 'noreply@scangym.com'}>`,
      to: ownerEmail,
      subject: `[ScanGym] Customer needs help at ${safeGymName}`,
      html: `
        <h2>A customer needs your help</h2>
        <p><strong>Gym:</strong> ${safeGymName}</p>
        <p><strong>Customer message:</strong></p>
        <blockquote style="background:#f5f5f5;padding:12px;border-left:3px solid #FF6B35;">
          ${safeMessage}
        </blockquote>
        <p>Our AI couldn't fully answer this question. Please reply at:</p>
        <p><a href="https://scangym.com/owner/messages/${safeConvoId}" style="background:#FF6B35;color:white;padding:10px 20px;text-decoration:none;display:inline-block;">Reply to Customer</a></p>
        <p style="color:#666;font-size:12px;">— ScanGym Team</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}

function buildGymContext(gym) {
  return `You are the AI fitness assistant for ScanGym — the world's first universal gym pass app.
You are currently helping a customer who is looking at "${gym.name}" on ScanGym.
Address: ${gym.address || 'Not available'}
City: ${gym.city || 'UK'}
${gym.day_pass_price ? `Day pass (24hr): £${gym.day_pass_price}` : ''}
${gym.amenities ? `Amenities: ${Array.isArray(gym.amenities) ? gym.amenities.join(', ') : gym.amenities}` : ''}
${gym.operating_hours ? `Hours: ${JSON.stringify(gym.operating_hours)}` : ''}
${gym.phone ? `Phone: ${gym.phone}` : ''}
${gym.description ? `About: ${gym.description}` : ''}
Rating: ${gym.average_rating || 'New'} (${gym.total_reviews || 0} reviews)

PERSONALITY:
- You are energetic, motivating, and friendly — like a personal trainer who's also a helpful concierge
- Use gym/fitness language naturally: "crush it", "let's get you in there", "gains await"
- Keep answers concise (under 150 words) but warm and helpful
- Use relevant emojis sparingly: 💪 🏋️ 🔥 ⚡

INSTRUCTIONS:
- Answer questions about this gym helpfully and concisely.
- You can also help with general fitness, workout tips, nutrition advice, and gym etiquette.
- If you CAN answer confidently, do so.
- If you CANNOT answer (e.g., specific real-time availability, special requests, membership queries,
  complaints, or anything you're unsure about), respond with EXACTLY this prefix:
  [ESCALATE] followed by a brief explanation of what the customer needs.
  Example: "[ESCALATE] Customer is asking about wheelchair accessibility which I don't have data on."
- Always encourage booking through ScanGym.
- Brand name is ScanGym only (never mention AIthlete or Gym Link AI).
- ScanGym offers: Day Pass, 3-Day Pass, Weekly Pass — no membership required.`;
}

// POST /api/chat/start — Start a new conversation with a gym
router.post('/start', optionalAuth, async (req, res) => {
  try {
    const { gymId } = req.body;
    if (!gymId) return res.status(400).json({ error: 'gymId is required' });

    const gymResult = await pool.query('SELECT * FROM gyms WHERE id = $1', [parseInt(gymId)]);
    if (gymResult.rows.length === 0) return res.status(404).json({ error: 'Gym not found' });

    const gym = gymResult.rows[0];

    let conversationId;
    try {
      const convo = await pool.query(`
        INSERT INTO conversations (title, created_at) VALUES ($1, NOW()) RETURNING *
      `, [`Chat with ${gym.name}`]);
      conversationId = convo.rows[0].id;
    } catch (e) {
      await pool.query(`CREATE TABLE IF NOT EXISTS conversations (id SERIAL PRIMARY KEY, title TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, conversation_id INTEGER, role VARCHAR(20), content TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      const convo = await pool.query(`INSERT INTO conversations (title, created_at) VALUES ($1, NOW()) RETURNING *`, [`Chat with ${gym.name}`]);
      conversationId = convo.rows[0].id;
    }

    await pool.query(`
      INSERT INTO messages (conversation_id, role, content, created_at)
      VALUES ($1, 'system', $2, NOW())
    `, [conversationId, buildGymContext(gym)]);

    const welcomeMsg = `Hey! 💪 Welcome to ${gym.name} on ScanGym! I'm your AI fitness assistant — ask me anything about this gym, workouts, or booking. If I can't help, I'll connect you straight to the gym team. What can I help you with?`;

    await pool.query(`
      INSERT INTO messages (conversation_id, role, content, created_at)
      VALUES ($1, 'assistant', $2, NOW())
    `, [conversationId, welcomeMsg]);

    res.status(201).json({
      conversationId,
      gymId: gym.id,
      gymName: gym.name,
      messages: [{ role: 'assistant', content: welcomeMsg, timestamp: new Date().toISOString() }],
      supportsHumanEscalation: true,
      aiModel: 'gemini-2.0-flash',
    });
  } catch (err) {
    console.error('Chat start error:', err);
    res.status(500).json({ error: 'Failed to start chat' });
  }
});

// POST /api/chat/message — Send message; AI answers or escalates to owner
router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { conversationId, message } = req.body;
    if (!conversationId || !message) {
      return res.status(400).json({ error: 'conversationId and message are required' });
    }

    const convo = await pool.query('SELECT id, title FROM conversations WHERE id = $1', [parseInt(conversationId)]);
    if (convo.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

    // Save user message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, 'user', $2, NOW())`,
      [parseInt(conversationId), message]
    );

    // Get conversation history
    const history = await pool.query(
      `SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 20`,
      [parseInt(conversationId)]
    );
    const messages = history.rows.map(m => ({ role: m.role, content: m.content }));

    // Get AI response from Gemini
    let aiResponse;
    try {
      aiResponse = await callGemini(messages, 300);
    } catch (geminiErr) {
      console.error('Gemini error, using fallback:', geminiErr.message);
      // Fallback to basic response if Gemini fails
      aiResponse = getFallbackResponse(message);
    }

    // Check for escalation trigger
    const needsEscalation = aiResponse.includes('[ESCALATE]');
    let escalation = null;

    if (needsEscalation) {
      const escalateReason = aiResponse.replace('[ESCALATE]', '').trim();

      const gymNameMatch = convo.rows[0].title?.match(/Chat with (.+)/);
      let gymInfo = null;
      if (gymNameMatch) {
        const gymResult = await pool.query(
          'SELECT id, name, phone, claimed_by FROM gyms WHERE name = $1 LIMIT 1',
          [gymNameMatch[1]]
        );
        gymInfo = gymResult.rows[0] || null;
      }

      let ownerPhone = null;
      let ownerEmail = null;
      if (gymInfo?.claimed_by) {
        try {
          const ownerResult = await pool.query('SELECT phone, email FROM users WHERE id = $1', [gymInfo.claimed_by]);
          if (ownerResult.rows[0]) {
            ownerPhone = ownerResult.rows[0].phone;
            ownerEmail = ownerResult.rows[0].email;
          }
        } catch (e) {}
      }

      const smsOk = await sendOwnerSMS(ownerPhone, gymInfo?.name || 'Your gym', message);
      const emailOk = await sendOwnerEmail(ownerEmail, gymInfo?.name || 'Your gym', message, conversationId);

      try {
        await pool.query(`
          INSERT INTO chat_escalations (conversation_id, gym_id, user_message, escalation_reason, owner_notified_sms, owner_notified_email)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [parseInt(conversationId), gymInfo?.id || null, message, escalateReason, smsOk, emailOk]);
      } catch (e) {}

      aiResponse = `Great question! That's something the gym team can best help with. I've just notified them ${smsOk || emailOk ? 'via ' + (smsOk ? 'SMS' : '') + (smsOk && emailOk ? ' and ' : '') + (emailOk ? 'email' : '') : ''} and they'll get back to you shortly. In the meantime, is there anything else I can help with? 💪`;

      escalation = {
        escalated: true,
        reason: escalateReason,
        ownerNotified: { sms: smsOk, email: emailOk },
        status: 'pending',
      };
    }

    // Save AI response
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, 'assistant', $2, NOW())`,
      [parseInt(conversationId), aiResponse]
    );

    res.json({
      conversationId: parseInt(conversationId),
      message: { role: 'assistant', content: aiResponse, timestamp: new Date().toISOString() },
      escalation,
    });
  } catch (err) {
    console.error('Chat message error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

/**
 * Fallback responses when Gemini API is unavailable
 */
function getFallbackResponse(question) {
  const q = question.toLowerCase();
  if (q.includes('price') || q.includes('cost') || q.includes('how much'))
    return `ScanGym offers flexible passes — Day Pass, 3-Day Pass, and Weekly Pass. Prices vary by gym and time of day. No membership needed! Check the booking section for exact pricing. 💰`;
  if (q.includes('cancel') || q.includes('refund'))
    return `Free cancellation up to 2 hours before your session! Refund goes instantly to your ScanGym Wallet, or back to your card in 5-10 days. No questions asked. ✅`;
  if (q.includes('shower') || q.includes('changing'))
    return `Most gyms have changing rooms with showers. Towels are included with Standard tier and above. 🚿`;
  if (q.includes('parking') || q.includes('park'))
    return `Parking varies by location. Check the map for nearby options. Many ScanGym locations have free parking or are near public transport. 🅿️`;
  if (q.includes('workout') || q.includes('exercise') || q.includes('routine'))
    return `Looking for workout tips? Try starting with compound movements: squats, deadlifts, bench press, rows. 3-4 sets of 8-12 reps each. Rest 60-90 seconds between sets. You've got this! 🔥`;
  return `Great question! I'm here to help with anything about this gym, workouts, booking, or fitness tips. Could you tell me a bit more about what you'd like to know? 💪`;
}

// POST /api/chat/escalation/:id/respond — Gym owner responds to escalation
const { authenticateUser } = require('../middleware/auth');
router.post('/escalation/:id/respond', authenticateUser, async (req, res) => {
  try {
    const { response } = req.body;
    const escalationId = parseInt(req.params.id);

    if (!response || typeof response !== 'string' || response.trim().length === 0) {
      return res.status(400).json({ error: 'Response text is required' });
    }

    // Verify the authenticated user owns the gym this escalation belongs to
    const escCheck = await pool.query(
      `SELECT ce.id, ce.gym_id, g.claimed_by
       FROM chat_escalations ce
       LEFT JOIN gyms g ON g.id = ce.gym_id
       WHERE ce.id = $1`,
      [escalationId]
    );
    if (escCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found' });
    }
    if (escCheck.rows[0].claimed_by && String(escCheck.rows[0].claimed_by) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Only the gym owner can respond to this escalation' });
    }

    const result = await pool.query(`
      UPDATE chat_escalations SET owner_response = $1, status = 'resolved', resolved_at = NOW()
      WHERE id = $2 RETURNING *
    `, [response.trim(), escalationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found' });
    }

    const esc = result.rows[0];
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, 'assistant', $2, NOW())`,
      [esc.conversation_id, `📞 Message from the gym team: ${response}`]
    );

    res.json({ success: true, escalation: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to respond to escalation' });
  }
});

// GET /api/chat/history/:conversationId
router.get('/history/:conversationId', optionalAuth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const convo = await pool.query('SELECT * FROM conversations WHERE id = $1', [parseInt(conversationId)]);
    if (convo.rows.length === 0) return res.status(404).json({ error: 'Conversation not found' });

    const msgs = await pool.query(`
      SELECT role, content, created_at as timestamp
      FROM messages WHERE conversation_id = $1 AND role != 'system'
      ORDER BY created_at ASC
    `, [parseInt(conversationId)]);

    res.json({ conversationId: parseInt(conversationId), title: convo.rows[0].title, messages: msgs.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// POST /api/chat/quick — Quick chat without gym context (general fitness AI)
// Accepts optional fitness profile for personalized recommendations
router.post('/quick', async (req, res) => {
  try {
    const { message, userProfile } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    // Build personalized context from user fitness profile
    let profileContext = '';
    if (userProfile) {
      const fieldMap = {
        name:'Name', height_cm:'Height (cm)', weight_kg:'Weight (kg)', body_fat_pct:'Body Fat %',
        muscle_mass_kg:'Muscle Mass (kg)', fitness_goal:'Goal', fitness_level:'Level',
        age:'Age', gender:'Gender', city:'City', country:'Country', body_type:'Body Type',
        weakest_muscle:'Weakest Muscle', supplements:'Supplements', diet:'Diet Preference',
        sleep_hours:'Sleep (hrs/night)', water_litres:'Water (L/day)',
        workout_duration:'Workout Duration (mins)', weekly_sessions:'Sessions/Week',
        diseases:'Diseases/Injuries', metabolism:'Metabolism'
      };
      const parts = [];
      for (const [key, label] of Object.entries(fieldMap)) {
        if (userProfile[key]) parts.push(`${label}: ${userProfile[key]}`);
      }
      if (parts.length > 0) {
        profileContext = `\n\nCUSTOMER FITNESS PROFILE:\n${parts.join('\n')}\n\nYou know this customer personally. Use their FULL profile to give hyper-personalized answers:\n- Calculate BMI, TDEE, calorie/macro targets from their stats\n- Tailor workout plans to their goal, body type, weakest muscles, injuries\n- Recommend diet/nutrition based on their diet preference, supplements, goal\n- Factor in sleep, water, metabolism when advising recovery\n- Suggest gyms/trainers matching their level and location\n- Address them by name. Be their personal coach who knows everything about them.`;
      }
    }

    const systemPrompt = `You are ScanGym AI — a friendly, energetic fitness assistant built into ScanGym, the world's first universal gym pass app.
Help users with: gym questions, workout tips, nutrition advice, fitness motivation, booking help.
Give personalized recommendations based on the customer's fitness profile when available.
Keep answers concise (under 150 words), warm, and motivating.
Use emojis sparingly: 💪 🏋️ 🔥 ⚡
Brand: ScanGym only.${profileContext}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message }
    ];

    let reply;
    try {
      reply = await callGemini(messages, 200);
    } catch (err) {
      reply = getFallbackResponse(message);
    }

    res.json({ reply, model: 'gemini-2.0-flash' });
  } catch (err) {
    console.error('Quick chat error:', err);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// POST /api/chat/onboarding — Conversational fitness profile intake (ChatGPT-style)
// Gemini asks questions one by one, extracts profile data when enough info gathered
router.post('/onboarding', async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });

    const systemPrompt = `You are ScanGym AI — a friendly, energetic fitness coach doing a quick intake interview to learn about a new member.

YOUR TASK: Ask fitness profile questions ONE AT A TIME, conversationally. Be warm, use 1-2 emojis max per reply. Keep each reply under 60 words.

FIELDS TO COLLECT (ask naturally, group related ones 2-3 at a time max):
- height (cm), weight (kg), age, gender
- body fat %, muscle mass (kg) — say "estimate is fine" or "skip if unsure"
- fitness goal (lose fat / build muscle / get stronger / improve endurance / maintain / body recomp)
- body type (ectomorph / mesomorph / endomorph — briefly explain each)
- weakest muscle group
- diet preference, supplements
- sleep hours, daily water intake (litres)
- workout duration (mins), weekly sessions
- any diseases or injuries
- metabolism (fast/normal/slow)
- city, country

RULES:
- Ask 2-3 related fields per question (e.g. "height and weight?" then "age and gender?")
- Accept approximate answers, be encouraging
- If they say "skip" or "idk", move on — don't push
- After collecting enough info (at least goal + 4-5 other fields), wrap up with a SHORT personalized summary of what you learned and what you'll help them with

CRITICAL: When you have enough data to complete the profile, you MUST end your reply with a JSON block on its own line:
[PROFILE_DATA]{"height_cm":175,"weight_kg":80,"age":25,"gender":"male","fitness_goal":"build muscle"}[/PROFILE_DATA]
Include ONLY fields the user actually provided. Use these exact keys: height_cm, weight_kg, body_fat_pct, muscle_mass_kg, fitness_goal, age, gender, city, country, body_type, weakest_muscle, supplements, diet, sleep_hours, water_litres, workout_duration, weekly_sessions, diseases, metabolism.
Do NOT include the JSON block until you have at least fitness_goal plus 4 other fields.`;

    // Build conversation history for multi-turn
    const messages = [{ role: 'system', content: systemPrompt }];

    // Add prior conversation turns
    if (history && Array.isArray(history)) {
      for (const turn of history) {
        messages.push({ role: turn.role === 'assistant' ? 'model' : 'user', content: turn.content });
      }
    }

    // Add current message
    messages.push({ role: 'user', content: message });

    // Call Gemini
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'AI not configured' });

    const geminiResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }]
          })),
          generationConfig: { temperature: 0.7, maxOutputTokens: 300 }
        })
      }
    );

    if (!geminiResp.ok) {
      const errText = await geminiResp.text();
      console.error('Gemini onboarding error:', errText);
      return res.status(500).json({ error: 'AI error' });
    }

    const geminiData = await geminiResp.json();
    let reply = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || "Let's continue — what's your main fitness goal?";

    // Extract profile data if present
    let profileData = null;
    const profileMatch = reply.match(/\[PROFILE_DATA\](.*?)\[\/PROFILE_DATA\]/s);
    if (profileMatch) {
      try {
        profileData = JSON.parse(profileMatch[1]);
        // Clean the reply — remove the JSON block
        reply = reply.replace(/\[PROFILE_DATA\].*?\[\/PROFILE_DATA\]/s, '').trim();
      } catch (e) {
        console.error('Profile data parse error:', e);
      }
    }

    res.json({ reply, profileData });
  } catch (err) {
    console.error('Onboarding error:', err);
    res.status(500).json({ error: 'Onboarding failed', detail: err.message });
  }
});

module.exports = router;
