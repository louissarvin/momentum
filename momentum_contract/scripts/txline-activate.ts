#!/usr/bin/env bun
/**
 * txline-activate.ts — 5-step TxLINE activation flow (devnet).
 *
 * Executes:
 *   1. POST /auth/guest/start        → JWT
 *   2. Anchor `subscribe(sl, weeks)` on-chain tx (pays 0 TxL for free tier)
 *   3. nacl-sign message `${txSig}::${jwt}` with the wallet key
 *   4. POST /api/token/activate      → X-Api-Token
 *   5. Persist { JWT, API_TOKEN, exp } to .env.local
 *
 * References:
 *   - notes/deploy-checklist.md § "TxLINE Activation Sub-Flow"
 *   - idls/txoracle.json (subscribe ix accounts + discriminator)
 *   - https://txline-docs.txodds.com/documentation/quickstart
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  AnchorProvider,
  Program,
  Wallet,
  BN,
  Idl,
  setProvider,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";
import { Transaction } from "@solana/web3.js";

const TXLINE_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
);
const TXL_TOKEN_MINT = new PublicKey(
  "4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG",
);
const API_BASE = "https://txline-dev.txodds.com";
// Devnet TxLINE pricing_matrix currently exposes only row_id=1 (free tier,
// price=0). Deploy-checklist referenced service_level_id=12 which was the
// documented WC/friendlies bundle but does not exist on-chain 2026-07-18.
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`Keypair not found: ${path}`);
  const raw = readFileSync(path, "utf8");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

async function fetchJwt(): Promise<string> {
  const res = await fetch(`${API_BASE}/auth/guest/start`, {
    method: "POST",
    headers: { "Accept-Encoding": "identity" },
  });
  if (!res.ok) {
    throw new Error(`guest/start failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { token: string };
  if (!body.token) throw new Error(`guest/start response missing token: ${JSON.stringify(body)}`);
  return body.token;
}

async function ensureAta(
  connection: Connection,
  payer: Keypair,
  owner: PublicKey,
  mint: PublicKey,
): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(
    mint,
    owner,
    false,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const info = await connection.getAccountInfo(ata, "confirmed");
  if (info) return ata;
  console.log(`  creating user TxL ATA: ${ata.toBase58()}`);
  const ix = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey,
    ata,
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const tx = new Transaction().add(ix);
  const sig = await connection.sendTransaction(tx, [payer]);
  await connection.confirmTransaction(sig, "confirmed");
  return ata;
}

async function loadTxoracleIdl(): Promise<Idl> {
  const p = join(__dirname, "..", "idls", "txoracle.json");
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as Idl;
}

async function subscribe(
  connection: Connection,
  wallet: Wallet,
  payer: Keypair,
): Promise<string> {
  const idl = await loadTxoracleIdl();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  setProvider(provider);
  const program = new Program(idl as any, provider);

  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pricing_matrix")],
    TXLINE_PROGRAM_ID,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("token_treasury_v2")],
    TXLINE_PROGRAM_ID,
  );

  const userTokenAccount = await ensureAta(
    connection,
    payer,
    wallet.publicKey,
    TXL_TOKEN_MINT,
  );
  const treasuryVault = getAssociatedTokenAddressSync(
    TXL_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  console.log(`  pricing_matrix     : ${pricingMatrixPda.toBase58()}`);
  console.log(`  token_treasury_pda : ${tokenTreasuryPda.toBase58()}`);
  console.log(`  treasury_vault ATA : ${treasuryVault.toBase58()}`);
  console.log(`  user_token_account : ${userTokenAccount.toBase58()}`);

  const sig = await program.methods
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: wallet.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: TXL_TOKEN_MINT,
      userTokenAccount,
      tokenTreasuryVault: treasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    } as any)
    .rpc();
  return sig;
}

function signMessage(payer: Keypair, msg: string): string {
  const bytes = Buffer.from(msg, "utf8");
  const sig = nacl.sign.detached(bytes, payer.secretKey);
  return Buffer.from(sig).toString("base64");
}

async function activate(
  jwt: string,
  txSig: string,
  walletSignature: string,
): Promise<string> {
  // Per docs: primary field is `leagues: []`. If server returns 400, retry with
  // `selectedLeagues` per deploy-checklist troubleshooting note.
  const headers = {
    "Authorization": `Bearer ${jwt}`,
    "Content-Type": "application/json",
    // Bun's zstd decompression is broken on some endpoints; disable it.
    "Accept-Encoding": "identity",
  };
  let res = await fetch(`${API_BASE}/api/token/activate`, {
    method: "POST",
    headers,
    body: JSON.stringify({ txSig, walletSignature, leagues: [] }),
  });
  if (res.status === 400) {
    console.log("  retrying with selectedLeagues field...");
    res = await fetch(`${API_BASE}/api/token/activate`, {
      method: "POST",
      headers,
      body: JSON.stringify({ txSig, walletSignature, selectedLeagues: [] }),
    });
  }
  if (!res.ok) {
    throw new Error(`activate failed: ${res.status} ${await res.text()}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = (await res.json()) as { token?: string; apiToken?: string };
    const t = body.token ?? body.apiToken;
    if (!t) throw new Error(`activate returned no token: ${JSON.stringify(body)}`);
    return t;
  }
  // text/plain fallback
  return (await res.text()).trim();
}

async function main() {
  const keypairPath = join(homedir(), ".config", "solana", "id.json");
  const payer = loadKeypair(keypairPath);
  const wallet = new Wallet(payer);
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  console.log("TxLINE activation");
  console.log(`  wallet   : ${payer.publicKey.toBase58()}`);
  console.log(`  api base : ${API_BASE}`);
  console.log(`  service  : ${SERVICE_LEVEL_ID}  weeks : ${DURATION_WEEKS}`);
  console.log("");

  console.log("Step 1/4 - Fetch guest JWT");
  const jwt = await fetchJwt();
  const jwtExp = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  console.log(`  jwt      : ${jwt.substring(0, 40)}... (exp ~${jwtExp})`);
  console.log("");

  console.log("Step 2/4 - Send subscribe(12, 4) tx");
  const txSig = await subscribe(connection, wallet, payer);
  console.log(`  txSig    : ${txSig}`);
  console.log(`  Explorer : https://explorer.solana.com/tx/${txSig}?cluster=devnet`);
  console.log("");

  console.log("Step 3/4 - Sign activation message");
  const message = `${txSig}::${jwt}`;
  const walletSignature = signMessage(payer, message);
  console.log(`  message  : ${message.substring(0, 60)}...`);
  console.log(`  sig(b64) : ${walletSignature.substring(0, 40)}...`);
  console.log("");

  console.log("Step 4/4 - POST /api/token/activate");
  const apiToken = await activate(jwt, txSig, walletSignature);
  console.log(`  apiToken : ${apiToken.substring(0, 30)}...`);
  console.log("");

  // Persist to .env.local (repo-relative)
  const envPath = join(__dirname, "..", ".env.local");
  const lines = [
    `TXLINE_JWT=${jwt}`,
    `TXLINE_API_TOKEN=${apiToken}`,
    `TXLINE_JWT_EXPIRES_AT=${jwtExp}`,
    `TXLINE_SUBSCRIBE_TX=${txSig}`,
    ``,
  ];
  writeFileSync(envPath, lines.join("\n"), { mode: 0o600 });
  console.log(`Persisted credentials to ${envPath}`);
  console.log(`::tx=${txSig}`);
  console.log(`::apiTokenPrefix=${apiToken.substring(0, 8)}`);
}

main().catch((err) => {
  console.error("txline-activate failed:", err);
  process.exit(1);
});
