#!/usr/bin/env node
/**
 * Seam end-to-end verification — Sprint 1
 * ════════════════════════════════════════
 * Proves the full ScanGym day-pass loop against Seam BEFORE any real gym:
 *   1. Auth check (workspace)
 *   2. List connected devices / ACS systems
 *   3. Create a time-boxed access code (24h day pass) on the first lock
 *   4. Read it back
 *   5. Revoke it
 *
 * Run with a SANDBOX key first (free at https://console.seam.co):
 *   SEAM_API_KEY=seam_test_... node scripts/verify-seam.js
 * In the Seam console add a virtual device (e.g. a fake Salto/TTLock lock)
 * so step 3 has something to target.
 */

const SEAM_API_KEY = process.env.SEAM_API_KEY;
const BASE = 'https://connect.getseam.com';

if (!SEAM_API_KEY) {
  console.error('FAIL: set SEAM_API_KEY env var (use a seam_test_ sandbox key first)');
  process.exit(1);
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { Authorization: `Bearer ${SEAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

(async () => {
  let pass = 0, fail = 0;
  const step = async (name, fn) => {
    try {
      const out = await fn();
      console.log(`PASS  ${name}`);
      pass++;
      return out;
    } catch (e) {
      console.log(`FAIL  ${name} -> ${e.message}`);
      fail++;
      return null;
    }
  };

  // 1. Auth / workspace
  await step('Auth: workspace reachable', () => api('GET', '/workspaces/get'));

  // 2. Devices + ACS systems
  const devices = await step('List devices', async () => {
    const d = await api('POST', '/devices/list', {});
    console.log(`      ${d.devices.length} device(s): ${d.devices.map(x => `${x.device_type}:${x.device_id.slice(0, 8)}`).join(', ') || 'none'}`);
    return d.devices;
  });
  await step('List ACS systems (Salto/Brivo/etc)', async () => {
    const s = await api('POST', '/acs/systems/list', {});
    console.log(`      ${s.acs_systems.length} ACS system(s)`);
    return s.acs_systems;
  });

  // 3-5. Day-pass loop on first code-capable lock
  const lock = (devices || []).find(d => d.capabilities_supported?.includes('access_code'));
  if (!lock) {
    console.log('SKIP  Day-pass loop: no access-code capable device in workspace.');
    console.log('      Add a virtual device in the Seam console and re-run.');
  } else {
    const startsAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const created = await step(`Create 24h day-pass code on ${lock.device_type}`, () =>
      api('POST', '/access_codes/create', {
        device_id: lock.device_id,
        name: `ScanGym verify ${Date.now()}`,
        starts_at: startsAt,
        ends_at: endsAt,
      })
    );
    if (created) {
      const id = created.access_code.access_code_id;
      await step('Read code back', async () => {
        const g = await api('POST', '/access_codes/get', { access_code_id: id });
        console.log(`      PIN: ${g.access_code.code} valid ${startsAt} -> ${endsAt}`);
        return g;
      });
      await step('Revoke code', () => api('POST', '/access_codes/delete', { access_code_id: id }));
    }
  }

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
