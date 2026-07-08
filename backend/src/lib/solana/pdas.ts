import { PublicKey } from '@solana/web3.js';
import { env } from '../../config/env.ts';

// -------- program ids --------

export const MOMENTUM_PROGRAM_ID = new PublicKey(env.MOMENTUM_PROGRAM_ID);
export const TXLINE_PROGRAM_ID = new PublicKey(env.TXLINE_PROGRAM_ID);

// -------- constants --------

const MS_PER_DAY = 86_400_000;

// -------- little-endian encoders --------

function u16LE(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

function u64LE(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(typeof n === 'bigint' ? n : BigInt(n), 0);
  return b;
}

// -------- Momentum PDAs --------

export function deriveTreeState(programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('tree_state')], programId);
}

export function deriveCollectionState(programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('collection_state')], programId);
}

export function deriveMintAuth(programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('mint_auth')], programId);
}

export function deriveGroup(groupId: bigint | number, programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('group'), u64LE(groupId)], programId);
}

export function deriveVault(groupPda: PublicKey, programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), groupPda.toBuffer()], programId);
}

export function deriveMembership(
  groupPda: PublicKey,
  user: PublicKey,
  programId: PublicKey = MOMENTUM_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('member'), groupPda.toBuffer(), user.toBuffer()],
    programId,
  );
}

export function derivePredictionCard(
  user: PublicKey,
  fixtureId: bigint | number,
  programId: PublicKey = MOMENTUM_PROGRAM_ID,
) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('card'), user.toBuffer(), u64LE(fixtureId)],
    programId,
  );
}

export function deriveListing(assetId: PublicKey, programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('listing'), assetId.toBuffer()],
    programId,
  );
}

/**
 * Global marketplace escrow authority.
 *
 * IMPORTANT: The on-chain seed is `b"escrow_auth"` (8 bytes) — NOT
 * `b"escrow_authority"`. Cross-checked against
 * `programs/momentum/src/instructions/{list_for_sale,buy_card,cancel_listing}.rs`.
 * The listing PDA is NOT part of the seeds — a single global escrow_authority
 * signs the Bubblegum delegate/transfer CPI for every listing.
 */
export function deriveEscrowAuthority(programId: PublicKey = MOMENTUM_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync([Buffer.from('escrow_auth')], programId);
}

// -------- TxLINE PDA --------

/**
 * MUST match `derive-daily-scores-root.ts` verbatim.
 * Seeds: [b"daily_scores_roots", u16_le(epochDay)]
 *
 * epochDay = floor(ts_ms / 86_400_000). CRITICAL: the ts_ms MUST come from
 * `proof.summary.updateStats.minTimestamp`, not the top-level `raw.ts`.
 * See smoke-test.ts:189-193 — using the wrong ts yields TimestampMismatch (6010).
 */
export function deriveDailyScoresRoot(tsMs: number, programId: PublicKey = TXLINE_PROGRAM_ID) {
  const epochDay = Math.floor(tsMs / MS_PER_DAY);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from('daily_scores_roots'), u16LE(epochDay)],
    programId,
  );
  return { pda, bump, epochDay };
}
