#!/usr/bin/env bun
/**
 * Settler worker — Phase C / C.6. THE load-bearing piece.
 *
 * Runs as a separate Bun process:
 *
 *   bun run worker:settler
 *
 * Loop:
 *   1. Grab up to 5 `SettlementJob` rows where status='pending', ordered
 *      by (priority DESC, createdAt ASC). Mark them 'in_progress' in the
 *      same transaction (Prisma `updateMany`).
 *   2. For each job:
 *        - type='settle':
 *           * Look up pending PredictionCard slots for that fixture whose
 *             stat_a_key matches the statKey encoded in the job payload
 *             (or, if statKey is a symbolic action like 'goal', scan for
 *             any pending slot).
 *           * For each match, fetch the stat-validation-v3 proof from
 *             TxLINE using (fixtureId, seq, statKey).
 *           * Decide HIT vs MISS from stored predicate + observed value.
 *           * Build + send settle_prediction using the smoke-test-verified
 *             v0-tx-with-ALT + 600K CU pattern in `../lib/solana/settle.ts`.
 *           * On success: mark StickerMint + update slot mirror + publish
 *             sticker_minted via pg NOTIFY.
 *        - type='match_card':
 *           * (deferred) — for MVP just no-op-mark done and log.
 *   3. Retries: 3 attempts with 2s backoff and priority-fee escalation
 *      (20k → 50k → 100k microLamports). On 3rd fail, mark job 'error'.
 *   4. Bump the SettlerHeartbeat file every 1s so /health can show
 *      workers.settler.
 *
 * Concurrency safety: multiple settler processes are NOT supported by this
 * naive `updateMany` lock (no FOR UPDATE SKIP LOCKED via Prisma) — we
 * assume a single settler per environment. If two run they may race on the
 * same job; on-chain PDA re-mint will simply revert (Anchor `init`) so no
 * double-mint risk.
 */

import '../../dotenv.ts';
import { initSentry, captureError } from '../lib/sentry.ts';
initSentry('settler');

import { PublicKey } from '@solana/web3.js';
import type { PredictionCard } from '../../prisma/generated/client.js';

import { env } from '../config/env.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { connection } from '../lib/solana/connection.ts';
import { keeper } from '../lib/solana/keeper.ts';
import { momentumProgram } from '../lib/solana/program.ts';
import { fetchStatValidation, type StatValidationProof } from '../lib/txline/proofs.ts';
import {
  buildSettleTx,
  confirmSettle,
  decideOutcome,
  normalizeProofForContract,
  sendSettleTx,
  type Comparison,
} from '../lib/solana/settle.ts';
import {
  notifyStickerMinted,
  notifyMatchCardClaimed,
  notifySettlementStarted,
  notifySettlementError,
} from '../lib/stream/notify.ts';
import { writeSettlerHeartbeat } from '../lib/settler-heartbeat.ts';
import {
  buildClaimMatchCardTx,
  confirmClaimMatchCard,
  sendClaimMatchCardTx,
} from '../lib/solana/claim-match-card.ts';
import { deriveMomentumAssetId } from '../lib/solana/umi.ts';
import { MERKLE_TREE } from '../lib/solana/constants.ts';
import {
  decodeAnchorEvent,
  normalizeStickerMintedEvent,
  normalizeMatchCardClaimedEvent,
} from '../lib/solana/events.ts';
import { flags } from '../lib/flags.ts';

const BATCH_SIZE = 5;
const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 1000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 2000;

// ---- telegram notify (fire-and-forget HTTP push to the HTTP process) ----
//
// The settler runs as its OWN Bun process (see package.json `worker:settler`),
// so it can't reach `app.telegram` directly. We POST to /api/notify/telegram
// on the HTTP process, gated by NOTIFY_SHARED_SECRET.
//
// Every failure path here is swallowed — a Telegram outage MUST NEVER
// block or crash settlement. We give it 3 seconds max (AbortSignal.timeout)
// so a hung DNS lookup on the Telegram edge can't wedge the settler loop.

function backendUrl(): string {
  return env.BACKEND_INTERNAL_URL ?? `http://localhost:${env.APP_PORT}`;
}

