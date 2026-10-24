# ============================================================================
# IVSERS Backend - Dockerfile
# Multi-stage build: install production deps only in the final image.
# ============================================================================

FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Run as a non-root user for defense in depth.
RUN addgroup -S ivsers && adduser -S ivsers -G ivsers

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mkdir -p logs && chown -R ivsers:ivsers /app

USER ivsers
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
