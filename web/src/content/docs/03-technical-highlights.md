# Technical Highlights

## 1. One-transaction verifiable settlement

The Momentum program's `settle_prediction` and `claim_match_card` instructions collapse the entire outcome-to-collectible pipeline into a single Solana transaction. Inside one instruction, the program CPIs into TxLINE's `txoracle::validate_stat` (which verifies the sub-tree proof, main tree proof, and evaluates the `TraderPredicate` against the sealed stat root) and immediately CPIs into `mpl_bubblegum::MintToCollectionV1` signed by the `mint_auth` PDA. Either both succeed atomically or the transaction reverts — there is no in-between state where a sticker exists without a valid Merkle proof.

## 2. On-chain proof lineage

Every sticker carries its own audit trail in program state. `PredictionSlot` persists `event_stat_root: [u8;32]` and `proof_ts: i64` from the exact TxLINE payload that satisfied the predicate (see `programs/momentum/src/state.rs`). Both fields are also emitted in the `StickerMinted` and `MatchCardClaimed` events (`programs/momentum/src/events.rs`) alongside the derived `asset_id`, so any indexer can reconstruct the full chain: sticker → asset ID → prediction slot → TxLINE root → original stat proof.

## 3. Wallet-visible collection

Every mint binds to the MOMENTUM 2026 Metaplex collection (`CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg`) via `Collection { verified: true }` in `MetadataArgs`. The `mint_auth` PDA is both the tree delegate AND the collection update authority AND the collection token owner, signing both roles in a single `invoke_signed`. This is rare in 2026 hackathon projects: most cNFT demos ship un-grouped mints. Momentum's stickers appear grouped as one album in Phantom / Backpack / Solflare / Solscan collection views.

## 4. Address Lookup Table + versioned transactions

`settle_prediction` touches 20+ accounts (card, tree state, mint auth, tree config, merkle tree, collection state, collection mint, collection metadata, collection edition, bubblegum signer, txoracle, log wrapper, compression program, token metadata program, system program, plus TxLINE's daily_scores_roots and the leaf owner). A legacy transaction would clock in at 1362 bytes — over the 1232-byte limit. Momentum uses an Address Lookup Table (`E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9`) with 16 static entries and a v0 versioned transaction. Final settlement tx: **933 bytes**.

## 5. Replay mode

The `REPLAY_MODE=true` worker (`backend/src/workers/replay.ts`) reads archived `ScorePacket` rows from Postgres and re-emits them at natural cadence divided by `REPLAY_SPEED`, driving the exact same classification + settlement pipeline as the live ingester. Judging-day insurance: if the TxLINE live stream is quiet (e.g., no fixtures in play during the demo), Momentum replays a captured fixture (`REPLAY_FIXTURE_ID=18237038`, the World Cup group fixture used across build) and the full settle chain still fires end-to-end. The live ingester has a boot guard that exits when replay mode is active, so the two producers never fight for the pg_notify channel.

## 6. Four-process Bun architecture

Momentum backend runs as four independent Bun processes, each with structured pino logs and graceful degradation:

- **HTTP** — Fastify API + SSE fanout + SIWS auth.
- **Ingester** — TxLINE SSE consumer, upserts `ScorePacket`, classifies for settlement.
- **Settler** — polls `SettlementJob`, builds v0 txs with priority-fee escalation, lands `settle_prediction` / `claim_match_card` on devnet.
- **Replay** — optional; replaces the ingester for demo determinism.

Cross-process fanout uses Postgres `LISTEN`/`NOTIFY` on three channels (`momentum_packet`, `momentum_sticker`, `momentum_match_card`) — no Redis, no queue infrastructure. `/health` reports per-worker liveness via filesystem heartbeats.

## Architecture

```
Frontend (TanStack Start / React 19 / Tailwind 4 / GSAP)
  ↓ REST + SSE
Backend (Bun + Fastify + Prisma + 4 workers)
  ↓ Anchor
Solana Program (Momentum v1)  ←  CPI  →  TxLINE (txoracle v1.4.2)
  ↓ CPI
Metaplex Bubblegum (cNFT tree + MOMENTUM 2026 collection)
```
