# Live Status

Momentum exposes a live `/health` endpoint on the backend. The `/docs` page embeds a real-time widget that polls this endpoint and renders the current status of every subsystem.

## What the widget shows

- **Cluster** — always `devnet` for this deployment.
- **Momentum program** — the deployed program ID (`39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT`).
- **Keeper** — the permissionless settler wallet address and its current SOL balance (15s-cached).
- **Prisma** — database connectivity, best-effort pool stats.
- **TxLINE auth** — `live | expired | not_initialized`, plus remaining JWT validity in hours (30-day rolling window).
- **Last packet** — milliseconds since the ingester (or replay worker) last observed a packet.
- **Workers** — per-worker liveness: `ingester`, `settler`, `replay`. Each derived from an on-disk heartbeat file (stale after 10-30s depending on worker).
- **Backlog** — `SettlementJob` counts by status: `pending`, `inProgress`, `errored` (24h window), `doneLast24h`.
- **Marketplace** — `activeListings` and `salesLast24h`.
- **Replay mode** — boolean; true when the backend is running the deterministic replay worker instead of the live ingester.
- **Feature flags** — `MOMENTUM_FF_*` (kora, turnkey, blinks, settler, heliusDas).
- **Version / commit** — deployed version + git SHA for verifiability.

## Why it matters

The widget makes it easy for anyone (judges, sponsors, teammates) to verify without CLI access that the full end-to-end system is live: TxLINE credentials are healthy, the ingester is receiving packets (or replay is emitting them), the settler is landing transactions, and the marketplace is functioning. If any subsystem drops, the widget shows a red indicator with the specific failure.