async function notifyTelegramMint(
  payload: {
    assetId?: string | null;
    outcome: 'HIT' | 'MISS';
    fixtureId: string;
    slotIndex: number;
    txSig: string;
  },
  log: (m: string, x?: unknown) => void,
): Promise<void> {
  if (!env.NOTIFY_SHARED_SECRET) {
    // Not configured — skip silently. Not an error condition.
    return;
  }
  const body = JSON.stringify({
    assetId: payload.assetId ?? undefined,
    outcome: payload.outcome,
    fixtureId: payload.fixtureId,
    slotIndex: payload.slotIndex,
    txSig: payload.txSig,
  });
  try {
    const res = await fetch(`${backendUrl()}/api/notify/telegram`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Notify-Secret': env.NOTIFY_SHARED_SECRET,
      },
      body,
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 204) {
      log('telegram bot disabled (204) — skipping');
      return;
    }
    if (!res.ok) {
      log(`telegram notify non-2xx: ${res.status}`);
    }
  } catch (err) {
    log('telegram notify failed (non-fatal)', { err: (err as Error).message });
  }
}

// Priority-fee escalation ladder (microLamports/CU).
const PRIORITY_LADDER = [20_000, 50_000, 100_000];

interface SlotMirror {
  statAKey: number;
  statBKey: number;
  op: number;
  predicateComparison: number;
  threshold: number;
  period: number;
  status?: number; // 0 pending, 1 hit, 2 miss
  stickerAssetSeq?: string;
}

// ---- helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function metadataUri(fixtureId: string, slotIndex: number): string {
  return `${env.METADATA_HOST}/stickers/${fixtureId}-${slotIndex}.json`;
}

function parseSlots(raw: unknown): SlotMirror[] {
  if (!Array.isArray(raw)) return [];
  return raw as SlotMirror[];
}

/**
 * Extract the observed integer value from the TxLINE proof payload.
 * The proof's `statToProve.value` field is what the on-chain contract
 * verified.
 */
function observedValue(proof: StatValidationProof): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const val = (proof as any).statToProve?.value ?? (proof as any).raw?.statToProve?.value;
  if (typeof val === 'number') return val;
  if (typeof val === 'string' && !Number.isNaN(Number(val))) return Number(val);
  return 0;
}

// ---- core job handler ----

/**
 * Fetch a `stat-validation-v3` proof for (fixtureId, seq, statKey).
 *
 * Lookup order:
 *   1. `ProofCache` table — persists proofs we've validated on chain OR
 *      pre-seeded from a captured JSON file (see scripts/seed-proof.ts).
 *      TxLINE ages out proofs for old fixtures, so replay demos rely on
 *      the local cache.
 *   2. Live TxLINE `/api/proof/stat-validation-v3/...`.
 *   3. Null when both are unavailable — caller marks the job as retry/skip.
 */
