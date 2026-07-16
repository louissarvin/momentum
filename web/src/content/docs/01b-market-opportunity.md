# Market Opportunity

## Size

Global sports and predictions is one of the largest consumer categories on the internet.

- **Sports betting** — approximately $100B in gross gaming revenue globally in 2025, growing double digits year over year as more US states regulate
- **Fantasy sports** — $18B in 2025 with 60M+ active US users, dominated by DraftKings and FanDuel
- **Free-to-play prediction games** — Sleeper hit $2B GMV and 2M DAU on a web2 stack with zero on-chain component

## The Web3 Gap

Every one of the above categories is trust-me-bro. The web3 prediction market space has been dominated by high-friction, permissioned platforms (Polymarket, Kalshi) targeting news and politics — not the football fan.

- Fliff dodges regulation with dual-currency (US cash + Fliff coins) but is off-chain
- WeLikeSports (Frontier 2026 finalist) proved consumer appetite on Solana but lacks a verifiable settlement primitive
- No shipped product combines a sponsor-native oracle + wallet-visible collectibles + sub-cent mint economics

Momentum is the first product where every settlement is a Merkle-anchored on-chain proof AND every collectible groups under a real Metaplex collection AND every mint costs a fraction of a US cent.

## Why 2026 World Cup

- **3+ billion viewers** — the largest single sports audience on the planet
- **104 matches** across ~5 weeks — enough surface for repeat engagement
- **TxLINE free tier covers World Cup + International Friendlies on devnet** — no cost to prove the product live
- **Consumer track of the TxODDS hackathon** — least crowded of three (67 Trading, 86 Prediction Markets, ~40 Consumer submissions)

## Why Solana

- **Sub-cent mint economics** — Bubblegum compressed NFTs at approximately $0.00005 per leaf mint. Un-viable on any other L1.
- **TxLINE is Solana-native** — no cross-chain bridge required, oracle CPI is native
- **Solana Actions / Blinks** — Momentum groups + share-card mints unfurl as signable buttons directly inside X/Twitter and Telegram
- **Wallet ecosystem maturity** — Phantom, Backpack, Solflare all support cNFT collections natively

## Distribution Loop

1. User joins a Momentum group via a shareable Blink link posted in X, Discord, or Telegram
2. User builds a prediction card in 30 seconds
3. Match happens → live Merkle-proof reveal animation → sticker cNFT minted
4. User shares the sticker (another Blink) to brag, invite friends to predict against them
5. Marketplace fees on secondary sales

This is the Sleeper distribution loop with a verifiable-settlement primitive underneath.

## Monetization Path

- **Marketplace fees** — flat basis-points on every secondary sticker sale (currently `sellerFeeBasisPoints: 500` = 5% baked into cNFT metadata)
- **Entry-fee groups** — non-zero `entry_fee_lamports` on `create_group` funds a SOL vault. `distribute_prize` splits proportional to hit-rate. Currently 0 for hackathon; ready to enable for mainnet.
- **Premium tiers** — post-hackathon TxLINE paid tiers unlock Premier League, La Liga, Champions League, Serie A. Same code, different `subscribe(service_level_id, weeks)` call.
- **Sponsor rev-share** — TxODDS BD gets a demoable end-user product they can white-label for Bet365 / DraftKings / any regulated operator wanting a "verifiable receipt" narrative

The product is defensible because the moat is the *combination* of (verifiable settlement + wallet-visible collectibles + fan-native UX). Any competitor has to rebuild all three layers.
