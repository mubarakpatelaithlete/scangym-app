/**
 * "Near me" has to do something, and it has to be honest about where it looked.
 *
 * Two bugs it used to have: it only searched when the screen was empty (tap it
 * with results already up and GPS off and nothing happened - a dead button),
 * and when it knew nothing it searched "gyms in London" and presented that as
 * near you. Best practice in every 2026 source on this: treat IP/defaults as a
 * prior, not a verdict - show the city, make the correction one tap - and treat
 * a denied permission as a normal path with a manual fallback, not an error.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(
  path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');

const findGyms = app.slice(
  app.indexOf('window.findGyms=function(){'),
  app.indexOf('window.openGym=async function'));

test('Near me always re-runs the search, empty screen or not', () => {
  assert.ok(findGyms.length > 0, 'findGyms not found');
  assert.ok(!/state\.gyms\.length===0/.test(findGyms),
    'Near me is gated on an empty list again, so a tap can do nothing visible');
  assert.match(findGyms, /searchGyms\(known\)/, 'Near me does not search the city it knows');
});

test('it prefers a city we can stand behind over the London default', () => {
  assert.match(findGyms, /_sgKnownCityQuery\(\)/, 'Near me no longer asks what city we know');
  const helper = app.slice(app.indexOf('function _sgKnownCityQuery()'),
                           app.indexOf('window._sgKnownCityQuery'));
  assert.match(helper, /sgChosenCity/, 'a city the visitor chose is not consulted first');
  assert.match(helper, /needs_confirmation/, 'an untrusted IP city is treated as known');
  assert.match(helper, /sg_gps/, 'the last GPS fix from a previous visit is ignored');
});

test('a guessed city is labelled, never passed off as "near you"', () => {
  assert.match(findGyms, /_sgSayItIsAGuess\(\)/, 'the London fallback is silent again');
  const say = app.slice(app.indexOf('function _sgSayItIsAGuess()'),
                        app.indexOf('window._sgSayItIsAGuess'));
  assert.match(say, /_injectLocationBanner\('denied'\)/,
    'nothing tells the visitor which city is on screen');
  assert.match(say, /_refreshLocationBanner/, 'the banner can go stale after a re-search');
  // The banner copy is what makes the guess self-explaining.
  assert.match(app, /Showing gyms in/, 'the banner no longer names the city');
  assert.match(app, /Not your area\? Tap to change/, 'the correction is not one tap away');
});

test('an untrusted IP city still asks instead of pretending', () => {
  assert.match(findGyms, /needs_confirmation&&!window\.sgChosenCity\(\)/,
    'a datacenter-town IP guess is accepted as the visitor location');
});

test('denied or unavailable GPS is a normal path with a way out', () => {
  const fire = app.slice(app.indexOf('function _fireGPS('), app.indexOf('function _startGPSWatch('));
  assert.match(fire, /_sgSayItIsAGuess\(\)/, 'a denied permission fails silently again');
  const watch = app.slice(app.indexOf('function _startGPSWatch('), app.indexOf('function _startGPSWatch(') + 600);
  assert.match(watch, /!navigator\.geolocation.*_sgSayItIsAGuess/s,
    'a browser with no geolocation gets no explanation and no picker');
});

test('the first-load default is labelled too, not just the button', () => {
  const auto = app.slice(app.indexOf('window.autoLoadGyms=async function'),
                         app.indexOf('window.autoLoadGyms=async function') + 4000);
  assert.match(auto, /_known\|\|'gyms in London'/, 'first load ignores the city we already know');
  assert.match(auto, /if\(!_known\)_sgSayItIsAGuess\(\)/, 'first load shows London unlabelled');
});
