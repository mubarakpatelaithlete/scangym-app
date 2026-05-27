FROM node:20-slim

WORKDIR /app

# Copy server deps & install
COPY server/package.json ./
RUN npm install --production

# Copy all server + frontend code
COPY server/ ./
COPY frontend/public/ ./public/

# Verify critical files exist (build fails if any are missing)
RUN echo "BUILD CHECK v4.1.0 $(date)" && \
    test -f public/index.html && echo "✓ index.html" && \
    test -f public/styles.css && echo "✓ styles.css ($(wc -c < public/styles.css) bytes)" && \
    test -f public/sw.js && echo "✓ sw.js ($(wc -c < public/sw.js) bytes)" && \
    test -f public/app.js && echo "✓ app.js ($(wc -c < public/app.js) bytes)" && \
    grep -q "styles.css" public/index.html && echo "✓ index.html references styles.css" && \
    ! grep -q "cdn.tailwindcss" public/index.html && echo "✓ no Tailwind CDN in index.html" && \
    echo "=== ALL CHECKS PASSED ==="

EXPOSE 3000

CMD ["node", "server.js"]