async function fetchProof(
  fixtureId: string,
  seq: number,
  statKey: string,
): Promise<StatValidationProof | null> {
  const cached = await prismaQuery.proofCache.findUnique({
    where: { fixtureId_seq_statKey: { fixtureId, seq, statKey } },
  });
  if (cached) return cached.payload as unknown as StatValidationProof;

  try {
    const proof = await fetchStatValidation(fixtureId, seq, statKey);
    return proof;
  } catch (err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
}

type JobResult = { status: 'done' | 'skip' | 'retry' | 'error'; reason?: string };

async function handleSettleJob(
  job: { id: string; fixtureId: string; seq: number | null; statKey: string | null; attempts: number },
  log: (msg: string, extra?: unknown) => void,
): Promise<JobResult> {
  const { fixtureId, seq, statKey } = job;
  if (seq === null) return { status: 'skip', reason: 'missing seq' };

  const cards = await prismaQuery.predictionCard.findMany({
    where: { fixtureId },
  });
  if (cards.length === 0) {
    return { status: 'skip', reason: 'no cards for fixture' };
  }

  let successCount = 0;
  let skippedCount = 0;
  let failureReason: string | null = null;

  for (const card of cards) {
    const slots = parseSlots(card.slots);
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex];
      if (!slot) continue;
      if ((slot.status ?? 0) !== 0) continue; // already resolved on-chain

      // Determine which stat key to fetch. If job.statKey is a symbolic
      // action ('goal' etc), we still need a numeric statAKey — trust the
      // slot's statAKey since the on-chain contract validates it anyway.
      let statKeyForFetch: string;
      if (statKey && /^[0-9]+$/.test(statKey)) {
        statKeyForFetch = statKey;
        if (String(slot.statAKey) !== statKey) continue; // slot not affected
      } else {
        statKeyForFetch = String(slot.statAKey);
      }

      let proof: StatValidationProof | null = null;
      try {
        proof = await fetchProof(fixtureId, seq, statKeyForFetch);
      } catch (err) {
        failureReason = `proof fetch error: ${(err as Error).message}`;
        log('proof fetch failed', { fixtureId, seq, statKeyForFetch, err: (err as Error).message });
        continue;
      }
      if (!proof) {
        skippedCount++;
        continue;
      }

      // Cache the proof (best-effort).
      prismaQuery.proofCache
        .upsert({
          where: {
            fixtureId_seq_statKey: { fixtureId, seq, statKey: statKeyForFetch },
          },
          create: {
            fixtureId,
            seq,
            statKey: statKeyForFetch,
            payload: proof as unknown as object,
          },
          update: { payload: proof as unknown as object },
        })
        .catch(() => undefined);

      const normalized = normalizeProofForContract(proof as never);
      const observed = observedValue(proof);
      const decision = decideOutcome(observed, {
        comparison: slot.predicateComparison as Comparison,
        threshold: slot.threshold,
      });
      if (!decision) {
        skippedCount++;
        log('cannot negate EqualTo predicate; skipping slot', { cardPda: card.cardPda, slotIndex });
        continue;
      }

      const priority = PRIORITY_LADDER[Math.min(job.attempts, PRIORITY_LADDER.length - 1)];
      let userPk: PublicKey;
      try {
        userPk = new PublicKey(card.userWallet);
      } catch {
        skippedCount++;
        continue;
      }

      let built;
      try {
        built = await buildSettleTx({
          program: momentumProgram,
          connection,
          keeper,
          userWallet: userPk,
          fixtureId: BigInt(card.fixtureId),
          slotIndex,
          proof: normalized,
          predicate: decision.predicate,
          outcomeClaim: decision.outcomeClaim,
          metadataUri: metadataUri(card.fixtureId, slotIndex),
          priorityMicroLamports: priority,
        });
      } catch (err) {
        failureReason = `tx build failed: ${(err as Error).message}`;
        log('settle build failed', { err: (err as Error).message });
        continue;
      }

      log('sending settle tx', {
        cardPda: card.cardPda,
        slotIndex,
        outcome: decision.outcomeClaim === 1 ? 'HIT' : 'MISS',
        bytes: built.vtx.serialize().length,
        priority,
      });
      let sent;
      try {
        sent = await sendSettleTx(connection, built);
      } catch (err) {
        failureReason = `tx send failed: ${(err as Error).message}`;
        log('settle send failed', { err: (err as Error).message });
        continue;
      }
      log('settle tx submitted', { sig: sent.signature });

      try {
        await confirmSettle(connection, sent);
      } catch (err) {
        failureReason = `tx confirm failed: ${(err as Error).message}`;
        log('settle confirm failed', { sig: sent.signature, err: (err as Error).message });
        continue;
      }

      // Derive the cNFT asset_id from the on-chain TreeState.next_index.
      // The just-completed settle_prediction consumed the previous
      // `next_index` value, so after confirm `nextIndex - 1` is the leaf
      // index of this mint (mpl_bubblegum::get_asset_id(tree, leaf_index)).
      let assetSeq: bigint | null = null;
      let assetIdStr: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ts = await (momentumProgram.account as any).treeState.fetch(
          (await import('../lib/solana/constants.ts')).TREE_STATE_PDA,
        );
        const next = BigInt(ts.nextIndex?.toString?.() ?? ts.nextIndex);
        if (next > 0n) {
          assetSeq = next - 1n;
          assetIdStr = deriveMomentumAssetId(assetSeq).toBase58();
        }
      } catch (err) {
        log('assetId derive failed (non-fatal)', { err: (err as Error).message });
      }

      // Persist the mint.
      try {
        await prismaQuery.stickerMint.upsert({
          where: { cardPda_slotIndex: { cardPda: card.cardPda, slotIndex } },
          create: {
            cardPda: card.cardPda,
            userWallet: card.userWallet,
            fixtureId: card.fixtureId,
            slotIndex,
            outcome: decision.outcomeClaim === 1 ? 'hit' : 'miss',
            stickerAssetSeq: assetSeq,
            assetId: assetIdStr,
            treeMerkle: MERKLE_TREE.toBase58(),
            eventStatRoot: Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
            proofTs: BigInt(normalized.ts.toString()),
            mintTxSig: sent.signature,
          },
          update: {
            outcome: decision.outcomeClaim === 1 ? 'hit' : 'miss',
            stickerAssetSeq: assetSeq ?? undefined,
            assetId: assetIdStr ?? undefined,
            treeMerkle: MERKLE_TREE.toBase58(),
            eventStatRoot: Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
            proofTs: BigInt(normalized.ts.toString()),
            mintTxSig: sent.signature,
          },
        });
      } catch (err) {
        log('stickerMint upsert failed (non-fatal)', { err: (err as Error).message });
      }

      // Update the slot mirror on the card to reflect the resolved status.
      try {
        const nextSlots = slots.map((s, i) =>
          i === slotIndex ? { ...s, status: decision.outcomeClaim } : s,
        );
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await prismaQuery.predictionCard.update({
          where: { cardPda: card.cardPda },
          data: { slots: nextSlots as unknown as any },
        });
      } catch {
        // best-effort
      }

      // Try to decode the on-chain StickerMinted event for the richer
      // payload (event_stat_root, proof_ts, asset_id, merkle_tree, outcome,
      // sticker_asset_seq, user). Fails soft — fall back to synthesized.
      let decoded: ReturnType<typeof normalizeStickerMintedEvent> = null;
      try {
        const raw = await decodeAnchorEvent(
          connection,
          momentumProgram,
          sent.signature,
          'StickerMinted',
        );
        decoded = normalizeStickerMintedEvent(raw);
        if (decoded) {
          log('decoded StickerMinted event', {
            sig: sent.signature,
            user: decoded.user,
            fixtureId: decoded.fixtureId,
            slotIndex: decoded.slotIndex,
            outcome: decoded.outcome,
            stickerAssetSeq: decoded.stickerAssetSeq,
            eventStatRoot: decoded.eventStatRoot,
            proofTs: decoded.proofTs,
            assetId: decoded.assetId,
          });
        }
      } catch (err) {
        log('event decode failed (non-fatal)', { err: (err as Error).message });
      }

      // Fanout via pg NOTIFY. Prefer decoded on-chain data when available.
      try {
        await notifyStickerMinted({
          fixtureId: decoded?.fixtureId ?? card.fixtureId,
          cardPda: card.cardPda,
          slotIndex: decoded?.slotIndex ?? slotIndex,
          assetId: decoded?.assetId ?? assetIdStr,
          mintTxSig: sent.signature,
          user: decoded?.user ?? card.userWallet,
          outcome: decoded?.outcome ?? decision.outcomeClaim,
          stickerAssetSeq: decoded?.stickerAssetSeq ?? assetSeq?.toString() ?? null,
          eventStatRoot:
            decoded?.eventStatRoot ??
            Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
          proofTs: decoded?.proofTs ?? normalized.ts.toString(),
          merkleTree: decoded?.merkleTree ?? MERKLE_TREE.toBase58(),
          decoded: !!decoded,
        });
      } catch {
        // best-effort
      }

      // Telegram push (fire-and-forget, non-blocking, non-fatal).
      void notifyTelegramMint(
        {
          assetId: decoded?.assetId ?? assetIdStr,
          outcome: decision.outcomeClaim === 1 ? 'HIT' : 'MISS',
          fixtureId: card.fixtureId,
          slotIndex,
          txSig: sent.signature,
        },
        log,
      );

      successCount++;
    }
  }

  if (successCount > 0) return { status: 'done' };
  if (failureReason) return { status: 'retry', reason: failureReason };
  return { status: 'skip', reason: skippedCount > 0 ? 'no proof yet' : 'no matching slots' };
}

