#!/usr/bin/env bun
/**
 * Transfer a small SOL amount from the keeper to a fresh keypair, then
 * write the keypair JSON to disk. Devnet only; no airdrop.
 *
 *   bun run scripts/fund-wallet.ts [lamports=15000000] [outPath=/tmp/momentum-test-wallet.json]
 */

import '../dotenv.ts';
import { writeFileSync } from 'node:fs';
import { Keypair, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { connection } from '../src/lib/solana/connection.ts';
import { keeper } from '../src/lib/solana/keeper.ts';

async function main(): Promise<void> {
  const lamports = Number(process.argv[2] ?? '15000000'); // 0.015 SOL
  const outPath = process.argv[3] ?? '/tmp/momentum-test-wallet.json';

  const kp = Keypair.generate();
  writeFileSync(outPath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`generated ${kp.publicKey.toBase58()} -> ${outPath}`);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keeper.publicKey,
      toPubkey: kp.publicKey,
      lamports,
    }),
  );
  const sig = await sendAndConfirmTransaction(connection, tx, [keeper]);
  console.log(`funded ${lamports} lamports  tx=${sig}`);
  console.log(`solscan=https://solscan.io/tx/${sig}?cluster=devnet`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
