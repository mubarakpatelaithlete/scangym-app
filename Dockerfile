# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: tests.
#
# Railway deploys this Dockerfile straight from `main`. Before this stage
# existed the image was built and shipped without the suite ever running, so a
# red commit reached a production app that takes card payments. The runtime
# stage copies a marker file out of this stage, which makes the test run a real
# dependency of the final image: if the tests fail, the build fails, and
# nothing deploys.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim AS test

WORKDIR /app

# Full install (not --production): several suites require() routes directly and
# need express, multer and friends present.
COPY server/package.json ./server/
RUN cd server && npm install --no-audit --no-fund

COPY package.json ./
COPY server/ ./server/
COPY frontend/ ./frontend/
COPY tests/ ./tests/
# tests/one-version.test.js reads /migrations to check the schema is declared in
# exactly one place. Leaving it out of the build context made three tests fail
# with ENOENT inside Docker while passing on a developer's checkout.
COPY migrations/ ./migrations/
# tests/docker-test-stage.test.js reads this file, to keep the two in step.
COPY Dockerfile ./

RUN npm test && mkdir -p /verified && date -u +%FT%TZ > /verified/tests-passed

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: runtime image.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-slim

# Install ffmpeg for video frame extraction (used by auto-enrichment pipeline)
RUN apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy server deps & install (production + terser for build step)
COPY server/package.json ./
RUN npm install --production

# Copy server code
COPY server/ ./

# Copy frontend (respects .dockerignore)
COPY frontend/public/ ./public/

# The schema. server/db/migrate.js applies these at boot — and until this line
# existed they were never in the runtime image at all, so every migration was a
# silent no-op in production and `login_links` (and anything else added since the
# baseline) simply did not exist. tests/migrations-reach-production.test.js pins
# this COPY to the loader's search path.
COPY migrations/ ./migrations/

# Build step: minify JS + pre-compress all static assets with Brotli & gzip
RUN node build.js

# Proof the suite ran and passed. Keep this: it is what forces BuildKit to
# execute the test stage instead of skipping it as an unreferenced target.
COPY --from=test /verified/tests-passed /app/.tests-passed

# Verify files and log sizes
RUN echo "=== v5.7.0 Build (cache-busted) ===" && \
    echo "Tests passed at: $(cat /app/.tests-passed)" && \
    ls -la public/index.html && \
    ls -la public/app.ctr576.*.js 2>/dev/null && \
    ls -la public/.asset-manifest.json 2>/dev/null && echo "Asset manifest: OK" || echo "Asset manifest: missing" && \
    cat public/.asset-manifest.json 2>/dev/null || true && \
    ls -la public/reels/index.html 2>/dev/null && echo "Reels app: OK" || echo "Reels app: missing" && \
    ls -la public/sw.js 2>/dev/null || true && \
    echo "Public dir size:" && du -sh public/ && \
    echo "Node modules size:" && du -sh node_modules/

EXPOSE 3000

CMD ["node", "server.js"]
