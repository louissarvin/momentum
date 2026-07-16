# Problem and Solution

## The Problem

Prediction games are trust-me-bro.

The user picks an outcome. A centralized server records it. The match ends. The same server tells the user whether they won. Rewards get credited. The user must trust the operator every step of the way — the odds are correct, the outcome was scored honestly, the payout wasn't clipped, the collectible NFT is really mine.

For sports especially, the data pipeline is opaque:

- Score feeds come from privately-operated APIs
- Bookmakers publish results after the fact with no auditable trail
- Even "on-chain" prediction markets settle from a single admin key that watches ESPN
- Fantasy platforms hold your team + points + winnings inside their own database

None of it is verifiable. If a platform disappears, so do your collectibles and your history.

## The Solution

Momentum flips the trust boundary. Every sticker cNFT is cryptographically bound to a TxLINE Merkle proof, verified by the Solana program itself in the same instruction that mints the NFT.

The settlement path is one atomic transaction:

1. TxLINE `validate_stat` CPI — the Solana program calls into `txoracle` v1.4.2 and passes the fixture, predicate, and Merkle proof
2. `txoracle` re-derives the daily-scores Merkle root PDA and validates the proof on-chain against its own anchored state
3. Only if the proof is valid does execution reach the Bubblegum `MintToCollectionV1` CPI
4. Every sticker minted from that path carries `event_stat_root` + `proof_ts` in its state and in the emitted event

If the proof is bad, the whole transaction reverts. No sticker exists. Ever.

The user does not need to trust the operator. The operator does not need to trust the oracle. The oracle does not need to trust the user. All three trust the Merkle path.

## Why This Matters

- **Auditable in perpetuity** — every collectible is provable years later even if the platform is gone
- **No admin key can rewrite history** — the mint authority is a program-derived address, not a wallet
- **The audit trail is the UX** — click any sticker, expand the Merkle path, jump to Solscan
- **Sponsor delight** — TxLINE's own product is what the user sees on every prediction receipt
