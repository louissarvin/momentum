#!/usr/bin/env bun
/**
 * Manually enqueue a settle SettlementJob for a specific (fixtureId, seq,
 * statKey). Used by end-to-end tests when the live TxLINE stream isn't
 * producing fresh settlement triggers.
 *
 *   bun run enqueue-settle <fixtureId> <seq> <statKey>
 *
 * Example (Pass 8 reference):
 *   bun run enqueue-settle 18237038 732 2
 */

import '../dotenv.ts';
import { prismaQuery } from '../src/lib/prisma.ts';

async function main(): Promise<void> {
  const [fixtureId, seqStr, statKey] = process.argv.slice(2);
  if (!fixtureId || !seqStr || !statKey) {
    console.error('usage: bun run enqueue-settle <fixtureId> <seq> <statKey>');
    process.exit(2);
  }
  const seq = Number(seqStr);
  if (!Number.isFinite(seq)) {
    console.error('seq must be numeric');
    process.exit(2);
  }
  // Ensure Fixture row exists.
  await prismaQuery.fixture.upsert({
    where: { fixtureId },
    create: { fixtureId, homeTeam: 'unknown', awayTeam: 'unknown' },
    update: {},
  });
  const job = await prismaQuery.settlementJob.create({
    data: {
      type: 'settle',
      fixtureId,
      seq,
      statKey,
      priority: 10,
      payload: { enqueuedBy: 'enqueue-settle-cli', at: new Date().toISOString() },
    },
  });
  console.log(`enqueued settle job ${job.id}`);
  console.log(`  fixtureId=${fixtureId} seq=${seq} statKey=${statKey}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
