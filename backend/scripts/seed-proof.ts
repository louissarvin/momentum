#!/usr/bin/env bun
/**
 * Seed a stat-validation-v3 proof file into `ProofCache` so the settler
 * can consume it even when the live TxLINE endpoint has aged out.
 *
 *   bun run scripts/seed-proof.ts <path-to-proof.json> <fixtureId> <seq> <statKey>
 */

import '../dotenv.ts';
import { readFileSync } from 'node:fs';
import { prismaQuery } from '../src/lib/prisma.ts';

async function main(): Promise<void> {
  const [path, fixtureId, seqStr, statKey] = process.argv.slice(2);
  if (!path || !fixtureId || !seqStr || !statKey) {
    console.error('usage: bun run scripts/seed-proof.ts <path> <fixtureId> <seq> <statKey>');
    process.exit(2);
  }
  const seq = Number(seqStr);
  const payload = JSON.parse(readFileSync(path, 'utf8'));

  await prismaQuery.fixture.upsert({
    where: { fixtureId },
    create: { fixtureId, homeTeam: 'unknown', awayTeam: 'unknown' },
    update: {},
  });
  const row = await prismaQuery.proofCache.upsert({
    where: { fixtureId_seq_statKey: { fixtureId, seq, statKey } },
    create: { fixtureId, seq, statKey, payload },
    update: { payload },
  });
  console.log(`seeded proofCache ${row.id}  fixture=${fixtureId} seq=${seq} statKey=${statKey}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
