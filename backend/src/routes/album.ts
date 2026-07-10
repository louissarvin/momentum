/**
 * Album (cards) routes — Phase C / C.4 + Phase D / D.4.
 *
 *   GET /api/cards/mine                 auth — user's cNFTs (cursor-paged)
 *   GET /api/cards/:assetId             public — enriched single card
 *   GET /api/cards/:assetId/lineage     public — full Merkle audit trail
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { jsonSafe } from '../utils/serialize.ts';
import { getAssetsByOwner, getAsset, getAssetProof, heliusAvailable } from '../lib/helius.ts';
import { COLLECTION_MINT, MERKLE_TREE } from '../lib/solana/constants.ts';

const COLLECTION_MINT_B58 = COLLECTION_MINT.toBase58();

export const albumRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // ---- GET /mine (paginated) ----
  app.get(
    '/mine',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const q = request.query as { limit?: string; cursor?: string };
      const rawLimit = Number(q.limit ?? '20');
      const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 20));

      // Cursor-based pagination on the mirror (source of truth for lineage).
      const mirrored = await prismaQuery.stickerMint.findMany({
        where: { userWallet: user.walletAddress },
        orderBy: { mintedAt: 'desc' },
        take: limit,
        ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      });

      let dasAssets: unknown[] = [];
      if (heliusAvailable()) {
        try {
          const res = await getAssetsByOwner(user.walletAddress, 1, 100);
          dasAssets = (res.items ?? []).filter((a) => {
            const groups = a.grouping ?? [];
            return groups.some(
              (g) => g.group_key === 'collection' && g.group_value === COLLECTION_MINT_B58,
            );
          });
        } catch (err) {
          request.log.warn({ err }, 'Helius getAssetsByOwner failed; falling back to mirror');
        }
      }

      const dasIndex = new Map<string, unknown>();
      for (const a of dasAssets) {
        const id = (a as { id?: string }).id;
        if (id) dasIndex.set(id, a);
      }

      // Enriched card entries: mirror lineage + DAS content when available.
      const cards = mirrored.map((m) => {
        const asset = m.assetId ? dasIndex.get(m.assetId) : null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const content = (asset as any)?.content;
        return {
          assetId: m.assetId,
          stickerAssetSeq: m.stickerAssetSeq?.toString() ?? null,
          fixtureId: m.fixtureId,
          slotIndex: m.slotIndex,
          outcome: m.outcome,
          mintTxSig: m.mintTxSig,
          eventStatRoot: m.eventStatRoot,
          proofTs: m.proofTs?.toString() ?? null,
          mintedAt: m.mintedAt.toISOString(),
          tree: m.treeMerkle ?? MERKLE_TREE.toBase58(),
          collection: COLLECTION_MINT_B58,
          name: content?.metadata?.name ?? null,
          image: content?.links?.image ?? null,
          uri: content?.json_uri ?? null,
        };
      });

      const nextCursor = mirrored.length === limit ? mirrored[mirrored.length - 1].id : null;
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          cards,
          count: cards.length,
          nextCursor,
          source: heliusAvailable() ? 'helius+mirror' : 'mirror-only',
        }),
      });
    },
  );

  // ---- GET /:assetId (public) ----
  app.get(
    '/:assetId',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { assetId } = request.params as { assetId: string };
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(assetId)) {
        return handleError(reply, 400, 'invalid assetId', 'VALIDATION_ERROR');
      }
      const mirror = await prismaQuery.stickerMint.findFirst({ where: { assetId } });
      let dasAsset: unknown = null;
      if (heliusAvailable()) {
        try {
          dasAsset = await getAsset(assetId);
        } catch (err) {
          request.log.warn({ err }, 'Helius getAsset failed');
        }
      }
      if (!mirror && !dasAsset) {
        return handleError(reply, 404, 'card not found', 'CARD_NOT_FOUND');
      }
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ assetId, mirror, dasAsset }),
      });
    },
  );

  // ---- GET /:assetId/lineage (public) ----
  // Full audit trail: card mirror + on-chain fixture context + proof root +
  // Merkle tree + leaf position + mint tx. This powers the frontend's
  // "Merkle-proof reveal" demo card.
  app.get(
    '/:assetId/lineage',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { assetId } = request.params as { assetId: string };
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(assetId)) {
        return handleError(reply, 400, 'invalid assetId', 'VALIDATION_ERROR');
      }

      const sticker = await prismaQuery.stickerMint.findFirst({ where: { assetId } });
      const matchCard = await prismaQuery.matchCard.findFirst({ where: { assetId } });
      const mirror = sticker ?? matchCard;
      if (!mirror) {
        return handleError(reply, 404, 'lineage not found', 'LINEAGE_NOT_FOUND');
      }

      // Best-effort enrich with fixture info + DAS proof.
      const fixture = await prismaQuery.fixture
        .findUnique({ where: { fixtureId: mirror.fixtureId } })
        .catch(() => null);

      let dasProof: unknown = null;
      let dasAsset: unknown = null;
      if (heliusAvailable()) {
        try {
          dasProof = await getAssetProof(assetId);
        } catch (err) {
          request.log.warn({ err }, 'getAssetProof failed (non-fatal)');
        }
        try {
          dasAsset = await getAsset(assetId);
        } catch (err) {
          request.log.warn({ err }, 'getAsset failed (non-fatal)');
        }
      }

      const kind = sticker ? 'sticker' : 'match_card';
      const solscanBase =
        (process.env.SOLANA_CLUSTER ?? 'devnet') === 'mainnet'
          ? 'https://solscan.io/tx'
          : 'https://solscan.io/tx';
      const cluster = process.env.SOLANA_CLUSTER === 'mainnet' ? '' : '?cluster=devnet';

      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          assetId,
          kind,
          fixture: fixture
            ? {
                fixtureId: fixture.fixtureId,
                competitionId: fixture.competitionId,
                homeTeam: fixture.homeTeam,
                awayTeam: fixture.awayTeam,
                kickoffAt: fixture.kickoffAt?.toISOString() ?? null,
                statusId: fixture.statusId,
              }
            : { fixtureId: mirror.fixtureId },
          slot: sticker ? sticker.slotIndex : null,
          outcome: sticker ? sticker.outcome : 'match_card',
          eventStatRoot: mirror.eventStatRoot,
          proofTs: mirror.proofTs?.toString() ?? null,
          mintTxSig: mirror.mintTxSig,
          mintTxSolscan: mirror.mintTxSig ? `${solscanBase}/${mirror.mintTxSig}${cluster}` : null,
          tree:
            (sticker && (sticker as { treeMerkle?: string | null }).treeMerkle) ??
            MERKLE_TREE.toBase58(),
          leafIndex: sticker ? sticker.stickerAssetSeq?.toString() ?? null : null,
          collection: COLLECTION_MINT_B58,
          das: {
            asset: dasAsset,
            proof: dasProof,
          },
        }),
      });
    },
  );

  done();
};