async function handleMatchCardJob(
  job: { id: string; fixtureId: string; seq: number | null; attempts: number },
  log: (msg: string, extra?: unknown) => void,
): Promise<JobResult> {
  const { fixtureId, seq } = job;
  if (seq === null) return { status: 'skip', reason: 'missing seq' };

  const cards = await prismaQuery.predictionCard.findMany({
    where: { fixtureId, matchCardMinted: false },
  });
  if (cards.length === 0) {
    return { status: 'skip', reason: 'no unclaimed cards' };
  }

  // Pick a stat key that always has a root at final whistle. We iterate
  // ProofCache rows for this (fixtureId, seq) — the first one whose value
  // satisfies GreaterThan(0) is the one we use. Fallback: statKey 1 (total
  // goals) which is universal to football fixtures on TxLINE.
  const proofCandidates = await prismaQuery.proofCache.findMany({
    where: { fixtureId, seq },
    orderBy: { capturedAt: 'asc' },
    take: 20,
  });

  let chosen: { statKey: string; proof: StatValidationProof } | null = null;
  for (const p of proofCandidates) {
    const proof = p.payload as unknown as StatValidationProof;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (proof as any).statToProve?.value;
    const num = typeof val === 'number' ? val : Number(val);
    if (Number.isFinite(num) && num > 0) {
      chosen = { statKey: p.statKey, proof };
      break;
    }
  }
  if (!chosen && proofCandidates.length > 0) {
    // Fall back to the first cached proof regardless — the on-chain contract
    // will reject if the predicate doesn't hold, and we'll bump priority.
    chosen = {
      statKey: proofCandidates[0].statKey,
      proof: proofCandidates[0].payload as unknown as StatValidationProof,
    };
  }
  if (!chosen) {
    // Try live TxLINE for statKey 1 (total goals) as last resort.
    try {
      const live = await fetchProof(fixtureId, seq, '1');
      if (live) chosen = { statKey: '1', proof: live };
    } catch (err) {
      log('match_card live proof lookup failed', { err: (err as Error).message });
    }
  }
  if (!chosen) return { status: 'retry', reason: 'no proof available' };

  const normalized = normalizeProofForContract(chosen.proof as never);
  const priority = PRIORITY_LADDER[Math.min(job.attempts, PRIORITY_LADDER.length - 1)];

  let successCount = 0;
  let failureReason: string | null = null;

  for (const card of cards) {
    let userPk: PublicKey;
    try {
      userPk = new PublicKey(card.userWallet);
    } catch {
      continue;
    }

    let built;
    try {
      built = await buildClaimMatchCardTx({
        program: momentumProgram,
        connection,
        keeper,
        userWallet: userPk,
        fixtureId: BigInt(card.fixtureId),
        proof: normalized,
        metadataUri: `${env.METADATA_HOST}/matchcards/${card.fixtureId}.json`,
        priorityMicroLamports: priority,
      });
    } catch (err) {
      failureReason = `match_card build failed: ${(err as Error).message}`;
      log('match_card build failed', { cardPda: card.cardPda, err: (err as Error).message });
      continue;
    }

    log('sending claim_match_card tx', {
      cardPda: card.cardPda,
      fixtureId: card.fixtureId,
      bytes: built.vtx.serialize().length,
      priority,
    });

    let sent;
    try {
      sent = await sendClaimMatchCardTx(connection, built);
    } catch (err) {
      failureReason = `match_card send failed: ${(err as Error).message}`;
      log('match_card send failed', { err: (err as Error).message });
      continue;
    }
    try {
      await confirmClaimMatchCard(connection, sent);
    } catch (err) {
      failureReason = `match_card confirm failed: ${(err as Error).message}`;
      log('match_card confirm failed', { sig: sent.signature, err: (err as Error).message });
      continue;
    }
    log('match_card tx confirmed', { sig: sent.signature });

    // Derive assetId from post-tx TreeState.next_index.
    let assetSeq: bigint | null = null;
    let assetIdStr: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ts = await (momentumProgram.account as any).treeState.fetch(
        (await import('../lib/solana/constants.ts')).TREE_STATE_PDA,
      );
      const next = BigInt(ts.nextIndex?.toString?.() ?? ts.nextIndex);
      if (next > 0n) {
        assetSeq = next - 1n;
        assetIdStr = deriveMomentumAssetId(assetSeq).toBase58();
      }
    } catch (err) {
      log('match_card assetId derive failed (non-fatal)', { err: (err as Error).message });
    }

    // Insert MatchCard row + flip predictionCard.matchCardMinted.
    try {
      await prismaQuery.$transaction([
        prismaQuery.matchCard.upsert({
          where: { cardPda: card.cardPda },
          create: {
            cardPda: card.cardPda,
            userWallet: card.userWallet,
            fixtureId: card.fixtureId,
            assetId: assetIdStr,
            eventStatRoot: Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
            proofTs: BigInt(normalized.ts.toString()),
            mintTxSig: sent.signature,
          },
          update: {
            assetId: assetIdStr ?? undefined,
            mintTxSig: sent.signature,
            eventStatRoot: Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
            proofTs: BigInt(normalized.ts.toString()),
          },
        }),
        prismaQuery.predictionCard.update({
          where: { cardPda: card.cardPda },
          data: { matchCardMinted: true },
        }),
      ]);
    } catch (err) {
      log('match_card DB mirror failed (non-fatal)', { err: (err as Error).message });
    }

    // Decode the on-chain MatchCardClaimed event (best-effort).
    let decodedMc: ReturnType<typeof normalizeMatchCardClaimedEvent> = null;
    try {
      const raw = await decodeAnchorEvent(
        connection,
        momentumProgram,
        sent.signature,
        'MatchCardClaimed',
      );
      decodedMc = normalizeMatchCardClaimedEvent(raw);
      if (decodedMc) {
        log('decoded MatchCardClaimed event', {
          sig: sent.signature,
          user: decodedMc.user,
          fixtureId: decodedMc.fixtureId,
          matchCardSeq: decodedMc.matchCardSeq,
          eventStatRoot: decodedMc.eventStatRoot,
          proofTs: decodedMc.proofTs,
          assetId: decodedMc.assetId,
        });
      }
    } catch (err) {
      log('match_card event decode failed (non-fatal)', { err: (err as Error).message });
    }

    try {
      await notifyMatchCardClaimed({
        fixtureId: decodedMc?.fixtureId ?? card.fixtureId,
        cardPda: card.cardPda,
        assetId: decodedMc?.assetId ?? assetIdStr,
        mintTxSig: sent.signature,
        user: decodedMc?.user ?? card.userWallet,
        matchCardSeq: decodedMc?.matchCardSeq ?? assetSeq?.toString() ?? null,
        eventStatRoot:
          decodedMc?.eventStatRoot ??
          Buffer.from(normalized.statA.eventStatRoot).toString('hex'),
        proofTs: decodedMc?.proofTs ?? normalized.ts.toString(),
        merkleTree: decodedMc?.merkleTree ?? MERKLE_TREE.toBase58(),
        decoded: !!decodedMc,
      });
    } catch {
      // best-effort
    }
    successCount++;
  }

  if (successCount > 0) return { status: 'done' };
  return { status: 'retry', reason: failureReason ?? 'no cards minted' };
}

