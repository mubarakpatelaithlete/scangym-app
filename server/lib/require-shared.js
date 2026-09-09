/**
 * Resolve a module that is shared between the server and the browser.
 * ═══════════════════════════════════════════════════════════════════
 *
 * Why this file exists
 * --------------------
 * `lib/pricing-engine.js` and `routes/pricing-extended.js` imported the shared
 * pass maths with `require('../../frontend/public/pass-math.js')`. That path is
 * correct in a developer checkout and inside the Docker *test* stage (which
 * copies `server/` and `frontend/` side by side), and wrong in the runtime
 * image, where the Dockerfile flattens the tree:
 *
 *     COPY server/           ./          →  /app/server.js, /app/lib, /app/routes
 *     COPY frontend/public/  ./public/   →  /app/public/pass-math.js
 *
 * So `/app/lib/../../frontend/public/...` does not exist, and the container
 * crashed on boot with MODULE_NOT_FOUND — after a green build and a green test
 * suite, because nothing exercised the packaged layout. The healthcheck caught
 * it and the deploy was rolled back, but the failure was invisible until then.
 *
 * Every shared browser module the server needs must be required through here,
 * and `tests/shared-modules-reach-production.test.js` both enforces that and
 * boots the consumers in a simulated runtime image.
 */
const fs = require('fs');
const path = require('path');

// Directories that may hold shared browser modules, in resolution order.
// Relative to this file (server/lib in the repo, /app/lib in the image).
const SHARED_DIRS = [
  '../../frontend/public', // developer checkout + Docker test stage
  '../public', // runtime image: frontend/public is copied to /app/public
];

/**
 * @param {string} file  Bare filename of the shared module, e.g. 'pass-math.js'
 * @returns {*} the module's exports
 */
function requireShared(file) {
  const tried = [];
  for (const dir of SHARED_DIRS) {
    const candidate = path.join(__dirname, dir, file);
    tried.push(candidate);
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error(
    `Shared module '${file}' not found. Looked in:\n  ${tried.join('\n  ')}\n` +
      'If the deployed layout changed, update SHARED_DIRS in server/lib/require-shared.js.'
  );
}

module.exports = { requireShared, SHARED_DIRS };
