# ScanGym Custom GPT — Setup Guide

## Quick Setup (5 minutes)

### Step 1: Go to ChatGPT GPT Editor
Visit [chatgpt.com/gpts/editor](https://chatgpt.com/gpts/editor) and click "Create a GPT"

### Step 2: Configure the GPT

**Name:** ScanGym — Book Any Gym  
**Description:** Find and book gym day passes at 1.2M+ gyms worldwide. No membership needed. Just pay per visit from £4.49.  
**Instructions:** Copy the contents of `gpt-instructions.md`  

**Conversation Starters:**
1. Find me a gym near Manchester 🏋️
2. What's the cheapest gym in London?
3. Book a session for tomorrow morning
4. Cancel my booking

**Profile Image:** Use the ScanGym logo (orange circle with dumbbell)

### Step 3: Add Actions
1. Click "Create new action"
2. Set Authentication to "None"
3. Paste the contents of `openapi.yaml` into the schema
4. Click "Test" to verify each endpoint works

### Step 4: Publish
1. Click "Update" (top right)
2. Set publishing to **"Everyone"** (Public — visible in GPT Store)
3. Select category: **Lifestyle**
4. Click "Confirm"

### Step 5: Verify Domain (for GPT Store visibility)
1. Go to your GPT settings → Actions → click your action
2. Under "Privacy policy", add: `https://scangym.com/privacy`
3. Follow the domain verification steps (add a TXT record or meta tag)

## Testing

Test these queries after publishing:
- "Find gyms in Bolton" → should return gym list from scangym.com API
- "Book a gym for tomorrow" → should ask for location, email, and confirm before booking
- "Cancel booking 12345" → should ask for email and cancel

## Files in this directory
- `gpt-instructions.md` — System prompt for the GPT
- `openapi.yaml` — OpenAPI 3.1 schema connecting to scangym.com API
- `README.md` — This file

## Live GPT Link
https://chatgpt.com/g/g-6a2d42cd13e08191a65eebd2426bbe60-scangym

## Support
book@scangym.com