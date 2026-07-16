# Overview

**MOMENTUM turns every World Cup moment into a verifiable, wallet-visible collectible.**

Momentum is a Solana consumer game built on TxLINE's verifiable sports oracle. Fans submit up to eight pre-match stat predictions per fixture (over/under goals, cards, corners, exact scores). When the match ends, a permissionless keeper collapses the full settlement stack into a single Solana transaction: TxLINE's `validate_stat` verifies the outcome against a live Merkle root, and Metaplex Bubblegum mints a compressed sticker NFT bound to that proof. Every sticker lands in a wallet-visible collection with the on-chain `event_stat_root` and `proof_ts` stamped into program state.

**The killer demo moment.** A group of friends picks their World Cup Final slots on desktop. At full whistle, the settler starts firing. Within seconds, everyone's wallet shows sticker cNFTs that lineage-verify back to a specific TxLINE Merkle root and a specific proved stat value. No trust in a centralized backend, no "check back in an hour" — the receipt IS the collectible.

The rest of this documentation covers the business angle, technical novelty, exact TxLINE endpoints hit, on-chain artifacts deployed on devnet, and verifiable transactions you can inspect on Solscan.
