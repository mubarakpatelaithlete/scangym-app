'use strict';

/**
 * Signing in must never hand the customer back to tapping.
 *
 * The product's promise is that you say what you want and it happens. Sign-in was
 * the one place that broke: the Partner and ScanSquad agents sit behind
 * authenticateUser, so an anonymous visitor got a 401, and the browser printed a
 * static "please sign in" line and stopped. There was no way to sign in by voice
 * on those tabs at all — verified live: `/api/book/agent` answers anonymous
 * callers with 200, `/api/squad/agent` and `/api/partner/agent` both return 401.
 *
 * The server already knows how to do this: `send_login_code` and
 * `confirm_login_code` are in the Book agent's PUBLIC_TOOLS, and its prompt tells
 * it to ask for a number and take the six digits back. The gap was purely that a
 * 401 gave up instead of asking that agent for help.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public');
const agentRaw = fs.readFileSync(path.join(PUBLIC, 'chat-agent.js'), 'utf8');
// Structural assertions run against comment-stripped source: this change is heavily
// commented, and a fixed-size window after the 401 check otherwise lands inside the
// explanation rather than the code it explains.
const agent = agentRaw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const PERSONALITIES = [
  'book-chat.js',
  'squad-chat.js',
  'partner-chat.js',
  'reels-chat.js',
  'profile-chat.js',
];

test('a 401 hands the turn to the agent that can sign people in', () => {
  assert.ok(/LOGIN_ENDPOINT\s*=\s*'\/api\/book\/agent'/.test(agent),
    'the login fallback must point at the public Book agent');
  const handler = agent.slice(agent.indexOf('res.status === 401'), agent.indexOf('res.status === 401') + 400);
  assert.ok(/stream\(body,\s*LOGIN_ENDPOINT\)/.test(handler),
    'a 401 must retry the turn against the login endpoint');
});

test('the hand-off cannot loop', () => {
  // A 401 from the fallback itself would otherwise bounce between endpoints forever.
  assert.ok(/loginHandoffUsed:\s*false/.test(agent), 'the guard must be initialised');
  const at = agent.indexOf('res.status === 401');
  const handler = agent.slice(at, at + 400);
  assert.ok(/!S\.loginHandoffUsed/.test(handler), 'the guard must be checked');
  assert.ok(/S\.loginHandoffUsed\s*=\s*true/.test(handler), 'the guard must be set');
  assert.ok(/endpoint !== LOGIN_ENDPOINT/.test(handler),
    'the Book agent must not hand off to itself');
});

test('stream() can be pointed at another endpoint', () => {
  assert.ok(/function stream\(body,\s*endpointOverride\)/.test(agent),
    'stream must accept an endpoint override');
  assert.ok(/fetch\(endpoint,/.test(agent), 'stream must fetch the resolved endpoint');
  assert.ok(!/fetch\(cfg\.endpoint,/.test(agent),
    'stream must not ignore the override by fetching cfg.endpoint directly');
});

test('no personality tells the customer to go and sign in elsewhere', () => {
  // The old copy deflected ("Sign in and I can book that for you"), which reads as
  // a wall. Every signed-out line should instead start the spoken login.
  for (const file of PERSONALITIES) {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    const m = /signedOutReply:\s*([\s\S]{0,180}?),\n/.exec(src);
    if (!m) continue;
    const reply = m[1];
    assert.ok(
      /number|email/i.test(reply),
      `${file}: signedOutReply should ask for a number or email, got ${reply.trim()}`,
    );
    assert.ok(
      !/^\s*['"]Sign in and I can/.test(reply),
      `${file}: signedOutReply still deflects instead of signing them in`,
    );
  }
});

test('the login tools are labelled while they run', () => {
  // Otherwise the customer hears silence while a code is being texted.
  const book = fs.readFileSync(path.join(PUBLIC, 'book-chat.js'), 'utf8');
  const profile = fs.readFileSync(path.join(PUBLIC, 'profile-chat.js'), 'utf8');
  for (const [name, src] of [['book-chat.js', book], ['profile-chat.js', profile]]) {
    assert.ok(/send_login_code:/.test(src), `${name} must label send_login_code`);
    assert.ok(/confirm_login_code:/.test(src), `${name} must label confirm_login_code`);
  }
});

test('no personality asks for a password or card number', () => {
  // The server refuses to take either by voice; the client must not invite them.
  for (const file of PERSONALITIES) {
    const src = fs.readFileSync(path.join(PUBLIC, file), 'utf8');
    assert.ok(!/say your password|your password/i.test(src), `${file} must never ask for a password`);
    assert.ok(!/card number/i.test(src), `${file} must never ask for a card number`);
  }
});