// ---- job puller ----

interface JobRow {
  id: string;
  type: 'settle' | 'match_card';
  fixtureId: string;
  seq: number | null;
  statKey: string | null;
  attempts: number;
  priority: number;
}

async function claimBatch(): Promise<JobRow[]> {
  // Two-step: fetch pending IDs then updateMany to 'in_progress'. Not a
  // FOR UPDATE SKIP LOCKED but sufficient for the single-settler
  // deployment. Prisma updateMany returns count; refetch by ids.
  const pending = await prismaQuery.settlementJob.findMany({
    where: { status: 'pending' },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: BATCH_SIZE,
    select: { id: true },
  });
  if (pending.length === 0) return [];
  const ids = pending.map((p) => p.id);
  await prismaQuery.settlementJob.updateMany({
    where: { id: { in: ids }, status: 'pending' },
    data: { status: 'in_progress' },
  });
  const rows = await prismaQuery.settlementJob.findMany({
    where: { id: { in: ids } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    fixtureId: r.fixtureId,
    seq: r.seq,
    statKey: r.statKey,
    attempts: r.attempts,
    priority: r.priority,
  }));
}

async function markJob(
  jobId: string,
  patch: {
    status?: 'pending' | 'in_progress' | 'done' | 'error';
    attempts?: number;
    lastError?: string | null;
  },
): Promise<void> {
  await prismaQuery.settlementJob.update({
    where: { id: jobId },
    data: patch,
  });
}

