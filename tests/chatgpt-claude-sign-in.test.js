'use strict';
// "Sign in with ScanGym" for ChatGPT/Claude (/mcp/account) — owner request 2026-09-26.
const test = require('node:test');
const assert = require('node:assert');
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-secret';
const oauth = require('../server/routes/mcp-oauth');
const { sign, verify, okRedirect } = oauth._internals;

test('tokens are signed, typed and expire', () => {
  const t = sign({ typ: 'at', sub: 'u1', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.equal(verify(t, 'at').sub, 'u1');
  assert.equal(verify(t, 'rt'), null, 'wrong type refused');
  assert.equal(verify(t.slice(0, -2) + 'xx', 'at'), null, 'forged refused');
  assert.equal(verify(sign({ typ: 'at', sub: 'u1', exp: 1 }), 'at'), null, 'expired refused');
});

test('bearer header maps to the account', () => {
  const t = sign({ typ: 'at', sub: 'u9', em: 'a@b.co', cn: 'Claude', exp: Math.floor(Date.now() / 1000) + 60 });
  assert.deepEqual(oauth.userFromAuthHeader('Bearer ' + t), { userId: 'u9', email: 'a@b.co', firstName: null, client: 'Claude' });
  assert.equal(oauth.userFromAuthHeader(''), null);
});

test('only https (or localhost) redirect uris', () => {
  assert.ok(okRedirect('https://claude.ai/api/mcp/auth_callback'));
  assert.ok(okRedirect('https://chatgpt.com/connector_platform_oauth_redirect'));
  assert.ok(!okRedirect('http://evil.com/cb'));
  assert.ok(!okRedirect('javascript:alert(1)'));
});

test('signed-in connector lists library, memory and in-chat create; open one does not', async () => {
  const { handleRpc } = require('../server/routes/mcp')._internals;
  const open = await handleRpc({ id: 1, method: 'tools/list' }, {});
  assert.ok(!open.result.tools.some((t) => t.name === 'my_library'));
  const signed = await handleRpc({ id: 1, method: 'tools/list' }, { user: { userId: 'u1' } });
  const names = signed.result.tools.map((t) => t.name);
  for (const n of ['my_library', 'my_memory', 'check_creation', 'create_media', 'search_gyms']) assert.ok(names.includes(n), n);
  assert.equal(names.filter((n) => n === 'create_media').length, 1);
});
