'use strict';
/**
 * Every button that shows a success toast must actually do the thing.
 *
 * Found in a button-by-button audit of the Trello "Buttons" list: Partner
 * Hours/Facilities "Save" only closed the sheet and toasted; the Photos page
 * showed stock photos with invented usernames and "Link copied!" that copied
 * nothing; the Music page listed chart songs with no audio behind them; the
 * Profile rail's "Pricing" opened the login page; and every gym — including
 * unclaimed Google Maps listings — said "Your ScanGym pass works here ✓".
 *
 * Two server holes came out of the same audit: any logged-in account could
 * rewrite any gym's hours (/api/gym-mgmt) and amenities (/api/amenities).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const app = read('frontend/public/app.ctr576.js');
const gymPartner = read('server/routes/gym-partner.js');
const gymMgmt = read('server/routes/gym-management.js');
const amenities = read('server/routes/amenities.js');

function body(src, startMarker) {
  const i = src.indexOf(startMarker);
  assert.ok(i >= 0, `missing ${startMarker}`);
  const next = src.indexOf('\nwindow.', i + 10);
  return src.slice(i, next < 0 ? undefined : next);
}

test('Partner "Save Hours" sends the hours to the server instead of only toasting', () => {
  const hours = body(app, 'window._partnerSaveHours=');
  assert.match(hours, /fetch\('\/api\/gym-partner\/update-gym'/);
  assert.match(hours, /openingHours:hours/);
  const sheet = body(app, 'window._partnerEditHours=');
  assert.doesNotMatch(sheet, /sgToast\(\\?'Hours updated!/, 'the old fake toast is gone');
  assert.match(sheet, /_partnerSaveHours\(\)/);
  assert.match(sheet, /gd\.openingHours/, 'sheet is pre-filled from the saved hours');
});

test('Partner "Save Facilities" sends the facilities to the server instead of only toasting', () => {
  const save = body(app, 'window._partnerSaveFacilities=');
  assert.match(save, /fetch\('\/api\/gym-partner\/update-gym'/);
  assert.match(save, /amenities:amenities/);
  const sheet = body(app, 'window._partnerEditFacilities=');
  assert.doesNotMatch(sheet, /Facilities updated!/);
  assert.match(sheet, /_partnerSaveFacilities\(\)/);
});

test('update-gym accepts openingHours/is24h/amenities and validates them', () => {
  assert.match(gymPartner, /const \{ gymId, name, address, description, pricing, photos, openingHours, is24h, amenities \}/);
  assert.match(gymPartner, /function normaliseOpeningHours/);
  assert.match(gymPartner, /function normaliseAmenities/);
  assert.match(gymPartner, /TIME_RE = \/\^\(\[01\]\\d\|2\[0-3\]\):\[0-5\]\\d\$\//);
  // Writes stay behind the ownership check that opens the route
  assert.match(gymPartner, /UPDATE gyms SET opening_hours[\s\S]*claimed_by::text = \$4::text/);
  assert.match(gymPartner, /INSERT INTO gym_amenities[\s\S]*ON CONFLICT \(gym_id\)/);
  // Dashboard returns them so the sheets can pre-fill
  assert.match(gymPartner, /openingHours: g\.id === primaryGym\.id \? openingHours/);
  assert.match(gymPartner, /amenities: g\.id === primaryGym\.id \? amenitiesOut/);
});

test('gym-mgmt writes are owner-only, not just logged-in', () => {
  const mw = gymMgmt.slice(gymMgmt.indexOf('async function requireAuth'), gymMgmt.indexOf('\n}\n', gymMgmt.indexOf('async function requireAuth')));
  assert.match(mw, /claimed_by::text = \$2::text/);
  assert.match(mw, /status\(403\)/);
  assert.doesNotMatch(gymMgmt, /^function requireAuth\(req, res, next\) \{\n  if \(!req\.session\?\.userId\)[^]*?\n  next\(\);\n\}/m,
    'the old three-line requireAuth that never checked the gym is gone');
});

test('amenities PUTs compare the owner instead of fetching and ignoring it', () => {
  assert.match(amenities, /async function requireGymOwner/);
  assert.match(amenities, /String\(gym\.rows\[0\]\.claimed_by \|\| ''\) !== String\(req\.session\.userId\)/);
  assert.match(amenities, /router\.put\('\/:gymId', requireGymOwner,/);
  assert.match(amenities, /router\.put\('\/:gymId\/vending', requireGymOwner,/);
});

test('signed-out Profile rail has no Find Gym / Pricing / Creator (owner, 2026-09-26)', () => {
  const a = app.indexOf('RIGHT-SIDE BUTTONS \u2014 TikTok style', app.indexOf('function MoreHubPage()'));
  const rail = app.slice(a, app.indexOf('BOTTOM \u2014 Stats + CTA', a));
  assert.ok(a > 0 && rail.length > 0);
  for (const lbl of ['Find Gym', 'Pricing', 'Creator']) assert.ok(!rail.includes('>' + lbl + '</span>'), lbl + ' is back');
  assert.match(rail, />Help<\/span>/);
});

test('Photos page shows real gym photos, not stock shots with fake users', () => {
  const photos = app.slice(app.indexOf('function _sgGymPhotos'), app.indexOf('// Photo slide helpers'));
  assert.doesNotMatch(photos, /images\.unsplash\.com/);
  assert.doesNotMatch(photos, /@fitking_23|@sarah_gains|likesN/);
  assert.match(photos, /photos_list/, 'uses the Places photos already loaded for the gyms');
  assert.match(photos, /Photo via Google Maps/);
  // The rail buttons on each slide are the real ones
  assert.match(photos, /window\._sgShareGymLink\(/);
  assert.match(photos, /window\._sgSaveGym\(/);
  assert.match(photos, /openGymDirectOverlay\(/);
  assert.doesNotMatch(photos, /sgToast\(\\'📤 Link copied!/);
  assert.doesNotMatch(photos, /sgToast\(\\'🔖 Saved!/);
});

test('Music page only lists tracks that ship with audio', () => {
  const music = app.slice(app.indexOf('function MusicTabPage'), app.indexOf('// ── State ──', app.indexOf('function MusicTabPage')));
  const tracks = music.match(/\{n:'/g) || [];
  const withAudio = music.match(/audio:'\/audio\//g) || [];
  assert.ok(tracks.length > 0);
  assert.equal(tracks.length, withAudio.length, 'every listed track has an audio file');
  for (const m of music.matchAll(/audio:'(\/audio\/[^']+)'/g)) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'frontend/public', m[1])), `${m[1]} exists`);
  }
  assert.doesNotMatch(music, /Eminem|AC\/DC|Dua Lipa|Metallica|Kanye/);
});

test('"Your ScanGym pass works here" is only claimed for claimed gyms', () => {
  assert.match(app, /\$\{gym\.isClaimed\|\|gym\.is_claimed\|\|gym\.claimed_by\?'Your ScanGym pass works here ✓':'Listed from Google Maps/);
  assert.equal((app.match(/Your ScanGym pass works here ✓/g) || []).length, 2);
  assert.match(app, /\(\(gym\.isClaimed\|\|gym\.is_claimed\|\|gym\.claimed_by\)\?'Your ScanGym pass works here ✓'/);
});

test('review "Share" shares or copies a real link', () => {
  assert.match(app, /window\._sgShareReview=function\(reviewId\)/);
  assert.match(body(app, 'window._sgShareReview='), /navigator\.share|navigator\.clipboard\.writeText/);
  assert.doesNotMatch(app, /onclick="event\.stopPropagation\(\);sgToast\('Link copied!','info',2000\)"/);
});
