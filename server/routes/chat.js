/**
 * Task 6: AI Gym Receptionist Chat — CORRECTED
 * CEO: "Option C" — AI answers instantly + escalates to gym owner via SMS/email
 * Hybrid: AI chatbot handles common questions; when it can't help, it
 * escalates to the gym owner with SMS (Twilio) + email notification.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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
async function sendOwnerEmail(ownerEmail, gymName, userMessage, conversationId) {
  if (!ownerEmail || !process.env.SMTP_USER) return false;
  try {
    await emailTransport.sendMail({
      from: `"ScanGym" <${process.env.SMTP_USER || 'noreply@scangym.com'}>`,
      to: ownerEmail,
      subject: `[ScanGym] Customer needs help at ${gymName}`,
      html: `
        <h2>A customer needs your help</h2>
        <p><strong>Gym:</strong> ${gymName}</p>
        <p><strong>Customer message:</strong></p>
        <blockquote style="background:#f5f5f5;padding:12px;border-left:3px solid #00D4AA;">
          ${userMessage}
        </blockquote>
        <p>Our AI couldn't fully answer this question. Please reply at:</p>
        <p><a href="https://scangym.com/owner/messages/${conversationId}" style="background:#00D4AA;color:white;padding:10px 20px;text-decoration:none;display:inline-block;">Reply to Customer</a></p>
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
  return `You are the AI receptionist for "${gym.name}" on ScanGym.
Address: ${gym.address || 'Not available'}
City: ${gym.city || 'UK'}
${gym.day_pass_price ? `Day pass (24hr): £${gym.day_pass_price}` : ''}
${gym.amenities ? `Amenities: ${Array.isArray(gym.amenities) ? gym.amenities.join(', ') : gym.amenities}` : ''}
${gym.operating_hours ? `Hours: ${JSON.stringify(gym.operating_hours)}` : ''}
${gym.phone ? `Phone: ${gym.phone}` : ''}
${gym.description ? `About: ${gym.description}` : ''}
Rating: ${gym.average_rating || 'New'} (${gym.total_reviews || 0} reviews)

INSTRUCTIONS:
- Answer questions about this gym helpfully and concisely (under 150 words).
- If you CAN answer confidently, do so.
- If you CANNOT answer (e.g., specific availability, special requests, membership queries,
  complaints, or anything you're unsure about), respond with EXACTLY this prefix:
  [ESCALATE] followed by a brief explanation of what the customer needs.
  Example: "[ESCALATE] Customer is asking about wheelchair accessibility which I don't have data on."
- Always be friendly and encourage booking through ScanGym.
- Brand name is ScanGym only (never mention AIthlete or Gym Link AI).`;
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
      // If conversations table doesn't exist, create a simple one
      await pool.query(`CREATE TABLE IF NOT EXISTS conversations (id SERIAL PRIMARY KEY, title TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      await pool.query(`CREATE TABLE IF NOT EXISTS messages (id SERIAL PRIMARY KEY, conversation_id INTEGER, role VARCHAR(20), content TEXT, created_at TIMESTAMP DEFAULT NOW())`);
      const convo = await pool.query(`INSERT INTO conversations (title, created_at) VALUES ($1, NOW()) RETURNING *`, [`Chat with ${gym.name}`]);
      conversationId = convo.rows[0].id;
    }

    await pool.query(`
      INSERT INTO messages (conversation_id, role, content, created_at)
      VALUES ($1, 'system', $2, NOW())
    `, [conversationId, buildGymContext(gym)]);

    const welcomeMsg = `Hi! 👋 Welcome to ${gym.name}! I'm here to help with any questions about the gym. If I can't answer something, I'll connect you directly with the gym team. What would you like to know?`;

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

    // Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 300,
      temperature: 0.7,
    });

    let aiResponse = completion.choices[0]?.message?.content || "[ESCALATE] Unable to process the question.";

    // Check for escalation trigger
    const needsEscalation = aiResponse.includes('[ESCALATE]');
    let escalation = null;

    if (needsEscalation) {
      const escalateReason = aiResponse.replace('[ESCALATE]', '').trim();

      // Get gym info for owner notification
      const gymNameMatch = convo.rows[0].title?.match(/Chat with (.+)/);
      let gymInfo = null;
      if (gymNameMatch) {
        const gymResult = await pool.query(
          'SELECT id, name, phone, claimed_by FROM gyms WHERE name = $1 LIMIT 1',
          [gymNameMatch[1]]
        );
        gymInfo = gymResult.rows[0] || null;
      }

      // Get owner contact info
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

      // Send SMS + Email to gym owner
      const smsOk = await sendOwnerSMS(ownerPhone, gymInfo?.name || 'Your gym', message);
      const emailOk = await sendOwnerEmail(ownerEmail, gymInfo?.name || 'Your gym', message, conversationId);

      // Log escalation
      try {
        await pool.query(`
          INSERT INTO chat_escalations (conversation_id, gym_id, user_message, escalation_reason, owner_notified_sms, owner_notified_email)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [parseInt(conversationId), gymInfo?.id || null, message, escalateReason, smsOk, emailOk]);
      } catch (e) {}

      // Replace AI response with friendly escalation message
      aiResponse = `Great question! That's something the gym team can best help with. I've just notified them ${smsOk || emailOk ? 'via ' + (smsOk ? 'SMS' : '') + (smsOk && emailOk ? ' and ' : '') + (emailOk ? 'email' : '') : ''} and they'll get back to you shortly. In the meantime, is there anything else I can help with?`;

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
    if (err.status === 401 || err.code === 'invalid_api_key') {
      return res.status(503).json({ error: 'AI service temporarily unavailable' });
    }
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// POST /api/chat/escalation/:id/respond — Gym owner responds to escalation
router.post('/escalation/:id/respond', async (req, res) => {
  try {
    const { response } = req.body;
    const escalationId = parseInt(req.params.id);

    const result = await pool.query(`
      UPDATE chat_escalations SET owner_response = $1, status = 'resolved', resolved_at = NOW()
      WHERE id = $2 RETURNING *
    `, [response, escalationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Escalation not found' });
    }

    // Add owner response to the conversation
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

module.exports = router;
