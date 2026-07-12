<div align="center">

<img src="../web/public/assets/logo.svg" alt="Momentum backend" width="240" />

**The Momentum API + workers.**

<br />

![Bun](https://img.shields.io/badge/Bun-1.3-F9F1E1?style=flat-square)
![Fastify](https://img.shields.io/badge/Fastify-5-000000?style=flat-square)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?style=flat-square)
![Tests](https://img.shields.io/badge/tests-34%20passing-22C55E?style=flat-square)

</div>

---

## What this is

Four Bun processes orchestrating the Momentum on-chain program. HTTP serves the REST/SSE/Blinks API. Ingester consumes TxLINE's SSE stream. Settler processes the SettlementJob queue and fires v0 transactions with ALT. Replay is judging-day insurance.

## Processes

| Process | Command | Purpose |
|---|---|---|
| HTTP server | `bun run dev` | REST + SSE + Blinks on port 3700 |
| Ingester | `bun run worker:ingester` | TxLINE SSE consumer + backfill |
| Settler | `bun run worker:settler` | SettlementJob queue → v0 tx with ALT |
| Replay | `bun run worker:replay` | Judging-day insurance (archived packet replay) |

## Prisma data model — 14 models

| Model | Purpose |
|---|---|
| `User` | SIWS-authenticated wallet |
| `Session` | Nonce challenges (5-min TTL, single-use) |
| `TxlineSession` (singleton) | JWT + API token cache |
| `TxlineJwt` | Rotation audit log |
| `Fixture` | Match snapshot mirror |
| `ScorePacket` | Raw TxLINE packet archive (unique on `[fixtureId, seq]`) |
| `ProofCache` | Fetched stat-validation payloads |
| `Group` | On-chain group mirror |
| `Membership` | Group members |
| `PredictionCard` | On-chain card mirror |
| `StickerMint` | Minted cNFT records with full lineage |
| `MatchCard` | Match summary cNFT records |
| `Listing` / `Sale` | Marketplace records |
| `SettlementJob` | Queue table (pending / in_progress / done / error) |

## Prerequisites

- Bun 1.3+
- PostgreSQL 16
- Solana keypair at `~/.config/solana/id.json` (or via `KEEPER_SECRET_JSON`)
- The Momentum program deployed on devnet (already live at `39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT`)

## Setup

```bash
bun install
cp .env.example .env
```

Fill in `.env` — critical vars:

```
DATABASE_URL="postgresql://postgres:admin@localhost:5432/momentum?schema=public"
DIRECT_URL="postgresql://postgres:admin@localhost:5432/momentum?schema=public"
SESSION_JWT_SECRET="min-32-bytes-please-change"
FRONTEND_URL=http://localhost:3200
SOLANA_CLUSTER=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
MOMENTUM_PROGRAM_ID=39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT
TXLINE_PROGRAM_ID=6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
TXLINE_BASE_URL=https://txline-dev.txodds.com
KEEPER_KEYPAIR_PATH=~/.config/solana/id.json
```

Push schema and generate the Prisma client:

```bash
bunx prisma migrate dev
```

## Run

```bash
bun run dev
```

In separate terminals:

```bash
bun run worker:ingester
bun run worker:settler
bun run worker:replay      # optional, only for judging-day demo
```

## Verify

```bash
curl -s http://localhost:3700/health | jq
```

Expected: `status: "ok"`, `workers.ingester: "live"`, `workers.settler: "live"`, `txlineAuth: "live"`.

## Test

```bash
bun test
```

Expected: 34 passing across 4 spec files.

## API reference

Every route is documented in the OpenAPI spec served at `http://localhost:3700/docs`. Categories:

- **Auth** — `/api/session/challenge`, `/api/session/wallet-login`, `/api/session/me`
- **Fixtures** — `/api/fixtures`, `/api/fixtures/:id`
- **Groups** — CRUD + join + confirm
- **Predictions** — build unsigned tx + confirm + `/me` reader
- **Cards** — `/api/cards/mine`, `/api/cards/:assetId/lineage`
- **Marketplace** — list / buy / cancel with `/confirm` counterparts
- **SSE** — `/api/stream/fixture/:fixtureId?ticket=<jwt>`
- **Blinks** — `/actions.json`, `/api/actions/join-group/:id`, `/api/actions/share-card/:assetId`
- **Meta** — `/health`, `/api/flags`, `/api/replay/status`, `/api/stats/live`
- **User profile** — `/api/users/:wallet`, `/api/groups/:pda/leaderboard`
- **Assets** — `/api/match-cards/:fixtureId/image.svg` (dynamic XSS-safe SVG generation)

## Reference

See the [top-level README](../README.md) for the full product story and integration details.
