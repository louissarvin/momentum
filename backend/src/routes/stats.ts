/**
 * Live stats — Pass 8 / E-4.
 *
 *   GET /api/stats/live   -> landing-page counter payload (30s cache)
 *
 * Public, high-traffic endpoint. Cache aggressively — every count is a
 * table scan on a small mirror. Rate limit is intentionally loose (this
 * is what the marketing site hammers).
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';

interface LiveStatsPayload {
  totalPredictions: number;
  totalStickers: number;
  activeGroups: number;
  salesLast24h: number;
  totalVolumeLamports: string;
  fixtureCount: number;
  lastSettleAt: string | null;
}

const CACHE_TTL_MS = 30_000;
let cached: { at: number; body: { success: true; error: null; data: LiveStatsPayload } } | null = null;

async function computeLiveStats(): Promise<LiveStatsPayload> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  // Fire counts in parallel — each is a small COUNT(*) on an indexed
  // column. Prisma serializes these on the driver adapter's single
  // connection but the round-trip cost still drops with concurrency.
  const [
    totalPredictions,
    totalStickers,
    activeGroups,
    salesLast24h,
    volumeAgg,
    fixtureCount,
    lastMint,
  ] = await Promise.all([
    prismaQuery.predictionCard.count(),
    prismaQuery.stickerMint.count(),
    prismaQuery.group.count({ where: { deletedAt: null, currentSize: { gt: 0 } } }),
    prismaQuery.sale.count({ where: { soldAt: { gt: since24h } } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prismaQuery.sale as any).aggregate({ _sum: { priceLamports: true } }),
    prismaQuery.fixture.count(),
    prismaQuery.stickerMint.findFirst({
      orderBy: { mintedAt: 'desc' },
      select: { mintedAt: true },
    }),
  ]);

  // aggregate() returns { _sum: { priceLamports: bigint | null } }
  const sum = (volumeAgg as { _sum?: { priceLamports: bigint | null } })._sum?.priceLamports;
  const totalVolumeLamports = sum === null || sum === undefined ? '0' : sum.toString();

  return {
    totalPredictions,
    totalStickers,
    activeGroups,
    salesLast24h,
    totalVolumeLamports,
    fixtureCount,
    lastSettleAt: lastMint?.mintedAt ? lastMint.mintedAt.toISOString() : null,
  };
}

/** Exposed so `/health` can piggy-back the counters. Uses the same cache. */
export async function getCachedLiveStats(): Promise<LiveStatsPayload> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.body.data;
  const data = await computeLiveStats();
  cached = { at: now, body: { success: true, error: null, data } };
  return data;
}

export const statsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/live',
    {
      config: { rateLimit: { max: 300, timeWindow: '1 minute' } },
      schema: {
        description:
          'Landing-page counter payload. 30s cached, safe to poll from unauthenticated clients.',
        tags: ['meta'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'null' },
              data: {
                type: 'object',
                properties: {
                  totalPredictions: { type: 'integer' },
                  totalStickers: { type: 'integer' },
                  activeGroups: { type: 'integer' },
                  salesLast24h: { type: 'integer' },
                  totalVolumeLamports: { type: 'string' },
                  fixtureCount: { type: 'integer' },
                  lastSettleAt: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await getCachedLiveStats();
        return reply.code(200).send({ success: true, error: null, data });
      } catch (err) {
        return handleError(reply, 500, 'stats aggregation failed', 'STATS_FAILED', err as Error);
      }
    },
  );

  done();
};
