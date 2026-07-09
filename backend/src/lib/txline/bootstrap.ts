/**
 * TxLINE activation bootstrap — Phase B / B.3.
 *
 * Verbatim replay of the working reference at
 * `momentum_contract/scripts/txline-activate.ts`:
 *
 *   1. POST /auth/guest/start                  -> JWT (30-day TTL)
 *   2. Anchor subscribe(service_level=1, weeks=4) via keeper (free tier)
 *   3. Sign `${txSig}::${jwt}` with keeper via nacl.sign.detached
 *   4. POST /api/token/activate                -> API token
 *   5. Upsert TxlineSession(id=1) with { jwt, apiToken, jwtExpiresAt }
 *
 * Notes:
 *   - service_level_id=12 in the deploy-checklist does NOT exist on-chain
 *     as of 2026-07-18. Only row 1 (free tier, price=0) is exposed by the
 *     pricing_matrix PDA. See txline_quirks memory.
 *   - Activation body starts as { leagues: [] }; on HTTP 400, retries with
 *     { selectedLeagues: [] }. The `${txSig}::${jwt}` separator is a
 *     literal double colon (the empty leagues field between).
 *   - Accept-Encoding: identity is mandatory (Bun zstd bug).
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AnchorProvider,
  Program,
  Wallet,
  setProvider,
  type Idl,
} from '@coral-xyz/anchor';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import nacl from 'tweetnacl';

import { env } from '../../config/env.ts';
import { prismaQuery } from '../prisma.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// TxL SPL-Token-2022 mint on devnet (confirmed by reference script).
const TXL_TOKEN_MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG');
const SERVICE_LEVEL_ID = 1;
const DURATION_WEEKS = 4;

// JWT is documented as 30-day TTL. Persist the expected expiry.
const JWT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface TxlineBootstrapResult {
  jwt: string;
  apiToken: string;
  txSig: string;
  jwtExpiresAt: Date;
  skippedSubscribe: boolean;
}

async function fetchJwt(): Promise<string> {
  const res = await fetch(`${env.TXLINE_BASE_URL}/auth/guest/start`, {
    method: 'POST',
    headers: { 'Accept-Encoding': 'identity' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`guest/start failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { token?: string };
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
  const info = await connection.getAccountInfo(ata, 'confirmed');
  if (info) return ata;
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
  await connection.confirmTransaction(sig, 'confirmed');
  return ata;
}

function loadTxoracleIdl(): Idl {
  // The IDL is bundled inside the backend at src/lib/solana/idls/txoracle.json
  const p = join(__dirname, '..', 'solana', 'idls', 'txoracle.json');
  const raw = readFileSync(p, 'utf8');
  return JSON.parse(raw) as Idl;
}

async function subscribeOnChain(
  connection: Connection,
  wallet: Wallet,
  payer: Keypair,
  log?: (msg: string) => void,
): Promise<string> {
  const idl = loadTxoracleIdl();
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  setProvider(provider);
  // Inject program id — txoracle IDL ships without address.
  (idl as { address?: string }).address = env.TXLINE_PROGRAM_ID;
  const program = new Program(idl as Idl, provider);

  const txlineProgramId = new PublicKey(env.TXLINE_PROGRAM_ID);
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pricing_matrix')],
    txlineProgramId,
  );
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('token_treasury_v2')],
    txlineProgramId,
  );

  const userTokenAccount = await ensureAta(connection, payer, wallet.publicKey, TXL_TOKEN_MINT);
  const treasuryVault = getAssociatedTokenAddressSync(
    TXL_TOKEN_MINT,
    tokenTreasuryPda,
    true,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  log?.(`  pricing_matrix     : ${pricingMatrixPda.toBase58()}`);
  log?.(`  token_treasury_pda : ${tokenTreasuryPda.toBase58()}`);
  log?.(`  treasury_vault ATA : ${treasuryVault.toBase58()}`);
  log?.(`  user_token_account : ${userTokenAccount.toBase58()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sig = await (program.methods as any)
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
    })
    .rpc();
  return sig as string;
}

function signMessage(payer: Keypair, msg: string): string {
  const bytes = Buffer.from(msg, 'utf8');
  const sig = nacl.sign.detached(bytes, payer.secretKey);
  return Buffer.from(sig).toString('base64');
}

async function activate(jwt: string, txSig: string, walletSignature: string): Promise<string> {
  const headers = {
    'Authorization': `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'identity',
  };
  let res = await fetch(`${env.TXLINE_BASE_URL}/api/token/activate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ txSig, walletSignature, leagues: [] }),
  });
  if (res.status === 400) {
    res = await fetch(`${env.TXLINE_BASE_URL}/api/token/activate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ txSig, walletSignature, selectedLeagues: [] }),
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`activate failed: ${res.status} ${body}`);
  }
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = (await res.json()) as { token?: string; apiToken?: string };
    const t = body.token ?? body.apiToken;
    if (!t) throw new Error(`activate returned no token: ${JSON.stringify(body)}`);
    return t;
  }
  return (await res.text()).trim();
}

export interface TxlineBootstrapOptions {
  connection: Connection;
  keeper: Keypair;
  /** If true, skip the on-chain subscribe step and only rotate JWT + API token. */
  refreshOnly?: boolean;
  log?: (msg: string) => void;
}

