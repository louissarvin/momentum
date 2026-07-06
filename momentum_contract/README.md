<div align="center">

<img src="../web/public/assets/logo.svg" alt="Momentum contract" width="240" />

**The Momentum Anchor program on Solana devnet.**

<br />

![Anchor](https://img.shields.io/badge/Anchor-0.31.1-512BD4?style=flat-square)
![Rust](https://img.shields.io/badge/Rust-1.93-000000?style=flat-square)
![Solana](https://img.shields.io/badge/Solana-devnet-9945FF?style=flat-square)
![mpl-bubblegum](https://img.shields.io/badge/mpl--bubblegum-2.1.1-EE6A55?style=flat-square)
![Instructions](https://img.shields.io/badge/instructions-13-2A6DF4?style=flat-square)

</div>

---

## What this is

The on-chain program is where Momentum's trust lives. Every prediction card is a PDA. Every sticker mint is gated on a TxLINE Merkle proof CPI. Every marketplace swap is atomic (CEI-ordered) and enforced by `has_one` + address constraints.

**Program ID:** `39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT` (Solana devnet)

## Instructions

13 handlers grouped by role:

**Admin (once):**
- `initialize_tree_state` — bind Bubblegum tree to program
- `initialize_collection_state` — register MOMENTUM 2026 collection

**Group lifecycle:**
- `create_group` / `join_group` / `pause_group` / `unpause_group` / `distribute_prize`

**Prediction lifecycle:**
- `submit_predictions` — user creates card (init-only, 1-8 slots)
- `settle_prediction` — keeper settles one slot with TxLINE proof + mints cNFT
- `claim_match_card` — keeper mints summary card at `game_finalised`

**Marketplace:**
- `list_for_sale` / `buy_card` / `cancel_listing`

## The load-bearing handler

`settle_prediction` is the single most important instruction. It composes TxLINE's `validate_stat` CPI with Bubblegum's `mint_to_collection_v1` CPI in one atomic transaction. If the proof CPI fails at any check (`InvalidPda`, `PredicateFailed`, `RootNotAvailable`, `TimeSlotMismatch`, `StatKeyMismatch`), the whole transaction reverts and no sticker exists.

See [`programs/momentum/src/instructions/settle_prediction.rs`](programs/momentum/src/instructions/settle_prediction.rs).

## Prerequisites

- Rust 1.93+
- Anchor CLI 0.31.1
- Solana CLI 2.3.12 (Agave)
- Node.js 20+ (for yarn + ts-mocha)

## Build

```bash
anchor build
```

Produces `target/deploy/momentum.so` (~539 KB) + `target/idl/momentum.json`.

## Test

Uses `solana-bankrun` for deterministic CPI paths (no local validator needed).

```bash
yarn install
yarn ts-mocha -p ./tsconfig.json -t 1000000 tests/**/*.ts
```

Expected: 19 passing, 5 pending, 0 failing.

## Deploy (already deployed)

The program is already live on devnet. To verify:

```bash
solana program show 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT --url devnet
anchor idl fetch 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT --provider.cluster devnet
```

To upgrade (requires the admin keypair + ~0.5 SOL):

```bash
anchor upgrade target/deploy/momentum.so \
  --program-id 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT \
  --provider.cluster devnet
anchor idl upgrade 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT \
  -f target/idl/momentum.json --provider.cluster devnet
```

## Live deployed artifacts

| Artifact | Address |
|---|---|
| Momentum program | `39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT` |
| Bubblegum tree | `2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX` |
| Tree config (delegate = mint_auth) | `FH11cU3FJZGyutv6DKynbncjnkK8aTf1NwCBQD1cCfdc` |
| TreeState PDA | `9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr` |
| CollectionState PDA | `Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj` |
| Collection mint | `CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg` |
| mint_auth PDA | `FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41` |
| Address Lookup Table | `E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9` |
| txoracle (sponsor) devnet | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` |

## Reference

See the [top-level README](../README.md) for the full product story, integration details, and live tx sigs.
