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

  done();
};
