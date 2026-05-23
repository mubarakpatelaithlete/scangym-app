FROM node:20-slim

WORKDIR /app

# Copy server
COPY server/package.json ./
RUN npm install --production

COPY server/ ./
COPY frontend/public/ ./public/

EXPOSE 3000

CMD ["node", "server.js"]
