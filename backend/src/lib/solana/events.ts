/**
 * Anchor event decoding helper — Pass 6.
 *
 * The on-chain `momentum` program emits `#[event] StickerMinted` and
 * `#[event] MatchCardClaimed` (see `momentum_contract/programs/momentum/src/events.rs`).
 * We use Anchor's `EventParser` to lift the richer on-chain payload out of the
 * confirmed tx logs so downstream SSE consumers can present the ground-truth
 * fields (`event_stat_root`, `proof_ts`, `asset_id`, `merkle_tree`,
 * `outcome`, `sticker_asset_seq`) instead of DB-mirror synthesized data.
 *
 * The EventParser pattern is documented at:
 *   https://www.anchor-lang.com/docs/features/events
 *
 * Fetch strategy: `getTransaction(sig, { commitment: 'confirmed',
 * maxSupportedTransactionVersion: 0 })`. v0 txs (which settle uses) require
 * the `maxSupportedTransactionVersion` opt-in.
 */

import * as anchor from '@coral-xyz/anchor';
import type { Program } from '@coral-xyz/anchor';
import type { Connection, PublicKey } from '@solana/web3.js';

export interface DecodedStickerMinted {
  user: string;
  fixtureId: string; // i64 → string for BigInt safety
  slotIndex: number;
  outcome: number; // 1 = HIT, 2 = MISS
  stickerAssetSeq: string; // u64 → string
  eventStatRoot: string; // hex
  proofTs: string; // i64 → string
  assetId: string;
  merkleTree: string;
}

export interface DecodedMatchCardClaimed {
  user: string;
  fixtureId: string;
  matchCardSeq: string;
  eventStatRoot: string;
  proofTs: string;
  assetId: string;
  merkleTree: string;
}

/**
 * Fetch a confirmed tx's logs and run them through Anchor's EventParser.
 * Returns the first event matching `eventName`, or null.
 *
 * IMPORTANT: fails soft — a decoded event is a *bonus*, not a requirement.
 * Callers must fall back to synthesized payloads if this returns null.
 */
export async function decodeAnchorEvent<T = unknown>(
  connection: Connection,
  program: Program,
  signature: string,
  eventName: string,
): Promise<T | null> {
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages;
    if (!logs || logs.length === 0) return null;

    const parser = new anchor.EventParser(program.programId, program.coder);
    for (const ev of parser.parseLogs(logs, false)) {
      if (ev.name === eventName) {
        return ev.data as T;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Normalize an anchor-decoded `StickerMinted` event (BN / PublicKey / u8[])
 * into a JSON-safe shape suitable for SSE fan-out.
 */
export function normalizeStickerMintedEvent(raw: unknown): DecodedStickerMinted | null {
  if (!raw || typeof raw !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  try {
    return {
      user: (r.user as PublicKey).toBase58(),
      fixtureId: bnToString(r.fixtureId ?? r.fixture_id),
      slotIndex: numOrZero(r.slotIndex ?? r.slot_index),
      outcome: numOrZero(r.outcome),
      stickerAssetSeq: bnToString(r.stickerAssetSeq ?? r.sticker_asset_seq),
      eventStatRoot: bytesToHex(r.eventStatRoot ?? r.event_stat_root),
      proofTs: bnToString(r.proofTs ?? r.proof_ts),
      assetId: (r.assetId ?? r.asset_id).toBase58(),
      merkleTree: (r.merkleTree ?? r.merkle_tree).toBase58(),
    };
  } catch {
    return null;
  }
}

export function normalizeMatchCardClaimedEvent(raw: unknown): DecodedMatchCardClaimed | null {
  if (!raw || typeof raw !== 'object') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  try {
    return {
      user: (r.user as PublicKey).toBase58(),
      fixtureId: bnToString(r.fixtureId ?? r.fixture_id),
      matchCardSeq: bnToString(r.matchCardSeq ?? r.match_card_seq),
      eventStatRoot: bytesToHex(r.eventStatRoot ?? r.event_stat_root),
      proofTs: bnToString(r.proofTs ?? r.proof_ts),
      assetId: (r.assetId ?? r.asset_id).toBase58(),
      merkleTree: (r.merkleTree ?? r.merkle_tree).toBase58(),
    };
  } catch {
    return null;
  }
}

function bnToString(v: unknown): string {
  if (v === null || v === undefined) return '0';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'bigint') return v.toString();
  // Anchor BN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (v && typeof (v as any).toString === 'function') return (v as any).toString(10);
  return '0';
}

function numOrZero(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && !Number.isNaN(Number(v))) return Number(v);
  // BN
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (v && typeof (v as any).toNumber === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (v as any).toNumber();
    } catch {
      return 0;
    }
  }
  return 0;
}

function bytesToHex(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return Buffer.from(v as number[]).toString('hex');
  if (v instanceof Uint8Array) return Buffer.from(v).toString('hex');
  if (Buffer.isBuffer(v)) return v.toString('hex');
  return '';
}
