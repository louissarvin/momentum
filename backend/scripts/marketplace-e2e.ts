#!/usr/bin/env bun
/**
 * Marketplace end-to-end smoke test (Phase D halt criterion).
 *
 *   bun run scripts/marketplace-e2e.ts <assetId>
 *
 * Assumes HTTP server is running on APP_PORT. Uses the keeper as both
 * seller (must be the current cNFT owner) and buyer — this is a
 * self-transfer for smoke-test purposes only. Verifies the full flow:
 *
 *   1. SIWS login (keeper as user)
 *   2. POST /api/marketplace/list  → unsigned tx
 *   3. Sign + send + confirm on-chain
 *   4. POST /api/marketplace/list/confirm  → DB mirror
 *   5. POST /api/marketplace/buy/:listingPda  → unsigned tx
 *   6. Sign + send + confirm
 *   7. POST /api/marketplace/buy/:listingPda/confirm  → DB mirror
 *
 * All txSigs printed with solscan links.
 */

import '../dotenv.ts';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Transaction, sendAndConfirmRawTransaction } from '@solana/web3.js';
import { connection } from '../src/lib/solana/connection.ts';
import { keeper } from '../src/lib/solana/keeper.ts';
import { env } from '../src/config/env.ts';

const BASE = `http://127.0.0.1:${env.APP_PORT}`;

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

function solscan(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

async function login(): Promise<string> {
  const wallet = keeper.publicKey.toBase58();
  const c = await api<{ data: { message: string } }>('POST', '/api/session/challenge', { wallet });
  if (c.status !== 200) throw new Error(`challenge failed: ${JSON.stringify(c.json)}`);
  const sig = nacl.sign.detached(new TextEncoder().encode(c.json.data.message), keeper.secretKey);
  const l = await api<{ data: { token: string } }>('POST', '/api/session/wallet-login', {
    wallet,
    signature: bs58.encode(sig),
  });
  if (l.status !== 200) throw new Error(`login failed: ${JSON.stringify(l.json)}`);
  return l.json.data.token;
}

async function signAndSend(unsignedTxB64: string): Promise<string> {
  const raw = Buffer.from(unsignedTxB64, 'base64');
  const tx = Transaction.from(raw);
  tx.sign(keeper);
  const sig = await sendAndConfirmRawTransaction(connection, tx.serialize(), {
    commitment: 'confirmed',
    skipPreflight: true,
  });
  return sig;
}

async function main(): Promise<void> {
  const assetId = process.argv[2];
  const priceLamports = Number(process.argv[3] ?? '100000');
  if (!assetId) {
    console.error('usage: bun run scripts/marketplace-e2e.ts <assetId> [priceLamports=100000]');
    process.exit(2);
  }

  console.log(`assetId=${assetId} price=${priceLamports}`);
  console.log('\n[1/7] SIWS');
  const jwt = await login();
  console.log(`  ok  (jwt=${jwt.slice(0, 20)}…)`);

  console.log('\n[2/7] POST /api/marketplace/list');
  type ListRes = { data: { listingPda: string; unsignedTx: string } };
  const list = await api<ListRes>(
    'POST',
    '/api/marketplace/list',
    { assetId, priceLamports },
    jwt,
  );
  if (list.status !== 200) {
    throw new Error(`list build failed: ${list.status} ${JSON.stringify(list.json)}`);
  }
  const listingPda = list.json.data.listingPda;
  console.log(`  listingPda=${listingPda}`);

  console.log('\n[3/7] sign + send list_for_sale tx');
  const listSig = await signAndSend(list.json.data.unsignedTx);
  console.log(`  txSig=${listSig}`);
  console.log(`  solscan=${solscan(listSig)}`);

  console.log('\n[4/7] POST /api/marketplace/list/confirm');
  const listConf = await api<{ data: unknown }>(
    'POST',
    '/api/marketplace/list/confirm',
    { txSig: listSig, assetId, priceLamports },
    jwt,
  );
  if (listConf.status !== 200) {
    throw new Error(`list confirm failed: ${JSON.stringify(listConf.json)}`);
  }
  console.log('  listing mirrored');

  console.log('\n[5/7] POST /api/marketplace/buy/:listingPda');
  type BuyRes = { data: { unsignedTx: string } };
  const buy = await api<BuyRes>('POST', `/api/marketplace/buy/${listingPda}`, {}, jwt);
  if (buy.status !== 200) {
    throw new Error(`buy build failed: ${buy.status} ${JSON.stringify(buy.json)}`);
  }

  console.log('\n[6/7] sign + send buy_card tx');
  const buySig = await signAndSend(buy.json.data.unsignedTx);
  console.log(`  txSig=${buySig}`);
  console.log(`  solscan=${solscan(buySig)}`);

  console.log('\n[7/7] POST /api/marketplace/buy/:listingPda/confirm');
  const buyConf = await api<{ data: unknown }>(
    'POST',
    `/api/marketplace/buy/${listingPda}/confirm`,
    { txSig: buySig },
    jwt,
  );
  if (buyConf.status !== 200) {
    throw new Error(`buy confirm failed: ${JSON.stringify(buyConf.json)}`);
  }
  console.log('  sale mirrored');

  console.log('\n=== SUMMARY ===');
  console.log(`assetId    : ${assetId}`);
  console.log(`listingPda : ${listingPda}`);
  console.log(`list_tx    : ${listSig}  ${solscan(listSig)}`);
  console.log(`buy_tx     : ${buySig}   ${solscan(buySig)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('FAIL:', err);
  process.exit(1);
});
