/**
 * The server must boot, and the coach must answer, with no OpenAI key at all.
 *
 * routes/coach.js used to run `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })` at
 * require time. The OpenAI client throws when the key is missing, and server.js requires
 * the coach router on the way up — so deleting one environment variable took the whole
 * product down, booking and all, not just the coach. Production meanwhile was running a
 * revoked key (401 on every coach message) with no failover, because the coach never went
 * through lib/llm.js like the other two assistants do.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', 'server');

test('no module constructs an OpenAI client at require time', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const src = fs.readFileSync(full, 'utf8');
      // Module scope = column 0. A client built inside a function (self-check's probes,
      // llm.js's build()) only runs when called, and both guard on the key first.
      for (const line of src.split('\n')) {
        if (/^const\s+\w+\s*=\s*new OpenAI\(/.test(line)) offenders.push(path.relative(SERVER, full));
      }
    }
  };
  walk(SERVER);
  assert.deepStrictEqual(offenders, [], 'these modules crash the server when their key is unset');
});

test('the coach router loads with no keys in the environment', () => {
  const saved = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GROQ_API_KEY;
  try {
    delete require.cache[require.resolve('../server/lib/llm')];
    delete require.cache[require.resolve('../server/routes/coach')];
    assert.doesNotThrow(() => require('../server/routes/coach'));
  } finally {
    Object.assign(process.env, saved);
    delete require.cache[require.resolve('../server/lib/llm')];
    delete require.cache[require.resolve('../server/routes/coach')];
  }
});

test('llm.chat fails over to the next provider when the first rejects the key', async () => {
  delete require.cache[require.resolve('../server/lib/llm')];
  process.env.OPENAI_API_KEY = 'dead';
  process.env.GROQ_API_KEY = 'alive';
  const llm = require('../server/lib/llm');

  const dead = Object.assign(new Error('Incorrect API key'), { status: 401 });
  llm.providers[0].client = { chat: { completions: { create: async () => { throw dead; } } } };
  llm.providers[1].client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'hi' } }] }) } },
  };

  const { completion, provider } = await llm.chat('Test', { messages: [] });
  assert.strictEqual(provider, 'groq');
  assert.strictEqual(completion.choices[0].message.content, 'hi');

  delete require.cache[require.resolve('../server/lib/llm')];
});

test('a dead provider is benched so the next customer does not pay for it', async () => {
  delete require.cache[require.resolve('../server/lib/llm')];
  process.env.OPENAI_API_KEY = 'dead';
  process.env.GROQ_API_KEY = 'alive';
  const llm = require('../server/lib/llm');

  let openaiCalls = 0;
  llm.providers[0].client = {
    chat: { completions: { create: async () => { openaiCalls++; throw Object.assign(new Error('401'), { status: 401 }); } } },
  };
  llm.providers[1].client = {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: 'ok' } }] }) } },
  };

  await llm.chat('Test', { messages: [] });
  await llm.chat('Test', { messages: [] });
  assert.strictEqual(openaiCalls, 1, 'the dead key was tried again instead of being benched');

  delete require.cache[require.resolve('../server/lib/llm')];
});
