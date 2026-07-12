#!/usr/bin/env bun
/**
 * Sign a base64-encoded unsigned transaction using the keeper keypair.
 * Intended for backend end-to-end testing when the frontend wallet is not
 * available yet.
 *
 *   bun run sign-tx <base64-unsigned-tx>
 *
 * Prints the signed tx as base64 (for POST-to-RPC) AND submits it via the
 * configured Solana RPC, returning the tx signature.
 */

import '../dotenv.ts';
import { Transaction, sendAndConfirmRawTransaction } from '@solana/web3.js';
import { connection } from '../src/lib/solana/connection.ts';
import { keeper } from '../src/lib/solana/keeper.ts';

async function main(): Promise<void> {
  const b64 = process.argv[2];
  if (!b64) {
    console.error('usage: bun run sign-tx <base64-unsigned-tx>');
    process.exit(2);
  }
  const buf = Buffer.from(b64, 'base64');
  const tx = Transaction.from(buf);
  // If feePayer is not the keeper, refresh blockhash + sign so it broadcasts.
  const bh = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.lastValidBlockHeight = bh.lastValidBlockHeight;
  tx.feePayer = keeper.publicKey;
  tx.sign(keeper);

  const raw = tx.serialize();
  console.log(`signed tx bytes: ${raw.length}`);
  const sig = await sendAndConfirmRawTransaction(connection, raw, {
    commitment: 'confirmed',
    skipPreflight: false,
  });
  console.log(`::txSig=${sig}`);
  console.log(`::solscan=https://solscan.io/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
