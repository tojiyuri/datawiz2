# ─── Stage 1: Build the React client ────────────────────────────────────────
FROM node:22-alpine AS client-builder

WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ─── Stage 2: Install server deps + run ─────────────────────────────────────
FROM node:22-alpine

# better-sqlite3 + bcrypt need build tools to compile
RUN apk add --no-cache python3 make g++ \
    && ln -sf python3 /usr/bin/python

WORKDIR /app

# Install server deps separately to maximize Docker cache hits
COPY package*.json ./
RUN npm ci --omit=dev && \
    apk del make g++ python3

COPY server/ ./server/
COPY --from=client-builder /app/client/dist ./client/dist

# Persistent data volume — mounted by docker-compose
RUN mkdir -p /app/server/data /app/server/data/datasets /app/server/uploads

ENV NODE_ENV=production
ENV PORT=8000
EXPOSE 8000

# Healthcheck — Docker will mark the container unhealthy if /api/ready fails
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8000/api/ready || exit 1

CMD ["node", "server/index.js"]
