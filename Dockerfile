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

# Build step: minify JS + pre-compress all static assets with Brotli & gzip
RUN node build.js

# Verify files and log sizes
RUN echo "=== v4.4.0 Build ===" && \
    ls -la public/index.html && \
    ls -la public/app.ctr575.js public/app.ctr575.js.br public/app.ctr575.js.gz 2>/dev/null && \
    ls -la public/reels/index.html 2>/dev/null && echo "Reels app: OK" || echo "Reels app: missing" && \
    ls -la public/styles.css public/sw.js 2>/dev/null || true && \
    echo "Public dir size:" && du -sh public/ && \
    echo "Node modules size:" && du -sh node_modules/

EXPOSE 3000

CMD ["node", "server.js"]
