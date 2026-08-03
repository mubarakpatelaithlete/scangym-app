/**
 * The key watchdog must (a) notice a broken dependency, (b) alert exactly once
 * per transition, and (c) alert again when it recovers. Driven with fake probes
 * so nothing here touches the network.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const selfCheck = require('../server/lib/self-check');

function harness() {
  const alerts = [];
  return { alerts, notify: async (name, result, line) => { alerts.push(line); } };
}

test('a broken key alerts once, not on every run', async () => {
  selfCheck._resetForTests();
  const { alerts, notify } = harness();
  let ok = true;
  const probes = { openai: async () => { if (!ok) throw new Error('401 Incorrect API key'); return { detail: 'fine' }; } };

  await selfCheck.runAll({ probes, notify });
  assert.equal(selfCheck.snapshot().healthy, true);
  assert.equal(alerts.length, 0);

  ok = false;
  await selfCheck.runAll({ probes, notify });
  await selfCheck.runAll({ probes, notify });
  const snap = selfCheck.snapshot();
  assert.equal(snap.healthy, false);
  assert.deepEqual(snap.broken, ['openai']);
  assert.equal(alerts.length, 1, 'a continuing outage must not spam');
  assert.match(alerts[0], /ALERT: openai is broken — 401 Incorrect API key/);

  ok = true;
  await selfCheck.runAll({ probes, notify });
  assert.equal(selfCheck.snapshot().healthy, true);
  assert.equal(alerts.length, 2);
  assert.match(alerts[1], /RECOVERED: openai/);
});

test('a broken key on the very first run still alerts', async () => {
  selfCheck._resetForTests();
  const { alerts, notify } = harness();
  await selfCheck.runAll({ probes: { stripe: async () => { throw new Error('Invalid API Key provided'); } }, notify });
  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /stripe is broken/);
});

test('an unconfigured dependency is skipped, not reported broken', async () => {
  selfCheck._resetForTests();
  const { alerts, notify } = harness();
  await selfCheck.runAll({ probes: { groq: async () => ({ skipped: true, detail: 'GROQ_API_KEY not set' }) }, notify });
  const snap = selfCheck.snapshot();
  assert.equal(snap.healthy, true);
  assert.equal(snap.checks.groq.status, 'skipped');
  assert.equal(alerts.length, 0);
});

test('one probe blowing up does not stop the others', async () => {
  selfCheck._resetForTests();
  const { notify } = harness();
  await selfCheck.runAll({
    probes: {
      openai: async () => { throw new Error('boom'); },
      database: async () => ({ detail: 'query ok' }),
    },
    notify,
  });
  const snap = selfCheck.snapshot();
  assert.equal(snap.checks.openai.status, 'broken');
  assert.equal(snap.checks.database.status, 'ok');
});
