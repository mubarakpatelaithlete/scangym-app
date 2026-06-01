# ScanGym — Checkout & Location System: Complete Fix Documentation

> **Version:** 1.0 — June 1, 2026  
> **Author:** Viktor AI + Mubarak Patel  
> **Purpose:** Full rebuild guide. If anything breaks, this file contains every bug found, root cause, exact fix, and verification results.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Stage 4 — Checkout Bugs (3 fixes)](#2-stage-4--checkout-bugs)
3. [Location System Bugs (3 fixes)](#3-location-system-bugs)
4. [Uber-Style Payment on File (new feature)](#4-uber-style-payment-on-file)
5. [50-City Test Results](#5-50-city-test-results)
6. [Commits & Deployment](#6-commits--deployment)
7. [Known Remaining Issues](#7-known-remaining-issues)
8. [How to Rebuild From Scratch](#8-how-to-rebuild-from-scratch)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend: frontend/public/app.ctr575.js (single file)  │
│  Served as static file from server                      │
├─────────────────────────────────────────────────────────┤
│  Server: server/server.js (Express + Node 20)           │
│  ├── server/routes/payment.js    ← Stripe + checkout    │
│  ├── server/routes/booking.js    ← Booking CRUD         │
│  ├── server/routes/liveSearch.js ← Google Places proxy  │
│  ├── server/routes/auth.js       ← Auth + sessions      │
│  └── server/middleware/db.js     ← PostgreSQL pool       │
├─────────────────────────────────────────────────────────┤
│  DB: Supabase PostgreSQL                                │
│  Hosting: Railway (ScanGym-API-V2 service)              │
│  Domains: scangym.com, www.scangym.com                  │
│  Payments: Stripe (GBP)                                 │
│  Maps: Google Places API                                │
└─────────────────────────────────────────────────────────┘
```

**Location detection layers (frontend):**
```
Layer 0 — Default (London)
Layer 1 — Cloudflare geo headers (not active — Railway not behind CF)
Layer 2 — Timezone heuristic
Layer 3 — IP geolocation (geoip-lite, free MaxMind DB)
Layer 4 — Cached location from localStorage
Layer 5 — GPS (navigator.geolocation) ← most accurate
```

---

## 2. Stage 4 — Checkout Bugs

### Bug 2.1: `google_place_id` → `place_id` Column Mismatch

**Symptom:** Checkout fails with PostgreSQL error — column `google_place_id` does not exist.

**Root Cause:** The database table `public.gyms` uses column name `place_id`, but `payment.js` referenced `google_place_id`.

**File:** `server/routes/payment.js`

**Fix:**
```javascript
// BEFORE (broken):
const ensureResult = await pool.query(
  'SELECT id FROM public.gyms WHERE google_place_id = $1', [placeId]
);

// AFTER (fixed):
const ensureResult = await pool.query(
  'SELECT id FROM public.gyms WHERE place_id = $1', [placeId]
);
```

Also fixed the INSERT statement for auto-creating gyms:
```javascript
// BEFORE (broken — missing required NOT NULL columns):
INSERT INTO public.gyms (name, address, google_place_id, day_pass_price, created_at, updated_at)
VALUES ($1, $2, $3, 5.00, NOW(), NOW())

// AFTER (fixed — includes owner_id, slug, is_active):
INSERT INTO public.gyms (name, address, place_id, day_pass_price, owner_id, slug, is_active, created_at, updated_at)
VALUES ($1, $2, $3, 5.00, 'system', $4, true, NOW(), NOW())
```

---

### Bug 2.2: `pool is not defined` in Server Startup

**Symptom:** Server crashes on startup during DB migration — `ReferenceError: pool is not defined`.

**Root Cause:** `server.js` had a migration block that used `pool` but it wasn't imported at that scope.

**File:** `server/server.js`

**Fix:**
```javascript
// Added at the top of the migration block:
const pool = require('./middleware/db');
```

---

### Bug 2.3: Email Required Before Stripe Elements Mount

**Symptom:** Checkout fails because email validation runs before the user can type anything. Stripe Elements won't mount.

**Root Cause:** `instant-checkout` endpoint required email upfront, but the UI flow needs Stripe Elements to mount first (they appear above the email field). Email should be collected at payment confirmation time.

**File:** `server/routes/payment.js` (backend) + `frontend/public/app.ctr575.js` (frontend)

**Fix (backend):**
```javascript
// BEFORE: email required at init
if (!date || !time || !email) {
  return res.status(400).json({ error: 'date, time, and email are required' });
}

// AFTER: email optional at init, collected at confirm-intent
if (!date || !time) {
  return res.status(400).json({ error: 'date and time are required' });
}
const userEmail = (email && email.includes('@')) ? email : null;
```

**Fix (frontend):** Added email to `confirm-intent` call:
```javascript
const confirmEmail = document.getElementById('uc-email')?.value || '';
const result = await fetch('/api/payment/confirm-intent', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ bookingId, paymentIntentId: paymentIntent.id, email: confirmEmail })
}).then(r => r.json());
```

**Fix (backend confirm-intent):** Accept and save email at confirmation:
```javascript
const { bookingId, paymentIntentId, email } = req.body;
// ... after verifying payment ...
if (email && email.includes('@')) {
  await pool.query('UPDATE public.bookings SET user_email = $1, updated_at = NOW() WHERE id = $2', [email, bookingId]);
  booking.user_email = email;
  try { await stripe.paymentIntents.update(paymentIntentId, { receipt_email: email }); } catch(e) {}
}
```

---

## 3. Location System Bugs

### Bug 3.1: Race Condition — IP Search Overwrites GPS Results (CRITICAL)

**Symptom:** User in Darwen, UK sees gyms in Boardman, Ohio or San Francisco, USA.

**Root Cause:** 
1. Page loads → Layer 3 (IP geolocation via geoip-lite) detects "Boardman" → calls `searchGyms('gyms in Boardman')`
2. Layer 5 (GPS) fires faster, loads correct Darwen results (13 gyms)
3. BUT Layer 3's `searchGyms` API call returns 1-2 seconds later and *blindly overwrites* `state.gyms`
4. `searchGyms()` had no guard — it always wrote results regardless of whether a better source already loaded

**Why London/Dubai worked:** Timing luck. GPS loaded fast enough that the IP search hadn't finished yet, or IP detected a nearby-enough city.

**File:** `frontend/public/app.ctr575.js`

**Fix — Race condition guard in `searchGyms()`:**
```javascript
// BEFORE:
async function searchGyms(query, isExplicit) {
  // ... fetch results ...
  state.gyms = data.gyms || [];  // Always overwrites!
}

// AFTER:
async function searchGyms(query, isExplicit, _triggerLayer) {
  // ... fetch results ...
  
  // RACE CONDITION FIX: If GPS (layer 5) loaded while this API call was in-flight,
  // discard these stale results. GPS data is always more accurate.
  if (_triggerLayer && window._locationLayer > _triggerLayer) {
    console.log('[Search] Discarding stale L' + _triggerLayer + ' results for "' + query + '" — L' + window._locationLayer + ' already loaded');
    return;  // Don't overwrite!
  }
  
  state.gyms = data.gyms || [];
}
```

**Fix — Pass layer from `_upgradeLocation()`:**
```javascript
// BEFORE:
searchGyms(query);

// AFTER:
searchGyms(query, false, layer);
```

**Fix — Default London search gets layer 0:**
```javascript
// BEFORE:
searchGyms('gyms in London');

// AFTER:
searchGyms('gyms in London', false, 0);
```

---

### Bug 3.2: geoip-lite Returns Wrong Cities

**Symptom:** IP geolocation maps UK mobile IPs and cloud server IPs to US cities (Boardman, Oregon; San Francisco, California).

**Root Cause:** The free MaxMind GeoLite2 database bundled with `geoip-lite` is inaccurate for many IP ranges, especially cloud providers and mobile carriers.

**Impact:** This bug is now *harmless* because of Fix 3.1 (race condition guard) — even if IP says "Boardman", GPS results win. But for future improvement, consider replacing `geoip-lite` with `ipinfo.io` (more accurate, paid API).

---

### Bug 3.3: No Location Bias in Google Places Text Search

**Symptom:** Search for "gyms in Boardman" returns gyms in Boardman, Ohio instead of nearby gyms.

**Root Cause:** `/api/live/search` sent the text query to Google Places without any `location` or `region` parameters. Google interpreted "Boardman" as the most popular match (Ohio, USA).

**File:** `server/routes/liveSearch.js`

**Fix — Add location bias:**
```javascript
// In the /search endpoint:
const { q, query, pagetoken, type, lat, lng, radius } = req.query;

// Cache key now includes coordinates:
const cacheKey = `search:${searchQuery}:${pagetoken || ''}:${lat || ''}:${lng || ''}`;

// Add location bias to Google Places URL:
if (lat && lng) {
  const r = radius || 20000; // 20km default bias radius
  url += `&location=${lat},${lng}&radius=${r}`;
}

// Add region bias from query:
const regionMatch = searchQuery.match(/\b(uk|gb|us|ae|in|au|ca|de|fr|es|it)\b/i);
if (regionMatch) {
  url += `&region=${regionMatch[1].toLowerCase()}`;
}
```

**File:** `frontend/public/app.ctr575.js`

**Fix — Pass coordinates to search:**
```javascript
// In _upgradeLocation(): set coordinates from meta
if (meta && meta.lat && meta.lng) {
  state.searchLat = meta.lat;
  state.searchLng = meta.lng;
}

// In searchGyms(): append to URL
let searchUrl = `/search?q=${encodeURIComponent(query)}`;
if (state.searchLat && state.searchLng) {
  searchUrl += `&lat=${state.searchLat}&lng=${state.searchLng}`;
}
```

---

## 4. Uber-Style Payment on File

### New Endpoints Added to `server/routes/payment.js`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/payment/save-card` | POST | Save card after first payment (auto-called by frontend) |
| `/api/payment/saved-cards` | GET | List saved payment methods for logged-in user |
| `/api/payment/saved-cards/:id` | DELETE | Remove a saved card |
| `/api/payment/quick-checkout` | POST | 1-tap checkout with saved card (no Stripe Elements) |
| `/api/payment/setup-card` | POST | Create SetupIntent to save card without payment |

### Flow:
```
First visit:
  User → picks gym → checkout modal → enters card → pays → card auto-saved silently

Future visits:
  User → picks gym → sees saved card (•••• 4242) → taps "⚡ Book Now" → done in 1 tap
  
  If SCA required → falls back to regular Stripe Elements flow
  "Use different card" link → switches to manual entry
```

### Key Helper Function:
```javascript
async function getOrCreateStripeCustomer(userId, email, phone) {
  // Checks users.stripe_customer_id → creates Stripe Customer if none → saves to DB
}
```

### Frontend UI (in `app.ctr575.js`):
- `#uc-saved-card` div: Shows saved card brand + last4 + "1-tap booking enabled"
- `_initUberPayment()`: Checks for saved cards first, shows 1-tap UI or falls back to Stripe Elements
- `_handleQuickCheckout()`: Calls `/quick-checkout` with saved card ID
- After first payment: auto-calls `/save-card` silently

---

## 5. 50-City Test Results

Tested with automated browser (GPS simulation, "Use My Location" button click, verify gym results).

```
✅ 50/50 cities PASSED — correct location detected, local gyms shown

🇬🇧 UK (15/15)
  Darwen, London, Manchester, Birmingham, Liverpool, Leeds, Glasgow,
  Edinburgh, Bristol, Cardiff, Sheffield, Newcastle, Nottingham, Bolton, Brighton

🇺🇸 USA (10/10)
  New York, Los Angeles, Chicago, Miami, San Francisco, Houston,
  Boston, Seattle, Denver, Atlanta

🇪🇺 Europe (10/10)
  Paris, Berlin, Amsterdam, Barcelona, Rome, Stockholm, Dublin,
  Lisbon, Prague, Vienna

🌍 Rest of World (15/15)
  Dubai, Abu Dhabi, Mumbai, Delhi, Tokyo, Singapore, Hong Kong,
  Bangkok, Sydney, Melbourne, Toronto, Vancouver, Cape Town, Lagos, Nairobi
```

**Key validation:** Darwen now shows 13 local gyms (previously showed Boardman, Ohio).

---

## 6. Commits & Deployment

### Git Commits (on `main` branch, chronological):

| SHA | Message | Files |
|---|---|---|
| `419f8b57` | fix: Stage 4 checkout + Uber payment on file (#35) | `payment.js`, `app.ctr575.js` |
| `e8cfc7a3` | fix: use require for pool in DB migration (fix startup crash) | `server.js` |
| `e9f367c8` | fix: make email optional at checkout init, collect at confirmation | `payment.js` |
| `dd498304` | fix: send email to confirm-intent for QR delivery | `app.ctr575.js` |
| `a604ca3c` | fix: race condition + location bias — GPS no longer overwritten by stale IP search | `app.ctr575.js`, `liveSearch.js` |

### Deployment

- **Hosting:** Railway project `impartial-rejoicing`, service `ScanGym-API-V2`
- **Start command:** Clones from GitHub → `npm install` → `node server.js`
- **Redeploy trigger:** Push to `main` on GitHub → Railway auto-deploys (or manual via Railway GraphQL API)
- **Live URLs:** `https://scangym.com`, `https://www.scangym.com`

### GitHub Repository
- **Repo:** `mubarakpatelaithlete/scangym-app` (public)
- **Branch:** `main`

---

## 7. Known Remaining Issues

| Issue | Severity | Details |
|---|---|---|
| Auto-create gym fallback | Medium | INSERT fails if `description` is NOT NULL — needs default value or schema change |
| `BASE_URL` env var | Low | Set to Railway URL, not `scangym.com` — affects some redirects |
| `#1 most booked in Bolton` badge | Low | Hardcoded on London gyms — should be dynamic or removed |
| Bank statement name | Low | Shows "Upmart Store Limited" not ScanGym — update in Stripe Dashboard |
| Email/QR delivery | Medium | `SENDGRID_API_KEY` likely not set — QR codes generated but not emailed |
| geoip-lite accuracy | Low | Free MaxMind DB maps many IPs to wrong cities — harmless now (GPS wins) but could upgrade to ipinfo.io |
| No Cloudflare | Low | Railway not behind CF, so CF geo headers (Layer 1) never fire |

---

## 8. How to Rebuild From Scratch

If you need to re-apply all fixes to a clean codebase:

### Step 1: Clone the repo
```bash
git clone https://github.com/mubarakpatelaithlete/scangym-app.git
cd scangym-app
```

### Step 2: Apply checkout fixes to `server/routes/payment.js`
1. Change `google_place_id` → `place_id` in all queries
2. Add `owner_id, slug, is_active` to gym INSERT statement
3. Make email optional in `instant-checkout` (accept `null`)
4. Add email handling to `confirm-intent` (accept email param, update booking + Stripe)
5. Add all Uber endpoints: `save-card`, `saved-cards`, `quick-checkout`, `setup-card`, `delete saved-cards/:id`
6. Add `getOrCreateStripeCustomer()` helper

### Step 3: Fix server startup — `server/server.js`
1. Add `const pool = require('./middleware/db');` before any migration code that uses `pool`

### Step 4: Apply location fixes to `frontend/public/app.ctr575.js`
1. Add `_triggerLayer` parameter to `searchGyms(query, isExplicit, _triggerLayer)`
2. After API response, check: `if (_triggerLayer && window._locationLayer > _triggerLayer) { return; }`
3. In `_upgradeLocation()`: set `state.searchLat/searchLng` from `meta.lat/meta.lng`
4. In `_upgradeLocation()`: pass layer to `searchGyms(query, false, layer)`
5. In `searchGyms()`: append `&lat=...&lng=...` to search URL when available
6. Default London search: `searchGyms('gyms in London', false, 0)`

### Step 5: Apply location fixes to `server/routes/liveSearch.js`
1. Accept `lat, lng, radius` query params in `/search`
2. Include lat/lng in cache key
3. Append `&location=${lat},${lng}&radius=${r}` to Google Places URL
4. Add region bias: detect country code in query, append `&region=xx`

### Step 6: Add Uber-style UI to `frontend/public/app.ctr575.js`
1. Add `#uc-saved-card` div in checkout modal HTML
2. In `_initUberPayment()`: check `/saved-cards` first, show 1-tap UI
3. Add `_handleQuickCheckout()` function
4. After successful payment: auto-call `/save-card` silently

### Step 7: Deploy
```bash
git add -A
git commit -m "rebuild: checkout + location + Uber payment on file"
git push origin main
# Railway auto-deploys from main
```

### Step 8: Verify
- Open `https://scangym.com` on mobile
- Click "Use My Location" → should show gyms near you
- Click a gym → "Book Now" → checkout should load Stripe Elements
- Complete payment → QR code generated
- Next visit → should show saved card with 1-tap booking

---

*This document is the single source of truth for all checkout and location changes made on May 31–June 1, 2026. Keep it in the repo root for reference.*
