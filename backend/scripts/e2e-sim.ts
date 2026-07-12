#!/usr/bin/env bun
/**
 * End-to-end Phase C simulation.
 *
 * Uses the loaded keeper keypair as the "user" wallet so we don't need to
 * airdrop a fresh keypair. Walks:
 *   1. SIWS challenge + wallet-login  → session JWT
 *   2. Build unsigned submit_predictions tx for fixture 18237038 slot 0
 *      mirroring proof_18237038_732_2.json (statAKey=2, period=4)
 *   3. Sign with keeper, send + confirm
 *   4. POST /confirm → mirror card
 *   5. Enqueue settle job with (fixtureId=18237038, seq=732, statKey=2)
 *   6. Poll /health until backlog.pending == 0 (or timeout)
 *   7. Verify StickerMint row was written; print settle tx sig
 *
 * If the card already exists on-chain (e.g., re-run against same wallet),
 * step 2/3/4 short-circuit and we go straight to enqueue.
 */

import '../dotenv.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Transaction, sendAndConfirmRawTransaction, Keypair } from '@solana/web3.js';
import { connection } from '../src/lib/solana/connection.ts';
import { keeper } from '../src/lib/solana/keeper.ts';
import { prismaQuery } from '../src/lib/prisma.ts';
import { env } from '../src/config/env.ts';

const BASE = `http://127.0.0.1:${env.APP_PORT}`;

const PROOF_PATH = join(
  __dirname,
  '..',
  '..',
  'momentum_contract',
  'tests',
  'fixtures',
  'proofs',
  'proof_18237038_732_2.json',
);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  jwt?: string,
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, json: j };
}

async function main(): Promise<void> {
  // Optional --wallet flag lets us run e2e against a fresh keypair to
  // exercise a completely new PredictionCard PDA (needed when the keeper
  // wallet has already claimed slot 0 for fixture 18237038 from a prior
  // run). Fresh wallets sign the SIWS challenge, submit the prediction,
  // and the keeper still signs the settle tx (it's permissionless).
  const args = process.argv.slice(2);
  const walletArgIdx = args.indexOf('--wallet');
  let userKp = keeper;
  if (walletArgIdx >= 0) {
    const p = args[walletArgIdx + 1];
    if (!p) {
      console.error('--wallet requires a keypair path');
      process.exit(2);
    }
    userKp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(p, 'utf8'))));
    console.log(`using --wallet ${p} pubkey=${userKp.publicKey.toBase58()}`);
  } else {
    console.log(`using keeper as user wallet: ${userKp.publicKey.toBase58()}`);
  }

  const proof = JSON.parse(readFileSync(PROOF_PATH, 'utf8'));
  const fixtureId = String(proof.summary.fixtureId);
  const statAKey = proof.statToProve.key;
  const period = proof.statToProve.period;
  console.log(`fixture=${fixtureId} statAKey=${statAKey} period=${period}`);

  // ---- step 1: SIWS ----
  console.log('\n[1/6] SIWS challenge');
  const wallet = userKp.publicKey.toBase58();
  const chal = await api<{ data: { nonce: string; message: string } }>(
    'POST',
    '/api/session/challenge',
    { wallet },
  );
  if (chal.status !== 200) throw new Error(`challenge failed: ${chal.status} ${JSON.stringify(chal.json)}`);
  const { nonce, message } = chal.json.data;
  const messageBytes = new TextEncoder().encode(message);
  const sig = nacl.sign.detached(messageBytes, userKp.secretKey);
  const login = await api<{ data: { token: string } }>('POST', '/api/session/wallet-login', {
    wallet,
    signature: bs58.encode(sig),
  });
  if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
  const jwt = login.json.data.token;
  console.log(`  JWT ok (${jwt.slice(0, 24)}…) nonce=${nonce.slice(0, 8)}`);

  // ---- step 2: submit_predictions ----
  console.log('\n[2/6] POST /api/predictions/:fixtureId (build unsigned tx)');
  const submit = await api<{ data: { unsignedTx: string | null; cardPda: string; alreadyExists?: boolean } }>(
    'POST',
    `/api/predictions/${fixtureId}`,
    {
      slots: [
        {
          statAKey,
          statBKey: 0,
          op: 0,
          predicateComparison: 0, // GreaterThan
          threshold: 0,
          period,
        },
      ],
    },
    jwt,
  );
  if (submit.status !== 200) throw new Error(`submit failed: ${submit.status} ${JSON.stringify(submit.json)}`);
  const cardPda = submit.json.data.cardPda;
  console.log(`  cardPda=${cardPda} alreadyExists=${submit.json.data.alreadyExists ?? false}`);

  if (submit.json.data.unsignedTx) {
    console.log('\n[3/6] sign + submit predictions tx');
    const raw = Buffer.from(submit.json.data.unsignedTx, 'base64');
    const tx = Transaction.from(raw);
    tx.sign(userKp);
    const txSig = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
      commitment: 'confirmed',
      skipPreflight: false,
    });
    console.log(`  txSig=${txSig}`);
    console.log(`  solscan=https://solscan.io/tx/${txSig}?cluster=devnet`);

    console.log('\n[4/6] POST /confirm to mirror');
    const conf = await api<{ data: unknown }>(
      'POST',
      `/api/predictions/${fixtureId}/confirm`,
      { txSig },
      jwt,
    );
    if (conf.status !== 200) {
      throw new Error(`confirm failed: ${conf.status} ${JSON.stringify(conf.json)}`);
    }
    console.log('  card mirrored');
  } else {
    console.log('  (skipping sign/confirm — card already exists on-chain)');
  }

  // ---- step 5: enqueue settle ----
  console.log('\n[5/6] enqueue settle job (fixtureId=18237038 seq=732 statKey=2)');
  const job = await prismaQuery.settlementJob.create({
    data: {
      type: 'settle',
      fixtureId,
      seq: 732,
      statKey: String(statAKey),
      priority: 100,
      payload: { enqueuedBy: 'e2e-sim' },
    },
  });
  console.log(`  jobId=${job.id}`);

  // ---- step 6: wait for settlement ----
  console.log('\n[6/6] waiting for settler to complete (max 90s)');
  const deadline = Date.now() + 90_000;
  let done = false;
  while (Date.now() < deadline) {
    await sleep(2000);
    const j = await prismaQuery.settlementJob.findUnique({ where: { id: job.id } });
    if (!j) break;
    if (j.status === 'done' || j.status === 'error') {
      console.log(`  job status = ${j.status}${j.lastError ? ` reason=${j.lastError}` : ''}`);
      done = true;
      break;
    }
    process.stdout.write('.');
  }
  if (!done) {
    console.log('\n  job did not complete within 90s — check /health and settler logs');
  }

  // ---- print StickerMint row(s) ----
  const stickers = await prismaQuery.stickerMint.findMany({ where: { cardPda } });
  console.log(`\nStickerMint rows for ${cardPda}: ${stickers.length}`);
  for (const s of stickers) {
    console.log(
      `  slot=${s.slotIndex} outcome=${s.outcome} sig=${s.mintTxSig}` +
        (s.mintTxSig ? `  solscan=https://solscan.io/tx/${s.mintTxSig}?cluster=devnet` : ''),
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
