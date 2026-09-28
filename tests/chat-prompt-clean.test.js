const test = require('node:test');
const assert = require('node:assert');
const { cleanPrompt } = require('../server/chatbot/chat-create');
const { scrub } = require('../server/lib/gen-provider');

test('cleanPrompt strips the chat command and model name', () => {
  assert.strictEqual(cleanPrompt('music', 'create music with Eleven Music of upbeat gym workout beat'), 'upbeat gym workout beat');
  assert.strictEqual(cleanPrompt('audio', 'create audio with ElevenLabs v3: Welcome to ScanGym'), 'Welcome to ScanGym');
  assert.strictEqual(cleanPrompt('image', 'create image with Nano Banana 2 of a boxer'), 'a boxer');
  assert.strictEqual(cleanPrompt('image', 'a boxer in a gym'), 'a boxer in a gym');
  assert.strictEqual(cleanPrompt('image', 'create image'), 'create image');
});

test('scrub turns fal detail arrays into readable text', () => {
  assert.match(scrub([{ msg: 'x', type: 'content_policy_violation' }]), /content checker/);
  assert.strictEqual(scrub([{ msg: 'too long' }]), 'too long');
  assert.doesNotMatch(scrub({ foo: 1 }), /object Object/);
});