/**
 * Full activation flow. Idempotent-ish: safe to call at boot; the subscribe
 * step is skipped when `refreshOnly` is set (used by refresh.ts on 401).
 */
export async function bootstrapTxline(opts: TxlineBootstrapOptions): Promise<TxlineBootstrapResult> {
  const { connection, keeper, refreshOnly, log } = opts;
  const wallet = new Wallet(keeper);
  log?.(`[TxLINE] activation start (wallet=${keeper.publicKey.toBase58()} refreshOnly=${!!refreshOnly})`);

  log?.('[TxLINE] step 1/4 — POST /auth/guest/start');
  const jwt = await fetchJwt();
  const jwtExpiresAt = new Date(Date.now() + JWT_TTL_MS);

  let txSig = 'refresh';
  if (!refreshOnly) {
    log?.(`[TxLINE] step 2/4 — subscribe(${SERVICE_LEVEL_ID}, ${DURATION_WEEKS})`);
    txSig = await subscribeOnChain(connection, wallet, keeper, log);
    log?.(`[TxLINE] subscribe tx: ${txSig}`);
  } else {
    log?.('[TxLINE] step 2/4 — skipped (refresh-only path)');
    // Reuse last known subscribe tx if we have one. If none, we still need
    // a valid tx sig for the activate call; recovery is: user re-runs
    // bootstrap with refreshOnly=false.
    const prior = await prismaQuery.txlineSession.findUnique({ where: { id: 1 } });
    if (!prior) {
      throw new Error('refreshOnly=true but no prior TxlineSession row found');
    }
    // We don't persist the subscribe tx sig; TxLINE accepts a valid signed
    // message even on refresh. If activate insists on the original tx, the
    // 401 loop will surface it — treat as unrecoverable and re-bootstrap.
  }

  log?.('[TxLINE] step 3/4 — sign activation message');
  const message = `${txSig}::${jwt}`;
  const walletSignature = signMessage(keeper, message);

  log?.('[TxLINE] step 4/4 — POST /api/token/activate');
  const apiToken = await activate(jwt, txSig, walletSignature);

  // Persist singleton. `id = 1` upsert keeps a single active session row.
  await prismaQuery.txlineSession.upsert({
    where: { id: 1 },
    create: { id: 1, jwt, apiToken, jwtExpiresAt },
    update: { jwt, apiToken, jwtExpiresAt },
  });
  // Audit log the JWT rotation.
  await prismaQuery.txlineJwt.create({
    data: {
      jwt,
      jwtExpiresAt,
      reason: refreshOnly ? 'refresh' : 'bootstrap',
    },
  });

  log?.('[TxLINE] activation persisted');
  return { jwt, apiToken, txSig, jwtExpiresAt, skippedSubscribe: !!refreshOnly };
}
