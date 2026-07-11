#!/usr/bin/env bun
/**
 * Replay worker — Phase E / E.1.
 *
 * Judging happens on 2026-07-29, after the tournament ended 2026-07-19.
 * The live TxLINE stream is quiet, so demos rely on replaying archived
 * `ScorePacket` rows through the same fanout pipeline the live ingester
 * uses (Postgres NOTIFY + SettlementJob enqueue).
 *
 * Env-driven:
 *   REPLAY_MODE=true
 *   REPLAY_FIXTURE_ID=18237038
 *   REPLAY_SPEED=5.0                  (float; higher = faster than wall clock)
 *   REPLAY_START_SEQ=1                (inclusive)
 *   REPLAY_END_SEQ=9007199254740991   (inclusive; default Number.MAX_SAFE_INTEGER)
 *
 * Run with:
 *
 *   REPLAY_MODE=true REPLAY_FIXTURE_ID=18237038 REPLAY_SPEED=100 \
 *   bun run worker:replay
 *
 * Interaction with the live ingester: the live ingester bails out at boot
 * when REPLAY_MODE=true so we don't double-emit.
 */

import '../../dotenv.ts';
import { initSentry, captureError } from '../lib/sentry.ts';
initSentry('replay');

import { env } from '../config/env.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { notifyPacket } from '../lib/stream/notify.ts';
import { writeReplayStatus, clearReplayStatus } from '../lib/replay-status.ts';

const SCORING_ACTIONS = new Set(['goal', 'goal_confirmed', 'red_card', 'yellow_card', 'half_time']);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function enqueueJob(
  type: 'settle' | 'match_card',
  fixtureId: string,
  seq: number,
  statKey: string | null,
): Promise<void> {
  try {
    await prismaQuery.settlementJob.create({
      data: {
        type,
        fixtureId,
        seq,
        statKey,
        payload: { enqueuedBy: 'replay', at: new Date().toISOString() },
      },
    });
  } catch (err) {
    console.warn('[Replay] enqueue failed', err);
  }
}

async function main(): Promise<void> {
  if (!env.REPLAY_MODE) {
    console.log('[Replay] REPLAY_MODE is false — nothing to do');
    process.exit(0);
  }
  const fixtureId = env.REPLAY_FIXTURE_ID;
  if (!fixtureId) {
    console.error('[Replay] REPLAY_FIXTURE_ID is required');
    process.exit(1);
  }

  const startSeq = env.REPLAY_START_SEQ;
  const endSeq = env.REPLAY_END_SEQ;
  const speed = env.REPLAY_SPEED;

  console.log(
    `[Replay] starting fixture=${fixtureId} startSeq=${startSeq} endSeq=${endSeq} speed=${speed}x`,
  );

  const packets = await prismaQuery.scorePacket.findMany({
    where: {
      fixtureId,
      seq: { gte: startSeq, lte: endSeq === Number.MAX_SAFE_INTEGER ? undefined : endSeq },
    },
    orderBy: { seq: 'asc' },
  });

  if (packets.length === 0) {
    console.warn(
      `[Replay] no packets found for fixture=${fixtureId} in seq[${startSeq}..${endSeq}] — did you backfill?`,
    );
    await writeReplayStatus({
      active: false,
      fixtureId,
      currentSeq: 0,
      endSeq,
      startSeq,
      totalPackets: 0,
      processedPackets: 0,
      speed,
      startedAt: new Date().toISOString(),
      estimatedCompletionAt: null,
      finishedAt: new Date().toISOString(),
    });
    process.exit(0);
  }

  const firstTs = packets[0].ts ? Number(packets[0].ts) : null;
  const lastTs = packets[packets.length - 1].ts
    ? Number(packets[packets.length - 1].ts)
    : null;
  const spanMs = firstTs && lastTs ? Math.max(0, lastTs - firstTs) : 0;
  const estimateMs = spanMs / speed;
  const startedAt = new Date();
  const estimatedCompletionAt = new Date(startedAt.getTime() + estimateMs);

  console.log(
    `[Replay] ${packets.length} packets, natural span ${spanMs}ms, estimated replay ${Math.round(
      estimateMs,
    )}ms`,
  );

  await writeReplayStatus({
    active: true,
    fixtureId,
    currentSeq: packets[0].seq,
    endSeq: packets[packets.length - 1].seq,
    startSeq: packets[0].seq,
    totalPackets: packets.length,
    processedPackets: 0,
    speed,
    startedAt: startedAt.toISOString(),
    estimatedCompletionAt: estimatedCompletionAt.toISOString(),
  });

  let prevTsMs: number | null = null;
  let processed = 0;

  for (const p of packets) {
    const tsMs = p.ts ? Number(p.ts) : null;
    if (prevTsMs !== null && tsMs !== null) {
      const delta = Math.max(0, tsMs - prevTsMs);
      const wait = Math.floor(delta / speed);
      if (wait > 0) await sleep(Math.min(wait, 30_000)); // hard cap per-step 30s
    }
    prevTsMs = tsMs;

    // Bump ingester heartbeat so /health reports replay traffic as live.
    try {
      await prismaQuery.txlineSession.update({
        where: { id: 1 },
        data: { lastPacketAt: new Date() },
      });
    } catch {
      // singleton not initialised — non-fatal
    }

    try {
      await notifyPacket({
        fixtureId: p.fixtureId,
        seq: p.seq,
        ts: tsMs ?? undefined,
        action: p.action,
        statusId: p.statusId,
        period: p.period,
        raw: null,
      });
    } catch (err) {
      console.warn('[Replay] pg_notify failed', err);
    }

    // Same classification as the live ingester so settlement is exercised.
    const isFinal =
      p.action === 'game_finalised' &&
      p.statusId === 100 &&
      (p.period === null || p.period === 100);
    if (isFinal) {
      await enqueueJob('match_card', p.fixtureId, p.seq, null);
    } else if (p.action && SCORING_ACTIONS.has(p.action)) {
      await enqueueJob('settle', p.fixtureId, p.seq, p.action);
    }

    processed += 1;
    if (processed % 10 === 0 || processed === packets.length) {
      await writeReplayStatus({
        active: true,
        fixtureId,
        currentSeq: p.seq,
        processedPackets: processed,
      });
      console.log(
        `[Replay] ${processed}/${packets.length} — seq=${p.seq} action=${p.action ?? 'null'}`,
      );
    }
  }

  const finishedAt = new Date();
  await writeReplayStatus({
    active: false,
    processedPackets: processed,
    currentSeq: packets[packets.length - 1].seq,
    finishedAt: finishedAt.toISOString(),
  });
  console.log(
    `[Replay] complete — ${processed} packets emitted in ${finishedAt.getTime() - startedAt.getTime()}ms`,
  );
  process.exit(0);
}

process.on('SIGINT', () => {
  console.log('[Replay] SIGINT — clearing status');
  void clearReplayStatus().finally(() => process.exit(0));
});
process.on('SIGTERM', () => {
  console.log('[Replay] SIGTERM — clearing status');
  void clearReplayStatus().finally(() => process.exit(0));
});

main().catch((err) => {
  console.error('[Replay] fatal', err);
  captureError(err, { component: 'replay' });
  process.exit(1);
});
