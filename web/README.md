<div align="center">

<img src="public/assets/logo.svg" alt="Momentum web" width="240" />

**The Momentum user-facing app.**

<br />

![TanStack](https://img.shields.io/badge/TanStack-Start-EF4444?style=flat-square)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square)
![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?style=flat-square)
![GSAP](https://img.shields.io/badge/GSAP-3.14-88CE02?style=flat-square)
![HeroUI](https://img.shields.io/badge/HeroUI-2.8-8B5CF6?style=flat-square)

</div>

---

## What this is

The web app is what a user (or judge) actually clicks. 15 routes, wallet-connected, SIWS-authed, real-time via SSE. Every layer of the design system — Bricolage Grotesque display + JetBrains Mono for numerics, cream / orange / dark-ink palette, `rounded-3xl` shape language — lives here.

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing (GSAP hero + live stats + closing CTA) |
| `/style-guide` | Design system reference (13 sections) |
| `/docs` | 12-section technical documentation with live HealthWidget |
| `/fixtures` | Real match list from TxLINE snapshot, sorted soonest-first |
| `/fixtures/$id` | Match hero + "Your prediction card" section + Watch Live CTA |
| `/fixtures/$id/predict` | Prediction card builder (1-8 slots) |
| `/fixtures/$id/live` | SSE-driven live view + reveal ceremony triggers |
| `/groups` | Group directory + create |
| `/groups/$pda` | Group lobby with Blink share link |
| `/album` | User's sticker collection with lineage modal |
| `/market` | Marketplace grid with filters |
| `/market/$pda` | Listing detail with lineage + buy flow |
| `/market/list` | List your own sticker for sale |
| `/profile/$wallet` | Public profile (stats + activity feed) |

## The killer demo moment

The "Merkle-proof reveal" is Momentum's signature interaction. Implemented as [`components/StickerRevealCurtain.tsx`](src/components/StickerRevealCurtain.tsx) — a 4-second GSAP timeline that:

1. Dims the screen with a "GOAL!" hero title
2. Slides in a gold receipt card with monospace on-chain data
3. Animates a 4-node Merkle path with pixel-shimmer + `stroke-dasharray` growth
4. Folds the tree into a hexagonal collectible with confetti
5. Slides the sticker to its slot position + flips HIT/MISS status
6. Fires a Solscan toast

Web Audio API SFX synthesized on the fly (no audio files). Full `prefers-reduced-motion` respect.

Demo-triggerable without wallet or backend:

```
http://localhost:3200/fixtures/18257739/live?trigger=demo
http://localhost:3200/fixtures/18257739/live?trigger=demo-match-card
```

## Design system

Three axes:

- **Minimalist** — cream `#F9F6EF` cards on dark `#0A0B0D` ink, one focal element per section
- **Curvy** — `rounded-3xl` (24px) everywhere, floating pill nav, blob hero morph
- **Pixel-art** — Raflux-style corner-bracket variants, monospace data fields, hexagonal sticker frames

**Fonts:** Bricolage Grotesque (display, wide + geometric) + JetBrains Mono (numerics/timestamps)
**Palette:** True black + warm orange `#F97316` accent + cream + 4-5 category colors
**Motion:** GSAP + `motion` (framer motion) — 4 custom `CustomEase` curves (`momentum-out`, `momentum-snap`, `momentum-glide`, `momentum-tick`)

## Prerequisites

- Bun 1.3+
- The Momentum backend running on `http://localhost:3700`
- (Optional) A Solana wallet extension (Phantom / Solflare) in devnet mode

## Setup

```bash
bun install
cp .env.example .env
```

`.env` critical vars:

```
VITE_API_URL=http://localhost:3700
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_SOLANA_CLUSTER=devnet
VITE_MOMENTUM_PROGRAM_ID=39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT
VITE_APP_URL=http://localhost:3200
```

## Run

```bash
bun run dev
```

Opens on [http://localhost:3200](http://localhost:3200).

## Build

```bash
bun run build
```

Outputs to `.output/`.

## Deploy

Vercel-ready via [`vercel.json`](vercel.json). One command from a linked repo:

```bash
vercel --prod
```

## Reference

See the [top-level README](../README.md) for the full product story, integration details, and live tx sigs.
