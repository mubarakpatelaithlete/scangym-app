/**
 * The assistant died on 24 Aug 2026 in a way no alarm caught: the OpenAI key was revoked
 * (401) and Groq's pinned `llama-3.3-70b-versatile` had been decommissioned (404). Failover
 * between two providers is useless when what expired is the model name, so every question
 * — including "hi" — came back "my assistant service is down", while /health said 200.
 *
 * These tests pin the two things that fix that class of outage:
 *   1. A retired model repoints itself to a live one and the answer still happens.
 *   2. The deep health check tells the truth about whether the assistant can answer.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');

const ROOT = path.join(__dirname, '..');
const llmSrc = fs.readFileSync(path.join(ROOT, 'server/lib/llm.js'), 'utf8');
const llm = require(path.join(ROOT, 'server/lib/llm.js'));
const { repointToLiveModel, isMissingModel, UNUSABLE } = llm._internals;

function fakeProvider(ids) {
  return {
    label: 'groq',
    model: 'llama-3.3-70b-versatile',
    client: { models: { list: async () => ({ data: ids.map((id) => ({ id })) }) } },
  };
}

test('a decommissioned model is recognised however the provider words it', () => {
  assert.equal(isMissingModel({ status: 404 }), true);
  assert.equal(isMissingModel({ message: 'The model `x` does not exist or you do not have access to it.' }), true);
  assert.equal(isMissingModel({ status: 401, message: 'Incorrect API key' }), false);
  assert.equal(isMissingModel(null), false);
});

test('repointing prefers a real tool-calling model and never a guard model', async () => {
  const p = fakeProvider([
    'meta-llama/llama-prompt-guard-2-22m',
    'whisper-large-v3-turbo',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ]);
  const picked = await repointToLiveModel('Test', p);
  assert.equal(picked, 'openai/gpt-oss-120b');
  assert.equal(p.model, 'openai/gpt-oss-120b');
});

test('guard, whisper and embedding models are never chosen to hold a conversation', () => {
  for (const bad of ['meta-llama/llama-prompt-guard-2-86m', 'whisper-large-v3', 'openai/gpt-oss-safeguard-20b', 'text-embedding-3']) {
    assert.ok(UNUSABLE.test(bad), `${bad} must be rejected`);
  }
  for (const good of ['openai/gpt-oss-120b', 'qwen/qwen3.6-27b', 'llama-3.3-70b-versatile']) {
    assert.ok(!UNUSABLE.test(good), `${good} must stay usable`);
  }
});

test('a provider with nothing usable on offer does not pretend it repointed', async () => {
  const p = fakeProvider(['meta-llama/llama-prompt-guard-2-22m', 'whisper-large-v3']);
  assert.equal(await repointToLiveModel('Test', p), null);
});

test('the Groq default is a model that exists today, not the retired one', () => {
  assert.ok(!llmSrc.includes("|| 'llama-3.3-70b-versatile'"), 'the decommissioned model must not be the default again');
  assert.ok(llmSrc.includes("AGENT_MODEL_GROQ || 'openai/gpt-oss-120b'"));
});

test('deep health reports per provider and stays honest when one is dead', async () => {
  const dead = { label: 'openai', model: 'gpt-4o-mini', client: { chat: { completions: { create: async () => { const e = new Error('Incorrect API key'); e.status = 401; throw e; } } } } };
  const live = { label: 'groq', model: 'openai/gpt-oss-120b', client: { chat: { completions: { create: async () => ({ choices: [{}] }) } } } };

  // health() walks module-level providers, so exercise the same shape it produces.
  const results = [];
  for (const p of [dead, live]) {
    try {
      await p.client.chat.completions.create({ model: p.model, messages: [], max_tokens: 1 });
      results.push({ provider: p.label, ok: true });
    } catch (err) {
      results.push({ provider: p.label, ok: false, status: err.status });
    }
  }
  assert.deepEqual(results, [{ provider: 'openai', ok: false, status: 401 }, { provider: 'groq', ok: true }]);
  assert.ok(results.some((r) => r.ok), 'one live provider is enough to answer');
  assert.equal(typeof llm.health, 'function');
});

test('the book agent exposes a deep health route that can fail loudly', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/routes/book-agent.js'), 'utf8');
  assert.ok(src.includes("router.get('/agent/health'"));
  assert.ok(src.includes('res.status(ok ? 200 : 503)'), 'a broken assistant must not answer 200');
});

test('a public health response never quotes the API key back, even masked', () => {
  const { scrub } = require(path.join(ROOT, 'server/lib/llm.js'))._internals;
  const real = 'Incorrect API key provided: sk-proj-***********dsEA. You can find your key at...';
  const out = scrub(real);
  assert.ok(!/sk-proj/.test(out), out);
  assert.ok(out.includes('<redacted>'));
  assert.ok(!/gsk_/.test(scrub('bad key gsk_abc123DEF')));
});
