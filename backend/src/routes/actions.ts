/**
 * Solana Actions / Blinks endpoints — Phase D / D.3.
 *
 * Public, wildcard-CORS (see `src/plugins/cors-actions.ts`), no auth. All
 * transactions returned here are unsigned (`account` from the Blink client
 * is the fee-payer).
 *
 *   GET  /actions.json                          — rules doc
 *   GET  /api/actions/join-group/:groupPda      — action metadata
 *   POST /api/actions/join-group/:groupPda      — unsigned join_group tx
 *   POST /api/actions/join-group/:groupPda/confirm  — chained "you're in"
 *   GET  /api/actions/share-card/:assetId       — action metadata (buy)
 *   POST /api/actions/share-card/:assetId       — unsigned buy_card tx
 *   GET  /api/actions/predict/:fixtureId        — action metadata (4 params)
 *   POST /api/actions/predict/:fixtureId        — unsigned submit_predictions tx
 *   POST /api/actions/predict/:fixtureId/next   — chained "card minted" ack
 *
 * Reference: https://solana.com/docs/advanced/actions
 */

import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import { z } from 'zod';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import { prismaQuery } from '../lib/prisma.ts';
import { env } from '../config/env.ts';
import { buildUnsignedLegacyTx, awaitConfirmed } from '../lib/solana/tx.ts';
import { getAsset, getAssetProof, heliusAvailable, type DasAsset } from '../lib/helius.ts';
import {
  buildBuyCardIx,
  proofToBundle,
  type AssetProofBundle,
} from '../lib/solana/marketplace.ts';
import { flags } from '../lib/flags.ts';

// Phase E / E.6: 60/min per IP on all Actions POSTs. Blinks are anonymous —
// no wallet key available server-side, IP is the only stable identifier.
const ACTION_POST_RATE = { max: 60, timeWindow: '1 minute' } as const;
const ACTION_GET_RATE = { max: 120, timeWindow: '1 minute' } as const;

// Phase E / E.3: BLINKS kill-switch. Applied per-request so it can flip at
// runtime without a restart if we ever move flags to a hot-reload source.
function blinksDisabledResponse(reply: import('fastify').FastifyReply): import('fastify').FastifyReply {
  return reply
    .code(503)
    .send({ message: 'Blinks are disabled on this deployment', code: 'FEATURE_DISABLED' });
}

const PLACEHOLDER_ICON =
  (env.METADATA_HOST ? `${env.METADATA_HOST}/momentum-icon.png` : 'https://placehold.co/512x512/000/FFF.png?text=MOMENTUM');

const AccountBody = z.object({
  account: z.string().min(32).max(44),
});
const AccountAndSignatureBody = z.object({
  account: z.string().min(32).max(44),
  signature: z.string().min(64).max(120),
});

function assertPubkey(candidate: string): PublicKey {
  return new PublicKey(candidate);
}

