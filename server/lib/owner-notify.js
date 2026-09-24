/**
 * Telling a gym owner a customer needs them — by SMS (Twilio) and email (SMTP).
 *
 * Moved out of routes/chat.js so the voice tools (lib/comms-tools.js: "message the
 * gym") reach the owner through exactly the same two channels as the receptionist
 * chat's escalation, with the same wording. Each sender returns true only when the
 * provider accepted the message; a missing key or address is a quiet false, never a
 * throw, so the caller can say honestly whether anyone was told.
 */
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
        <p><a href="https://www.scangym.com/owner/messages/${safeConvoId}" style="background:#FF6B35;color:white;padding:10px 20px;text-decoration:none;display:inline-block;">Reply to Customer</a></p>
        <p style="color:#666;font-size:12px;">— ScanGym Team</p>
      `,
    });
    return true;
  } catch (err) {
    console.error('Email send error:', err.message);
    return false;
  }
}


/**
 * Notify the owner of `gym` about `userMessage`. Looks the owner up from gyms.claimed_by.
 * @returns { sms: boolean, email: boolean }
 */
async function notifyGymOwner(pool, gym, userMessage, conversationId) {
  let phone = null;
  let email = null;
  if (gym?.claimed_by) {
    try {
      const { rows } = await pool.query('SELECT phone, email FROM users WHERE id = $1', [gym.claimed_by]);
      phone = rows[0]?.phone || null;
      email = rows[0]?.email || null;
    } catch (e) {
      console.warn('[OwnerNotify] owner lookup failed:', e.message);
    }
  }
  const sms = await sendOwnerSMS(phone, gym?.name || 'Your gym', userMessage);
  const emailOk = await sendOwnerEmail(email, gym?.name || 'Your gym', userMessage, conversationId);
  return { sms, email: emailOk };
}

module.exports = { sendOwnerSMS, sendOwnerEmail, notifyGymOwner, escapeHtml };
