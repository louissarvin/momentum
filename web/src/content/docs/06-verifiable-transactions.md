# Verifiable Transactions

Every headline capability of Momentum has a live devnet transaction you can inspect. Each entry links to Solscan; no truncation.

## Full verifiable settlement (TxLINE `validate_stat` + Bubblegum `MintToCollectionV1`)

The first end-to-end proof of the system. Fixture `18237038` (World Cup group stage), seq `732`, statKey `2` (period 4) with value `2` satisfying the `> 0` HIT predicate. Executed via the on-chain smoke test, v0 tx with ALT, 933 bytes.

- Tx: `24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g`
- Solscan: https://solscan.io/tx/24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g?cluster=devnet

## Backend-driven `settle_prediction` (Phase C end-to-end)

Same instruction, this time landed by the backend's `settler` worker after a fresh user wallet submitted predictions via the REST API. Priority-fee escalation, ProofCache-first, structured logs.

- Tx: `4fH7oq6RhWyUnKSUTcRSx7vYYGKKt8kHSQigHtsW7gZoGwaZ4U8pbbSoxcJvrevsUMABAQT6GMaowtRYrQPc2oQ2`
- Solscan: https://solscan.io/tx/4fH7oq6RhWyUnKSUTcRSx7vYYGKKt8kHSQigHtsW7gZoGwaZ4U8pbbSoxcJvrevsUMABAQT6GMaowtRYrQPc2oQ2?cluster=devnet

## `claim_match_card` (Phase D)

Match-card mint for the keeper's card on fixture 18237038.

- Tx: `24mEF77YJXGfJMW5qyoHfxzenyrF3aTUiKvfsaRjYAjZttcBafoAsozg1WnKU5fQpPoLr6kwz5eCkb5z3rkDUqYc`
- Solscan: https://solscan.io/tx/24mEF77YJXGfJMW5qyoHfxzenyrF3aTUiKvfsaRjYAjZttcBafoAsozg1WnKU5fQpPoLr6kwz5eCkb5z3rkDUqYc?cluster=devnet

## `claim_match_card` (Phase D, second user)

Same instruction, second user wallet. Proves the flow works for arbitrary card owners.

- Tx: `54jNvFvTAd7ndbxrrWAejsAJh1ep7PELe2cc5kPzH4nZiRSJ9p13xUt4q27wL6xgmpaZmephi74LHASh2RbayKE3`
- Solscan: https://solscan.io/tx/54jNvFvTAd7ndbxrrWAejsAJh1ep7PELe2cc5kPzH4nZiRSJ9p13xUt4q27wL6xgmpaZmephi74LHASh2RbayKE3?cluster=devnet

## `list_for_sale` (Phase D marketplace)

Lists a match-card cNFT for sale. Uses Helius DAS-derived asset proof, sets the global `escrow_auth` PDA as the leaf delegate.

- Tx: `3fWbc4QCF7z9aABKWkyWLcQ9Lytnv1pPBCHqxKu4dFjzkyTeKGHNsKKG6FkeV4oPsEaNqUDbhtcpmaMwDd3kXUf8`
- Solscan: https://solscan.io/tx/3fWbc4QCF7z9aABKWkyWLcQ9Lytnv1pPBCHqxKu4dFjzkyTeKGHNsKKG6FkeV4oPsEaNqUDbhtcpmaMwDd3kXUf8?cluster=devnet

## `buy_card` (Phase D marketplace)

Atomic buy: SOL transfers to seller, cNFT transfers to buyer, listing account closes to seller for rent recovery. Checks-Effects-Interactions ordering (listing.active flipped to false before the Bubblegum CPI).

- Tx: `458X2xSpZGmUTvSmP9gcgz6JhvWjwCMuKExDE2EL8UficK9swDmgCtgk9H82PECaUxq8oycDEDAEfogLGHYuTTmv`
- Solscan: https://solscan.io/tx/458X2xSpZGmUTvSmP9gcgz6JhvWjwCMuKExDE2EL8UficK9swDmgCtgk9H82PECaUxq8oycDEDAEfogLGHYuTTmv?cluster=devnet

## Program upgrade (Pass 7)

Adds `initialize_collection_state`, `CollectionState` account, and swaps `MintV1CpiBuilder` → `MintToCollectionV1CpiBuilder` in both settle handlers. No state migration required (additive schema).

- Tx: `2yepSUKCn4BYXqmEhrN6ZsGxtCmN7sVP92yf7vLsBqnbz9MtFEEE8iE9irpdKGEr9s4TP5M1sidnRcG8NCAYCdQz`
- Solscan: https://solscan.io/tx/2yepSUKCn4BYXqmEhrN6ZsGxtCmN7sVP92yf7vLsBqnbz9MtFEEE8iE9irpdKGEr9s4TP5M1sidnRcG8NCAYCdQz?cluster=devnet
