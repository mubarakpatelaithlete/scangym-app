# ScanGym — Book a Gym. Anywhere.

**Gym finder & booking marketplace.** Find gyms near you, book 24-hour day passes for £5, scan QR to enter.

🌐 **Live:** [scangym.com](https://scangym.com)

## Tech Stack

- **Backend:** Node.js 20 + Express.js
- **Database:** Supabase PostgreSQL (Drizzle ORM)
- **Frontend:** Vanilla JS SPA + Tailwind CSS
- **Hosting:** Railway (Docker)
- **Payments:** Stripe (£5 day passes)
- **Auth:** Twilio Phone OTP
- **Maps:** Google Maps Places API

## Architecture

```
scangym-app/
├── server/
│   ├── server.js          # Express app, health check, routing
│   ├── package.json       # Dependencies
│   ├── routes/            # 12 API route modules
│   │   ├── guest.js       # Gym search, discovery (Google Places)
│   │   ├── reviews.js     # Ratings & reviews
│   │   ├── chat.js        # AI chat + gym owner escalation (Task 6)
│   │   ├── coach.js       # AI Coach (gated: Task 1)
│   │   ├── wallet.js      # Wallet top-ups & spending (Task 14)
│   │   ├── creators.js    # ScanSquad / referral creators (Tasks 15-18)
│   │   ├── gymProfile.js  # Gym details, photos, hours
│   │   ├── owner.js       # Gym owner pricing dashboard (Task 11)
│   │   ├── stats.js       # CEO dashboard analytics (Task 21)
│   │   ├── directions.js  # Embedded map directions (Task 23)
│   │   ├── qr.js          # QR code gen & 2-scan entry (Task 12)
│   │   └── conviction.js  # 33 Booking.com persuasion techniques (Task 9)
│   └── middleware/
│       ├── db.js           # PostgreSQL connection pool
│       ├── auth.js         # Phone OTP auth (Task 20)
│       └── analytics.js    # Funnel tracking (Task 21)
├── frontend/
│   └── public/
│       ├── index.html      # SPA shell (Tailwind CDN)
│       └── app.js          # Client-side router + all pages
├── Dockerfile              # Production Docker build
└── README.md
```

## 24 Tasks Implemented

All 24 tasks from the ScanGym research report, with CEO corrections applied:

1. AI Coach (gated after booking + QR check-in)
2. Google Places API search (cards: 1 photo + walking distance)
3. Smart filters
4. Peer reviews & ratings
5. Gamification badges
6. AI chat + gym owner escalation (SMS/email)
7. Personalised recommendations
8. Scrape + remix content for compliance
9. ALL 33 Booking.com persuasion techniques
10. Off-peak pricing (real-time live data)
11. Hybrid pricing (owner-set + auto-suggested)
12. 24hr day pass ONLY, 2-scan QR (JD Gym style)
13. Auto-generated FAQ
14. ScanGym Wallet with top-up bonuses
15. ScanSquad 4-tier program
16. ScanGym brand only, mascot FLEX
17. Community naming (deep research)
18. Creator landing pages at `/r/:slug`
19. Workout plan sharing
20. Phone OTP login
21. CEO Dashboard (full funnel analytics)
22. Multi-language support
23. Embedded Google Maps (no external links)
24. Three supplier pages (Vending, QR Scanners, Gym Loans)

## Deployment

Deployed on Railway via Docker. Push to `main` to auto-deploy.

### Environment Variables Required

```
DATABASE_URL=postgresql://...
PORT=5000
OPENAI_API_KEY=sk-...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_DAY_PASS_PRICE_ID=price_...
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_PHONE_NUMBER=...
GOOGLE_MAPS_API_KEY=AIza...
```
