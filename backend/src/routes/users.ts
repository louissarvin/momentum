/**
 * Public user profile — Pass 8 / E-2.
 *
 *   GET /api/users/:wallet   -> profile + aggregate stats + recent activity
 *
 * Public (no auth). Anyone who knows a wallet address can see its play
 * record. This is intentional — the whole app is public-ledger data.
 * No PII, no email, no session tokens leave this handler.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { jsonSafe } from '../utils/serialize.ts';

interface Activity {
  type: 'prediction' | 'sticker_mint' | 'match_card' | 'sale' | 'membership';
  description: string;
  at: string; // ISO
  txSig?: string;
}

function isValidWallet(candidate: string): boolean {
  try {
    // Just parse — this catches malformed base58 and off-curve strings.
    // We do not require on-curve because groupPdas etc. are also queryable.
    new PublicKey(candidate);
    return true;
  } catch {
    return false;
  }
}

export const userRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/:wallet',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        description: 'Public profile + aggregate play stats + last 10 activity events for a wallet.',
        tags: ['cards'],
        params: {
          type: 'object',
          properties: { wallet: { type: 'string', minLength: 32, maxLength: 64 } },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'null' },
              data: {
                type: 'object',
                properties: {
                  wallet: { type: 'string' },
                  memberSince: { type: ['string', 'null'] },
                  stats: {
                    type: 'object',
                    properties: {
                      predictionsSubmitted: { type: 'integer' },
                      slotsHit: { type: 'integer' },
                      slotsMissed: { type: 'integer' },
                      slotsPending: { type: 'integer' },
                      hitRate: { type: 'number' },
                      stickersOwned: { type: 'integer' },
                      matchCardsClaimed: { type: 'integer' },
                      groupsJoined: { type: 'integer' },
                      listingsCreated: { type: 'integer' },
                      salesCompleted: { type: 'integer' },
                    },
                  },
                  recentActivity: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        type: { type: 'string' },
                        description: { type: 'string' },
                        at: { type: 'string' },
                        txSig: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { wallet } = request.params as { wallet: string };
      if (!wallet || !isValidWallet(wallet)) {
        return handleError(reply, 400, 'invalid wallet', 'VALIDATION_ERROR');
      }

      try {
        const [
          user,
          predictionCount,
          stickerGroups,
          stickerAssets,
          matchCardsCount,
          membershipsCount,
          listingsCount,
          salesCount,
          predictionCards,
          firstPrediction,
          recentStickers,
          recentMatchCards,
          recentSales,
          recentMemberships,
          recentPredictions,
        ] = await Promise.all([
          prismaQuery.user.findUnique({ where: { walletAddress: wallet } }),
          prismaQuery.predictionCard.count({ where: { userWallet: wallet } }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (prismaQuery.stickerMint as any).groupBy({
            by: ['outcome'],
            where: { userWallet: wallet },
            _count: { _all: true },
          }) as Promise<{ outcome: string; _count: { _all: number } }[]>,
          prismaQuery.stickerMint.count({
            where: { userWallet: wallet, assetId: { not: null } },
          }),
          prismaQuery.matchCard.count({ where: { userWallet: wallet } }),
          prismaQuery.membership.count({ where: { userWallet: wallet } }),
          prismaQuery.listing.count({ where: { seller: wallet, deletedAt: null } }),
          prismaQuery.sale.count({ where: { seller: wallet } }),
          // For slotsPending we need slotCount vs settled — sum slotCount,
          // subtract settled sticker count.
          prismaQuery.predictionCard.findMany({
            where: { userWallet: wallet },
            select: { slotCount: true },
          }),
          prismaQuery.predictionCard.findFirst({
            where: { userWallet: wallet },
            orderBy: { submittedAt: 'asc' },
            select: { submittedAt: true },
          }),
          prismaQuery.stickerMint.findMany({
            where: { userWallet: wallet },
            orderBy: { mintedAt: 'desc' },
            take: 10,
            select: {
              mintedAt: true,
              outcome: true,
              fixtureId: true,
              slotIndex: true,
              mintTxSig: true,
            },
          }),
          prismaQuery.matchCard.findMany({
            where: { userWallet: wallet },
            orderBy: { mintedAt: 'desc' },
            take: 10,
            select: { mintedAt: true, fixtureId: true, mintTxSig: true },
          }),
          prismaQuery.sale.findMany({
            where: { OR: [{ seller: wallet }, { buyer: wallet }] },
            orderBy: { soldAt: 'desc' },
            take: 10,
            select: {
              soldAt: true,
              seller: true,
              buyer: true,
              priceLamports: true,
              saleTxSig: true,
              assetId: true,
            },
          }),
          prismaQuery.membership.findMany({
            where: { userWallet: wallet },
            orderBy: { joinedAt: 'desc' },
            take: 10,
            select: { joinedAt: true, groupPda: true },
          }),
          prismaQuery.predictionCard.findMany({
            where: { userWallet: wallet },
            orderBy: { submittedAt: 'desc' },
            take: 10,
            select: { submittedAt: true, fixtureId: true, slotCount: true },
          }),
        ]);

        let slotsHit = 0;
        let slotsMissed = 0;
        for (const g of stickerGroups) {
          if (g.outcome === 'hit') slotsHit = g._count._all;
          else if (g.outcome === 'miss') slotsMissed = g._count._all;
        }
        const totalSlotsSettled = slotsHit + slotsMissed;
        const totalSlotsSubmitted = predictionCards.reduce((acc, c) => acc + c.slotCount, 0);
        const slotsPending = Math.max(0, totalSlotsSubmitted - totalSlotsSettled);
        const hitRate = totalSlotsSettled > 0 ? Number((slotsHit / totalSlotsSettled).toFixed(4)) : 0;

        const memberSince =
          user?.createdAt?.toISOString() ??
          firstPrediction?.submittedAt?.toISOString() ??
          null;

        // Merge + sort recentActivity across five sources; limit 10.
        const activity: Activity[] = [];
        for (const s of recentStickers) {
          activity.push({
            type: 'sticker_mint',
            description: `Sticker ${s.outcome.toUpperCase()} on fixture ${s.fixtureId} slot ${s.slotIndex}`,
            at: s.mintedAt.toISOString(),
            ...(s.mintTxSig ? { txSig: s.mintTxSig } : {}),
          });
        }
        for (const m of recentMatchCards) {
          activity.push({
            type: 'match_card',
            description: `Match card claimed on fixture ${m.fixtureId}`,
            at: m.mintedAt.toISOString(),
            ...(m.mintTxSig ? { txSig: m.mintTxSig } : {}),
          });
        }
        for (const s of recentSales) {
          const role = s.seller === wallet ? 'sold' : 'bought';
          activity.push({
            type: 'sale',
            description: `${role === 'sold' ? 'Sold' : 'Bought'} ${s.assetId} for ${s.priceLamports.toString()} lamports`,
            at: s.soldAt.toISOString(),
            txSig: s.saleTxSig,
          });
        }
        for (const m of recentMemberships) {
          activity.push({
            type: 'membership',
            description: `Joined group ${m.groupPda}`,
            at: m.joinedAt.toISOString(),
          });
        }
        for (const p of recentPredictions) {
          activity.push({
            type: 'prediction',
            description: `Submitted ${p.slotCount}-slot card on fixture ${p.fixtureId}`,
            at: p.submittedAt.toISOString(),
          });
        }
        activity.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
        const recentActivity = activity.slice(0, 10);

        return reply.code(200).send({
          success: true,
          error: null,
          data: jsonSafe({
            wallet,
            memberSince,
            stats: {
              predictionsSubmitted: predictionCount,
              slotsHit,
              slotsMissed,
              slotsPending,
              hitRate,
              stickersOwned: stickerAssets,
              matchCardsClaimed: matchCardsCount,
              groupsJoined: membershipsCount,
              listingsCreated: listingsCount,
              salesCompleted: salesCount,
            },
            recentActivity,
          }),
        });
      } catch (err) {
        return handleError(reply, 500, 'user profile aggregation failed', 'USER_PROFILE_FAILED', err as Error);
      }
    },
  );

  done();
};
