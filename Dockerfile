FROM node:20-slim

WORKDIR /app

# v3.3.0 speed build
ARG BUILD_VERSION=3.4.0

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
    echo "Minified JS files" && \
    ls -la public/*.js

# Verify liveSearch.js is present
RUN ls -la routes/liveSearch.js && echo "liveSearch.js OK"

EXPOSE 3000

CMD ["node", "server.js"]
