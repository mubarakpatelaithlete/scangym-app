/**
 * Every shipped file must parse. The frontend has no build step — a stray typo
 * in a patch file is a white screen in production, and nothing would have
 * caught it before this test.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dirs = [
  path.join(__dirname, '..', 'frontend', 'public'),
  path.join(__dirname, '..', 'server'),
  path.join(__dirname, '..', 'server', 'routes'),
  path.join(__dirname, '..', 'server', 'lib'),
];

for (const dir of dirs) {
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  test(`${path.relative(path.join(__dirname, '..'), dir)}: ${files.length} files parse`, () => {
    for (const f of files) {
      try {
        execFileSync(process.execPath, ['--check', path.join(dir, f)], { stdio: 'pipe' });
      } catch (err) {
        assert.fail(`${f} does not parse:\n${err.stderr && err.stderr.toString().slice(0, 400)}`);
      }
    }
  });
}
