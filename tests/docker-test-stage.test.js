'use strict';

// The Dockerfile runs the suite as a build stage, so a red commit cannot deploy.
// That only works if the stage actually contains everything the tests read.
//
// It did not. tests/one-version.test.js reads /migrations, the stage never
// copied it, and three tests failed with ENOENT inside Docker while passing on
// every developer checkout -- the build broke for a reason that had nothing to
// do with the code in the commit. This test keeps the build context and the
// suite's real dependencies in step.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');

// Everything above the second FROM: the test stage.
const TEST_STAGE = DOCKERFILE.split(/^FROM /m)[1] || '';

/** Top-level directories the suite reaches for, read out of the suite itself. */
function directoriesTheTestsRead() {
  const found = new Set();
  for (const file of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js'))) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const m of src.matchAll(/__dirname,\s*'\.\.',\s*'([A-Za-z0-9_-]+)'/g)) {
      const dir = m[1];
      if (fs.existsSync(path.join(ROOT, dir)) && fs.statSync(path.join(ROOT, dir)).isDirectory()) {
        found.add(dir);
      }
    }
  }
  return [...found].sort();
}

test('the Docker test stage copies every directory the suite reads', () => {
  const missing = directoriesTheTestsRead().filter(
    (dir) => !new RegExp(`^COPY\\s+${dir}/`, 'm').test(TEST_STAGE)
  );
  assert.deepStrictEqual(
    missing,
    [],
    `the test stage never receives these, so the tests fail with ENOENT in Docker: ${missing.join(', ')}`
  );
});

test('the test stage is named, and the runtime image depends on its result', () => {
  assert.match(DOCKERFILE, /^FROM\s+\S+\s+AS\s+test$/m, 'no named test stage');
  assert.match(
    DOCKERFILE,
    /^COPY --from=test \/verified\/tests-passed/m,
    'nothing copies the marker out, so BuildKit is free to skip the tests entirely'
  );
});

test('the test stage really runs the suite', () => {
  assert.match(TEST_STAGE, /^RUN npm test /m, 'the test stage does not run npm test');
});
