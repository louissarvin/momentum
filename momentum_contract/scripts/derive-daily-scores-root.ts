/**
 * Derive the TxLINE `daily_scores_roots` PDA for a given ms timestamp.
 *
 * Seeds (per txodds/tx-on-chain reference client):
 *   [
 *     Buffer.from("daily_scores_roots"),
 *     u16_le(epochDay)   // epochDay = floor(ts_ms / 86_400_000)
 *   ]
 *
 * NOTE: The `validate_stat` IDL calls this account `daily_scores_merkle_roots`,
 * but the docs explicitly say the seeds match those of `insert_scores_root`
 * whose account name is `daily_scores_roots`. Both refer to the SAME PDA.
 *
 * Usage:
 *   bun run derive-daily-scores-root.ts <ts_ms>
 *   bun run derive-daily-scores-root.ts --epoch-day <n>
 *
 * If no arg given, uses `Date.now()`.
 */
import { Connection, PublicKey } from "@solana/web3.js";

export const TXLINE_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
);
const DEVNET_RPC = "https://api.devnet.solana.com";
const SEED_LITERAL = "daily_scores_roots";
const MS_PER_DAY = 86_400_000;

/** Number of days since Unix epoch (UTC), as used by TxLINE for its `epoch_day` seed. */
export function epochDayFromMs(tsMs: number): number {
  return Math.floor(tsMs / MS_PER_DAY);
}

/** Derive the daily_scores_roots PDA for the day containing `tsMs`. */
export function deriveDailyScoresRoot(
  tsMs: number,
  programId: PublicKey = TXLINE_PROGRAM_ID,
): { pda: PublicKey; bump: number; epochDay: number } {
  const epochDay = epochDayFromMs(tsMs);
  const dayBuf = Buffer.alloc(2);
  dayBuf.writeUInt16LE(epochDay & 0xffff, 0);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LITERAL), dayBuf],
    programId,
  );
  return { pda, bump, epochDay };
}

/** Convenience: derive by explicit epoch day. */
export function deriveDailyScoresRootByDay(
  epochDay: number,
  programId: PublicKey = TXLINE_PROGRAM_ID,
): { pda: PublicKey; bump: number } {
  const dayBuf = Buffer.alloc(2);
  dayBuf.writeUInt16LE(epochDay & 0xffff, 0);
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_LITERAL), dayBuf],
    programId,
  );
  return { pda, bump };
}

async function main() {
  const args = process.argv.slice(2);
  let tsMs: number;
  let epochDay: number | null = null;

  if (args[0] === "--epoch-day" && args[1]) {
    epochDay = parseInt(args[1], 10);
    tsMs = epochDay * MS_PER_DAY;
  } else if (args[0]) {
    tsMs = parseInt(args[0], 10);
  } else {
    tsMs = Date.now();
  }

  const d = deriveDailyScoresRoot(tsMs);
  console.log(`ts_ms      : ${tsMs}`);
  console.log(`utc_date   : ${new Date(tsMs).toISOString()}`);
  console.log(`epoch_day  : ${d.epochDay}${epochDay !== null ? " (from arg)" : ""}`);
  console.log(`seeds      : ["${SEED_LITERAL}", u16_le(${d.epochDay})]`);
  console.log(`pda        : ${d.pda.toBase58()}`);
  console.log(`bump       : ${d.bump}`);

  const conn = new Connection(DEVNET_RPC, "confirmed");
  const info = await conn.getAccountInfo(d.pda, "confirmed");
  if (!info) {
    console.log(`\naccount    : NOT FOUND on devnet`);
    console.log(`             (TxLINE has not posted a scores root for this day yet)`);
    return;
  }
  console.log(`\naccount owner   : ${info.owner.toBase58()}`);
  console.log(`account lamports: ${info.lamports}`);
  console.log(`account exec    : ${info.executable}`);
  console.log(`account data.len: ${info.data.length}`);
  const buf = info.data as Buffer;
  const first40 = buf.slice(0, Math.min(40, buf.length)).toString("hex");
  console.log(`first 40 hex    : ${first40}`);
  console.log(`  discriminator : ${buf.slice(0, 8).toString("hex")}`);
  if (buf.length >= 10) {
    // Heuristic: interpret next bytes as u16 epoch_day + tail.
    console.log(`  bytes[8..10]  : ${buf.slice(8, 10).toString("hex")}  (u16 LE=${buf.readUInt16LE(8)})`);
  }
}

// Only run main if invoked directly.
if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
