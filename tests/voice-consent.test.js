/**
 * Live voice has to be predictable before it can be delightful.
 *
 * Seven behaviours were reported by the product owner after using it, and every one
 * of them is cheap to reintroduce by editing a single line. These tests read the
 * three files that own voice and pin each one:
 *
 *   1. it opened the microphone on a scroll
 *   2. "no" expired after 24 hours
 *   3. "no" was not recorded when the panel was closed
 *   4. it hard-muted the reel the customer was watching
 *   5. thinking was silent, indistinguishable from a broken microphone
 *   6. changing tab restarted the conversation instead of continuing it
 *   7. the microphone never timed out
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ALWAYS = read('frontend/public/voice-always.js');
const VOICE = read('frontend/public/voice.js');
const AGENT = read('frontend/public/chat-agent.js');

/** The body of a named function, so a match cannot come from an unrelated place. */
function fnBody(src, name) {
  const start = src.indexOf('function ' + name);
  assert.ok(start > 0, `expected a function named ${name}`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

test('1. scrolling a page is not a request to be listened to', () => {
  const body = fnBody(ALWAYS, 'armOnFirstTouch');
  assert.ok(!/['"]scroll['"]/.test(body), 'scroll must not arm the microphone');
  assert.ok(!/['"]wheel['"]/.test(body), 'wheel must not arm the microphone');
  assert.match(body, /pointerdown/, 'a deliberate tap still arms it');
  assert.match(body, /keydown/);
});

test('1b. a granted permission alone does not open the microphone on arrival', () => {
  const body = fnBody(ALWAYS, 'armIfAlreadyTrusted');
  assert.match(body, /hasUsedVoice\(\)/,
    'zero-click is for people who have actually held a conversation, not everyone who ever granted mic access');
  const guard = body.indexOf('hasUsedVoice()');
  const query = body.indexOf('navigator.permissions');
  assert.ok(guard < query, 'the check must come before we look at the permission');
});

test('2. "no" does not expire', () => {
  assert.match(ALWAYS, /OPT_OUT_KEY = 'sg_voice_off'/, 'a flag, not a deadline');
  const body = fnBody(ALWAYS, 'optOut');
  assert.ok(!/Date\.now\(\)\s*\+/.test(body), 'opt-out must not be stored as an expiry time');
  assert.match(body, /setItem\(OPT_OUT_KEY, '1'\)/);
  // Anyone opted out under the old scheme must not be re-armed when it lapses.
  assert.match(fnBody(ALWAYS, 'optedOut'), /LEGACY_OPT_OUT_KEY/, 'migrate the old 24-hour opt-out');
});

test('3. ending voice yourself is recorded, whichever way you do it', () => {
  const body = fnBody(AGENT, 'endLive');
  assert.match(body, /reason === 'user'/, 'endLive must distinguish who ended it');
  assert.match(body, /SGVoiceAlways\.userEnded/, 'and tell the arming layer');

  // Closing the panel by hand is a user decision; a route change is not.
  assert.match(AGENT, /pchat-close'\)\)\.onclick = function \(\) \{ close\('user'\); \}/);
  assert.match(AGENT, /if \(dy > h \/ 3 \|\| flick\) close\('user'\)/, 'swipe-to-dismiss counts');
  assert.match(AGENT, /if \(!onTab && S\.open\) close\('route'\)/, 'navigating away does not');
  assert.match(AGENT, /pchat-live-end'\)\)\.onclick = function \(\) \{ endLive\('user'\); \}/);
});

test('4. the reel is ducked, not muted, and only while we hold the floor', () => {
  const duck = fnBody(ALWAYS, 'duckAudio');
  assert.ok(!/\.muted\s*=\s*true/.test(duck), 'hard-muting the customer\'s video is what looked broken');
  assert.match(duck, /volume = Math\.min/, 'lower the volume instead');
  const unduck = fnBody(ALWAYS, 'unduckAudio');
  assert.match(unduck, /ducked\[i\]\.el\.volume = ducked\[i\]\.volume/, 'restore what it was, not 1.0');

  const holding = fnBody(ALWAYS, 'holdingFloor');
  assert.match(holding, /liveState\(\)/);
  assert.match(holding, /'thinking' \|\| st === 'speaking'/,
    'an armed but silent microphone must not touch the audio at all');
  assert.match(fnBody(ALWAYS, 'followLive'), /holdingFloor\(\)/);
});

test('5. thinking makes a sound', () => {
  assert.match(VOICE, /function playEarcon/);
  const setState = fnBody(VOICE, 'setState');
  assert.match(setState, /state === 'thinking' && was !== 'thinking'/,
    'once per turn, on the transition — not on every re-entrant call');
  assert.match(setState, /playEarcon\(\)/);
  // Synthesised, so it cannot 404 and costs no request.
  assert.match(fnBody(VOICE, 'playEarcon'), /createOscillator/);
});

test('6. changing tab carries the conversation, not just the microphone', () => {
  const body = fnBody(ALWAYS, 'followTabs');
  assert.match(body, /exportHistory/, 'take the transcript from the leaving agent');
  assert.match(body, /importHistory/, 'and give it to the arriving one');
  assert.match(body, /endLive\('handover'\)/, 'a tab change is not the customer saying no');

  assert.match(AGENT, /exportHistory: function/);
  assert.match(AGENT, /importHistory: function/);
  // Never overwrite a conversation that already exists in the target agent.
  const imp = AGENT.slice(AGENT.indexOf('importHistory: function'));
  assert.match(imp.slice(0, 500), /if \(S\.msgs\.length\) return;/);
});

test('7. an idle microphone hands itself back', () => {
  assert.match(VOICE, /IDLE_END_MS = 120000/, 'two minutes of silence');
  const tick = fnBody(VOICE, 'tick');
  assert.match(tick, /now - live\.lastVoiceAt > IDLE_END_MS/);
  assert.match(tick, /!holding &&/, 'never mid-answer');
  assert.match(tick, /stopLive\(\)/);
  // And it is not a decision, so it must not be remembered as one.
  const idle = AGENT.slice(AGENT.indexOf('onIdleEnd'));
  assert.match(idle.slice(0, 400), /endLive\('idle'\)/);
  assert.ok(!/onIdleEnd[\s\S]{0,300}userEnded/.test(AGENT), 'timing out is not opting out');
});

test('a spoken turn is what earns the zero-click open', () => {
  assert.match(AGENT, /SGVoiceAlways\.markUsed\(\)/);
  assert.match(ALWAYS, /markUsed: function/);
  assert.match(ALWAYS, /USED_KEY = 'sg_voice_used'/);
  // Tapping the mic is an explicit yes and clears a previous no.
  assert.match(fnBody(AGENT, 'toggleMic'), /SGVoiceAlways\.optIn/);
});
