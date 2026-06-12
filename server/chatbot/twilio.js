/**
 * Twilio Adapter — WhatsApp + SMS booking for ScanGym
 * 
 * One endpoint handles both WhatsApp and SMS via Twilio.
 * Twilio sends incoming messages to our webhook, we process them
 * through the universal message-handler, and reply via Twilio API.
 * 
 * Setup:
 *   1. Twilio account (already configured for ScanGym)
 *   2. Set env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
 *   3. For WhatsApp: Enable Twilio WhatsApp Sandbox or Business API
 *   4. Set webhook URL in Twilio console:
 *      POST https://scangym.com/api/chatbot/twilio/webhook
 * 
 * WhatsApp messages come from "whatsapp:+447xxx"
 * SMS messages come from "+447xxx"
 */

const express = require('express');
const router = express.Router();
const { handleMessage } = require('./message-handler');

const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// ─── Webhook endpoint (Twilio sends messages here) ──────────
router.post('/webhook', async (req, res) => {
  try {
    const { Body, From, To, MessageSid, NumMedia } = req.body;

    if (!Body || !From) {
      return res.type('text/xml').send('<Response></Response>');
    }

    // Detect channel: WhatsApp messages come as "whatsapp:+44..."
    const isWhatsApp = From.startsWith('whatsapp:');
    const platform = isWhatsApp ? 'whatsapp' : 'sms';
    const userPhone = From.replace('whatsapp:', '');
    const userId = `${platform}:${userPhone}`;

    console.log(`[Twilio/${platform}] Message from ${userPhone}: ${Body.substring(0, 100)}`);

    // Process through universal handler
    const response = await handleMessage(userId, Body.trim(), {
      userName: userPhone,
      platform,
      phone: userPhone,
    });

    // Reply using TwiML (Twilio Markup Language)
    // This is the simplest way — Twilio reads the response directly
    const replyText = response.text
      .replace(/\*/g, '')  // Remove markdown bold (SMS doesn't support it)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${replyText}</Message>
</Response>`;

    res.type('text/xml').send(twiml);

  } catch (err) {
    console.error('[Twilio] Webhook error:', err);
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Sorry, something went wrong. Please try again or visit scangym.com</Message>
</Response>`);
  }
});

// ─── Status callback (delivery receipts) ─────────────────────
router.post('/status', (req, res) => {
  const { MessageSid, MessageStatus, To } = req.body;
  if (MessageStatus === 'failed' || MessageStatus === 'undelivered') {
    console.error(`[Twilio] Message ${MessageSid} to ${To}: ${MessageStatus}`);
  }
  res.sendStatus(200);
});

module.exports = router;
