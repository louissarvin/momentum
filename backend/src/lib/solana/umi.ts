/**
 * Bubblegum asset-id helpers via umi.
 *
 * The on-chain program uses `mpl_bubblegum::utils::get_asset_id(tree, nonce)`
 * to bind a Merkle leaf to a Solana pubkey (the "cNFT asset id"). The umi
 * SDK exposes the same helper on the JS side; we wrap it here so callers can
 * derive the asset id after `settle_prediction` / `claim_match_card` land on
 * chain (needed to backfill `StickerMint.assetId` and to query DAS).
 *
 * We avoid spinning up a full umi context for a pure-math helper — the
 * `findLeafAssetIdPda` fn only needs the tree pubkey + u64 nonce and the
 * Bubblegum program id. All three are already in `constants.ts`.
 */

import { PublicKey } from '@solana/web3.js';
import { BUBBLEGUM_PROGRAM_ID, MERKLE_TREE } from './constants.ts';

/**
 * `mpl_bubblegum::utils::get_asset_id(tree, nonce)` — port.
 *
 * Seeds: [b"asset", tree.toBytes(), nonce.toU64LE()]  under Bubblegum program.
 * Ref: mpl-bubblegum sources; verified against the on-chain Rust helper the
 * program emits into MatchCardClaimed / StickerMintedFromCard events.
 */
export function deriveAssetId(
  tree: PublicKey,
  leafIndex: bigint | number,
): PublicKey {
  const idx = typeof leafIndex === 'bigint' ? leafIndex : BigInt(leafIndex);
  const nonceLE = Buffer.alloc(8);
  nonceLE.writeBigUInt64LE(idx, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('asset'), tree.toBuffer(), nonceLE],
    BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

/**
 * Convenience wrapper against the Momentum tree.
 */
export function deriveMomentumAssetId(leafIndex: bigint | number): PublicKey {
  return deriveAssetId(MERKLE_TREE, leafIndex);
}
