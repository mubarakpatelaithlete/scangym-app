/**
 * The city on the screen must be the city the visitor asked for.
 *
 * Observed on the live site (8 Sep 2026), UK visitor, no GPS:
 *   • first load resolved to "Boardman" (the AWS us-west-2 town, pop. 4,000)
 *     and showed two gyms 34–43 km away priced in dollars;
 *   • after choosing Manchester, the location banner still read "Showing gyms
 *     in Boardman", the sticky CTA still read "Book in Boardman", and the
 *     search sheet opened pre-filled with "gyms in Boardman".
 *
 * These tests pin the two rules that fix it:
 *   1. An IP-derived hosting-region city is flagged, never asserted.
 *   2. A city the visitor chose outranks every guess, everywhere it is shown.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'frontend/public/app.ctr576.js'), 'utf8');
const GEO = fs.readFileSync(path.join(ROOT, 'server/routes/geolocation.js'), 'utf8');

test('hosting-region cities are recognised', () => {
  // Loaded without express so the module list stays cheap: pull the set out of
  // the source instead of requiring the router.
  const match = GEO.match(/const DATACENTER_CITIES = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(match, 'geolocation.js must define DATACENTER_CITIES');
  const cities = match[1].toLowerCase();
  for (const city of ['boardman', 'ashburn', 'the dalles', 'council bluffs', 'eemshaven']) {
    assert.ok(cities.includes(`'${city}'`), `${city} should be treated as a datacenter city`);
  }
});

test('an untrustworthy IP city is flagged for confirmation, not asserted', () => {
  assert.ok(/needs_confirmation: datacenter/.test(GEO),
    'auto-city must flag datacenter cities with needs_confirmation');
  assert.ok(/if \(!datacenter\) recordLocationForPrediction/.test(GEO),
    'a datacenter city must not be learned as the visitor\'s home city');
  assert.ok(/confidence: 'none', needs_confirmation: true/.test(GEO),
    'the London placeholder must not present itself as a detected city');
});

test('the client refuses to label the screen with an unconfirmed city', () => {
  assert.ok(/cityData\.needs_confirmation&&!window\.sgChosenCity\(\)/.test(APP),
    'the location cascade must skip cities the server could not stand behind');
  assert.ok(/c\.city&&!c\.needs_confirmation/.test(APP),
    'sgCurrentSearchCity must ignore unconfirmed cached cities');
});

test('an explicit choice is stored and outranks the IP guess', () => {
  assert.ok(/window\.sgSetChosenCity=function/.test(APP), 'sgSetChosenCity must exist');
  assert.ok(/window\.sgChosenCity=function/.test(APP), 'sgChosenCity must exist');
  // doSearch records the choice
  const doSearch = APP.slice(APP.indexOf('window.doSearch=function'), APP.indexOf('window.doSearch=function') + 1200);
  assert.ok(doSearch.includes('sgSetChosenCity'),
    'doSearch must record the city the visitor searched for');
  // and every consumer reads it first
  const localOffer = APP.slice(APP.indexOf('window._sgLocalOffer=function'), APP.indexOf('window._sgLocalOffer=function') + 900);
  assert.ok(localOffer.includes('sgChosenCity'),
    'the reels CTA ("Book in <city>") must prefer the chosen city');
  const currentCity = APP.slice(APP.indexOf('function sgCurrentSearchCity()'), APP.indexOf('function sgCurrentSearchCity()') + 700);
  assert.ok(currentCity.indexOf('sgChosenCity') < currentCity.indexOf('getCachedLocation'),
    'sgCurrentSearchCity must check the chosen city before the IP cache');
});

test('the banner text can be updated after a city change', () => {
  assert.ok(/window\._refreshLocationBanner=function/.test(APP),
    'the banner must be refreshable in place, not written once at injection');
  assert.ok(/data-sg-loc-title/.test(APP) && /data-sg-loc-sub/.test(APP),
    'banner title/subtitle need stable hooks for the refresh');
  const setter = APP.slice(APP.indexOf('window.sgSetChosenCity=function'), APP.indexOf('window.sgSetChosenCity=function') + 700);
  assert.ok(setter.includes('_refreshLocationBanner') && setter.includes('_sgRefreshCtaText'),
    'choosing a city must refresh both the banner and the sticky CTA');
});

test('the search sheet does not pre-fill our guess as typed text', () => {
  const overlay = APP.slice(APP.indexOf('window._openSearchOverlay=function'));
  const inputTag = overlay.slice(overlay.indexOf('id="sso-search-input"') - 200, overlay.indexOf('id="sso-search-input"') + 400);
  assert.ok(!/value="'\+state\.searchQuery/.test(inputTag),
    'the search field must open empty — the current city belongs in the placeholder');
  assert.ok(/showing '\+_placeholderCity|_placeholderCity/.test(overlay),
    'the current city should appear as placeholder text');
});
