/**
 * A gym owner must never be told "unclaimed" and "already claimed" about the
 * same gym.
 *
 * Found while walking the Partner tab as the owner of a real Bharuch business
 * (17 Sep 2026), signed in on scangym.com:
 *   • GET /api/live/place/{placeId} answered `isClaimed: false` for gym 121,
 *     because it read `gyms.is_claimed` — a legacy flag no code ever sets.
 *   • POST /api/gym-partner/claim answered `409 already claimed` for the very
 *     same gym, because it reads `gyms.claimed_by` — the column the claim
 *     route actually writes and every partner query filters on.
 *   • That 409 carried no message and no way out, so the owner standing in
 *     their own gym had no next step.
 *   • The claim search sent no lat/lng, so a bare venue name answered with
 *     big-city gyms in the default region instead of the owner's own venue.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LIVE_SEARCH = read('server/routes/liveSearch.js');
const GYM_PARTNER = read('server/routes/gym-partner.js');
const PARTNER_UI = read('frontend/public/partner-editable.js');

test('one gym has one claimed state — claimed_by decides it', () => {
  assert.ok(
    /isClaimed:\s*!!\(dbGym\?\.claimed_by/.test(LIVE_SEARCH),
    'isClaimed must be derived from claimed_by, the column the claim route writes',
  );
  assert.ok(
    /SELECT[^;]*claimed_by[^;]*FROM gyms WHERE place_id/.test(LIVE_SEARCH),
    'the place lookup must actually select claimed_by',
  );
});

test('claiming a gym sets both the column and the legacy flag', () => {
  assert.ok(
    /UPDATE gyms SET claimed_by = \$1,\s*\n\s*is_claimed = TRUE/.test(GYM_PARTNER),
    'a claim should leave is_claimed consistent for any reader still using it',
  );
});

test('"already claimed" is never a dead end', () => {
  const block = GYM_PARTNER.slice(
    GYM_PARTNER.indexOf("error: 'This gym is already claimed'"),
  ).slice(0, 600);
  assert.ok(/book@scangym\.com/.test(block), 'tell the owner who to email');
  assert.ok(/message:/.test(block), 'send a human-readable message, not just an error code');
});

test('the claim search asks Google near the owner, not near the default city', () => {
  const block = PARTNER_UI.slice(PARTNER_UI.indexOf('_peClaimSearchInput'));
  assert.ok(
    /lat='\+encodeURIComponent\(_lat\)/.test(block) && /&lng='\+encodeURIComponent\(_lng\)/.test(block),
    'the claim search must pass lat/lng when the browser knows where the owner is',
  );
});