// ---- main loop ----

async function processJob(job: JobRow, log: (msg: string, extra?: unknown) => void): Promise<void> {
  const scoped = (m: string, x?: unknown): void =>
    log(`[job=${job.id} type=${job.type} fx=${job.fixtureId}] ${m}`, x);
  scoped('claimed');

  // Safety switch: mark done + log; do not submit on-chain.
  if (!flags.settler) {
    scoped('settlement disabled by MOMENTUM_FF_SETTLER — skipping');
    await markJob(job.id, { status: 'done', lastError: 'settlement disabled' });
    return;
  }

  // Signal the frontend that this job is now in-flight.
  notifySettlementStarted({
    jobId: job.id,
    fixtureId: job.fixtureId,
    seq: job.seq,
    statKey: job.statKey,
  }).catch(() => undefined);

  let result: JobResult;
  try {
    if (job.type === 'settle') {
      result = await handleSettleJob(job, scoped);
    } else {
      result = await handleMatchCardJob(job, scoped);
    }
  } catch (err) {
    scoped('unhandled error', { err: (err as Error).message });
    result = { status: 'retry', reason: (err as Error).message };
  }

  if (result.status === 'done' || result.status === 'skip') {
    await markJob(job.id, { status: 'done', lastError: result.reason ?? null });
    scoped(`marked done (${result.status})`, { reason: result.reason });
    return;
  }
  // retry path
  const nextAttempts = job.attempts + 1;
  if (nextAttempts >= MAX_ATTEMPTS) {
    await markJob(job.id, {
      status: 'error',
      attempts: nextAttempts,
      lastError: result.reason ?? null,
    });
    scoped('marked ERROR (max attempts)', { reason: result.reason });
    notifySettlementError({
      jobId: job.id,
      fixtureId: job.fixtureId,
      error: result.reason ?? 'max attempts exceeded',
    }).catch(() => undefined);
  } else {
    await markJob(job.id, {
      status: 'pending',
      attempts: nextAttempts,
      lastError: result.reason ?? null,
    });
    scoped(`re-queued (attempt ${nextAttempts}/${MAX_ATTEMPTS})`, { reason: result.reason });
    // Backoff so a persistent failure doesn't spin.
    await sleep(RETRY_BACKOFF_MS);
  }
}

