FROM node:20-slim

WORKDIR /app

# Copy server deps & install
COPY server/package.json ./
RUN npm install --production

# Copy server code (v3.2.0 — live Google Places API)
COPY server/ ./
COPY frontend/public/ ./public/

EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "const h=require('http');h.get('http://localhost:3000/api/v2/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
