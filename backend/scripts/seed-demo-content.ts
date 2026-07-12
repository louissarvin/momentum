/**
 * Seed demo content so /album and /market have real-looking data.
 *
 * Uses REAL Pass 8 devnet transaction values so clicking Solscan works.
 * Safe to re-run — uses upserts.
 *
 * Usage:  bun run scripts/seed-demo-content.ts <userWalletBase58>
 */

import { prismaQuery } from '../src/lib/prisma.ts';

const PASS_8_MINT_TX_SIG =
  '24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g';
const PASS_8_EVENT_STAT_ROOT =
  '24ebb28c9f8a4d8b6a7f1f39d7b2e1c0aabbccdd11223344aabbccdd11223344';
const PASS_8_PROOF_TS = 1784060998513n;
const TREE_PUBKEY = '2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX';
const USERS_EXISTING_CARD_PDA = 'HcfGjHdDwP2GDA4v6DtXj5G1PZPuqETS67BEsMvdGRrJ';
const PASS_8_SELLER = '77WT6vzxvr7tgHVm5Ju9ECJbfmZ6FMTVDnfMWEEd1Hrc';
const PASS_8_CARD_PDA = '4zrVJ47j6BYdFPcmndKaHVV4fTGGKdF5DfRf6rPQoeJ3';

const wallet = process.argv[2];
if (!wallet || wallet.length < 32) {
  console.error(
    'Usage: bun run scripts/seed-demo-content.ts <userWalletBase58>',
  );
  process.exit(1);
}

async function main() {
  console.log(`Seeding demo content for wallet ${wallet}`);

  // Fixture (Spain vs Argentina from the user's existing prediction)
  await prismaQuery.fixture.upsert({
    where: { fixtureId: '18257739' },
    create: {
      fixtureId: '18257739',
      homeTeam: 'Spain',
      awayTeam: 'Argentina',
      competitionId: '72',
    },
    update: {},
  });

  await prismaQuery.user.upsert({
    where: { walletAddress: wallet },
    create: { walletAddress: wallet },
    update: {},
  });

  // Ensure the user's existing PredictionCard exists in DB (it should — they
  // just submitted). If for some reason it doesn't, insert a placeholder.
  await prismaQuery.predictionCard.upsert({
    where: { cardPda: USERS_EXISTING_CARD_PDA },
    create: {
      cardPda: USERS_EXISTING_CARD_PDA,
      userWallet: wallet,
      fixtureId: '18257739',
      slotCount: 3,
      slots: [],
    },
    update: {},
  });

  // Seed 3 StickerMints on that card (2 HIT, 1 MISS)
  const stickers: Array<{
    slotIndex: number;
    outcome: string;
    seq: bigint;
    assetId: string;
  }> = [
    { slotIndex: 0, outcome: 'hit', seq: 100n, assetId: 'DemoAsset1_Spain_Argentina_TotalGoals_Over25' },
    { slotIndex: 1, outcome: 'hit', seq: 101n, assetId: 'DemoAsset2_Spain_Argentina_SpainCorners_Over45' },
    { slotIndex: 2, outcome: 'miss', seq: 102n, assetId: 'DemoAsset3_Spain_Argentina_ArgYellow_Over25' },
  ];

  for (const s of stickers) {
    await prismaQuery.stickerMint.upsert({
      where: {
        cardPda_slotIndex: {
          cardPda: USERS_EXISTING_CARD_PDA,
          slotIndex: s.slotIndex,
        },
      },
      create: {
        cardPda: USERS_EXISTING_CARD_PDA,
        userWallet: wallet,
        fixtureId: '18257739',
        slotIndex: s.slotIndex,
        outcome: s.outcome,
        stickerAssetSeq: s.seq,
        assetId: s.assetId,
        treeMerkle: TREE_PUBKEY,
        eventStatRoot: PASS_8_EVENT_STAT_ROOT,
        proofTs: PASS_8_PROOF_TS,
        mintTxSig: PASS_8_MINT_TX_SIG,
      },
      update: {
        outcome: s.outcome,
        assetId: s.assetId,
        stickerAssetSeq: s.seq,
      },
    });
    console.log(`  ✓ StickerMint slot ${s.slotIndex} (${s.outcome})`);
  }

  // Seed a marketplace listing on a sticker owned by another wallet so the
  // current user can browse (and, in the demo, hypothetically buy).
  await prismaQuery.fixture.upsert({
    where: { fixtureId: '18237038' },
    create: {
      fixtureId: '18237038',
      homeTeam: 'Iceland',
      awayTeam: 'Portugal',
      competitionId: '72',
    },
    update: {},
  });
  await prismaQuery.user.upsert({
    where: { walletAddress: PASS_8_SELLER },
    create: { walletAddress: PASS_8_SELLER },
    update: {},
  });
  await prismaQuery.predictionCard.upsert({
    where: { cardPda: PASS_8_CARD_PDA },
    create: {
      cardPda: PASS_8_CARD_PDA,
      userWallet: PASS_8_SELLER,
      fixtureId: '18237038',
      slotCount: 1,
      slots: [],
    },
    update: {},
  });
  const marketAssetId = 'DemoMarketAsset_IcelandPortugal_TotalGoals_Over15';
  await prismaQuery.stickerMint.upsert({
    where: {
      cardPda_slotIndex: { cardPda: PASS_8_CARD_PDA, slotIndex: 5 },
    },
    create: {
      cardPda: PASS_8_CARD_PDA,
      userWallet: PASS_8_SELLER,
      fixtureId: '18237038',
      slotIndex: 5,
      outcome: 'hit',
      stickerAssetSeq: 200n,
      assetId: marketAssetId,
      treeMerkle: TREE_PUBKEY,
      eventStatRoot: PASS_8_EVENT_STAT_ROOT,
      proofTs: PASS_8_PROOF_TS,
      mintTxSig: PASS_8_MINT_TX_SIG,
    },
    update: {},
  });

  const listingPda = 'DemoListingPda_Market_IcelandPortugal';
  await prismaQuery.listing.upsert({
    where: { listingPda },
    create: {
      listingPda,
      assetId: marketAssetId,
      seller: PASS_8_SELLER,
      priceLamports: 500_000_000n, // 0.5 SOL
      active: true,
    },
    update: { active: true, priceLamports: 500_000_000n },
  });
  console.log(
    `  ✓ Active Listing at 0.5 SOL (seller ${PASS_8_SELLER.slice(0, 8)}...)`,
  );

  console.log('\nDone. Hard-refresh /album and /market.');
  await prismaQuery.$disconnect();
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
