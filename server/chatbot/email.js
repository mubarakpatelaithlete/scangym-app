/**
 * Email Booking Adapter for ScanGym
 * 
 * Receives inbound emails via SendGrid Inbound Parse webhook,
 * passes the message to the universal message-handler, and
 * replies via SendGrid SMTP (already configured in the app).
 * 
 * Architecture: Same "one kitchen, many doors" pattern.
 *   User emails book@scangym.com → SendGrid Inbound Parse → This adapter
 *   → message-handler.js → ScanGym API → Reply email sent back
 * 
 * Setup:
 *   1. In SendGrid: Settings → Inbound Parse → Add Host & URL
 *      - Domain: scangym.com (or subdomain like book.scangym.com)
 *      - URL: https://scangym.com/api/chatbot/email/webhook
 *      - Check "POST the raw, full MIME message"  ← optional
 *   2. Add MX record for your domain pointing to mx.sendgrid.net
 *      (or use a subdomain like book.scangym.com)
 *   3. Env vars needed: SENDGRID_API_KEY (already set), SMTP_FROM (already set)
 * 
 * Users email book@scangym.com with messages like:
 *   Subject: "Find gyms in Bolton"
 *   Body: "Book a gym near Manchester for tomorrow at 3pm"
 * 
 * The bot replies to the email with search results or booking confirmation.
 * Zero new dependencies — uses nodemailer (already in the project).
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

// Reuse existing email config
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SMTP_FROM = process.env.SMTP_FROM || 'book@scangym.com';

// ─── Inbound Email Webhook ──────────────────────────────────
// SendGrid Inbound Parse sends POST with multipart/form-data
router.post('/webhook', express.urlencoded({ extended: true, limit: '10mb' }), async (req, res) => {
  // Always respond 200 quickly (SendGrid retries on failures)
  res.sendStatus(200);

  try {
    const {
      from,         // "John Smith <john@example.com>" or "john@example.com"
      to,           // "book@scangym.com"
      subject,      // Email subject line
      text,         // Plain text body
      html,         // HTML body (fallback)
      envelope,     // JSON string: {"from":"...","to":["..."]}
      headers,      // Raw email headers
    } = req.body;

    if (!from || (!text && !subject)) {
      console.log('[Email] Received webhook with no usable content');
      return;
    }

    // Extract sender email from "Name <email>" format
    const senderEmail = extractEmail(from);
    if (!senderEmail) {
      console.log('[Email] Could not parse sender email from:', from);
      return;
    }

    // Extract sender name
    const senderName = extractName(from);

    // Use subject + body as the message (users might put query in either)
    const bodyText = cleanEmailBody(text || '');
    const messageText = bodyText || subject || '';

    if (!messageText.trim()) {
      console.log('[Email] Empty message from:', senderEmail);
      return;
    }

    const userId = `email:${senderEmail}`;

    console.log(`[Email] From ${senderName} <${senderEmail}>: ${messageText.substring(0, 100)}`);

    // #175: Log inbound email
    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'inbound', from: senderEmail, to: SMTP_FROM, subject: subject || '', body: messageText, status: 'received' }); } catch(e){}

    // Process through universal handler
    const response = await handleMessage(userId, messageText.trim(), {
      userName: senderName,
      platform: 'email',
      email: senderEmail,
    });

    // Reply via email
    await sendEmailReply(senderEmail, senderName, subject, response.text);

  } catch (err) {
    console.error('[Email] Webhook error:', err);
  }
});

// ─── Direct Email Endpoint (alternative to webhook) ─────────
// POST /api/chatbot/email/send { "email": "user@example.com", "message": "Find gyms in Bolton" }
router.post('/send', async (req, res) => {
  const { email, message, name } = req.body;
  if (!email || !message) {
    return res.status(400).json({ error: 'email and message are required' });
  }

  const userId = `email:${email}`;
  const response = await handleMessage(userId, message.trim(), {
    userName: name || email,
    platform: 'email',
    email,
  });

  // Send the reply
  await sendEmailReply(email, name || email, 'ScanGym Booking', response.text);

  res.json({ success: true, response: response.text });
});

// ─── Status endpoint ────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: !!SENDGRID_API_KEY,
    inboundEmail: SMTP_FROM,
    instructions: !SENDGRID_API_KEY
      ? 'Set SENDGRID_API_KEY to enable email replies'
      : 'Send an email to ' + SMTP_FROM + ' to book a gym',
  });
});

// ─── Email Sending ──────────────────────────────────────────

async function sendEmailReply(toEmail, toName, originalSubject, responseText) {
  if (!SENDGRID_API_KEY) {
    console.error('[Email] No SENDGRID_API_KEY — cannot send reply');
    return;
  }

  // Format subject
  const reSubject = originalSubject
    ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
    : 'ScanGym — Your Gym Booking';

  // Convert plain text response to simple HTML email
  const htmlBody = formatEmailHtml(responseText);
  // Also keep a clean plain text version
  const plainText = responseText.replace(/\*/g, '');

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: SENDGRID_API_KEY },
    });

    await transporter.sendMail({
      from: `ScanGym <${SMTP_FROM}>`,
      to: toEmail,
      subject: reSubject,
      text: plainText,
      html: htmlBody,
    });

    console.log(`[Email] Reply sent to ${toEmail}`);
    // #175: Log to comms_log
    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'outbound', from: SMTP_FROM, to: toEmail, subject: reSubject, body: plainText, status: 'sent' }); } catch(e){}
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'outbound', from: SMTP_FROM, to: toEmail, subject: reSubject, body: plainText, status: 'failed', metadata: { error: err.message } }); } catch(e){}
  }
}

// ─── Helpers ────────────────────────────────────────────────

function extractEmail(from) {
  // "John Smith <john@example.com>" → "john@example.com"
  // "john@example.com" → "john@example.com"
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<>,]+@[^\s<>,]+)/);
  return match ? match[1].toLowerCase() : null;
}

function extractName(from) {
  // "John Smith <john@example.com>" → "John Smith"
  const match = from.match(/^([^<]+)\s*</);
  if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  return from.split('@')[0]; // fallback: use email prefix
}

function cleanEmailBody(text) {
  if (!text) return '';

  // Remove quoted replies (lines starting with > or "On ... wrote:")
  const lines = text.split('\n');
  const cleanLines = [];

  for (const line of lines) {
    // Stop at reply quote markers
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (/^-{3,}/.test(line.trim()) && cleanLines.length > 0) break; // "---" separator
    if (/^_{3,}/.test(line.trim())) break; // "___" separator
    if (line.trim().startsWith('>')) continue; // Skip quoted lines

    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

function formatEmailHtml(text) {
  // Convert markdown-ish text to simple HTML
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')  // *bold*
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <div style="border-bottom: 3px solid #FF6D00; padding-bottom: 12px; margin-bottom: 20px;">
    <span style="font-size: 20px; font-weight: 700;">🏋️ Scan<span style="color: #FF6D00;">Gym</span></span>
  </div>
  <div style="font-size: 15px; line-height: 1.6;">
    <p>${html}</p>
  </div>
  <div style="margin-top: 30px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #999;">
    <p>Sent by ScanGym Bot — <a href="https://scangym.com" style="color: #FF6D00;">scangym.com</a></p>
    <p>Reply to this email to continue the conversation.</p>
  </div>
</body>
</html>`;
}

module.exports = router;
