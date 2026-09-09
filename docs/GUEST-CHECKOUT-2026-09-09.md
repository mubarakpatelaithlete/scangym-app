# Guest checkout, an escapable sheet, and the truth about SMS

_2026-09-09 — from the second customer test of scangym.com_

Two customer tests in a row ended the same way: card in hand, nothing to tap.
This change closes that, and fixes the two things that made the dead end worse —
a sheet that was hard to escape, and a sign-in code that could never arrive.

## 1. A visitor with a card can buy a pass

The server has been able to do this the whole time:

| endpoint | needs a session? | what it does |
| --- | --- | --- |
| `POST /api/bookings/guest-create` | no | pending booking from `{gymId, date, email}` |
| `POST /api/payment/create-intent` | no (session only adds card saving) | Stripe PaymentIntent |
| `POST /api/payment/confirm-intent` | no | QR, confirmation email, access credential |

Nothing in the web app called the first one. The one place that came close — the
`/checkout` landing page's Pay button — created the booking, then opened the
sign-in sheet instead of taking the money.

New `frontend/public/guest-checkout.js` is that missing path and nothing else:

- step 1 takes an email and creates the booking;
- step 2 shows **the amount the server returned for that booking** next to a
  Stripe card field, so the displayed price is the charged price by construction
  (no pass arithmetic in the browser — that is what sold a 3-day pass at the day
  rate);
- step 3 shows the QR on screen, says which inbox it went to, and only then
  offers an account ("save this pass"), where it costs nothing.

Wired in two places: the sign-in sheet's book mode now leads with
**Continue as guest — no account**, and `_checkoutPayBooking` pays instead of
redirecting.

## 2. Every sheet can be closed

The sign-in sheet had exactly one exit: a tap on the backdrop above the panel.
That works, but it is the one gesture nobody is told about, the strip shrinks to
a sliver when the panel is tall, and the three things people actually try all
failed — no ✕, Escape ignored, and the drag handle drawn at the top was
decoration. Tapping Book and changing your mind meant reloading the site.

New `frontend/public/sheet-dismiss.js` adds the missing half of a bottom sheet
in one reusable call:

```js
sgMakeSheetDismissible({ panel, onClose, isOpen });
```

It injects a real close button, closes on Escape (topmost sheet only), and
closes on a downward drag — but not when the panel is scrolled, so flicking
through a long form does not throw the sheet away.

## 3. When Twilio refuses, say something true

Production runtime logs had two failures wearing one message:

```
60200  Invalid parameter `To`: +447700900123
60605  The destination phone number has been blocked by Verify Geo-Permissions.
       GG is blocked for sms channel for all services
```

The first is a typo the customer can fix. The second is a setting in *our*
Twilio console: that region will never receive a code, so "Try again" is a lie
and the retry loop is the whole loss.

`server/lib/sms-error.js` classifies the provider's code into
`invalid_number` / `blocked_region` / `unavailable`, returns copy the customer
can act on (never the provider's text), and marks the cases that need a human.
A blocked region also logs one greppable line — with the region, not the
customer's number:

```
[SMS-BLOCKED] Twilio 60605 for +447xxx — sign-in by SMS is failing for real
customers. Check Twilio Console → Verify → Geo Permissions.
```

**Still needs a human:** enabling the destination countries in
Twilio Console → Verify → Geo Permissions. Nothing in this repo can do that.

And because SMS can be blocked at all, the sheet now offers
**"Email me a sign-in link instead"**, which calls the `/api/auth/send-link`
endpoint that has existed for months with no button anywhere.

## Tests

- `tests/guest-can-pay-without-an-account.test.js` — runs the real module in a
  minimal DOM with a stubbed Stripe: the three calls in order, the email carried
  through all three, the price coming from the server, a declined card that does
  not claim a pass, a failed booking that never asks for a card, and no sign-in
  sheet anywhere in the flow.
- `tests/every-sheet-can-be-closed.test.js` — gestures, not markup: ✕, Escape,
  a 200px swipe closes, a 20px drag does not, a scrolled panel is left alone,
  double-wiring does not stack handlers.
- `tests/sms-block-is-not-a-dead-end.test.js` — classification, no provider text
  in customer-facing copy, no full phone number in logs, and the route actually
  using the classifier.
- `tests/helpers/mini-dom.js` — the element model from `chat-agent-sheet.test.js`
  lifted out so more than one test can use it.

Each was mutation-checked: reverting the fix turns them red. Full suite 526
tests, 0 failures.

## Not in this change

Apple Pay / Revolut Pay for guests (the card element only does cards, though
`create-intent` already offers those methods), a confirmed bookable gym, and the
door guarantee.
