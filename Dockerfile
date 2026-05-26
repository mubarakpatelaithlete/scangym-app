FROM node:20-slim

WORKDIR /app

# v3.2.0 build
ARG BUILD_VERSION=3.2.0

# Copy server deps & install
COPY server/package.json ./
RUN npm install --production

# Copy all server + frontend code
COPY server/ ./
COPY frontend/public/ ./public/

# Verify liveSearch.js is present
RUN ls -la routes/liveSearch.js && echo "liveSearch.js OK"

EXPOSE 3000

CMD ["node", "server.js"]
