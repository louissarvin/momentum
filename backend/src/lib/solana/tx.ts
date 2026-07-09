/**
 * Small helpers for building unsigned transactions that the browser wallet
 * will sign and submit.
 *
 * Strategy:
 *   - Use legacy `Transaction` (not v0) for user-signed instructions when the
 *     tx fits under 1232 bytes and no ALT is needed. Every non-settle Momentum
 *     ix (create_group/join_group/submit_predictions/marketplace) fits.
 *   - `feePayer = user`. Server does NOT sign as keeper on user-payer paths.
 *   - Serialized with `requireAllSignatures: false, verifySignatures: false`
 *     so we can return an unsigned skeleton for the wallet to fill in.
 */

import {
  Transaction,
  type TransactionInstruction,
  type PublicKey,
  type Connection,
} from '@solana/web3.js';

export interface UnsignedTxResult {
  transaction: string; // base64
  recentBlockhash: string;
  lastValidBlockHeight: number;
  feePayer: string;
}

/**
 * Compose a legacy Transaction with the given ixs and a fresh blockhash.
 * The wallet will sign and submit.
 */
export async function buildUnsignedLegacyTx(
  connection: Connection,
  feePayer: PublicKey,
  ixs: TransactionInstruction[],
): Promise<UnsignedTxResult> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction();
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  for (const ix of ixs) tx.add(ix);
  const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return {
    transaction: Buffer.from(serialized).toString('base64'),
    recentBlockhash: blockhash,
    lastValidBlockHeight,
    feePayer: feePayer.toBase58(),
  };
}

/**
 * Await `confirmTransaction` with a proper `lastValidBlockHeight` strategy.
 * Throws on timeout so the caller can decide to poll or fail the job.
 */
export async function awaitConfirmed(
  connection: Connection,
  signature: string,
  blockhashInfo?: { blockhash: string; lastValidBlockHeight: number },
): Promise<void> {
  const bh = blockhashInfo ?? (await connection.getLatestBlockhash('confirmed'));
  const res = await connection.confirmTransaction(
    {
      signature,
      blockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (res.value.err) {
    throw new Error(`tx failed to confirm: ${JSON.stringify(res.value.err)}`);
  }
}
