'use strict';
/* Gemini chatbot (owner request 2026-09-28): Profile → Gemini opens /gemini,
   which copies our MCP URL for Gemini Connected Apps → Add a custom app. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Gemini button, route and guide exist', () => {
  const rail = read('frontend/public/profile-rail.js');
  // Button removed from the Profile rail (owner, 2026-09-29); the handler, route and guide stay.
  assert.ok(!/\['gemini', 'Gemini'\]/.test(rail));
  assert.match(rail, /gemini: function \(\) \{[\s\S]*?window\.open\('\/gemini'/);
  assert.match(read('server/server.js'), /app\.get\('\/gemini'/);
  const g = read('frontend/public/gemini/index.html');
  assert.match(g, /https:\/\/www\.scangym\.com\/mcp/);
  assert.match(g, /Connected Apps/);
  assert.ok(!/grok/i.test(g));
});

test('Gemini CLI extension manifest points at the signed-in MCP connector', () => {
  const ext = JSON.parse(read('gemini-extension.json'));
  assert.strictEqual(ext.name, 'scangym');
  assert.strictEqual(ext.contextFileName, 'GEMINI.md');
  assert.strictEqual(ext.mcpServers.scangym.httpUrl, 'https://www.scangym.com/mcp/account');
  assert.match(read('GEMINI.md'), /\/mcp auth scangym/);
  const g = read('frontend/public/gemini/index.html');
  assert.match(g, /gemini extensions install https:\/\/github\.com\/mubarakpatelaithlete\/scangym-app/);
});
