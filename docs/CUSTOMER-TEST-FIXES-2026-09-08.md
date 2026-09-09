# Customer test, 8 Sep 2026 — what was fixed and what is still open

A first-time-customer pass over the live site (116 checks: mobile 414×896 and
desktop 1440×900, the booking funnel, reels, the assistant, the creator and
partner funnels, the public APIs, performance, accessibility and SEO). The
tester never completed a booking. This file records what the four commits on
`fix/customer-test-findings` changed, and — more importantly — what they did
not, so nobody assumes the funnel is fixed.

## Fixed

| # | Symptom seen by the customer | Root cause | Fix |
| --- | --- | --- | --- |
| 1 | Pass sheet showed Weekly **£22.45** / Monthly **£44.90**; Stripe charges **£22.49** / **£44.99**. Couple showed £8.08 against a £7.63 charge | The browser multiplied the day price (4.49 × 5); the pricing engine multiplies *and then* charm-rounds | `frontend/public/pass-math.js` — one implementation, required by the server engine and loaded by the browser. `sgGymPass()` replaces every hand-rolled multiplier |
| 2 | "Save 20% / 43% / 67%" on passes worth 10% / 28% / 66% | Marketing numbers typed into the markup | Savings derived from the multipliers |
| 3 | "100% of visitors come back again" (sample: 1), "#1 most booked gym in Bolton" (platform bookings: 0), "✅ Verified ScanGym partner gym" (claimed gyms: 0), "popular time — 0 people already booked today", "First visit: 50% off" with nothing to redeem it | `conviction.js` techniques generated copy from defaults and unguarded percentages | Every signal now requires real data; verified/insurance badges require `claimed_by` + access/ownership verification; the 50% default is gone |
| 4 | "🎉 50% off applied!" then charged full price | `/api/promo/validate` does not exist; the client fell back to a hardcoded code table and applied a cosmetic discount | Fallback deleted; the promo field is hidden unless `/api/config` reports `promoCodes` (`PROMO_CODES_ENABLED`) |
| 5 | "Showing gyms in Boardman" (AWS us-west-2 town) with gyms 34–43 km away in dollars; the banner and the sticky CTA kept saying Boardman after the customer chose Manchester; the search sheet opened pre-filled with "gyms in Boardman" | IP geolocation treated as fact; the banner was written once at injection; the reels CTA read the IP cache | `DATACENTER_CITIES` + `needs_confirmation` on the server; `sgSetChosenCity()`/`sgChosenCity()` as the one authoritative city on the client; banner refreshable in place; search sheet opens empty with the city as placeholder |
| 6 | Dialling code defaulted to 🇺🇸 +1 while browsing UK gyms in £ | Country came from the same bad IP | Browser locale first, confident geo hint second, GB last |
| 7 | "123" as a phone number returned `Invalid parameter To: +44123` | No client validation; the provider's error was returned verbatim | Validation in the sheet and E.164 validation on `/api/auth/send-code`; provider text logged, never returned |
| 8 | `/admin` rendered its full shell (tiles, live counters) with no session | The route only served the file | `/admin`, `/admin/uploads`, `/ceo-dashboard` require a session and `ADMIN_USER_IDS` when set |
| 9 | `/pricing`: "LIVE PRICING · changes by time of day" vs FAQ "same price any time of day"; "Basic £4.49" and "Standard £4.49" with different features | Copy predates flat pricing (engine v4.1); tiers were pass lengths with product-tier names | Copy matches the engine; tiers named and priced as Day / 3-Day / Weekly / Monthly from `sgPrice()` |
| 10 | "guest checkout available" (`/how-it-works`), "account is created automatically" (`/my-bookings`) | Copy describing a flow that was deleted (`app.ctr576.js` notes the removal) | Copy now describes what actually happens |
| 11 | Creator library advertised as 440+, 388+ and 242+ assets | Three hardcoded numbers | `frontend/public/squad-config.js` |
| 12 | Date sheet printed `U0001F7E1 Moderate` | `\U0001F7E1` is a Python escape, not JavaScript | `\u{1F7E1}` |
| 13 | No `<h1>` in the document | Headings render client-side | One clipped `<h1>` in the shell |

Tests added (`node --test tests/*.test.js`):

- `tests/displayed-price-is-charged-price.test.js` — every pass type at five day
  prices must display exactly what the engine charges; no file under
  `frontend/public` may multiply a day price by hand again.
- `tests/chosen-city-wins.test.js` — hosting-region cities are flagged not
  asserted, and an explicit city choice outranks every guess everywhere.
- `tests/one-claim-one-number.test.js` — no time-of-day pricing copy, no two
  tiers at one price, no guest-checkout promise, one asset count, an `<h1>`,
  phone validation before the provider, gated internal pages, no Python escapes.

## Not fixed — deliberately, and why

1. **You still cannot buy a pass without signing in.** Guest checkout is a
   product decision plus a payment-flow change (Apple Pay → QR by email →
   account created silently). The dishonest copy is gone, but the wall is
   still the biggest single drop-off in the funnel.
2. **No gym is verifiably bookable.** 1.2M listings, 0 claimed. The badge is
   now truthful, which means it renders for nobody until an owner claims a
   listing and access is verified. Ten confirmed Manchester gyms would change
   the product more than every fix in this branch.
3. **No door guarantee.** "Turned away? Instant refund + credit" would remove
   the objection that stopped the tester buying. Needs a policy decision.
4. **No gym detail page before payment** — hours, kit list, entry
   instructions, cancellation terms. Tapping a card still does nothing.
5. **No SSR and a 7-URL sitemap.** `/gym/1` ships ~135 characters of text, so
   there is nothing to index for "day pass gyms in Manchester". Needs
   server-rendered city and gym pages.
6. **Desktop is still broken** — the 1440px hero is a black canvas with a
   YouTube "sign in to confirm you're not a bot" panel; `/explore` is a
   centred phone column.
7. **Third-party creator clips** (Huberman, Goggins, Hormozi, a YouTube
   Short) are self-hosted on the CDN under a page that says "COPYRIGHT-FREE".
   That is a legal decision, not a code change: replace them with own footage.
8. **`/api/config` exposes the Maps key** (public by design) — confirm
   HTTP-referrer restrictions are set in Google Cloud.
9. **Filters row renders off-screen** at the bottom of the results page and is
   unreachable in normal use; keyboard navigation stops after 8 tab stops
   (cards, rail icons and filters are not focusable).
10. **The assistant shows "× Searching gyms — did not finish"** on answers that
    did in fact succeed; a Tokyo query stalled past 10s.
