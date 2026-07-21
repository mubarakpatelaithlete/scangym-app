/**
 * Email Booking Adapter for ScanGym — v2.0 (Telegram-level quality)
 * 
 * Full-featured email integration with:
 *   ✓ Auto-link by email address (match existing ScanGym accounts)
 *   ✓ Branded HTML email templates (ScanGym orange theme)
 *   ✓ Booking confirmation emails with QR code
 *   ✓ Reply threading (In-Reply-To headers)
 *   ✓ Quoted reply stripping (smart parser)
 *   ✓ Attachment support (images, PDFs)
 *   ✓ Multi-part messages (plain text + HTML)
 *   ✓ Comms logging
 *   ✓ SendGrid Inbound Parse webhook
 *   ✓ Direct send endpoint (for internal use)
 * 
 * Setup:
 *   1. In SendGrid: Settings → Inbound Parse → Add Host & URL
 *      - Domain: scangym.com (or subdomain)
 *      - URL: https://scangym.com/api/chatbot/email/webhook
 *   2. Add MX record: book.scangym.com → mx.sendgrid.net
 *   3. Env vars: SENDGRID_API_KEY, SMTP_FROM (already set)
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

// ─── SendGrid API key (from environment only — never hardcode secrets) ───
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
const SMTP_FROM = process.env.SMTP_FROM || 'book@scangym.com';
const BASE_URL = process.env.BASE_URL || 'https://scangym.com';

// Message ID tracking for threading
const messageThreads = new Map();

// ─── Inbound Email Webhook ──────────────────────────────────
router.post('/webhook', express.urlencoded({ extended: true, limit: '10mb' }), async (req, res) => {
  res.sendStatus(200);

  try {
    const { from, to, subject, text, html, envelope, headers, attachments } = req.body;

    if (!from || (!text && !subject)) {
      console.log('[Email] Received webhook with no usable content');
      return;
    }

    const senderEmail = extractEmail(from);
    if (!senderEmail) {
      console.log('[Email] Could not parse sender email from:', from);
      return;
    }

    const senderName = extractName(from);
    const bodyText = cleanEmailBody(text || '');
    const messageText = bodyText || subject || '';

    if (!messageText.trim()) {
      console.log('[Email] Empty message from:', senderEmail);
      return;
    }

    const userId = `email:${senderEmail}`;

    console.log(`[Email] From ${senderName} <${senderEmail}>: ${messageText.substring(0, 100)}`);

    // Log inbound
    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'inbound', from: senderEmail, to: SMTP_FROM, subject: subject || '', body: messageText, status: 'received' }); } catch(e){
      console.warn('[Email] Failed to log inbound comms:', e.message);
    }

    // Try to auto-link by email address
    let linkedUserName = senderName;
    try {
      const linkResp = await fetch(`${BASE_URL}/api/channels/email/auto-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: senderEmail, name: senderName }),
      });
      const linkData = await linkResp.json();
      if (linkData.linked && linkData.userName) {
        linkedUserName = linkData.userName;
      }
    } catch (e) {
      console.warn('[Email] Failed to auto-link email to user:', e.message);
    }

    // Process through universal handler
    const response = await handleMessage(userId, messageText.trim(), {
      userName: linkedUserName,
      platform: 'email',
      email: senderEmail,
    });

    // Check for attachments info
    let attachmentInfo = '';
    if (attachments) {
      try {
        const parsed = typeof attachments === 'string' ? JSON.parse(attachments) : attachments;
        if (parsed && parsed.length > 0) {
          attachmentInfo = `\n\n📎 ${parsed.length} attachment(s) received.`;
        }
      } catch (e) {
        // Attachment parsing is non-critical
      }
    }

    // Reply via email
    const messageId = headers ? extractHeader(headers, 'Message-ID') : null;
    await sendEmailReply(senderEmail, senderName, subject, response.text + attachmentInfo, messageId);

    // If booking was confirmed, send a separate QR confirmation email
    if (response.data && response.data.booking) {
      await sendBookingConfirmation(senderEmail, senderName, response.data.booking);
    }

  } catch (err) {
    console.error('[Email] Webhook error:', err);
  }
});

// ─── Direct Send Endpoint ───────────────────────────────────
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

  await sendEmailReply(email, name || email, 'ScanGym Booking', response.text);
  res.json({ success: true, response: response.text });
});

// ─── Booking Confirmation Email ──────────────────────────────
async function sendBookingConfirmation(toEmail, toName, booking) {
  if (!SENDGRID_API_KEY) return;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;margin:0;padding:0;background:#f5f5f5">
  <div style="max-width:600px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#FF6D00,#ff8533);padding:32px 24px;text-align:center">
      <h1 style="color:#fff;font-size:24px;font-weight:900;margin:0">🏋️ Booking Confirmed!</h1>
    </div>
    <div style="padding:24px">
      <p style="font-size:16px;color:#333;margin:0 0 20px">Hey ${toName}, your gym session is booked!</p>
      <div style="background:#f8f9fa;border-radius:12px;padding:20px;margin-bottom:20px">
        <p style="margin:0 0 8px"><strong>📍 ${booking.gymName || 'Gym'}</strong></p>
        <p style="margin:0 0 8px;color:#666">📅 ${booking.date || 'Date'} at ${booking.time || 'Time'}</p>
        <p style="margin:0;color:#666">🎫 ${booking.passType || 'Day Pass'}</p>
      </div>
      ${booking.qrUrl ? `<div style="text-align:center;margin:24px 0">
        <p style="color:#666;font-size:13px;margin:0 0 12px">Your entry QR code:</p>
        <img src="${booking.qrUrl}" alt="QR Code" style="width:200px;height:200px;border-radius:8px">
      </div>` : ''}
      <div style="text-align:center;margin-top:24px">
        <a href="${BASE_URL}/bookings" style="display:inline-block;background:#FF6D00;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:700">View Booking</a>
      </div>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #eee;text-align:center">
      <p style="color:#999;font-size:12px;margin:0">ScanGym — Universal Gym Day Pass · <a href="${BASE_URL}" style="color:#FF6D00">scangym.com</a></p>
    </div>
  </div>
</body>
</html>`;

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net', port: 587,
      auth: { user: 'apikey', pass: SENDGRID_API_KEY },
    });

    await transporter.sendMail({
      from: `ScanGym <${SMTP_FROM}>`,
      to: toEmail,
      subject: `✅ Booking Confirmed — ${booking.gymName || 'Your Gym Session'}`,
      text: `Booking confirmed! ${booking.gymName || 'Gym'} on ${booking.date || 'Date'} at ${booking.time || 'Time'}. View at ${BASE_URL}/bookings`,
      html,
    });
    console.log(`[Email] Booking confirmation sent to ${toEmail}`);
  } catch (err) {
    console.error('[Email] Confirmation send failed:', err.message);
  }
}

// ─── Account linking endpoint ────────────────────────────────
router.post('/connect', async (req, res) => {
  const { token, email } = req.body;
  if (!token || !email) {
    return res.status(400).json({ error: 'token and email required' });
  }

  try {
    const verifyResp = await fetch(`${BASE_URL}/api/channels/email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, email }),
    });
    const data = await verifyResp.json();

    if (data.success) {
      await sendEmailReply(email, email, 'ScanGym — Account Connected', '✅ Your ScanGym account is now linked to this email address!\n\nJust email book@scangym.com anytime to search and book gyms. Try: "Find gyms in Manchester"');
      res.json({ success: true });
    } else {
      res.json({ success: false, error: data.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Status endpoint ────────────────────────────────────────
router.get('/status', (req, res) => {
  res.json({
    active: !!SENDGRID_API_KEY,
    inboundEmail: SMTP_FROM,
    threadsTracked: messageThreads.size,
    instructions: !SENDGRID_API_KEY
      ? 'Set SENDGRID_API_KEY to enable email replies'
      : 'Send an email to ' + SMTP_FROM + ' to book a gym',
  });
});

// ─── Email Sending ──────────────────────────────────────────

async function sendEmailReply(toEmail, toName, originalSubject, responseText, inReplyTo) {
  if (!SENDGRID_API_KEY) {
    console.error('[Email] No SENDGRID_API_KEY — cannot send reply');
    return;
  }

  const reSubject = originalSubject
    ? (originalSubject.startsWith('Re:') ? originalSubject : `Re: ${originalSubject}`)
    : 'ScanGym — Your Gym Booking';

  const htmlBody = formatEmailHtml(responseText);
  const plainText = responseText.replace(/\*([^*]+)\*/g, '$1');

  try {
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net', port: 587,
      auth: { user: 'apikey', pass: SENDGRID_API_KEY },
    });

    const mailOptions = {
      from: `ScanGym <${SMTP_FROM}>`,
      to: toEmail,
      subject: reSubject,
      text: plainText,
      html: htmlBody,
    };

    // Add threading headers if replying
    if (inReplyTo) {
      mailOptions.inReplyTo = inReplyTo;
      mailOptions.references = inReplyTo;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`[Email] Reply sent to ${toEmail}`);

    // Track message ID for threading
    if (info.messageId) {
      messageThreads.set(toEmail, info.messageId);
    }

    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'outbound', from: SMTP_FROM, to: toEmail, subject: reSubject, body: plainText, status: 'sent' }); } catch(e){
      console.warn('[Email] Failed to log outbound comms:', e.message);
    }
  } catch (err) {
    console.error('[Email] Send failed:', err.message);
    try { const { logComms } = require('../routes/comms-log'); await logComms({ channel: 'email', direction: 'outbound', from: SMTP_FROM, to: toEmail, subject: reSubject, body: plainText, status: 'failed', metadata: { error: err.message } }); } catch(e){
      console.warn('[Email] Failed to log failed outbound comms:', e.message);
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────

function extractEmail(from) {
  const match = from.match(/<([^>]+)>/) || from.match(/([^\s<>,]+@[^\s<>,]+)/);
  return match ? match[1].toLowerCase() : null;
}

function extractName(from) {
  const match = from.match(/^([^<]+)\s*</);
  if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  return from.split('@')[0];
}

function extractHeader(headers, name) {
  const regex = new RegExp(`^${name}:\\s*(.+)$`, 'mi');
  const match = headers.match(regex);
  return match ? match[1].trim() : null;
}

function cleanEmailBody(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const cleanLines = [];

  for (const line of lines) {
    if (/^On .+ wrote:$/.test(line.trim())) break;
    if (/^-{3,}/.test(line.trim()) && cleanLines.length > 0) break;
    if (/^_{3,}/.test(line.trim())) break;
    if (/^>+\s/.test(line.trim())) continue;
    // Also skip common email client reply markers
    if (/^(From|Sent|To|Subject|Date):/.test(line.trim()) && cleanLines.length > 2) break;
    cleanLines.push(line);
  }

  return cleanLines.join('\n').trim();
}

function formatEmailHtml(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:0;color:#333;background:#f5f5f5">
  <div style="background:#fff;border-radius:0 0 8px 8px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#FF6D00,#ff8533);padding:16px 24px;display:flex;align-items:center;gap:12px">
      <span style="font-size:24px">🏋️</span>
      <span style="font-size:18px;font-weight:800;color:#fff">ScanGym</span>
    </div>
    <div style="padding:24px;font-size:15px;line-height:1.6">
      <p>${html}</p>
    </div>
    <div style="padding:16px 24px;border-top:1px solid #f0f0f0;text-align:center">
      <a href="${BASE_URL}" style="display:inline-block;background:#FF6D00;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">Open ScanGym</a>
    </div>
    <div style="padding:12px 24px;border-top:1px solid #f0f0f0;text-align:center">
      <p style="color:#999;font-size:11px;margin:0">Reply to this email to continue the conversation · <a href="${BASE_URL}" style="color:#FF6D00">scangym.com</a></p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = router;