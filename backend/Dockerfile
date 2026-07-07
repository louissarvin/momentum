# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------
# Momentum backend — Bun 1.3 runtime
# Multi-stage: builder (installs deps + generates Prisma client)
# runner       (slim, production only)
# ------------------------------------------------------------

FROM oven/bun:1.3-slim AS builder

WORKDIR /app

# System deps required by Prisma engines
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first (cache-friendly)
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# Copy source and generate Prisma client
COPY prisma ./prisma
COPY . .
RUN bunx prisma generate --config prisma/prisma.config.ts

# ------------------------------------------------------------
FROM oven/bun:1.3-slim AS runner

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy resolved node_modules + prisma client + source
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app ./

# Drop root
USER bun

EXPOSE 3700

CMD ["bun", "run", "index.ts"]
