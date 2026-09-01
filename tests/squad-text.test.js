/**
 * The Text mode of the ScanSquad Create sheet.
 *
 * Seven of the eight Create modes were drawn but not built; they render a
 * "not switched on yet" banner because /api/squad-create/modes says
 * reason: 'not_built'. Text is the one that needed no new provider — the app
 * already runs an LLM with failover in lib/llm.js — so it ships first.
 *
 * The rule this file defends is the one squad-create.js was written around:
 * a control may not claim an action it cannot perform. That means the mode is
 * only offered when a provider really exists, and it means the sheet must
 * actually be able to display what the route returns.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const route = require(path.join(ROOT, 'server', 'routes', 'squad-text.js'));
const { clean, systemPrompt, MAX_PROMPT } = route._internals;
const SHEET = fs.readFileSync(
  path.join(ROOT, 'frontend', 'public', 'squad-create.js'),
  'utf8'
);
const REGISTRY = fs.readFileSync(
  path.join(ROOT, 'server', 'routes', 'squad-create.js'),
  'utf8'
);
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('settings are whitelisted, never passed through', () => {
  const out = clean({ prompt: 'hi', tone: 'Sarcastic', length: 'Infinite' });
  assert.strictEqual(out.tone, 'Punchy');
  assert.strictEqual(out.length, 'Short');

  const kept = clean({ prompt: 'hi', tone: 'Professional', length: 'Long' });
  assert.strictEqual(kept.tone, 'Professional');
  assert.strictEqual(kept.length, 'Long');
});

test('a prompt cannot be unbounded', () => {
  const out = clean({ prompt: 'x'.repeat(MAX_PROMPT + 500) });
  assert.strictEqual(out.prompt.length, MAX_PROMPT);
});

test('a missing prompt is caught before any provider is called', () => {
  assert.strictEqual(clean({ prompt: '   ' }).prompt, '');
  const src = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'squad-text.js'), 'utf8');
  const gen = src.slice(src.indexOf("router.post('/generate'"));
  const guard = gen.indexOf('if (!prompt)');
  const call = gen.indexOf('llm.streamChat');
  assert.ok(guard > -1 && guard < call, 'the empty-prompt guard must come before the model call');
});

test('the model is told the house facts, so it cannot invent an offer', () => {
  const sys = systemPrompt({ tone: 'Punchy', length: 'Short' });
  assert.match(sys, /no membership/i);
  assert.match(sys, /day passes/i);
  assert.match(sys, /Never invent prices/i);
});

test('the mode is only offered when a provider actually exists', () => {
  // Not a hardcoded env name: lib/llm.js accepts OpenAI or Groq, and naming one
  // variable would report a working mode as broken on a Groq-only deployment.
  assert.match(
    REGISTRY,
    /text:\s*\{[^}]*ready:\s*\(\)\s*=>\s*require\('\.\.\/lib\/llm'\)\.configured\(\)[^}]*api:\s*'\/api\/squad-text'/,
    'the text mode must report availability from llm.configured()'
  );
  assert.match(
    REGISTRY,
    /const ok = def\.ready \? !!def\.ready\(\) : !!process\.env\[def\.env\]/,
    'statusFor must support both a ready() predicate and a single env var'
  );
});

test('the route is mounted', () => {
  assert.match(SERVER, /app\.use\('\/api\/squad-text', squadTextRouter\)/);
});

test('the sheet can display what the route returns', () => {
  assert.match(
    SHEET,
    /key: 'text'[^}]*api: '\/api\/squad-text'/,
    'the text mode must point at its route'
  );
  assert.match(
    SHEET,
    /if \(res\.d\.text\)\s*\{\s*showText\(/,
    'a result that arrives in the POST response must be rendered, not polled for'
  );
  assert.match(SHEET, /function showText\(/, 'text needs its own renderer — it is read, not played');
  assert.match(SHEET, /navigator\.clipboard/, 'a caption must be copyable');
});

test('text history is not requested, because captions are not stored', () => {
  assert.match(
    SHEET,
    /if \(!mode\.api \|\| mode\.resultKind === 'text'\) return;/,
    'loadHistory must skip text rather than parse a video-shaped payload'
  );
});