async function main(): Promise<void> {
  console.log('[Settler] starting');
  console.log(`[Settler] keeper=${keeper.publicKey.toBase58()} cluster=${env.SOLANA_CLUSTER}`);
  console.log(`[Settler] program=${momentumProgram.programId.toBase58()}`);
  console.log(`[Settler] rpc=${env.SOLANA_RPC_URL}`);
  if (!flags.settler) {
    console.warn(
      '[Settler] MOMENTUM_FF_SETTLER=false — polling jobs but NOT submitting on-chain txs. ' +
        'This is a safety switch, not a bug.',
    );
  }

  const hbInterval = setInterval(() => void writeSettlerHeartbeat(), HEARTBEAT_INTERVAL_MS);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let batch: JobRow[];
    try {
      batch = await claimBatch();
    } catch (err) {
      console.error('[Settler] claimBatch error', err);
      await sleep(POLL_INTERVAL_MS * 5);
      continue;
    }
    if (batch.length === 0) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }
    console.log(`[Settler] claimed ${batch.length} job(s)`);
    // Process sequentially — keeper signs one tx at a time to avoid
    // blockhash reuse conflicts.
    for (const job of batch) {
      const log = (m: string, x?: unknown): void => console.log(`[Settler] ${m}`, x ?? '');
      try {
        await processJob(job, log);
        await writeSettlerHeartbeat({ lastJobId: job.id });
      } catch (err) {
        console.error(`[Settler] processJob crashed for ${job.id}`, err);
        try {
          await markJob(job.id, {
            status: 'error',
            attempts: job.attempts + 1,
            lastError: (err as Error).message,
          });
        } catch {
          // ignore
        }
      }
    }
  }

  // unreachable
  // eslint-disable-next-line no-unreachable
  clearInterval(hbInterval);
}

process.on('SIGINT', () => {
  console.log('[Settler] SIGINT — exiting');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[Settler] SIGTERM — exiting');
  process.exit(0);
});

// Silence unused type import (helps TS strict).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _PredictionCardType = null as unknown as PredictionCard | null;

main().catch((err) => {
  console.error('[Settler] fatal', err);
  captureError(err, { component: 'settler' });
  process.exit(1);
});
