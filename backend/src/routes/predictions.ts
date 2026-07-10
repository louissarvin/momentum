/**
 * Prediction routes — Phase C / C.3.
 *
 *   POST /api/predictions/:fixtureId          -> unsigned submit_predictions tx
 *   POST /api/predictions/:fixtureId/confirm  -> mirror PredictionCard
 *   GET  /api/predictions/:fixtureId/me       -> user's card + slots
 *
 * The on-chain PDA is [b"card", user, u64 LE fixture_id]; Anchor `init`
 * enforces one card per (user, fixture) which is our natural idempotency.
 * We short-circuit and return the existing card if the DB mirror already
 * has one — avoids paying to build a doomed tx.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';

import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';
import { jsonSafe } from '../utils/serialize.ts';
import { buildUnsignedLegacyTx, awaitConfirmed } from '../lib/solana/tx.ts';
import {
  idempotencyCacheKey,
  readIdempotencyHeader,
  getIdempotent,
  setIdempotent,
} from '../lib/idempotency.ts';

const SlotSchema = z.object({
  statAKey: z.number().int(),
  statBKey: z.number().int().default(0),
  op: z.number().int().min(0).max(2).default(0),
  predicateComparison: z.number().int().min(0).max(2),
  threshold: z.number().int(),
  period: z.number().int().min(0).max(65535).default(0),
});

const SubmitBody = z.object({
  slots: z.array(SlotSchema).min(1).max(8),
});

const ConfirmBody = z.object({
  txSig: z.string().min(64).max(120),
});

function assertPubkey(candidate: string): PublicKey {
  try {
    return new PublicKey(candidate);
  } catch {
    throw new Error('invalid pubkey');
  }
}

export const predictionRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // ---- POST /:fixtureId (build unsigned submit_predictions) ----
  app.post(
    '/:fixtureId',
    {
      preHandler: [app.authenticate],
      // Rate limit per contract: 60 req/min per wallet. Key generator uses
      // wallet if authenticated, else IP.
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const claims = (req as { user?: { wallet?: string } }).user;
            return claims?.wallet ?? req.ip;
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { fixtureId: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const { fixtureId } = params;
      if (!/^[0-9]+$/.test(fixtureId)) {
        return handleError(reply, 400, 'invalid fixtureId', 'VALIDATION_ERROR');
      }

      const parsed = SubmitBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues,
        });
      }

      const idemHeader = readIdempotencyHeader(request.headers as Record<string, unknown>);
      const idemKey = idemHeader
        ? idempotencyCacheKey(idemHeader, `predictions.submit:${user.id}:${fixtureId}`)
        : null;
      if (idemKey) {
        const cached = getIdempotent(idemKey);
        if (cached) return reply.code(cached.status).send(cached.body);
      }

      let userPk: PublicKey;
      try {
        userPk = assertPubkey(user.walletAddress);
      } catch {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID');
      }

      const { momentum, connection, pdas } = app.solana;
      const fixtureIdBn = new BN(fixtureId);
      const [cardPda] = pdas.derivePredictionCard(userPk, BigInt(fixtureId));

      // Short-circuit if a card exists on-chain — Anchor init would revert.
      try {
        const info = await connection.getAccountInfo(cardPda, 'confirmed');
        if (info) {
          const body = {
            success: true,
            error: null,
            data: jsonSafe({
              cardPda: cardPda.toBase58(),
              alreadyExists: true,
              unsignedTx: null,
            }),
          };
          if (idemKey) setIdempotent(idemKey, 200, body);
          return reply.code(200).send(body);
        }
      } catch {
        // If getAccountInfo fails, best-effort continue.
      }

      // Ensure the parent Fixture row exists (satisfies FK for later mirror).
      await prismaQuery.fixture
        .upsert({
          where: { fixtureId },
          create: { fixtureId, homeTeam: 'unknown', awayTeam: 'unknown' },
          update: {},
        })
        .catch(() => undefined);

      let ix;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ix = await (momentum.methods as any)
          .submitPredictions(fixtureIdBn, parsed.data.slots)
          .accountsPartial({
            user: userPk,
            card: cardPda,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
      } catch (err) {
        return handleError(reply, 500, 'failed to build ix', 'IX_BUILD_FAILED', err as Error);
      }

      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, userPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'failed to build tx', 'TX_BUILD_FAILED', err as Error);
      }

      const body = {
        success: true,
        error: null,
        data: jsonSafe({
          fixtureId,
          cardPda: cardPda.toBase58(),
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

  // ---- POST /:fixtureId/confirm ----
  app.post(
    '/:fixtureId/confirm',
    {
      preHandler: [app.authenticate],
      config: {
        rateLimit: {
          max: 60,
          timeWindow: '1 minute',
          keyGenerator: (req: FastifyRequest) => {
            const claims = (req as { user?: { wallet?: string } }).user;
            return claims?.wallet ?? req.ip;
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { fixtureId: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const { fixtureId } = params;
      if (!/^[0-9]+$/.test(fixtureId)) {
        return handleError(reply, 400, 'invalid fixtureId', 'VALIDATION_ERROR');
      }
      const parsed = ConfirmBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');
      }

      let userPk: PublicKey;
      try {
        userPk = assertPubkey(user.walletAddress);
      } catch {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID');
      }

      const { momentum, connection, pdas } = app.solana;
      const [cardPda] = pdas.derivePredictionCard(userPk, BigInt(fixtureId));

      try {
        await awaitConfirmed(connection, parsed.data.txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }

      let onchain;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onchain = await (momentum.account as any).predictionCard.fetch(cardPda);
      } catch (err) {
        return handleError(reply, 404, 'card not found on-chain', 'CARD_NOT_FOUND', err as Error);
      }

      // Mirror slots as JSON (Prisma JsonValue-safe shape).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const slotsSerial = (onchain.slots as any[]).slice(0, onchain.slotCount).map((s) => ({
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

      try {
        await prismaQuery.predictionCard.upsert({
          where: { cardPda: cardPda.toBase58() },
          create: {
            cardPda: cardPda.toBase58(),
            userWallet: user.walletAddress,
            fixtureId,
            slots: slotsSerial,
            slotCount: onchain.slotCount,
          },
          update: {
            slots: slotsSerial,
            slotCount: onchain.slotCount,
          },
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to mirror card', 'CARD_MIRROR_FAILED', err as Error);
      }

      const card = await prismaQuery.predictionCard.findUnique({
        where: { cardPda: cardPda.toBase58() },
      });
      return reply.code(200).send({ success: true, error: null, data: jsonSafe(card) });
    },
  );

  // ---- GET /:fixtureId/me ----
  app.get(
    '/:fixtureId/me',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { fixtureId: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');
      const { fixtureId } = params;
      const card = await prismaQuery.predictionCard.findUnique({
        where: { userWallet_fixtureId: { userWallet: user.walletAddress, fixtureId } },
        include: { stickers: true, matchCard: true },
      });
      if (!card) return handleError(reply, 404, 'card not found', 'CARD_NOT_FOUND');
      return reply.code(200).send({ success: true, error: null, data: jsonSafe(card) });
    },
  );

  done();
};
