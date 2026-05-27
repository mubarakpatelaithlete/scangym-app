FROM node:20-slim

WORKDIR /app

# Copy server deps & install
COPY server/package.json ./
RUN npm install --production

# Copy server code
COPY server/ ./

# Copy frontend (respects .dockerignore)
COPY frontend/public/ ./public/

# Verify files and log sizes
RUN echo "=== v4.1.0 Build ===" && \
    ls -la public/index.html public/app.js && \
    ls -la public/styles.css public/sw.js 2>/dev/null || true && \
    echo "Public dir size:" && du -sh public/ && \
    echo "Node modules size:" && du -sh node_modules/

EXPOSE 3000

CMD ["node", "server.js"]
