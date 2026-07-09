/**
 * Marketplace instruction builders — Phase D / D.2.
 *
 * On-chain contract ixs (all use Bubblegum CPI + canopy-truncated proof
 * remaining_accounts):
 *
 *   list_for_sale   -> seller signs; delegates leaf to global escrow_authority.
 *   buy_card        -> buyer signs; SOL Transfer + Bubblegum transfer under
 *                       escrow_authority PDA signature.
 *   cancel_listing  -> seller signs; escrow_authority restores delegate.
 *
 * All three take `asset_id: Pubkey` as ix arg #1 (used to derive the
 * `listing` PDA) plus root/data_hash/creator_hash/nonce/index for the
 * Bubblegum proof.
 *
 * IMPORTANT: `escrow_authority` PDA uses the seed `b"escrow_auth"` (not
 * `escrow_authority`). See `pdas.ts::deriveEscrowAuthority`.
 */

import { BN } from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';

import {
  BUBBLEGUM_PROGRAM_ID,
  MERKLE_TREE,
  SPL_ACCOUNT_COMPRESSION_ID,
  SPL_NOOP_ID,
  TREE_CONFIG_PDA,
} from './constants.ts';
import { deriveEscrowAuthority, deriveListing } from './pdas.ts';
import type { DasAssetProof } from '../helius.ts';

// ---- helpers ----

function base58ToBytes32(s: string): number[] {
  const bytes = bs58.decode(s);
  if (bytes.length !== 32) {
    throw new Error(`expected 32-byte base58 hash, got ${bytes.length} bytes`);
  }
  return Array.from(bytes);
}

/**
 * Convert a DAS getAssetProof response + getAsset creator/data hashes into
 * the shape the on-chain ix expects: {root, dataHash, creatorHash, nonce,
 * leafIndex} plus a proof node list (remaining_accounts).
 *
 * DAS returns the *tree* proof; the canopy already accounts for its share.
 * Bubblegum's CPI still expects the full path but we pass whatever DAS
 * returned — the Bubblegum program truncates to `canopy_depth`.
 */
export interface AssetProofBundle {
  root: number[];
  dataHash: number[];
  creatorHash: number[];
  nonce: bigint;
  leafIndex: number;
  proofAccounts: AccountMeta[];
}

export function proofToBundle(
  dasProof: DasAssetProof,
  dataHash: string,
  creatorHash: string,
  nonce: bigint | number,
  leafIndex: number,
): AssetProofBundle {
  return {
    root: base58ToBytes32(dasProof.root),
    dataHash: base58ToBytes32(dataHash),
    creatorHash: base58ToBytes32(creatorHash),
    nonce: typeof nonce === 'bigint' ? nonce : BigInt(nonce),
    leafIndex,
    proofAccounts: dasProof.proof.map((p) => ({
      pubkey: new PublicKey(p),
      isSigner: false,
      isWritable: false,
    })),
  };
}

// ---- list_for_sale ----

export interface BuildListForSaleArgs {
  program: Program;
  seller: PublicKey;
  assetId: PublicKey;
  priceLamports: bigint;
  proof: AssetProofBundle;
  merkleTree?: PublicKey;
  treeConfig?: PublicKey;
}

export async function buildListForSaleIx(
  args: BuildListForSaleArgs,
): Promise<TransactionInstruction> {
  const {
    program,
    seller,
    assetId,
    priceLamports,
    proof,
    merkleTree = MERKLE_TREE,
    treeConfig = TREE_CONFIG_PDA,
  } = args;

  const [listingPda] = deriveListing(assetId);
  const [escrowAuthority] = deriveEscrowAuthority();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = await (program.methods as any)
    .listForSale(
      new BN(priceLamports.toString()),
      assetId,
      proof.root,
      proof.dataHash,
      proof.creatorHash,
      new BN(proof.nonce.toString()),
      proof.leafIndex,
    )
    .accountsPartial({
      seller,
      listing: listingPda,
      escrowAuthority,
      treeConfig,
      merkleTree,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      logWrapper: SPL_NOOP_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(proof.proofAccounts)
    .instruction();

  return ix;
}

// ---- buy_card ----

export interface BuildBuyCardArgs {
  program: Program;
  buyer: PublicKey;
  seller: PublicKey;
  assetId: PublicKey;
  proof: AssetProofBundle;
  merkleTree?: PublicKey;
  treeConfig?: PublicKey;
}

export async function buildBuyCardIx(
  args: BuildBuyCardArgs,
): Promise<TransactionInstruction> {
  const {
    program,
    buyer,
    seller,
    assetId,
    proof,
    merkleTree = MERKLE_TREE,
    treeConfig = TREE_CONFIG_PDA,
  } = args;

  const [listingPda] = deriveListing(assetId);
  const [escrowAuthority] = deriveEscrowAuthority();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = await (program.methods as any)
    .buyCard(
      assetId,
      proof.root,
      proof.dataHash,
      proof.creatorHash,
      new BN(proof.nonce.toString()),
      proof.leafIndex,
    )
    .accountsPartial({
      buyer,
      seller,
      listing: listingPda,
      escrowAuthority,
      treeConfig,
      merkleTree,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      logWrapper: SPL_NOOP_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(proof.proofAccounts)
    .instruction();

  return ix;
}

// ---- cancel_listing ----

export interface BuildCancelListingArgs {
  program: Program;
  seller: PublicKey;
  assetId: PublicKey;
  proof: AssetProofBundle;
  merkleTree?: PublicKey;
  treeConfig?: PublicKey;
}

export async function buildCancelListingIx(
  args: BuildCancelListingArgs,
): Promise<TransactionInstruction> {
  const {
    program,
    seller,
    assetId,
    proof,
    merkleTree = MERKLE_TREE,
    treeConfig = TREE_CONFIG_PDA,
  } = args;

  const [listingPda] = deriveListing(assetId);
  const [escrowAuthority] = deriveEscrowAuthority();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = await (program.methods as any)
    .cancelListing(
      assetId,
      proof.root,
      proof.dataHash,
      proof.creatorHash,
      new BN(proof.nonce.toString()),
      proof.leafIndex,
    )
    .accountsPartial({
      seller,
      listing: listingPda,
      escrowAuthority,
      treeConfig,
      merkleTree,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      logWrapper: SPL_NOOP_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(proof.proofAccounts)
    .instruction();

  return ix;
}
