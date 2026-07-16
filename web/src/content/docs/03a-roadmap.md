# Roadmap

## Now — Hackathon (shipped)

**On-chain**

- Solana Anchor program deployed on devnet at `39oqYs...` with 13 instructions
- Two program upgrades applied without downtime
- `distribute_prize`, `pause_group`, `unpause_group` shipped
- MOMENTUM 2026 Metaplex collection binds every mint into one wallet-visible album
- Six real live devnet transactions covering the full CPI path (settle, match_card, list, buy)

**Backend**

- Bun + Fastify + Prisma with 20+ REST/SSE/Blinks endpoints
- Four processes: HTTP, ingester, settler, replay
- TxLINE gateway with rotating auth + auto-refresh
- Postgres LISTEN/NOTIFY bridge for cross-process SSE fanout
- 34 tests passing (PDA parity, IDL shape, serialization, route shape)
- Replay mode for judging-day insurance

**Frontend**

- TanStack Start + React 19 + Tailwind 4 + GSAP + Framer Motion
- Full user flow: wallet connect → SIWS → predict → live reveal → album → marketplace
- Killer Merkle-proof reveal animation with 6-phase timeline + Web Audio SFX
- Solana Actions / Blinks share buttons
- View-transitions API for dark/light theme swap
- Live HealthWidget on `/docs` polling backend every 5s

## Next 30 days — Mainnet + Growth

- **Mainnet program deploy** using the same devnet program keypair
- **TxLINE paid tier subscription** to unlock Premier League, La Liga, Champions League, Serie A
- **Public backend deployment** on Fly.io + Neon Postgres, tuned rate limits for internet traffic
- **Public web deployment** on Vercel (already configured, `vercel.json` in place)
- **Sentry** wired to real DSN, error-tracked with wallet + tx-sig tags
- **Kora fee relayer** for gasless UX so new users can predict without holding SOL
- **Real sticker artwork** — commission 24 templates × 5 rarity palettes (120 sprites) to replace procedural SVG placeholders
- **Twitter launch thread** + Superteam ecosystem post + Solana Foundation submission

## Q4 2026 — Product depth

- **Turnkey embedded wallets** for social login onramp (no browser extension required)
- **Group leaderboards + prize pool distribution flow** in the frontend (contract already supports `distribute_prize`)
- **Match card SVG generation** at `/api/match-cards/:fixtureId/image.svg` fully personalized with real fixture logos
- **Inline Blinks widget** on group lobby pages so a friend can join in-place without leaving X
- **Notification stream** — invites, listing sold, match starting
- **Onboarding tour** — 4-step tooltip walkthrough on first wallet connect
- **Reveal audio pack** — professionally recorded pixel-art SFX to replace synthesized Web Audio tones
- **Multi-language** — Portuguese, Spanish, Japanese for the football-heavy markets

## 2027 — Platform

- **Multi-chain oracle abstraction** — same UX, different oracles (Chainlink, Pyth) for markets TxLINE doesn't cover
- **Third-party sponsors** — white-label deployment for DraftKings, Bet365, FanDuel wanting a "verifiable receipt" primitive
- **Creator groups** — influencers create branded prediction groups with rev-share on marketplace fees
- **Season-long tournaments** with escrowed prize pools, seasonal leaderboards, and cNFT trophies
- **API for third-party integrations** — embed a Momentum prediction card in any web page via oEmbed
- **Mobile app** — native iOS + Android for push notifications and share-sheet integration

## Beyond — Sports-agnostic prediction primitive

The `momentum` program is not football-specific. Any TxLINE-supported event feeds the same CPI. Roadmap includes:

- Basketball (NBA / Euroleague)
- Tennis (Grand Slams)
- Formula 1
- Esports events with real oracle feeds

Same contract. Same collection. Same album. Same audit trail.
