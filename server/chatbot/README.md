# ScanGym Chatbot — Book From Anywhere

Book a gym session from WhatsApp, Telegram, SMS, and more.

> "One kitchen, many doors" — one message handler, many channel adapters.

## Architecture

```
User Message → Channel Adapter → Message Handler → ScanGym API → Reply
                   │                    │
              telegram.js         message-handler.js
              twilio.js           (intent detection,
              discord.js*         entity extraction,
              messenger.js*       session tracking)
              (* = future)
```

## Active Channels

| Channel | Adapter | Cost | Setup |
|---------|---------|------|-------|
| **Telegram** | `telegram.js` | Free | Create bot with @BotFather |
| **WhatsApp** | `twilio.js` | ~$0.005/msg | Twilio WhatsApp Business API |
| **SMS** | `twilio.js` | ~$0.01/msg | Twilio (already configured) |

## Setup

### Telegram
1. Message @BotFather on Telegram → `/newbot` → get token
2. Set env: `TELEGRAM_BOT_TOKEN=your_token`
3. Set webhook:
```bash
curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://scangym.com/api/chatbot/telegram/webhook"}'
```

### WhatsApp + SMS (Twilio)
1. Already have Twilio account (used for OTP)
2. Set webhook in Twilio Console → Phone Number → Messaging:
   `https://scangym.com/api/chatbot/twilio/webhook`
3. For WhatsApp: Enable WhatsApp Sandbox or Business API in Twilio

## Test Endpoint

```bash
curl -X POST https://scangym.com/api/chatbot/test \
  -H "Content-Type: application/json" \
  -d '{"message": "Find gyms in Bolton", "userId": "test123"}'
```

## What Users Can Say

- "Find gyms in Bolton"
- "Book a gym in London for tomorrow at 3pm"
- "Book gym 1 for today" (after searching)
- "Cancel booking 123 email@example.com"
- "Help"

## Adding a New Channel

1. Create `server/chatbot/newchannel.js` as an Express router
2. Receive messages in the platform's webhook format
3. Extract text, userId, userName
4. Call `handleMessage(userId, text, meta)` from `message-handler.js`
5. Send the response text back to the user
6. Mount in `index.js`

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | For Telegram | Bot token from @BotFather |
| `TWILIO_ACCOUNT_SID` | For WhatsApp/SMS | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | For WhatsApp/SMS | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | For SMS | Twilio phone number |
