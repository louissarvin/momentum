/**
 * Settlement helper — build + send `settle_prediction` v0 tx with ALT.
 *
 * This mirrors `momentum_contract/scripts/smoke-test.ts` line-for-line:
 *   - Bundle `ComputeBudgetProgram.setComputeUnitLimit(600_000)` +
 *     `setComputeUnitPrice(microLamports)` as leading ixs.
 *   - Compile a v0 message backed by the pre-provisioned ALT
 *     (`SETTLE_ALT_ADDRESS`) so the tx fits under the 1232-byte cap.
 *   - `skipPreflight: true` on send — preflight simulation cannot see live
 *     TxLINE state and produces spurious failures.
 *   - Confirm with `lastValidBlockHeight` strategy.
 *
 * Outcome-claim rules per the on-chain contract:
 *   1 = HIT      (predicate satisfied by observed stat value)
 *   2 = MISS     (predicate NOT satisfied; keeper submits the negated
 *                 predicate — see contract's `is_valid_miss_negation`)
 *
 * Predicate negation table:
 *   GreaterThan(0) with threshold T   -> LessThan(1) with threshold T+1
 *   LessThan(1)    with threshold T   -> GreaterThan(0) with threshold T-1
 *   EqualTo(2)     with threshold T   -> NOT supported for MISS (any != T)
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

// ---- proof shape helpers ----

interface RawProof {
  ts?: number;
  statToProve: { key: number; value: number; period: number };
  eventStatRoot: number[];
  summary: {
    fixtureId: number;
    updateStats: { updateCount: number; minTimestamp: number; maxTimestamp: number };
    eventStatsSubTreeRoot: number[];
  };
  statProof: Array<{ hash: number[]; isRightSibling: boolean }>;
  subTreeProof: Array<{ hash: number[]; isRightSibling: boolean }>;
  mainTreeProof: Array<{ hash: number[]; isRightSibling: boolean }>;
}

export type Comparison = 0 | 1 | 2; // GreaterThan | LessThan | EqualTo

export interface SlotPredicate {
  comparison: Comparison;
  threshold: number;
}

/** Convert raw JSON proof into the Anchor-typed shape settle_prediction expects. */
export function normalizeProofForContract(raw: RawProof) {
  const node = (p: { hash: number[]; isRightSibling: boolean }) => ({
    hash: p.hash,
    isRightSibling: p.isRightSibling,
  });
  return {
    ts: new BN(raw.summary.updateStats.minTimestamp),
    fixtureId: raw.summary.fixtureId,
    fixtureSummary: {
      fixtureId: new BN(raw.summary.fixtureId),
      updateStats: {
        updateCount: raw.summary.updateStats.updateCount,
        minTimestamp: new BN(raw.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(raw.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: raw.summary.eventStatsSubTreeRoot,
    },
    fixtureProof: raw.subTreeProof.map(node),
    mainTreeProof: raw.mainTreeProof.map(node),
    statA: {
      statToProve: {
        key: raw.statToProve.key,
        value: raw.statToProve.value,
        period: raw.statToProve.period,
      },
      eventStatRoot: raw.eventStatRoot,
      statProof: raw.statProof.map(node),
    },
  };
}

/**
 * Given a stored slot predicate and the observed stat value, decide whether
 * the slot HITs. If it MISSES, return the NEGATED predicate + comparison
 * that the contract will accept (per `is_valid_miss_negation`).
 */
export function decideOutcome(
  observed: number,
  slot: SlotPredicate,
): { outcomeClaim: 1 | 2; predicate: { threshold: number; comparison: Record<string, unknown> } } | null {
  const asComparisonEnum = (c: Comparison): Record<string, unknown> => {
    switch (c) {
      case 0:
        return { greaterThan: {} };
      case 1:
        return { lessThan: {} };
      case 2:
        return { equalTo: {} };
    }
  };

  const hits =
    (slot.comparison === 0 && observed > slot.threshold) ||
    (slot.comparison === 1 && observed < slot.threshold) ||
    (slot.comparison === 2 && observed === slot.threshold);
  if (hits) {
    return {
      outcomeClaim: 1,
      predicate: { threshold: slot.threshold, comparison: asComparisonEnum(slot.comparison) },
    };
  }
  // MISS branch — negate. EqualTo cannot be safely negated to a single
  // comparison (would need "not equal") so we bail.
  if (slot.comparison === 0) {
    return {
      outcomeClaim: 2,
      predicate: { threshold: slot.threshold + 1, comparison: asComparisonEnum(1) },
    };
  }
  if (slot.comparison === 1) {
    return {
      outcomeClaim: 2,
      predicate: { threshold: slot.threshold - 1, comparison: asComparisonEnum(0) },
    };
  }
  return null;
}

// ---- settle tx builder + sender ----

export interface BuiltSettleTx {
  vtx: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

export interface SettleArgs {
  program: Program;
  connection: Connection;
  keeper: Keypair;
  userWallet: PublicKey;
  fixtureId: bigint;
  slotIndex: number;
  proof: ReturnType<typeof normalizeProofForContract>;
  predicate: { threshold: number; comparison: Record<string, unknown> };
  outcomeClaim: 1 | 2;
  metadataUri: string;
  cuLimit?: number;
  priorityMicroLamports?: number;
}

async function loadSettleAlt(connection: Connection): Promise<AddressLookupTableAccount> {
  const info = await connection.getAddressLookupTable(SETTLE_ALT_ADDRESS);
  if (!info.value) {
    throw new Error(`Settle ALT ${SETTLE_ALT_ADDRESS.toBase58()} not found on-chain`);
  }
  return info.value;
}

export async function buildSettleTx(args: SettleArgs): Promise<BuiltSettleTx> {
  const {
    program,
    connection,
    keeper,
    userWallet,
    fixtureId,
    slotIndex,
    proof,
    predicate,
    outcomeClaim,
    metadataUri,
    cuLimit = 600_000,
    priorityMicroLamports = 20_000,
  } = args;

  const [cardPda] = derivePredictionCard(userWallet, fixtureId);
  const { pda: dailyScoresRoot } = deriveDailyScoresRoot(proof.ts.toNumber());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const settleIx = await (program.methods as any)
    .settlePrediction(
      new BN(fixtureId.toString()),
      slotIndex,
      proof.ts,
      proof.fixtureSummary,
      proof.fixtureProof,
      proof.mainTreeProof,
      predicate,
      proof.statA,
      null, // stat_b
      null, // op
      outcomeClaim,
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
    instructions: [...computeIxs, settleIx],
  }).compileToV0Message([alt]);
  const vtx = new VersionedTransaction(msg);
  vtx.sign([keeper]);

  return { vtx, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight };
}

export interface SentSettle {
  signature: string;
  blockhash: string;
  lastValidBlockHeight: number;
  bytes: number;
}

export async function sendSettleTx(
  connection: Connection,
  built: BuiltSettleTx,
): Promise<SentSettle> {
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

export async function confirmSettle(
  connection: Connection,
  sent: SentSettle,
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
    throw new Error(`settle tx failed: ${JSON.stringify(res.value.err)}`);
  }
}
