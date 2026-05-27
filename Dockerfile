FROM node:20-slim

WORKDIR /app

# v4.0.0 — Performance Optimized Build (force clean rebuild)
ARG BUILD_VERSION=4.0.0

# Copy server deps & install
COPY server/package.json ./
RUN npm install --production

# Install terser globally for JS minification
RUN npm install -g terser

# Copy all server + frontend code
COPY server/ ./
COPY frontend/public/ ./public/

# Minify JavaScript for ~40% smaller files
RUN terser public/app.js -c -m --toplevel -o public/app.js && \
    terser public/robust-location.js -c -m -o public/robust-location.js && \
    terser public/sw.js -c -m -o public/sw.js && \
    echo "Minified JS files" && \
    ls -la public/*.js

# Verify critical performance files exist
RUN echo "=== Build Verification ===" && \
    ls -la public/index.html && \
    ls -la public/styles.css && echo "styles.css OK" && \
    ls -la public/sw.js && echo "sw.js OK" && \
    ls -la public/app.js && echo "app.js OK" && \
    ls -la routes/liveSearch.js && echo "liveSearch.js OK" && \
    echo "=== All critical files present ==="

EXPOSE 3000

CMD ["node", "server.js"]
