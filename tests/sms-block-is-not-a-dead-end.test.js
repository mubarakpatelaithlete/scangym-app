'use strict';

/**
 * When Twilio refuses, say something true.
 *
 * Production logs for the sign-in sheet held two different failures wearing one
 * message:
 *
 *   60200  Invalid parameter `To`: +447700900123
 *   60605  The destination phone number has been blocked by Verify
 *          Geo-Permissions. GG is blocked for sms channel for all services
 *
 * The first is a typo the customer can fix. The second is a setting in *our*
 * Twilio console: that region will never receive a code, however many times the
 * button is pressed, so "Try again" is a lie and the retry loop is the whole
 * loss. A blocked region has to be told the truth and handed another door, and
 * it has to be loud in the logs, because only a human with console access can
 * clear it.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { classifySmsFailure, alertLine } = require('../server/lib/sms-error');

const AUTH = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'auth.js'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'public', 'app.ctr576.js'), 'utf8');

test('a bad number is the customer\'s to fix', () => {
  const v = classifySmsFailure({ code: 60200, message: 'Invalid parameter `To`: +447700900123' });
  assert.equal(v.kind, 'invalid_number');
  assert.match(v.message, /country code/);
  assert.equal(v.alert, false, 'a typo should not page anyone');
});

test('a blocked region is told the truth, not "try again"', () => {
  const v = classifySmsFailure({ code: 60605, message: 'blocked by Verify Geo-Permissions. GG is blocked' });
  assert.equal(v.kind, 'blocked_region');
  assert.doesNotMatch(v.message, /try again/i, 'we told them to retry something that can never work');
  assert.match(v.message, /email/i, 'a blocked region was offered no other way in');
});

test('every other failure is honest about being ours, and offers a way round', () => {
  for (const code of [20003, 60999, undefined, 'weird']) {
    const v = classifySmsFailure({ code });
    assert.equal(v.kind, 'unavailable', `code ${code} was misfiled`);
    assert.match(v.message, /email|Google/i, `code ${code} left the visitor with nothing to try`);
    assert.equal(v.alert, true, `code ${code} should be visible in the logs`);
  }
});

test('the provider is never named to the visitor', () => {
  const codes = [60200, 60605, 60410, 60223, 20003, 999];
  for (const code of codes) {
    const { message } = classifySmsFailure({ code, message: 'Twilio Verify says no' });
    assert.doesNotMatch(message, /twilio|verify|60\d\d\d|parameter/i, `code ${code} leaked provider detail`);
  }
});

test('a blocked region leaves one greppable line, without the full number', () => {
  const line = alertLine({ code: 60605 }, '+447700900123');
  assert.match(line, /\[SMS-BLOCKED\]/);
  assert.match(line, /Geo Permissions/, 'the line does not say where to go and fix it');
  assert.match(line, /\+447xxx/, 'the region is not shown');
  assert.equal((line.match(/\d/g) || []).join('').length, 8, 'the line holds more digits than the code and the region');
  assert.doesNotMatch(line, /7700900123/, 'the log holds a full customer phone number');
});

test('send-code routes its failures through the classifier', () => {
  const route = AUTH.slice(AUTH.indexOf("router.post('/send-code'"), AUTH.indexOf("router.post('/verify'"));
  assert.ok(route.length > 100, 'could not find the send-code route');
  assert.match(route, /classifySmsFailure/, 'send-code still writes its own error copy');
  assert.match(route, /alertLine/, 'a blocked region would not be logged for an operator');
  assert.doesNotMatch(route, /We couldn't send your code just now\. Try again/,
    'the old "try again" copy is still hardcoded in the route');
  /* The provider's own text must never be handed to res.json. */
  assert.doesNotMatch(route, /error:\s*data\.message/, 'provider text is returned to the visitor');
});

test('the sheet offers a door that does not depend on SMS at all', () => {
  assert.match(APP, /_sgAuthEmailLink/, 'no email sign-in option exists in the sheet');
  assert.match(APP, /\/api\/auth\/send-link/, 'the email sign-in endpoint is still unreachable from the app');
});
