# ============================================================
# Outreach Enterprise Platform — Dockerfile
# ============================================================
# Multi-stage build: deps → app

# Stage 1: Install production dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Application image
FROM node:20-alpine AS app
WORKDIR /app

# Security: run as non-root
RUN addgroup -S outreach && adduser -S -G outreach outreach

# Copy deps from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Ensure data directory exists and is writable
RUN mkdir -p /app/data && chown -R outreach:outreach /app/data

USER outreach

EXPOSE 3848

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node scripts/health-check.js || exit 1

# Run migrations then start server
CMD ["sh", "-c", "node scripts/setup.js && node server.js"]
