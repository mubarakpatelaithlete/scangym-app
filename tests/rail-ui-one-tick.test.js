'use strict';
/**
 * The rail/card UI enhancers run on ONE timer.
 *
 * round3.js, ui-polish.js, round4-ui.js and round5-ui.js each kept their DOM
 * edits alive with their own setInterval (400/600/600/600ms). They were merged
 * into sg-rail-ui.js with a single shared 600ms tick. This test stops the four
 * files from coming back and stops a second timer from creeping into the merged
 * file.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the four merged rail patches stay deleted', () => {
  for (const f of ['round3.js', 'ui-polish.js', 'round4-ui.js', 'round5-ui.js']) {
    assert.ok(!fs.existsSync(path.join(PUB, f)), `${f} was merged into sg-rail-ui.js — do not re-add it`);
  }
  const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.ok(index.includes('/sg-rail-ui.js'), 'index.html must load sg-rail-ui.js');
});

test('sg-rail-ui.js has exactly one timer and runs all four enhancers from it', () => {
  const src = strip(fs.readFileSync(path.join(PUB, 'sg-rail-ui.js'), 'utf8'));
  assert.strictEqual((src.match(/setInterval\(/g) || []).length, 1, 'one shared tick, not one per module');
  for (const m of ['reelsRail', 'railIcons', 'bookSummary', 'buttonCleanup']) {
    assert.ok(new RegExp(`var ${m}=\\(function\\(\\)\\{`).test(src), `${m} module missing`);
  }
  assert.ok(/ENHANCERS=\[reelsRail,railIcons,bookSummary,buttonCleanup\]/.test(src), 'enhancer order must match the original load order');
});
