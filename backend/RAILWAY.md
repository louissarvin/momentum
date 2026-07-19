# Railway deployment guide

Deploy the Momentum backend to Railway as 4 services (HTTP + ingester + settler + replay), all pointing at the same GitHub repo, all sharing the same Supabase Postgres.

**Region choice:** Railway's `asia-southeast1` (Singapore) is the closest to your Supabase project in Mumbai (`ap-south-1`). Expect ~50ms round-trips to Postgres — acceptable. US regions add ~200ms round-trips per DB query and will make LISTEN/NOTIFY-driven UI feel sluggish.

---

## Prerequisites

- Railway account (railway.com — sign up with GitHub)
- Railway CLI: `bun add -g @railway/cli` OR `brew install railway`
- Logged in: `railway login` (opens browser OAuth)
- Supabase project active (see [top-level README](../README.md#run-locally))
- Solana devnet keeper wallet with ≥0.5 SOL (`solana balance --url devnet`)
- Keeper keypair as a JSON array (extract with `cat ~/.config/solana/id.json`)

---

## One-time project setup

### 1. Create the Railway project + link it locally

```bash
cd backend
railway init                     # pick "Empty Project"
railway link                     # links this directory to the new project
```

### 2. Set project-level shared env vars

These are shared across all 4 services. Set them once via the dashboard OR via CLI:

```bash
railway variables set \
  NODE_ENV=production \
  LOG_LEVEL=info \
  APP_PORT=3700 \
  DATABASE_URL='postgresql://postgres.kiejgjgzsehwkctkwueb:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' \
  DIRECT_URL='postgresql://postgres.kiejgjgzsehwkctkwueb:PASSWORD@aws-1-ap-south-1.pooler.supabase.com:5432/postgres' \
  SESSION_JWT_SECRET='$(openssl rand -hex 32)' \
  SESSION_JWT_EXPIRES_IN=24h \
  SOLANA_RPC_URL=https://api.devnet.solana.com \
  SOLANA_CLUSTER=devnet \
  MOMENTUM_PROGRAM_ID=39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT \
  TXLINE_PROGRAM_ID=6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J \
  TXLINE_BASE_URL=https://txline-dev.txodds.com \
  METADATA_HOST=https://cdn.momentum.app \
  SOLSCAN_CLUSTER=devnet \
  TELEGRAM_BOT_TOKEN='YOUR_TOKEN' \
  TELEGRAM_GROUP_CHAT_ID='YOUR_CHAT_ID' \
  NOTIFY_SHARED_SECRET='YOUR_16_PLUS_CHAR_SECRET' \
  KEEPER_SECRET_JSON='[123,45,67,...]'
```

**Never commit these.** They live only in Railway.

Also set (per-service later — the HTTP service needs this):
- `FRONTEND_URL` = the deployed Vercel URL (set once web is deployed)
- `BACKEND_INTERNAL_URL` = the HTTP service's public Railway URL (set once HTTP is deployed)

---

## Deploy the 4 services

### Service 1 — `momentum-http` (default, from railway.json)

```bash
cd backend
railway up                       # first deploy
```

Railway detects `railway.json` and uses `bun run index.ts` as the start command + `/health` as the healthcheck path. Wait for deploy → note the public URL (e.g., `momentum-http-production.up.railway.app`).

**Set `BACKEND_INTERNAL_URL` to this URL** so the settler can call the notify endpoint.

### Service 2 — `momentum-ingester`

In the Railway dashboard:
1. Click **New Service** → **GitHub Repo** → select `louissarvin/momentum`, branch `main`, root directory `backend`
2. Rename service to `momentum-ingester`
3. **Settings → Deploy** → set Start Command to: `bun run src/workers/ingester.ts`
4. **Settings → Networking** → disable public networking (worker only, no HTTP)
5. Under **Variables** → import from shared (all env vars from step 2 above)
6. Deploy

### Service 3 — `momentum-settler`

Same as ingester, but:
- Rename to `momentum-settler`
- Start Command: `bun run src/workers/settler.ts`

### Service 4 — `momentum-replay`

Same pattern:
- Rename to `momentum-replay`
- Start Command: `bun run src/workers/replay.ts`
- Additional per-service env: `REPLAY_MODE=true`, `REPLAY_FIXTURE_ID=18237038`, `REPLAY_SPEED=2`

---

## Verify

```bash
# HTTP is up + Supabase reachable + workers alive
curl -s https://momentum-http-production.up.railway.app/health | jq '{
  status,
  prisma: .prisma.connected,
  txlineAuth,
  workers
}'
```

Expected:
```json
{
  "status": "ok",
  "prisma": true,
  "txlineAuth": "live",
  "workers": {
    "ingester": "live",
    "settler": "live",
    "replay": "live"
  }
}
```

If `workers.ingester` shows `not_started`, the ingester service isn't reaching the HTTP process (it publishes via `LISTEN/NOTIFY`, so this is really a Postgres connectivity check). Check ingester logs in the dashboard.

---

## Rollback

Railway keeps every deploy image. In the dashboard → service → **Deployments** → click a prior successful deploy → **Redeploy**. Zero-downtime rollback in ~30 seconds.

---

## Cost expectations (2026)

- 4 services × ~256 MB each ≈ **$5-8/month** on Hobby ($5/mo credit included)
- Supabase Free tier (7-day pause risk during judging — see main README) or Pro ($25/mo, recommended)
- Total: **$5-33/mo** depending on Supabase tier

---

## When to add Redis / a proper queue

Not needed today. Momentum's cross-process pub/sub uses **Postgres `LISTEN`/`NOTIFY`** (see ADR-05 in the top-level README). Add BullMQ + Redis only when:
- SettlementJob backlog regularly exceeds 500
- Multiple settler replicas need coordinated backoff
- Cross-region replication (multi-Railway-region deploy)

None of those apply to the hackathon demo.
