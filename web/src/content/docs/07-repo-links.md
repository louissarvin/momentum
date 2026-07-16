# Repository

## Source

- **GitHub:** _TBD — repo URL to be added before submission_
- **Live demo:** _TBD — demo URL to be added before submission_
- **Demo video:** _TBD — video URL to be added before submission_

## Monorepo layout

Momentum ships as three independently buildable subtrees.

```
momentum/
├─ momentum_contract/   Solana Anchor program (devnet)
├─ backend/             Bun + Fastify + Prisma + 4 workers
└─ web/                 TanStack Start + React 19 + Tailwind 4
```

### `momentum_contract/` — On-chain

```
programs/momentum/src/
├─ lib.rs              Program entry + declare_id
├─ state.rs            Group, PredictionCard, Sticker, Listing
├─ events.rs           StickerMinted, MatchCardClaimed, ...
├─ errors.rs           Custom error codes
└─ instructions/       10 handlers: create_group, join_group,
                       submit_predictions, settle_prediction,
                       claim_match_card, list_for_sale,
                       buy_card, cancel_listing, plus 2 init
```

Supporting: `scripts/` deploy + admin, `tests/` bankrun harness, `idls/` txoracle v1.4.2.

### `backend/` — Off-chain

```
src/
├─ config/             Zod env schema
├─ plugins/            Fastify plugin stack (auth, CORS, ratelimit)
├─ routes/             /api/* handlers
├─ workers/            ingester, settler, replay (separate Bun procs)
├─ middlewares/        JWT verify + session
└─ lib/
   ├─ txline/          TxLINE client, bootstrap, SSE
   ├─ solana/          Anchor + PDAs + tx builders
   └─ stream/          In-proc event hub + pg NOTIFY bridge
```

Supporting: `prisma/schema.prisma` (14 models), `scripts/` backfill + e2e-sim + seed-proof.

### `web/` — User surface

```
src/
├─ routes/             File-based routing (TanStack Router)
├─ components/         AppHeader, Footer, reveal ceremonies
├─ providers/          Solana wallet, theme, HeroUI, Lenis
├─ hooks/              useAuth, useFixtureStream (SSE)
├─ lib/                api client, anchor, sticker-art SVG, audio
└─ content/docs/       This documentation
```

Supporting: `DESIGN.md` (design system spec), `notes/web-plan.md` (6-phase build log).

Each subtree has its own `README.md` with a local quickstart. See the repo-root `README.md` for the aggregate story.
