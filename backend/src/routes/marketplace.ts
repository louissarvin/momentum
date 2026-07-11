/**
 * Marketplace routes — Phase D / D.2.
 *
 * Read (public):
 *   GET  /api/marketplace                     — paginated active listings
 *   GET  /api/marketplace/:listingPda         — single listing detail
 *
 * Write (auth required, 60/min per wallet):
 *   POST /api/marketplace/list                — unsigned list_for_sale tx
 *   POST /api/marketplace/list/confirm        — mirror Listing on confirm
 *   POST /api/marketplace/buy/:listingPda     — unsigned buy_card tx
 *   POST /api/marketplace/buy/:listingPda/confirm — mirror Sale + move owner
 *   POST /api/marketplace/cancel/:listingPda  — unsigned cancel_listing tx
 *   POST /api/marketplace/cancel/:listingPda/confirm — deactivate Listing
 *
 * All on-chain reads for Bubblegum proofs use Helius DAS
 * (`getAssetProof` + `getAsset`); we require HELIUS_API_KEY to be set.
 */

import type {
  FastifyInstance,
  FastifyPluginCallback,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';

import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { jsonSafe } from '../utils/serialize.ts';
import { buildUnsignedLegacyTx, awaitConfirmed } from '../lib/solana/tx.ts';
import { deriveListing } from '../lib/solana/pdas.ts';
import {
  buildBuyCardIx,
  buildCancelListingIx,
  buildListForSaleIx,
  proofToBundle,
  type AssetProofBundle,
} from '../lib/solana/marketplace.ts';
import { getAsset, getAssetProof, heliusAvailable, type DasAsset } from '../lib/helius.ts';
import {
  idempotencyCacheKey,
  readIdempotencyHeader,
  getIdempotent,
  setIdempotent,
} from '../lib/idempotency.ts';

const ListBody = z.object({
  assetId: z.string().min(32).max(44),
  priceLamports: z.union([
    z.number().int().min(1),
    z.string().regex(/^[0-9]+$/).transform((s) => Number(s)),
  ]),
});

const ListConfirmBody = z.object({
  txSig: z.string().min(64).max(120),
  assetId: z.string().min(32).max(44),
  priceLamports: z.union([
    z.number().int().min(1),
    z.string().regex(/^[0-9]+$/).transform((s) => Number(s)),
  ]),
});

const ConfirmOnlyBody = z.object({
  txSig: z.string().min(64).max(120),
});

function assertPubkey(candidate: string): PublicKey {
  return new PublicKey(candidate);
}

/**
 * Fetch DAS asset + proof and assemble the bundle the on-chain ix expects.
 * `dataHash` / `creatorHash` / `nonce` / `leafIndex` come from `getAsset`;
 * `root` + `proof` come from `getAssetProof`.
 */
async function assembleProofBundle(assetId: string): Promise<{
  bundle: AssetProofBundle;
  asset: DasAsset;
  owner: string;
  tree: string;
}> {
  const [asset, proof] = await Promise.all([getAsset(assetId), getAssetProof(assetId)]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const comp = (asset as any).compression;
  if (!comp || comp.compressed !== true) {
    throw new Error('asset is not a compressed NFT');
  }
  const dataHash: string | undefined = comp.data_hash;
  const creatorHash: string | undefined = comp.creator_hash;
  const leafIndex: number | undefined = comp.leaf_id;
  // Bubblegum ix arg `nonce` == the asset's leaf index (NOT the DAS `seq`
  // field, which counts writes and can drift). The contract's
  // `get_asset_id(tree, nonce)` must equal the assetId — using seq here
  // yields TreeMismatch (custom 6012).
  const nonce = leafIndex;
  const tree: string | undefined = comp.tree;
  if (!dataHash || !creatorHash || leafIndex === undefined || nonce === undefined || !tree) {
    throw new Error('DAS response missing required compression fields');
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const owner: string | undefined = (asset as any).ownership?.owner;
  if (!owner) throw new Error('DAS response missing ownership.owner');

  const bundle = proofToBundle(proof, dataHash, creatorHash, BigInt(nonce), leafIndex);
  return { bundle, asset, owner, tree };
}

const walletRate = {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => {
    const claims = (req as { user?: { wallet?: string } }).user;
    return claims?.wallet ?? req.ip;
  },
};

export const marketplaceRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
) => {
  // ---- GET / (public, paginated) ----
  app.get(
    '/',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { limit?: string; cursor?: string; sort?: string };
      const rawLimit = Number(q.limit ?? '30');
      const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 30));

      let orderBy;
      switch (q.sort) {
        case 'price_asc':
          orderBy = { priceLamports: 'asc' as const };
          break;
        case 'price_desc':
          orderBy = { priceLamports: 'desc' as const };
          break;
        default:
          orderBy = { createdAt: 'desc' as const };
      }

      const rows = await prismaQuery.listing.findMany({
        where: { active: true, deletedAt: null },
        orderBy,
        take: limit,
        ...(q.cursor ? { skip: 1, cursor: { listingPda: q.cursor } } : {}),
      });

      // Join StickerMint mirror for basic metadata on each listing.
      const assetIds = rows.map((r) => r.assetId);
      const stickers = assetIds.length
        ? await prismaQuery.stickerMint.findMany({ where: { assetId: { in: assetIds } } })
        : [];
      const stickerByAsset = new Map(stickers.map((s) => [s.assetId!, s]));

      const listings = rows.map((r) => ({
        ...r,
        sticker: stickerByAsset.get(r.assetId) ?? null,
      }));

      const nextCursor = rows.length === limit ? rows[rows.length - 1].listingPda : null;
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ listings, nextCursor }),
      });
    },
  );

  // ---- GET /:listingPda (public) ----
  app.get(
    '/:listingPda',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { listingPda } = request.params as { listingPda: string };
      try {
        assertPubkey(listingPda);
      } catch {
        return handleError(reply, 400, 'invalid listingPda', 'VALIDATION_ERROR');
      }
      const listing = await prismaQuery.listing.findUnique({ where: { listingPda } });
      if (!listing) return handleError(reply, 404, 'listing not found', 'LISTING_NOT_FOUND');
      const sticker = listing.assetId
        ? await prismaQuery.stickerMint.findFirst({ where: { assetId: listing.assetId } })
        : null;
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ listing, sticker }),
      });
    },
  );

  // ---- POST /list (build unsigned list_for_sale tx) ----
  app.post(
    '/list',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      if (!heliusAvailable()) {
        return handleError(
          reply,
          503,
          'Helius not configured; marketplace requires HELIUS_API_KEY',
          'HELIUS_UNAVAILABLE',
        );
      }
      const parsed = ListBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues,
        });
      }
      const { assetId, priceLamports } = parsed.data;

      const idemHeader = readIdempotencyHeader(request.headers as Record<string, unknown>);
      const idemKey = idemHeader
        ? idempotencyCacheKey(idemHeader, `marketplace.list:${user.id}:${assetId}`)
        : null;
      if (idemKey) {
        const cached = getIdempotent(idemKey);
        if (cached) return reply.code(cached.status).send(cached.body);
      }

      let sellerPk: PublicKey;
      let assetPk: PublicKey;
      try {
        sellerPk = assertPubkey(user.walletAddress);
        assetPk = assertPubkey(assetId);
      } catch {
        return handleError(reply, 400, 'invalid pubkey', 'VALIDATION_ERROR');
      }

      let bundle: AssetProofBundle;
      let owner: string;
      let treeStr: string;
      try {
        const res = await assembleProofBundle(assetId);
        bundle = res.bundle;
        owner = res.owner;
        treeStr = res.tree;
      } catch (err) {
        return handleError(
          reply,
          502,
          `Helius DAS lookup failed: ${(err as Error).message}`,
          'DAS_LOOKUP_FAILED',
          err as Error,
        );
      }

      if (owner !== user.walletAddress) {
        return handleError(reply, 403, 'not the current owner', 'NOT_OWNER');
      }

      const [listingPda] = deriveListing(assetPk);
      const { momentum, connection } = app.solana;

      let ix;
      try {
        ix = await buildListForSaleIx({
          program: momentum,
          seller: sellerPk,
          assetId: assetPk,
          priceLamports: BigInt(priceLamports),
          proof: bundle,
          merkleTree: new PublicKey(treeStr),
        });
      } catch (err) {
        return handleError(reply, 500, 'ix build failed', 'IX_BUILD_FAILED', err as Error);
      }

      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, sellerPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'tx build failed', 'TX_BUILD_FAILED', err as Error);
      }

      const body = {
        success: true,
        error: null,
        data: jsonSafe({
          assetId,
          listingPda: listingPda.toBase58(),
          priceLamports: String(priceLamports),
          unsignedTx: unsigned.transaction,
          recentBlockhash: unsigned.recentBlockhash,
          lastValidBlockHeight: unsigned.lastValidBlockHeight,
          feePayer: unsigned.feePayer,
        }),
      };
      if (idemKey) setIdempotent(idemKey, 200, body);
      return reply.code(200).send(body);
    },
  );

  // ---- POST /list/confirm ----
  app.post(
    '/list/confirm',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      const parsed = ListConfirmBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');
      }
      const { txSig, assetId, priceLamports } = parsed.data;

      const { connection } = app.solana;
      try {
        await awaitConfirmed(connection, txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }

      let assetPk: PublicKey;
      try {
        assetPk = assertPubkey(assetId);
      } catch {
        return handleError(reply, 400, 'invalid assetId', 'VALIDATION_ERROR');
      }
      const [listingPda] = deriveListing(assetPk);

      try {
        await prismaQuery.listing.upsert({
          where: { listingPda: listingPda.toBase58() },
          create: {
            listingPda: listingPda.toBase58(),
            assetId,
            seller: user.walletAddress,
            priceLamports: BigInt(priceLamports),
            active: true,
          },
          update: {
            priceLamports: BigInt(priceLamports),
            active: true,
            deletedAt: null,
          },
        });
      } catch (err) {
        return handleError(reply, 500, 'mirror failed', 'LISTING_MIRROR_FAILED', err as Error);
      }

      const listing = await prismaQuery.listing.findUnique({
        where: { listingPda: listingPda.toBase58() },
      });
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ listing }),
      });
    },
  );

  // ---- POST /buy/:listingPda ----
  app.post(
    '/buy/:listingPda',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      if (!heliusAvailable()) {
        return handleError(reply, 503, 'Helius not configured', 'HELIUS_UNAVAILABLE');
      }

      const { listingPda } = request.params as { listingPda: string };
      const listing = await prismaQuery.listing.findUnique({ where: { listingPda } });
      if (!listing) return handleError(reply, 404, 'listing not found', 'LISTING_NOT_FOUND');
      if (!listing.active) {
        return handleError(reply, 409, 'listing not active', 'LISTING_INACTIVE');
      }

      let buyerPk: PublicKey;
      let sellerPk: PublicKey;
      let assetPk: PublicKey;
      try {
        buyerPk = assertPubkey(user.walletAddress);
        sellerPk = assertPubkey(listing.seller);
        assetPk = assertPubkey(listing.assetId);
      } catch {
        return handleError(reply, 400, 'invalid pubkey', 'VALIDATION_ERROR');
      }

      let bundle: AssetProofBundle;
      let treeStr: string;
      try {
        const res = await assembleProofBundle(listing.assetId);
        bundle = res.bundle;
        treeStr = res.tree;
      } catch (err) {
        return handleError(reply, 502, 'DAS lookup failed', 'DAS_LOOKUP_FAILED', err as Error);
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
        return handleError(reply, 500, 'ix build failed', 'IX_BUILD_FAILED', err as Error);
      }
      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, buyerPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'tx build failed', 'TX_BUILD_FAILED', err as Error);
      }
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          listingPda,
          assetId: listing.assetId,
          priceLamports: listing.priceLamports.toString(),
          unsignedTx: unsigned.transaction,
          recentBlockhash: unsigned.recentBlockhash,
          lastValidBlockHeight: unsigned.lastValidBlockHeight,
          feePayer: unsigned.feePayer,
        }),
      });
    },
  );

  // ---- POST /buy/:listingPda/confirm ----
  app.post(
    '/buy/:listingPda/confirm',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      const { listingPda } = request.params as { listingPda: string };
      const parsed = ConfirmOnlyBody.safeParse(request.body);
      if (!parsed.success) return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');
      const { txSig } = parsed.data;

      const listing = await prismaQuery.listing.findUnique({ where: { listingPda } });
      if (!listing) return handleError(reply, 404, 'listing not found', 'LISTING_NOT_FOUND');

      const { connection } = app.solana;
      try {
        await awaitConfirmed(connection, txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }

      try {
        await prismaQuery.$transaction([
          prismaQuery.listing.update({
            where: { listingPda },
            data: { active: false },
          }),
          prismaQuery.sale.create({
            data: {
              listingPda,
              assetId: listing.assetId,
              seller: listing.seller,
              buyer: user.walletAddress,
              priceLamports: listing.priceLamports,
              saleTxSig: txSig,
            },
          }),
          prismaQuery.stickerMint.updateMany({
            where: { assetId: listing.assetId },
            data: { userWallet: user.walletAddress },
          }),
        ]);
      } catch (err) {
        return handleError(reply, 500, 'mirror failed', 'SALE_MIRROR_FAILED', err as Error);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          listingPda,
          buyer: user.walletAddress,
          seller: listing.seller,
          assetId: listing.assetId,
          priceLamports: listing.priceLamports.toString(),
          saleTxSig: txSig,
        }),
      });
    },
  );

  // ---- POST /cancel/:listingPda ----
  app.post(
    '/cancel/:listingPda',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      if (!heliusAvailable()) {
        return handleError(reply, 503, 'Helius not configured', 'HELIUS_UNAVAILABLE');
      }
      const { listingPda } = request.params as { listingPda: string };
      const listing = await prismaQuery.listing.findUnique({ where: { listingPda } });
      if (!listing) return handleError(reply, 404, 'listing not found', 'LISTING_NOT_FOUND');
      if (listing.seller !== user.walletAddress) {
        return handleError(reply, 403, 'not the seller', 'NOT_SELLER');
      }
      if (!listing.active) {
        return handleError(reply, 409, 'listing not active', 'LISTING_INACTIVE');
      }

      let sellerPk: PublicKey;
      let assetPk: PublicKey;
      try {
        sellerPk = assertPubkey(user.walletAddress);
        assetPk = assertPubkey(listing.assetId);
      } catch {
        return handleError(reply, 400, 'invalid pubkey', 'VALIDATION_ERROR');
      }
      let bundle: AssetProofBundle;
      let treeStr: string;
      try {
        const res = await assembleProofBundle(listing.assetId);
        bundle = res.bundle;
        treeStr = res.tree;
      } catch (err) {
        return handleError(reply, 502, 'DAS lookup failed', 'DAS_LOOKUP_FAILED', err as Error);
      }

      const { momentum, connection } = app.solana;
      let ix;
      try {
        ix = await buildCancelListingIx({
          program: momentum,
          seller: sellerPk,
          assetId: assetPk,
          proof: bundle,
          merkleTree: new PublicKey(treeStr),
        });
      } catch (err) {
        return handleError(reply, 500, 'ix build failed', 'IX_BUILD_FAILED', err as Error);
      }
      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, sellerPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'tx build failed', 'TX_BUILD_FAILED', err as Error);
      }
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          listingPda,
          assetId: listing.assetId,
          unsignedTx: unsigned.transaction,
          recentBlockhash: unsigned.recentBlockhash,
          lastValidBlockHeight: unsigned.lastValidBlockHeight,
          feePayer: unsigned.feePayer,
        }),
      });
    },
  );

  // ---- POST /cancel/:listingPda/confirm ----
  app.post(
    '/cancel/:listingPda/confirm',
    { preHandler: [app.authenticate], config: { rateLimit: walletRate } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      const { listingPda } = request.params as { listingPda: string };
      const parsed = ConfirmOnlyBody.safeParse(request.body);
      if (!parsed.success) return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');

      const { connection } = app.solana;
      try {
        await awaitConfirmed(connection, parsed.data.txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }
      // Soft-delete pattern: mark active=false + set deletedAt.
      try {
        await prismaQuery.listing.update({
          where: { listingPda },
          data: { active: false, deletedAt: new Date() },
        });
      } catch (err) {
        return handleError(reply, 500, 'mirror failed', 'LISTING_MIRROR_FAILED', err as Error);
      }
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ listingPda, cancelled: true }),
      });
    },
  );

  done();
};
