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
  assert.match(rail, /\['gemini', 'Gemini'\]/);
  assert.match(rail, /gemini: function \(\) \{[\s\S]*?window\.open\('\/gemini'/);
  assert.match(read('server/server.js'), /app\.get\('\/gemini'/);
  const g = read('frontend/public/gemini/index.html');
  assert.match(g, /https:\/\/www\.scangym\.com\/mcp/);
  assert.match(g, /Connected Apps/);
  assert.ok(!/grok/i.test(g));
});
