/**
 * `claim_match_card` builder + sender — Phase D / D.1.
 *
 * Mirrors `settle.ts` (v0 tx + ALT + 600K CU + skipPreflight) but for the
 * match card cNFT rather than a sticker. Called by the settler when a
 * `type='match_card'` job is picked up.
 *
 * The keeper picks a trivially-satisfied `TraderPredicate` against the final
 * fixture stats — typically `stat_key = 1` (total goals, whatever the sport
 * uses as the "always-populated after final whistle" root) with
 * `GreaterThan(threshold=0)` — which the contract validates via TxLINE CPI.
 *
 * Because we depend on a *validated* proof for the final state, the caller
 * (settler) MUST pass a ProofCache row (or live TxLINE proof) whose
 * `statusId == 100` epoch matches the fixture's finalise packet.
 */

import { BN } from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  BUBBLEGUM_PROGRAM_ID,
  BUBBLEGUM_SIGNER_PDA,
  COLLECTION_EDITION,
  COLLECTION_METADATA,
  COLLECTION_MINT,
  COLLECTION_STATE_PDA,
  MERKLE_TREE,
  MINT_AUTH_PDA,
  MPL_TOKEN_METADATA_ID,
  SETTLE_ALT_ADDRESS,
  SPL_ACCOUNT_COMPRESSION_ID,
  SPL_NOOP_ID,
  TREE_CONFIG_PDA,
  TREE_STATE_PDA,
} from './constants.ts';
import { deriveDailyScoresRoot, derivePredictionCard, TXLINE_PROGRAM_ID } from './pdas.ts';
import type { normalizeProofForContract } from './settle.ts';

// ---- args ----

export interface ClaimMatchCardArgs {
  program: Program;
  connection: Connection;
  keeper: Keypair;
  userWallet: PublicKey;
  fixtureId: bigint;
  proof: ReturnType<typeof normalizeProofForContract>;
  /**
   * Predicate the contract accepts — the keeper picks the trivially-true one.
   * Default: `GreaterThan(threshold=0)` — any positive stat value passes.
   */
  predicate?: { threshold: number; comparison: Record<string, unknown> };
  metadataUri: string;
  cuLimit?: number;
  priorityMicroLamports?: number;
}

export interface BuiltClaimMatchCardTx {
  vtx: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

async function loadSettleAlt(connection: Connection): Promise<AddressLookupTableAccount> {
  const info = await connection.getAddressLookupTable(SETTLE_ALT_ADDRESS);
  if (!info.value) {
    throw new Error(`Settle ALT ${SETTLE_ALT_ADDRESS.toBase58()} not found on-chain`);
  }
  return info.value;
}

export async function buildClaimMatchCardTx(
  args: ClaimMatchCardArgs,
): Promise<BuiltClaimMatchCardTx> {
  const {
    program,
    connection,
    keeper,
    userWallet,
    fixtureId,
    proof,
    predicate,
    metadataUri,
    cuLimit = 600_000,
    priorityMicroLamports = 20_000,
  } = args;

  const [cardPda] = derivePredictionCard(userWallet, fixtureId);
  const { pda: dailyScoresRoot } = deriveDailyScoresRoot(proof.ts.toNumber());

  // Default trivially-satisfied predicate: any stat > 0 passes on a final
  // whistle. The `stat_a` root the caller passes in must correspond.
  const pred = predicate ?? {
    threshold: 0,
    comparison: { greaterThan: {} },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ix = await (program.methods as any)
    .claimMatchCard(
      new BN(fixtureId.toString()),
      proof.ts,
      proof.fixtureSummary,
      proof.fixtureProof,
      proof.mainTreeProof,
      pred,
      proof.statA,
      null, // stat_b
      null, // op
      metadataUri,
    )
    .accountsPartial({
      keeper: keeper.publicKey,
      user: userWallet,
      predictionCard: cardPda,
      treeState: TREE_STATE_PDA,
      collectionState: COLLECTION_STATE_PDA,
      mintAuth: MINT_AUTH_PDA,
      treeConfig: TREE_CONFIG_PDA,
      merkleTree: MERKLE_TREE,
      leafOwner: userWallet,
      collectionMint: COLLECTION_MINT,
      collectionMetadata: COLLECTION_METADATA,
      collectionEdition: COLLECTION_EDITION,
      bubblegumSigner: BUBBLEGUM_SIGNER_PDA,
      logWrapper: SPL_NOOP_ID,
      compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
      bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
      tokenMetadataProgram: MPL_TOKEN_METADATA_ID,
      txlineProgram: TXLINE_PROGRAM_ID,
      dailyScoresMerkleRoots: dailyScoresRoot,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const computeIxs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
  ];

  const alt = await loadSettleAlt(connection);
  const bh = await connection.getLatestBlockhash('confirmed');
  const msg = new TransactionMessage({
    payerKey: keeper.publicKey,
    recentBlockhash: bh.blockhash,
    instructions: [...computeIxs, ix],
  }).compileToV0Message([alt]);
  const vtx = new VersionedTransaction(msg);
  vtx.sign([keeper]);

  return { vtx, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight };
}

export interface SentClaimMatchCard {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  bytes: number;
}

export async function sendClaimMatchCardTx(
  connection: Connection,
  built: BuiltClaimMatchCardTx,
): Promise<SentClaimMatchCard> {
  const serialized = built.vtx.serialize();
  const sig = await connection.sendTransaction(built.vtx, {
    skipPreflight: true,
    maxRetries: 5,
  });
  return {
    signature: sig,
    blockhash: built.blockhash,
    lastValidBlockHeight: built.lastValidBlockHeight,
    bytes: serialized.length,
  };
}

export async function confirmClaimMatchCard(
  connection: Connection,
  sent: SentClaimMatchCard,
): Promise<void> {
  const res = await connection.confirmTransaction(
    {
      signature: sent.signature,
      blockhash: sent.blockhash,
      lastValidBlockHeight: sent.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (res.value.err) {
    throw new Error(`claim_match_card tx failed: ${JSON.stringify(res.value.err)}`);
  }
}
