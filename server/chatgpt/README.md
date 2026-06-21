# ScanGym ChatGPT GPT — Book Gyms from ChatGPT

Let anyone book a gym session directly from ChatGPT — just like booking.com does for hotels.

> "Find me a cheap gym in Bolton and book it for tomorrow" → Done. ✅

## How It Works

```
User → ChatGPT → GPT Actions (OpenAPI spec) → ScanGym API → Booking Created
                                                            → Payment Link
                                                            → QR Code Entry
```

This is a **Custom GPT with Actions** — ChatGPT reads our OpenAPI spec to know which ScanGym APIs to call. No authentication needed (uses guest checkout with email).

## Setup Guide

### Step 1: Create the GPT

1. Go to [chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor)
2. Click **"Create a GPT"**
3. Go to the **Configure** tab

### Step 2: Configure the GPT

**Name:** ScanGym — Book Any Gym  
**Description:** Find and book gym sessions worldwide. No memberships, just pay per visit. Flexible gym access from ScanGym. 💪  
**Instructions:** Copy the contents of `gpt-instructions.md`

### Step 3: Add Actions

1. In the Configure tab, scroll to **Actions** → click **"Create new action"**
2. Set **Authentication** to **"None"**
3. Paste the contents of `openapi.yaml` into the **Schema** field
4. Set **Privacy policy URL** to `https://scangym.com/privacy`

### Step 4: Set Conversation Starters

Add these example prompts:
- "Find gyms near me"
- "Book a gym in Bolton for tomorrow"
- "What's the cheapest gym in Manchester?"
- "Cancel my booking"

### Step 5: Upload Profile Image

Use the ScanGym logo (orange 🟠 circle branding).

### Step 6: Publish

1. Click **"Save"** → Choose **"Everyone"**
2. Verify your **Builder Profile** at Settings → Builder Profile:
   - Option A: Verify your name (from billing)
   - Option B: Verify domain `scangym.com` (add DNS TXT record)
3. Your GPT appears in the GPT Store!

## Testing

Before publishing, test these conversations:

| Test | What to say | Expected |
|------|-------------|----------|
| Search | "Find gyms in Bolton" | Returns list of gyms with prices |
| Details | "Tell me more about [gym name]" | Shows hours, reviews, photos |
| Book | "Book [gym] for tomorrow, email: test@test.com" | Creates booking, returns code |
| Cancel | "Cancel booking 123, email: test@test.com" | Cancels and confirms |
| No location | "I want to go to the gym" | Asks for location |
| Referral | "Book with code FITJOHN" | Applies 15% discount |

## Files

| File | Purpose |
|------|---------|
| `openapi.yaml` | OpenAPI 3.1 spec — defines the API actions ChatGPT can call |
| `gpt-instructions.md` | System prompt — personality, rules, booking flow |
| `README.md` | This setup guide |

## Architecture — All AI Channels

ScanGym is bookable from multiple AI platforms:

| Platform | Technology | Status |
|----------|-----------|--------|
| **ChatGPT** | GPT Actions (this folder) | 🆕 Ready to set up |
| **Claude** | MCP Server (`../mcp/`) | ✅ Built |
| **Telegram** | Bot API (`../chatbot/telegram.js`) | ✅ Live |
| **WhatsApp** | Twilio (`../chatbot/twilio.js`) | ✅ Live |
| **SMS** | Twilio (`../chatbot/twilio.js`) | ✅ Live |
| **Discord** | Bot (`../chatbot/discord.js`) | ✅ Live |
| **Email** | SendGrid (`../chatbot/email.js`) | ✅ Live |

All channels use the same ScanGym API — the difference is just how messages arrive and leave.

## Future: OpenAI Apps SDK

Booking.com, Expedia, and Spotify use the new **Apps SDK** (built on MCP). This is a premium tier that gives:
- Custom UI inside ChatGPT (not just text)
- Direct integration without manual GPT setup
- Featured placement in ChatGPT

To apply: [platform.openai.com/apps](https://platform.openai.com/apps)

For now, the GPT Actions approach gets ScanGym into ChatGPT immediately while the Apps SDK application is reviewed.
