#!/usr/bin/env bun
/**
 * Mirror an existing on-chain PredictionCard into the DB.
 *
 *   bun run scripts/mirror-card.ts <userWallet> <fixtureId>
 *
 * Useful when a card was created outside the /api/predictions/:fixture/confirm
 * flow (e.g., by the on-chain smoke test) and the settler needs a DB row to
 * key off.
 */

import '../dotenv.ts';
import { PublicKey } from '@solana/web3.js';
import { momentumProgram } from '../src/lib/solana/program.ts';
import { derivePredictionCard } from '../src/lib/solana/pdas.ts';
import { prismaQuery } from '../src/lib/prisma.ts';

async function main(): Promise<void> {
  const [wallet, fixtureId] = process.argv.slice(2);
  if (!wallet || !fixtureId) {
    console.error('usage: bun run scripts/mirror-card.ts <userWallet> <fixtureId>');
    process.exit(2);
  }
  const userPk = new PublicKey(wallet);
  const [cardPda] = derivePredictionCard(userPk, BigInt(fixtureId));
  console.log(`cardPda=${cardPda.toBase58()}`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onchain = await (momentumProgram.account as any).predictionCard.fetch(cardPda);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (onchain.slots as any[]).slice(0, onchain.slotCount).map((s) => ({
    statAKey: s.statAKey,
    statBKey: s.statBKey,
    op: s.op,
    predicateComparison: s.predicateComparison,
    threshold: s.threshold,
    period: s.period,
    status: s.status,
    stickerAssetSeq: s.stickerAssetSeq?.toString?.() ?? '0',
    eventStatRoot: Buffer.from(s.eventStatRoot ?? []).toString('hex'),
    proofTs: s.proofTs?.toString?.() ?? '0',
  }));

  await prismaQuery.fixture.upsert({
    where: { fixtureId },
    create: { fixtureId, homeTeam: 'unknown', awayTeam: 'unknown' },
    update: {},
  });
  await prismaQuery.user.upsert({
    where: { walletAddress: wallet },
    create: { walletAddress: wallet },
    update: {},
  });

  await prismaQuery.predictionCard.upsert({
    where: { cardPda: cardPda.toBase58() },
    create: {
      cardPda: cardPda.toBase58(),
      userWallet: wallet,
      fixtureId,
      slots,
      slotCount: onchain.slotCount,
    },
    update: { slots, slotCount: onchain.slotCount },
  });

  console.log('mirrored', { slotCount: onchain.slotCount, firstSlotStatus: slots[0]?.status });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
