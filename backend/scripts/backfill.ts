#!/usr/bin/env bun
/**
 * Backfill script — Phase B / B.5 fallback.
 *
 * When the live TxLINE stream is quiet (known-empty windows past
 * 2026-07-19), fetch a historical batch via
 * `/api/scores/updates/{epochDay}/{hour}/{intervalMin}` and drive it
 * through the same packet-handling pipeline as the live ingester.
 *
 *   bun run backfill <epochDay> <hour> [intervalMin=5]
 *
 * Example (matches Pass 8 winning fetch):
 *   bun run backfill 20648 20 5
 */

import '../dotenv.ts';

import { prismaQuery } from '../src/lib/prisma.ts';
import { fetchScoresUpdates } from '../src/lib/txline/proofs.ts';
import { notifyPacket } from '../src/lib/stream/notify.ts';
import { normalizePacket } from '../src/lib/txline/normalize.ts';

const SCORING_ACTIONS = new Set(['goal', 'goal_confirmed', 'red_card', 'yellow_card', 'half_time']);

async function ingest(raw: unknown): Promise<{ stored: boolean; enqueued: boolean }> {
  const p = normalizePacket(raw);
  if (!p) return { stored: false, enqueued: false };

  await prismaQuery.fixture.upsert({
    where: { fixtureId: p.fixtureId },
    create: {
      fixtureId: p.fixtureId,
      homeTeam: 'unknown',
      awayTeam: 'unknown',
      statusId: p.statusId,
      period: p.period,
    },
    update: { statusId: p.statusId, period: p.period },
  });

  let stored = false;
  try {
    await prismaQuery.scorePacket.create({
      data: {
        fixtureId: p.fixtureId,
        seq: p.seq,
        ts: p.ts !== undefined ? BigInt(p.ts) : null,
        action: p.action ?? null,
        statusId: p.statusId ?? null,
        period: p.period ?? null,
        raw: p.raw as unknown as object,
      },
    });
    stored = true;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'P2002') throw err;
  }

  if (stored) {
    await notifyPacket({
      fixtureId: p.fixtureId,
      seq: p.seq,
      ts: p.ts,
      action: p.action ?? null,
      statusId: p.statusId ?? null,
      period: p.period ?? null,
      raw: null,
    }).catch(() => undefined);
  }

  let enqueued = false;
  const isFinal =
    p.action === 'game_finalised' &&
    p.statusId === 100 &&
    (p.period === undefined || p.period === 100);
  if (isFinal) {
    await prismaQuery.settlementJob.create({
      data: {
        type: 'match_card',
        fixtureId: p.fixtureId,
        seq: p.seq,
        payload: { enqueuedBy: 'backfill' },
      },
    });
    enqueued = true;
  } else if (p.action && SCORING_ACTIONS.has(p.action)) {
    await prismaQuery.settlementJob.create({
      data: {
        type: 'settle',
        fixtureId: p.fixtureId,
        seq: p.seq,
        statKey: p.action,
        payload: { enqueuedBy: 'backfill' },
      },
    });
    enqueued = true;
  }
  return { stored, enqueued };
}

async function main() {
  const [epochDayStr, hourStr, intervalStr] = process.argv.slice(2);
  if (!epochDayStr || !hourStr) {
    console.error('usage: bun run backfill <epochDay> <hour> [intervalMin=5]');
    process.exit(2);
  }
  const epochDay = Number(epochDayStr);
  const hour = Number(hourStr);
  const interval = intervalStr ? Number(intervalStr) : 5;

  console.log(`[Backfill] fetching updates for epochDay=${epochDay} hour=${hour} interval=${interval}min`);
  const data = await fetchScoresUpdates(epochDay, hour, interval);

  const packets: unknown[] = Array.isArray(data)
    ? (data as unknown[])
    : (data as { packets?: unknown[]; items?: unknown[] })?.packets
      ?? (data as { items?: unknown[] })?.items
      ?? [];
  console.log(`[Backfill] received ${packets.length} packets`);

  let stored = 0;
  let enqueued = 0;
  for (const p of packets) {
    try {
      const r = await ingest(p);
      if (r.stored) stored++;
      if (r.enqueued) enqueued++;
    } catch (err) {
      console.warn('[Backfill] ingest error for one packet:', err);
    }
  }
  console.log(`[Backfill] stored=${stored} enqueued=${enqueued}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[Backfill] fatal', err);
  process.exit(1);
});
