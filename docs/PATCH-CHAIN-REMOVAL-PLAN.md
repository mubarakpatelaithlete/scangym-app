# Removing the patch chain

> Goal 1 — "remove old / overlapping code across the 5 tabs".
> Written 2026-09-01. Measurements taken from `main` at commit `6decf47`.

The frontend is `app.ctr576.js` (20,633 lines) plus **15 patch scripts that run after it
and edit what it produced**. This document is the removal plan: what is actually there,
what each file is doing, what can go, and in what order — so this becomes a sequence of
small, testable changes rather than an archaeology project.

## 1. What is actually loaded

`index.html` loads, in order (after the bundle):

| Script | Lines | What it is |
|---|---:|---|
| `app-patches.js` | 1,225 | Feature patches #4–#49: USP copy, filters, Mapbox overlay, Reels→booking |
| `app-patches-v3.js` | 35 | USP banner + **dead** owner quick-controls *(removed in phase 1)* |
| `continue-cta-flow.js` | 706 | Progressive "Continue" CTA for Partner + Creator |
| `tabs-v4.js` | 300 | Right-rail half sheets, Book prefetch, ScanSquad branding, deep links |
| `round2.js` | 168 | Partner/ScanSquad branding polish, share = affiliate link, withdraw fixes |
| `round3.js` | 67 | Moves 4 tabs out of the bottom bar into the Reels right rail |
| `ui-polish.js` | 137 | Re-icons the rails, collapses 9–10 buttons behind "More" |
| `phase2-improvements.js` | 440 | Lazy images, toasts, `switchTab`/`openGym`/`fetch` wrappers |
| `round4-ui.js` | 141 | Removes a logo square, neutralises "More", adds booking summary |
| `round5-ui.js` | 82 | Labels rail icons, merges duplicate buttons |
| `batch2.js` | 285 | Review prompt, gym online/offline toggle, one-tap rebook, review replies |
| `batch3.js` | 344 | Ownership proof, Stripe Identity step-up, withdrawal fix |
| `batch4.js` | 44 | "Door unlocked" line on a valid QR scan |
| `ux-v5-improvements.js` | 637 | Smart-lock setup flow (Seam iframe, PIN polling) |
| `sg-dock.js` | 173 | Bottom dock |

**5,100+ lines of patch layered on 20,633 lines of bundle.** Four tests
(`patch-chain`, `one-cta`, `one-orange`, `one-version`) exist only to stop this layer
re-introducing bugs it has caused before.

## 2. Three measurable costs

**a. Sixteen globals are assigned by more than one file.** The last file to load wins,
and load order is `index.html` document order — so behaviour depends on a list in an HTML
file, not on any code you can read in one place:

| Global | Assigned by |
|---|---|
| `switchTab` | `app.ctr576.js`, `app-patches.js`, `phase2-improvements.js` |
| `_partnerGymId` | bundle + `batch2`, `batch3`, `continue-cta-flow`, `ux-v5` |
| `window.fetch` | `phase2-improvements.js` **and** `nps-survey.js` (double-wrapped) |
| `sgToast`, `openGym`, `openGymOverlay`, `_sgShowAuthSheet`, `showBookingCheckout`, `sgVerifyQR`, `_sgSubmitRating`, `_sgSelectStar`, `_partnerViewReviews`, `_sgSeamConnectExisting`, `_partnerConnectSeam`, `_showPartnerScreen`, `_sgAuthAfterSuccess` | bundle + one patch each |

**b. ~66 timer callbacks per second, forever.** Most patches keep their DOM edits alive by
re-applying them on an interval, and almost none call `clearInterval`:

| File | Intervals (ms) | Cleared? |
|---|---|---|
| `ux-v5-improvements.js` | 300, 300, 3000, 300, 3000, 1000, 200, 1500, 300, 1000 | partly (12 clears) |
| `continue-cta-flow.js` | 200, 300 | 1 |
| `tabs-v4.js` | 700, 600, 600, 400 | **no** |
| `round2.js` | 400, 1000, 700 | **no** |
| `batch2.js` | 800, 700, 900, 900 | **no** |
| `batch3.js` | 800, 900 | **no** |
| `app-patches.js` | 2000, 5000, 1000, 250 | partly |
| `round3/ui-polish/round4/round5/batch4/sg-dock` | 400, 600, 600, 600, 800, 500 | **no** |

Each tick runs `querySelector`-and-repaint work whether or not anything changed. On a
mid-range phone this is a background tax on every session, and it is why UI fixes here
have to be written as "re-apply every 600ms" in the first place.

**c. Two render paths for the same card.** `ui-polish.js` says it patches the DOM because
"cards are rebuilt by two separate template paths in the app bundle". The patch layer
exists partly to paper over a duplication *inside* the bundle.

## 3. What must not be lost

Every one of these files ships behaviour someone asked for. This is not dead code with a
few live bits; it is live code in the wrong shape. The plan is therefore **fold in, then
delete** — never "delete and see". Two exceptions, both proven dead, go in phase 1.

Non-negotiables: the four policing tests keep passing; no phase changes what the user
sees; each phase is one PR that can be reverted alone.

## 4. Phases

### Phase 1 — delete what is provably dead *(done, this PR)*

- `app-patches-v3.js`: `addOwnerControls()` targets `#sg-owner-controls` /
  `[class*="owner-controls"]`, which **exists nowhere** in the app, and calls
  `PUT /api/gym-mgmt/:id/quick-toggle` and `/quick-price`, which **exist nowhere** on the
  server. It installs a `MutationObserver` on `document.body` with `subtree: true` for
  every visitor on every page, to inject a panel that can never appear. Deleted; the file
  keeps its one live job (the USP banner) and is renamed in spirit to what it is.
- Pinned by `tests/no-dead-patches.test.js`.

### Phase 2 — one owner per global (no behaviour change)

For each of the 16 layered globals, move the final implementation into the bundle and
delete the override. Start with the three-way ones (`switchTab`) and the `fetch`
double-wrap, which is the only one that can affect *every* request in the app.
Verification: the function bodies must be byte-identical to the last-writer version.

### Phase 3 — one enhancer tick

Replace the 20-odd independent intervals with a single shared scheduler that runs the
registered enhancers once per animation frame *after a render*, driven by the app's
existing render hook rather than by wall-clock polling. Same edits, ~1 tick per render
instead of ~66 per second.

### Phase 4 — fold the UI-only patches into the templates

`round2`, `round3`, `round4-ui`, `round5-ui`, `ui-polish` are all "the template drew the
wrong thing, fix it afterwards". Each one becomes an edit to the template that draws it,
which also removes the second render path `ui-polish.js` complains about. Do these one
file per PR, smallest first.

### Phase 5 — promote the feature patches to modules

`batch2`, `batch3`, `batch4`, `ux-v5-improvements`, `continue-cta-flow`, `app-patches` are
real features. They stop being patches and become named modules with their own entry
points, loaded through `sg-chunk-loader.js` for the tab that uses them — which is the
system this codebase already built and trusts.

## 5. Order of value

Phase 1 (dead weight) → phase 3 (battery/CPU, no UI risk) → phase 2 (predictability) →
phase 4 (visual, one file at a time) → phase 5 (structure). Phases 1–3 are safe to do
back to back; phases 4–5 want a device check per PR.
