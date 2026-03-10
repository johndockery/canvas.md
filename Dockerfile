FROM node:22-slim AS base
WORKDIR /app

# Install deps
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# Build Next.js
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_PUBLIC_COLLAB_URL=
RUN npx next build

# Production
FROM base AS runner
ENV NODE_ENV=production

# Need full node_modules for runtime (hocuspocus, tsx, pg, etc)
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/tsconfig.json ./
COPY server/ ./server/
COPY src/ ./src/

EXPOSE 8080

CMD ["npx", "tsx", "server/production.ts"]
