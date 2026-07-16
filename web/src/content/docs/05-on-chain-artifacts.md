# On-Chain Artifacts

Every account Momentum owns or references on Solana devnet. Every address links to Solscan for independent verification.

| Purpose                                      | Address                                        | Solscan                                                                                        |
| -------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Momentum program                             | `39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT` | [view](https://solscan.io/address/39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT?cluster=devnet) |
| Program data                                 | `4UFjiAgrhyoTK19sTtLRcFMHvXGqWVvAnQeVdWJ79wmz` | [view](https://solscan.io/address/4UFjiAgrhyoTK19sTtLRcFMHvXGqWVvAnQeVdWJ79wmz?cluster=devnet) |
| IDL account                                  | `G3wiyk7Q4L1t2zfxaxeZnWKyd71kqLQph46Y89Nqy6on` | [view](https://solscan.io/address/G3wiyk7Q4L1t2zfxaxeZnWKyd71kqLQph46Y89Nqy6on?cluster=devnet) |
| Bubblegum tree                               | `2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX` | [view](https://solscan.io/address/2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX?cluster=devnet) |
| Bubblegum tree config                        | `FH11cU3FJZGyutv6DKynbncjnkK8aTf1NwCBQD1cCfdc` | [view](https://solscan.io/address/FH11cU3FJZGyutv6DKynbncjnkK8aTf1NwCBQD1cCfdc?cluster=devnet) |
| TreeState PDA (`["tree_state"]`)             | `9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr` | [view](https://solscan.io/address/9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr?cluster=devnet) |
| CollectionState PDA (`["collection_state"]`) | `Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj`  | [view](https://solscan.io/address/Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj?cluster=devnet)  |
| Collection mint (MOMENTUM 2026)              | `CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg` | [view](https://solscan.io/address/CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg?cluster=devnet) |
| Collection metadata                          | `m82nwvqoxZ27LnfjeMzCGe7j1XsQQMdHTWhm4C6vk3D`  | [view](https://solscan.io/address/m82nwvqoxZ27LnfjeMzCGe7j1XsQQMdHTWhm4C6vk3D?cluster=devnet)  |
| Collection master edition                    | `Fen6DcmpQK6gkFYqom8BuSCEps54X9shY763XyLU56tL` | [view](https://solscan.io/address/Fen6DcmpQK6gkFYqom8BuSCEps54X9shY763XyLU56tL?cluster=devnet) |
| `mint_auth` PDA (`["mint_auth"]`)            | `FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41` | [view](https://solscan.io/address/FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41?cluster=devnet) |
| Address Lookup Table (settle v0 tx)          | `E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9` | [view](https://solscan.io/address/E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9?cluster=devnet) |
| TxLINE `txoracle` program (sponsor)          | `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` | [view](https://solscan.io/address/6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J?cluster=devnet) |
| Admin keeper (see note)                      | `2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV` | [view](https://solscan.io/address/2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV?cluster=devnet) |

## Key roles of `mint_auth` PDA

The `mint_auth` PDA is a single Momentum-owned signer that plays three roles at settlement time:

1. **Tree delegate** of the Bubblegum merkle tree (set via `set-tree-delegate`).
2. **Collection update authority** on the MOMENTUM 2026 collection.
3. **Collection token owner** of the collection NFT.

All three are proved with a single `invoke_signed` in `settle_prediction` / `claim_match_card`.

## Admin note

Only the admin keeper above can call the bootstrap-only instructions `initialize_tree_state` and `initialize_collection_state`. All user-facing and keeper-facing instructions (`create_group`, `join_group`, `submit_predictions`, `settle_prediction`, `claim_match_card`, `list_for_sale`, `buy_card`, `cancel_listing`) are permissionless — anyone can call them from any wallet subject to on-chain constraints. Rotate to a multisig before any mainnet deploy.
