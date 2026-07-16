# Business Highlights

## Market angle

- Solana consumer sports is the exact Sleeper-shaped opportunity — fantasy-style social prediction, but with instant on-chain settlement and collectibles that can travel.
- The 2026 FIFA World Cup is the right beachhead: a fixed calendar of ~64 fixtures with global mindshare, guaranteed live coverage from TxLINE, and viral moments (goals, cards, upsets) baked into every match.
- Sticker albums are a proven collector primitive with cross-generational appeal — Panini stickers sold in the billions during the last World Cup cycle. Momentum ports the pattern to a wallet that anyone can inspect.
- Consumer wallets (Phantom, Backpack) render Metaplex Bubblegum compressed NFTs natively in 2026, so the collectible surface is discoverable without a bespoke app.
- Prediction cards create a natural social loop: private groups of 2-12 friends compete on the same fixture, and the leaderboard emerges from a public on-chain scoreboard.

## Monetization path

- **Freemium groups.** Small private groups (up to 12) stay free. Paid tiers unlock bigger groups, custom fixtures, and premium sticker art.
- **Marketplace fee.** Momentum ships with an on-chain fixed-price marketplace (`list_for_sale` / `buy_card`) — a 2-3% protocol fee slots in cleanly at settlement.
- **Sponsor packs.** Tournament and club sponsors buy limited-edition sticker collections. Because every mint is bound to a real proved stat, sponsors can seed drops that only unlock on genuine on-chain events (e.g., "first hat-trick of the group stage").
- **Data resale opt-in.** Aggregated prediction distributions are a valuable signal for sportsbooks and media — users can opt in for a revenue share.
- **Season passes.** Album completion mechanics (e.g., "collect all 32 team stickers") drive repeat engagement across a tournament.

## Sponsor fit

- **Maximizes TxLINE surface area.** Momentum uses TxLINE both as an HTTP data plane (fixtures, live scores stream, historical updates) AND as an on-chain settlement primitive (`validate_stat` CPI). The full end-to-end verifiability story is the demo.
- **Consumer-visible proof.** Most on-chain oracle use is invisible to end users. Momentum makes it fan-visible: every sticker literally carries the Merkle-proved outcome. TxLINE becomes a brand fans see, not just infrastructure.
- **Volume story.** A single World Cup fixture with 100 fan groups of 8 users each generates ~5,000 `validate_stat` CPIs — high-volume, fully-verifiable settlement that showcases TxLINE's throughput.
- **Long-lived integration.** Sports data is a permanent need. Momentum is not a one-shot demo — the app can run continuously across World Cup, club leagues, and future tournaments.
