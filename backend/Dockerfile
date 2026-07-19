# syntax=docker/dockerfile:1.7
# ------------------------------------------------------------
# Momentum backend — Bun 1.3 runtime
# Multi-stage: (1) deps  → cached bun install
#              (2) build → generates Prisma client
#              (3) runner → slim, non-root, healthcheck
#
# Default CMD boots the HTTP server. In Railway, deploy this image
# as 4 separate services (all pointing at the same GitHub repo,
# using this same Dockerfile) and override the Start Command per
# service via the Railway dashboard:
#
#   momentum-http     → bun run index.ts                     (default CMD)
#   momentum-ingester → bun run src/workers/ingester.ts
#   momentum-settler  → bun run src/workers/settler.ts
#   momentum-replay   → bun run src/workers/replay.ts
#
# All 4 services share the same env vars via Railway's project-level
# shared variables (or per-service overrides). See backend/RAILWAY.md.
#
# Env expected at runtime:
#   DATABASE_URL          (Postgres, session-pooler for LISTEN/NOTIFY)
#   DIRECT_URL            (same URL is fine on Supabase session pooler)
#   SESSION_JWT_SECRET    (min 32 bytes)
#   SOLANA_RPC_URL        (devnet or mainnet)
#   SOLANA_CLUSTER        (devnet | mainnet)
#   MOMENTUM_PROGRAM_ID   (Anchor program ID)
#   TXLINE_PROGRAM_ID     (sponsor's txoracle ID)
#   TXLINE_BASE_URL       (https://txline-dev.txodds.com)
#   KEEPER_SECRET_JSON    (base58 or JSON secret key — use instead of KEEPER_KEYPAIR_PATH in prod)
#   FRONTEND_URL          (Vercel production URL, for CORS)
#   TELEGRAM_BOT_TOKEN    (optional — disables bot when unset)
#   TELEGRAM_GROUP_CHAT_ID
#   NOTIFY_SHARED_SECRET
# ------------------------------------------------------------

# ---------- Stage 1: deps (only lockfile + package.json for cache) ----------
FROM oven/bun:1.3-slim AS deps

WORKDIR /app

# System deps required by Prisma engines + node-canvas fallbacks used by resvg-js
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile

# ---------- Stage 2: build (generate Prisma client) ----------
FROM deps AS build

COPY prisma ./prisma
COPY . .

# Generate the Prisma client (respects prisma/prisma.config.ts)
RUN bunx prisma generate --config prisma/prisma.config.ts

# ---------- Stage 3: runner (slim, non-root, minimal surface) ----------
FROM oven/bun:1.3-slim AS runner

ENV NODE_ENV=production \
    APP_PORT=3700 \
    BACKEND_INTERNAL_URL=http://localhost:3700

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 1001 momentum \
    && useradd --system --uid 1001 --gid momentum --home /app momentum

# Copy resolved deps + built prisma client + source
COPY --from=build --chown=momentum:momentum /app/node_modules ./node_modules
COPY --from=build --chown=momentum:momentum /app/prisma ./prisma
COPY --from=build --chown=momentum:momentum /app ./

USER momentum

EXPOSE 3700

# tini reaps zombie children (Bun spawns workers via child_process for the
# Telegram long-poller HTTP loop; without tini they'd stack up under load)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default: HTTP server. Override per Railway service for workers.
CMD ["bun", "run", "index.ts"]