async function assembleProofBundle(assetId: string): Promise<{
  bundle: AssetProofBundle;
  owner: string;
  tree: string;
  asset: DasAsset;
}> {
  const [asset, proof] = await Promise.all([getAsset(assetId), getAssetProof(assetId)]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = (asset as any).compression;
  if (!comp?.compressed) throw new Error('not a compressed NFT');
  const dataHash: string = comp.data_hash;
  const creatorHash: string = comp.creator_hash;
  const leafIndex: number = comp.leaf_id;
  // Bubblegum ix arg `nonce` == leaf index (not DAS `seq`).
  const nonce = leafIndex;
  const tree: string = comp.tree;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner: string = (asset as any).ownership?.owner;
  const bundle = proofToBundle(proof, dataHash, creatorHash, BigInt(nonce), leafIndex);
  return { bundle, owner, tree, asset };
}

export const actionsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // -------- /actions.json --------
  app.get('/actions.json', async (_request, reply) => {
    if (!flags.blinks) {
      // Spec-compliant empty rules doc when disabled — clients degrade
      // gracefully instead of erroring.
      return reply.code(200).send({ rules: [] });
    }
    return reply.code(200).send({
      rules: [
        {
          pathPattern: '/api/actions/join-group/**',
          apiPath: '/api/actions/join-group/**',
        },
        {
          pathPattern: '/api/actions/share-card/**',
          apiPath: '/api/actions/share-card/**',
        },
        {
          pathPattern: '/api/actions/predict/**',
          apiPath: '/api/actions/predict/**',
        },
      ],
    });
  });

  // -------- GET /api/actions/join-group/:groupPda --------
  app.get('/api/actions/join-group/:groupPda', { config: { rateLimit: ACTION_GET_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { groupPda } = request.params as { groupPda: string };
    let group;
    try {
      assertPubkey(groupPda);
      group = await prismaQuery.group.findUnique({ where: { groupPda } });
    } catch {
      return reply.code(400).send({ message: 'invalid groupPda' });
    }
    if (!group || group.deletedAt) {
      return reply.code(404).send({ message: 'group not found' });
    }

    return reply.code(200).send({
      type: 'action',
      icon: PLACEHOLDER_ICON,
      label: 'Join Group',
      title: `Join ${group.name}`,
      description: `Join the MOMENTUM group "${group.name}" and start predicting World Cup outcomes with your friends.`,
      links: {
        actions: [
          {
            type: 'transaction',
            label: 'Join',
            href: `/api/actions/join-group/${groupPda}`,
            parameters: [],
          },
        ],
      },
    });
  });

  // -------- POST /api/actions/join-group/:groupPda --------
  app.post('/api/actions/join-group/:groupPda', { config: { rateLimit: ACTION_POST_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { groupPda } = request.params as { groupPda: string };
    const parsed = AccountBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'invalid body: account required' });
    }

    let groupPk: PublicKey;
    let joinerPk: PublicKey;
    try {
      groupPk = assertPubkey(groupPda);
      joinerPk = assertPubkey(parsed.data.account);
    } catch {
      return reply.code(400).send({ message: 'invalid pubkey' });
    }

    const { momentum, connection, pdas } = app.solana;

    // Need group_id (u64) — fetch on-chain state.
    let onchain;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onchain = await (momentum.account as any).group.fetch(groupPk);
    } catch (err) {
      return reply.code(404).send({ message: `group not found on chain: ${(err as Error).message}` });
    }
    const groupId = onchain.groupId?.toString?.() ?? String(onchain.groupId);
    const [vaultPda] = pdas.deriveVault(groupPk);
    const [membershipPda] = pdas.deriveMembership(groupPk, joinerPk);

    let ix;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ix = await (momentum.methods as any)
        .joinGroup(new BN(groupId))
        .accountsPartial({
          user: joinerPk,
          group: groupPk,
          vault: vaultPda,
          membership: membershipPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    } catch (err) {
      return reply.code(500).send({ message: `ix build failed: ${(err as Error).message}` });
    }
    let unsigned;
    try {
      unsigned = await buildUnsignedLegacyTx(connection, joinerPk, [ix]);
    } catch (err) {
      return reply.code(500).send({ message: `tx build failed: ${(err as Error).message}` });
    }

    return reply.code(200).send({
      transaction: unsigned.transaction,
      message: `Joining group ${groupPda}`,
      links: {
        next: {
          type: 'post',
          href: `/api/actions/join-group/${groupPda}/confirm`,
        },
      },
    });
  });

  // -------- POST /api/actions/join-group/:groupPda/confirm --------
  app.post('/api/actions/join-group/:groupPda/confirm', { config: { rateLimit: ACTION_POST_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { groupPda } = request.params as { groupPda: string };
    const parsed = AccountAndSignatureBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'invalid body: account + signature required' });
    }
    const { account, signature } = parsed.data;

    const { connection, momentum } = app.solana;
    try {
      await awaitConfirmed(connection, signature);
    } catch (err) {
      return reply.code(502).send({ message: `tx not confirmed: ${(err as Error).message}` });
    }

    // Mirror membership best-effort.
    try {
      let groupPk: PublicKey;
      try {
        groupPk = assertPubkey(groupPda);
      } catch {
        return reply.code(400).send({ message: 'invalid groupPda' });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onchain = await (momentum.account as any).group.fetch(groupPk);
      await prismaQuery.group
        .update({
          where: { groupPda },
          data: { currentSize: onchain.currentSize },
        })
        .catch(() => undefined);
      await prismaQuery.membership.upsert({
        where: { groupPda_userWallet: { groupPda, userWallet: account } },
        create: { groupPda, userWallet: account },
        update: {},
      });
    } catch (err) {
      request.log.warn({ err }, 'action join-group mirror failed (non-fatal)');
    }

    // Chained inline "completed" action — the Blink client shows a success card.
    return reply.code(200).send({
      transaction: '',
      message: 'You are in! Welcome to MOMENTUM.',
      links: {
        next: {
          type: 'inline',
          action: {
            type: 'completed',
            icon: PLACEHOLDER_ICON,
            label: 'Joined',
            title: 'Welcome to MOMENTUM',
            description: 'You have joined the group. Open the MOMENTUM app to start predicting.',
          },
        },
      },
    });
  });

  // -------- GET /api/actions/share-card/:assetId --------
  app.get('/api/actions/share-card/:assetId', { config: { rateLimit: ACTION_GET_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { assetId } = request.params as { assetId: string };
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(assetId)) {
      return reply.code(400).send({ message: 'invalid assetId' });
    }
    const listing = await prismaQuery.listing.findFirst({
      where: { assetId, active: true, deletedAt: null },
    });
    if (!listing) {
      return reply.code(404).send({
        type: 'action',
        icon: PLACEHOLDER_ICON,
        label: 'Not listed',
        title: 'Card not available',
        description: 'This card is not currently listed on the MOMENTUM marketplace.',
        disabled: true,
      });
    }

    // Try to enrich icon + title with DAS metadata, best effort.
    let icon = PLACEHOLDER_ICON;
    let title = 'MOMENTUM Sticker';
    if (heliusAvailable()) {
      try {
        const asset = await getAsset(assetId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        icon = (asset as any).content?.links?.image ?? icon;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        title = (asset as any).content?.metadata?.name ?? title;
      } catch (err) {
        request.log.warn({ err }, 'share-card DAS enrichment failed');
      }
    }

    const priceSol = (Number(listing.priceLamports) / 1e9).toFixed(3);
    return reply.code(200).send({
      type: 'action',
      icon,
      label: `Buy for ${priceSol} SOL`,
      title,
      description: 'Buy this verified MOMENTUM prediction sticker. Ownership settles on-chain via Bubblegum cNFT transfer.',
      links: {
        actions: [
          {
            type: 'transaction',
            label: `Buy for ${priceSol} SOL`,
            href: `/api/actions/share-card/${assetId}`,
            parameters: [],
          },
        ],
      },
    });
  });

  // -------- POST /api/actions/share-card/:assetId --------
  app.post('/api/actions/share-card/:assetId', { config: { rateLimit: ACTION_POST_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { assetId } = request.params as { assetId: string };
    const parsed = AccountBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'invalid body: account required' });
    }
    if (!heliusAvailable()) {
      return reply.code(503).send({ message: 'Helius not configured' });
    }
    const listing = await prismaQuery.listing.findFirst({
      where: { assetId, active: true, deletedAt: null },
    });
    if (!listing) return reply.code(404).send({ message: 'listing not found' });

    let buyerPk: PublicKey;
    let sellerPk: PublicKey;
    let assetPk: PublicKey;
    try {
      buyerPk = assertPubkey(parsed.data.account);
      sellerPk = assertPubkey(listing.seller);
      assetPk = assertPubkey(assetId);
    } catch {
      return reply.code(400).send({ message: 'invalid pubkey' });
    }

    let bundle: AssetProofBundle;
    let treeStr: string;
    try {
      const res = await assembleProofBundle(assetId);
      bundle = res.bundle;
      treeStr = res.tree;
    } catch (err) {
      return reply.code(502).send({ message: `DAS lookup failed: ${(err as Error).message}` });
    }

    const { momentum, connection } = app.solana;
    let ix;
    try {
      ix = await buildBuyCardIx({
        program: momentum,
        buyer: buyerPk,
        seller: sellerPk,
        assetId: assetPk,
        proof: bundle,
        merkleTree: new PublicKey(treeStr),
      });
    } catch (err) {
      return reply.code(500).send({ message: `ix build failed: ${(err as Error).message}` });
    }
    let unsigned;
    try {
      unsigned = await buildUnsignedLegacyTx(connection, buyerPk, [ix]);
    } catch (err) {
      return reply.code(500).send({ message: `tx build failed: ${(err as Error).message}` });
    }
    return reply.code(200).send({
      transaction: unsigned.transaction,
      message: `Buying MOMENTUM sticker for ${(Number(listing.priceLamports) / 1e9).toFixed(3)} SOL`,
    });
  });

  // ================================================================
  // Predict Blink — single-slot prediction card from an X (Twitter) share.
  // ================================================================
  //
  // Endpoint contract:
  //
  //   GET  /api/actions/predict/:fixtureId
  //     -> ActionGetResponse with 4 inline parameters:
  //          stat      (select, 8 base stats — home/away * goals/yellows/reds/corners)
  //          op        (radio,  Over=0 / Under=1  — mirrors PredictionSlot.predicate_comparison)
  //          threshold (number, integer >= 0, TxLINE thresholds are ints)
  //          period    (select, u16 as defined by ScoreStat.period)
  //
  //   POST /api/actions/predict/:fixtureId
  //     body:   { account: string }              // fee-payer, from the Blink client
  //     query:  ?stat=&op=&threshold=&period=    // set by the Blink UI form
  //     ->     ActionPostResponse { transaction: base64 legacy tx, links.next: post }
  //
  //   POST /api/actions/predict/:fixtureId/next
  //     body:   { account, signature }
  //     ->     inline `completed` action ("Card minted!") with a link back home.
  //
  // On-chain shape (verified against
  //   momentum_contract/programs/momentum/src/{state,instructions/submit_predictions}.rs):
  //     PredictionSlotInput {
  //       stat_a_key: i32,          // >0 required
  //       stat_b_key: i32 = 0,      // 0 for single-stat (op=0)
  //       op: u8 = 0,               // 0=None (single stat)  ← NOT the Over/Under selector
  //       predicate_comparison: u8, // 0=Over(>), 1=Under(<), 2=EqualTo — this is what the
  //                                 //   Blink's `op` param maps to (semantically Over/Under).
  //       threshold: i32,
  //       period: u16,              // 0=full match, 1000=1H, 3000=2H, 4000+=ET/pens
  //     }
  //
  // NOTE re: brief mismatch — the brief said `op: 0=Over, 1=Under` on the ix. The
  //   actual on-chain field for over/under is `predicate_comparison`, and slot-level
  //   `op` must be 0 for single-stat cards. Confirmed by reading
  //   submit_predictions.rs:52-63 which rejects `op != 0` when `stat_b_key == 0`.
  //   We therefore send `op=0, predicate_comparison=<query.op>` regardless of the
  //   Blink UI label. The user-facing radio still says Over/Under; only the wire
  //   format differs. This is a UX-vs-schema translation, not a semantic drift.
  //
  // NOTE re: threshold — PredictionSlot.threshold is `i32`, so we accept ints only
  //   (no 1.5). Default is derived per-stat below.

  const STAT_LABELS_HOME_AWAY = {
    // { statKey (i32): humanLabel }
    // Keys 1..8 per brief: 1=P1 Goals, 2=P2 Goals, 3=P1 Yellows, 4=P2 Yellows,
    // 5=P1 Reds, 6=P2 Reds, 7=P1 Corners, 8=P2 Corners.
    1: { pair: 'goals', side: 'home' as const },
    2: { pair: 'goals', side: 'away' as const },
    3: { pair: 'yellow cards', side: 'home' as const },
    4: { pair: 'yellow cards', side: 'away' as const },
    5: { pair: 'red cards', side: 'home' as const },
    6: { pair: 'red cards', side: 'away' as const },
    7: { pair: 'corners', side: 'home' as const },
    8: { pair: 'corners', side: 'away' as const },
  } as const;

  const PERIOD_OPTIONS: Array<{ value: string; label: string }> = [
    { value: '0', label: 'Full match' },
    { value: '1000', label: 'First half' },
    { value: '3000', label: 'Second half' },
    { value: '4000', label: 'Extra time 1' },
    { value: '5000', label: 'Extra time 2' },
    { value: '6000', label: 'Penalties' },
    { value: '7000', label: 'Extra time total' },
  ];

  // Sensible per-stat default threshold. Integers only (i32 on-chain).
  const DEFAULT_THRESHOLD: Record<number, number> = {
    1: 1, 2: 1, // goals
    3: 2, 4: 2, // yellows
    5: 0, 6: 0, // reds
    7: 4, 8: 4, // corners
  };

  const PredictQuery = z.object({
    stat: z.coerce.number().int().min(1).max(8).optional(),
    op: z.coerce.number().int().min(0).max(1).optional(),
    threshold: z.coerce.number().int().min(0).max(999).optional(),
    period: z.coerce.number().int().refine(
      (n) => ['0', '1000', '3000', '4000', '5000', '6000', '7000'].includes(String(n)),
      { message: 'period must be one of 0,1000,3000,4000,5000,6000,7000' },
    ).optional(),
  });

  const PredictPostQuery = z.object({
    stat: z.coerce.number().int().min(1).max(8),
    op: z.coerce.number().int().min(0).max(1),
    threshold: z.coerce.number().int().min(0).max(999),
    period: z.coerce.number().int().refine(
      (n) => [0, 1000, 3000, 4000, 5000, 6000, 7000].includes(n),
      { message: 'invalid period' },
    ),
  });

  function statLabel(statKey: number, homeTeam: string, awayTeam: string): string {
    const meta = STAT_LABELS_HOME_AWAY[statKey as keyof typeof STAT_LABELS_HOME_AWAY];
    if (!meta) return `Stat ${statKey}`;
    const team = meta.side === 'home' ? homeTeam : awayTeam;
    return `${team} ${meta.pair}`;
  }

  // -------- GET /api/actions/predict/:fixtureId --------
  app.get('/api/actions/predict/:fixtureId', { config: { rateLimit: ACTION_GET_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { fixtureId } = request.params as { fixtureId: string };
    if (!/^[0-9]{1,19}$/.test(fixtureId)) {
      return reply.code(400).send({ message: 'invalid fixtureId' });
    }

    const fixture = await prismaQuery.fixture.findUnique({ where: { fixtureId } });
    const homeTeam = fixture?.homeTeam && fixture.homeTeam !== 'unknown' ? fixture.homeTeam : 'Team 1';
    const awayTeam = fixture?.awayTeam && fixture.awayTeam !== 'unknown' ? fixture.awayTeam : 'Team 2';
    const kickoff = fixture?.kickoffAt ? fixture.kickoffAt.toISOString().slice(0, 10) : 'TBD';

    const q = PredictQuery.safeParse(request.query ?? {});
    const stat = q.success && q.data.stat ? q.data.stat : 1;
    const defaultThreshold = DEFAULT_THRESHOLD[stat] ?? 1;

    return reply.code(200).send({
      type: 'action',
      icon: PLACEHOLDER_ICON,
      label: 'Submit prediction',
      title: 'Momentum · Quick Pick',
      description: `Pick one stat prediction for ${homeTeam} vs ${awayTeam} on ${kickoff}. Mint a Merkle-proof-backed collectible when your call lands.`,
      links: {
        actions: [
          {
            type: 'transaction',
            label: 'Submit prediction',
            href: `/api/actions/predict/${fixtureId}?stat={stat}&op={op}&threshold={threshold}&period={period}`,
            parameters: [
              {
                type: 'select',
                name: 'stat',
                label: 'Stat',
                required: true,
                options: (Object.keys(STAT_LABELS_HOME_AWAY) as unknown as string[]).map((k) => {
                  const key = Number(k);
                  return {
                    label: statLabel(key, homeTeam, awayTeam),
                    value: String(key),
                    selected: key === stat,
                  };
                }),
              },
              {
                type: 'radio',
                name: 'op',
                label: 'Over / Under',
                required: true,
                options: [
                  { label: 'Over', value: '0', selected: true },
                  { label: 'Under', value: '1' },
                ],
              },
              {
                type: 'number',
                name: 'threshold',
                label: 'Threshold',
                required: true,
                min: 0,
                max: 999,
                // The Blink client uses `value` as the pre-filled default.
                // Cast to string for cross-client compatibility.
                value: String(defaultThreshold),
              },
              {
                type: 'select',
                name: 'period',
                label: 'Period',
                required: true,
                options: PERIOD_OPTIONS.map((p) => ({
                  ...p,
                  selected: p.value === '0',
                })),
              },
            ],
          },
        ],
      },
    });
  });

  // -------- POST /api/actions/predict/:fixtureId --------
  app.post('/api/actions/predict/:fixtureId', { config: { rateLimit: ACTION_POST_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { fixtureId } = request.params as { fixtureId: string };
    if (!/^[0-9]{1,19}$/.test(fixtureId)) {
      return reply.code(400).send({ message: 'invalid fixtureId' });
    }

    const bodyParsed = AccountBody.safeParse(request.body);
    if (!bodyParsed.success) {
      return reply.code(400).send({ message: 'invalid body: account required' });
    }
    const qParsed = PredictPostQuery.safeParse(request.query ?? {});
    if (!qParsed.success) {
      return reply.code(400).send({
        message: `invalid parameters: ${qParsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      });
    }

    let userPk: PublicKey;
    try {
      userPk = assertPubkey(bodyParsed.data.account);
    } catch {
      return reply.code(400).send({ message: 'invalid pubkey' });
    }

    // Ensure Fixture exists so the /confirm mirror in the parallel web flow
    // (if used) doesn't blow up on FK. Same pattern as predictions.ts.
    await prismaQuery.fixture
      .upsert({
        where: { fixtureId },
        create: { fixtureId, homeTeam: 'unknown', awayTeam: 'unknown' },
        update: {},
      })
      .catch(() => undefined);

    const { momentum, connection, pdas } = app.solana;
    const [cardPda] = pdas.derivePredictionCard(userPk, BigInt(fixtureId));

    // Short-circuit if the user already has a card on-chain (init would revert).
    try {
      const info = await connection.getAccountInfo(cardPda, 'confirmed');
      if (info) {
        return reply.code(409).send({
          message: 'You already submitted a prediction card for this fixture.',
        });
      }
    } catch (err) {
      request.log.warn({ err }, 'predict blink: getAccountInfo failed, continuing');
    }

    // Build the single slot. See NOTE above re: `op` vs `predicate_comparison`.
    const slot = {
      statAKey: qParsed.data.stat,
      statBKey: 0,
      op: 0, // single-stat card — MUST be 0 when stat_b_key == 0
      predicateComparison: qParsed.data.op, // 0=Over (>), 1=Under (<)
      threshold: qParsed.data.threshold,
      period: qParsed.data.period,
    };

    let ix;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ix = await (momentum.methods as any)
        .submitPredictions(new BN(fixtureId), [slot])
        .accountsPartial({
          user: userPk,
          card: cardPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
    } catch (err) {
      return reply.code(500).send({ message: `ix build failed: ${(err as Error).message}` });
    }

    let unsigned;
    try {
      unsigned = await buildUnsignedLegacyTx(connection, userPk, [ix]);
    } catch (err) {
      return reply.code(500).send({ message: `tx build failed: ${(err as Error).message}` });
    }

    const shortWallet = `${bodyParsed.data.account.slice(0, 4)}…${bodyParsed.data.account.slice(-4)}`;
    return reply.code(200).send({
      transaction: unsigned.transaction,
      message: `Signed with wallet ${shortWallet}. Sign to mint your prediction card.`,
      links: {
        next: {
          type: 'post',
          href: `/api/actions/predict/${fixtureId}/next`,
        },
      },
    });
  });

  // -------- POST /api/actions/predict/:fixtureId/next --------
  app.post('/api/actions/predict/:fixtureId/next', { config: { rateLimit: ACTION_POST_RATE } }, async (request, reply) => {
    if (!flags.blinks) return blinksDisabledResponse(reply);
    const { fixtureId } = request.params as { fixtureId: string };
    if (!/^[0-9]{1,19}$/.test(fixtureId)) {
      return reply.code(400).send({ message: 'invalid fixtureId' });
    }
    // Best-effort confirmation — we don't block the success UI on a slow RPC.
    // The Blink client already validated its own submission; this endpoint
    // exists purely to close the loop with a `completed` action card.
    const parsed = AccountAndSignatureBody.safeParse(request.body);
    if (parsed.success) {
      try {
        await awaitConfirmed(app.solana.connection, parsed.data.signature);
      } catch (err) {
        request.log.warn({ err }, 'predict blink: confirm probe failed (non-fatal)');
      }
    }

    const fixturePageUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/fixtures/${fixtureId}`;
    return reply.code(200).send({
      type: 'completed',
      icon: PLACEHOLDER_ICON,
      label: 'Card minted!',
      title: 'Prediction card minted',
      description: `Your call is on-chain. Track it live on Momentum: ${fixturePageUrl}`,
    });
  });

  done();
};
