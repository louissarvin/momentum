/**
 * Group routes — Phase C / C.2.
 *
 * Auth-required write flows build unsigned Anchor txs (create_group /
 * join_group), return them base64 for the wallet to sign. A companion
 * `/confirm` endpoint takes the client-submitted txSig, awaits confirm on
 * devnet, then mirrors on-chain state into Prisma.
 *
 *   POST /api/groups                          -> unsigned create_group tx
 *   POST /api/groups/:groupPda/confirm        -> mirror on-chain group
 *   POST /api/groups/:groupPda/join           -> unsigned join_group tx
 *   POST /api/groups/:groupPda/join/confirm   -> mirror membership
 *   GET  /api/groups                          -> paginated public list
 *   GET  /api/groups/:groupPda                -> single group + memberships
 *
 * Security posture:
 *   - Zod validation on every POST body.
 *   - Wallet-scoped Idempotency-Key handling (5-min TTL).
 *   - No secret data leaves the process.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { randomBytes } from 'node:crypto';

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

const CreateGroupBody = z.object({
  name: z.string().min(1).max(32),
  maxSize: z.number().int().min(2).max(64),
  entryFeeLamports: z.union([z.number().int().min(0), z.string().regex(/^[0-9]+$/)]).default(0),
});

const ConfirmBody = z.object({
  txSig: z.string().min(64).max(120),
});

function randomGroupId(): bigint {
  // Random u64 that fits in Number for logging but is safe as bigint on-chain.
  const b = randomBytes(6); // 48 bits — well below Number.MAX_SAFE_INTEGER
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  return n;
}

function assertPubkey(candidate: string): PublicKey {
  try {
    return new PublicKey(candidate);
  } catch {
    throw new Error('invalid pubkey');
  }
}

export const groupRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // ---- POST / (create) ----
  app.post(
    '/',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const parsed = CreateGroupBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues,
        });
      }
      const { name, maxSize, entryFeeLamports } = parsed.data;

      const idemHeader = readIdempotencyHeader(request.headers as Record<string, unknown>);
      const idemKey = idemHeader ? idempotencyCacheKey(idemHeader, `groups.create:${user.id}`) : null;
      if (idemKey) {
        const cached = getIdempotent(idemKey);
        if (cached) return reply.code(cached.status).send(cached.body);
      }

      let creatorPk: PublicKey;
      try {
        creatorPk = assertPubkey(user.walletAddress);
      } catch {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID');
      }

      const groupId = randomGroupId();
      const { pdas, momentum, connection } = app.solana;
      const [groupPda] = pdas.deriveGroup(groupId);
      const [vaultPda] = pdas.deriveVault(groupPda);
      const [membershipPda] = pdas.deriveMembership(groupPda, creatorPk);

      let ix;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ix = await (momentum.methods as any)
          .createGroup(new BN(groupId.toString()), name, maxSize, new BN(String(entryFeeLamports)))
          .accountsPartial({
            creator: creatorPk,
            group: groupPda,
            vault: vaultPda,
            creatorMembership: membershipPda,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
      } catch (err) {
        return handleError(reply, 500, 'failed to build create_group ix', 'IX_BUILD_FAILED', err as Error);
      }

      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, creatorPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'failed to build tx', 'TX_BUILD_FAILED', err as Error);
      }

      const body = {
        success: true,
        error: null,
        data: jsonSafe({
          groupId: groupId.toString(),
          groupPda: groupPda.toBase58(),
          vaultPda: vaultPda.toBase58(),
          membershipPda: membershipPda.toBase58(),
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

  // ---- POST /:groupPda/confirm ----
  app.post(
    '/:groupPda/confirm',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { groupPda: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const parsed = ConfirmBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');
      }
      let groupPda: PublicKey;
      try {
        groupPda = assertPubkey(params.groupPda);
      } catch {
        return handleError(reply, 400, 'invalid groupPda', 'VALIDATION_ERROR');
      }

      const { connection, momentum } = app.solana;

      try {
        await awaitConfirmed(connection, parsed.data.txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }

      let onchain;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onchain = await (momentum.account as any).group.fetch(groupPda);
      } catch (err) {
        return handleError(reply, 404, 'group not found on-chain', 'GROUP_NOT_FOUND', err as Error);
      }

      // Mirror.
      const groupIdStr = onchain.groupId?.toString?.() ?? String(onchain.groupId);
      const entryFee = onchain.entryFeeLamports?.toString?.() ?? '0';
      const creator = onchain.creator?.toBase58?.() ?? String(onchain.creator);
      try {
        await prismaQuery.group.upsert({
          where: { groupPda: groupPda.toBase58() },
          create: {
            groupPda: groupPda.toBase58(),
            groupId: groupIdStr,
            creator,
            name: onchain.name,
            maxSize: onchain.maxSize,
            currentSize: onchain.currentSize,
            entryFeeLamports: BigInt(entryFee),
          },
          update: {
            currentSize: onchain.currentSize,
            entryFeeLamports: BigInt(entryFee),
          },
        });
        // Ensure creator's Membership exists in DB.
        await prismaQuery.membership.upsert({
          where: { groupPda_userWallet: { groupPda: groupPda.toBase58(), userWallet: creator } },
          create: { groupPda: groupPda.toBase58(), userWallet: creator },
          update: {},
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to mirror group', 'GROUP_MIRROR_FAILED', err as Error);
      }

      const mirrored = await prismaQuery.group.findUnique({
        where: { groupPda: groupPda.toBase58() },
        include: { memberships: true },
      });
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe(mirrored),
      });
    },
  );

  // ---- POST /:groupPda/join ----
  app.post(
    '/:groupPda/join',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { groupPda: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      let groupPda: PublicKey;
      try {
        groupPda = assertPubkey(params.groupPda);
      } catch {
        return handleError(reply, 400, 'invalid groupPda', 'VALIDATION_ERROR');
      }

      const idemHeader = readIdempotencyHeader(request.headers as Record<string, unknown>);
      const idemKey = idemHeader
        ? idempotencyCacheKey(idemHeader, `groups.join:${user.id}:${groupPda.toBase58()}`)
        : null;
      if (idemKey) {
        const cached = getIdempotent(idemKey);
        if (cached) return reply.code(cached.status).send(cached.body);
      }

      let joinerPk: PublicKey;
      try {
        joinerPk = assertPubkey(user.walletAddress);
      } catch {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID');
      }

      const { momentum, connection, pdas } = app.solana;

      // Need the group_id (u64) which is a field on the on-chain Group state.
      let onchain;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onchain = await (momentum.account as any).group.fetch(groupPda);
      } catch (err) {
        return handleError(reply, 404, 'group not found on-chain', 'GROUP_NOT_FOUND', err as Error);
      }
      const groupId = onchain.groupId?.toString?.() ?? String(onchain.groupId);
      const [vaultPda] = pdas.deriveVault(groupPda);
      const [membershipPda] = pdas.deriveMembership(groupPda, joinerPk);

      // Pass 10: the on-chain program has an OPTIONAL `group_extension`
      // account that carries the paused flag. If we blindly pass the
      // derived PDA and it doesn't exist, Anchor errors with
      // AccountNotInitialized (3012). We probe first and only include the
      // account if it's actually been initialised on-chain.
      const [groupExtPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('group_ext'), groupPda.toBuffer()],
        momentum.programId,
      );
      let groupExtensionAccount: PublicKey | null = null;
      try {
        const extInfo = await connection.getAccountInfo(groupExtPda);
        if (extInfo && extInfo.owner.equals(momentum.programId)) {
          groupExtensionAccount = groupExtPda;
        }
      } catch {
        // best-effort — if the probe RPC fails, skip the optional account
      }

      let ix;
      try {
        // Anchor 0.31 optional-account convention: pass the PROGRAM ID
        // itself as the account key when the optional account is None.
        // On-chain, Anchor sees `program_id` at that slot and treats it
        // as `Option::None`, skipping deserialisation.
        //
        // If we omit the field (or pass null), `.accountsPartial()`
        // auto-derives the PDA from the seed constraint — which then
        // fails with AccountNotInitialized if that PDA doesn't exist
        // on-chain (legacy pre-Pass-10 groups). We probe whether the
        // ext PDA exists and pass either the real key or the program ID
        // sentinel accordingly.
        const groupExtensionForIx = groupExtensionAccount ?? momentum.programId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ix = await (momentum.methods as any)
          .joinGroup(new BN(groupId))
          .accountsPartial({
            user: joinerPk,
            group: groupPda,
            vault: vaultPda,
            membership: membershipPda,
            groupExtension: groupExtensionForIx,
            systemProgram: SystemProgram.programId,
          })
          .instruction();
        request.log.info(
          {
            groupExt: groupExtensionForIx.toBase58(),
            isSentinel: !groupExtensionAccount,
          },
          'join_group: ix built',
        );
      } catch (err) {
        return handleError(reply, 500, 'failed to build join_group ix', 'IX_BUILD_FAILED', err as Error);
      }

      let unsigned;
      try {
        unsigned = await buildUnsignedLegacyTx(connection, joinerPk, [ix]);
      } catch (err) {
        return handleError(reply, 500, 'failed to build tx', 'TX_BUILD_FAILED', err as Error);
      }

      const body = {
        success: true,
        error: null,
        data: jsonSafe({
          groupPda: groupPda.toBase58(),
          membershipPda: membershipPda.toBase58(),
          vaultPda: vaultPda.toBase58(),
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

  // ---- POST /:groupPda/join/confirm ----
  app.post(
    '/:groupPda/join/confirm',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { groupPda: string };
      const user = request.momentumUser;
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const parsed = ConfirmBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid body', 'VALIDATION_ERROR');
      }
      let groupPda: PublicKey;
      try {
        groupPda = assertPubkey(params.groupPda);
      } catch {
        return handleError(reply, 400, 'invalid groupPda', 'VALIDATION_ERROR');
      }

      const { connection, momentum } = app.solana;

      try {
        await awaitConfirmed(connection, parsed.data.txSig);
      } catch (err) {
        return handleError(reply, 502, 'tx not confirmed', 'TX_NOT_CONFIRMED', err as Error);
      }

      // Refresh on-chain state & mirror.
      let onchain;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onchain = await (momentum.account as any).group.fetch(groupPda);
      } catch (err) {
        return handleError(reply, 404, 'group not found on-chain', 'GROUP_NOT_FOUND', err as Error);
      }
      try {
        await prismaQuery.group.update({
          where: { groupPda: groupPda.toBase58() },
          data: { currentSize: onchain.currentSize },
        });
        await prismaQuery.membership.upsert({
          where: {
            groupPda_userWallet: {
              groupPda: groupPda.toBase58(),
              userWallet: user.walletAddress,
            },
          },
          create: { groupPda: groupPda.toBase58(), userWallet: user.walletAddress },
          update: {},
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to mirror membership', 'MEMBERSHIP_MIRROR_FAILED', err as Error);
      }

      const membership = await prismaQuery.membership.findUnique({
        where: {
          groupPda_userWallet: {
            groupPda: groupPda.toBase58(),
            userWallet: user.walletAddress,
          },
        },
      });
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({
          membership,
          group: { groupPda: groupPda.toBase58(), currentSize: onchain.currentSize },
        }),
      });
    },
  );

  // ---- GET /:groupPda (public) ----
  app.get(
    '/:groupPda',
    { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = request.params as { groupPda: string };
      const pdaStr = params.groupPda;
      try {
        assertPubkey(pdaStr);
      } catch {
        return handleError(reply, 400, 'invalid groupPda', 'VALIDATION_ERROR');
      }
      const group = await prismaQuery.group.findUnique({
        where: { groupPda: pdaStr },
        include: { memberships: true },
      });
      if (!group || group.deletedAt) {
        return handleError(reply, 404, 'group not found', 'GROUP_NOT_FOUND');
      }
      return reply.code(200).send({ success: true, error: null, data: jsonSafe(group) });
    },
  );

  // ---- GET /:groupPda/leaderboard (public, 60s cache) ----
  //
  // Members of a group ranked by global hit-rate. Hit-rate is computed
  // over ALL of the member's stickers (across every fixture) because the
  // current data model does not attribute predictions to groups. This is
  // called out in the response `note` field.
  const LEADERBOARD_TTL_MS = 60_000;
  const leaderboardCache = new Map<string, { at: number; body: unknown }>();

  app.get(
    '/:groupPda/leaderboard',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        description:
          'Public leaderboard for a group. Members ranked by global hit-rate (see note in response — hit-rate is not group-scoped).',
        tags: ['groups'],
        params: {
          type: 'object',
          properties: { pda: { type: 'string' } },
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
                  groupPda: { type: 'string' },
                  memberCount: { type: 'integer' },
                  note: { type: 'string' },
                  leaderboard: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        wallet: { type: 'string' },
                        joinedAt: { type: 'string' },
                        predictionCount: { type: 'integer' },
                        hitCount: { type: 'integer' },
                        missCount: { type: 'integer' },
                        hitRate: { type: 'number' },
                        score: { type: 'integer' },
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
      // Route registered under `/api/groups`, so `:groupPda` param name
      // matches the prefix pattern of the sibling routes. External spec
      // calls this `:pda` — we accept either by checking both keys.
      const params = request.params as { groupPda?: string; pda?: string };
      const pdaStr = params.groupPda ?? params.pda ?? '';
      try {
        assertPubkey(pdaStr);
      } catch {
        return handleError(reply, 400, 'invalid groupPda', 'VALIDATION_ERROR');
      }

      const cacheKey = pdaStr;
      const now = Date.now();
      const cached = leaderboardCache.get(cacheKey);
      if (cached && now - cached.at < LEADERBOARD_TTL_MS) {
        return reply.code(200).send(cached.body);
      }

      const group = await prismaQuery.group.findUnique({
        where: { groupPda: pdaStr },
        include: { memberships: true },
      });
      if (!group || group.deletedAt) {
        return handleError(reply, 404, 'group not found', 'GROUP_NOT_FOUND');
      }

      const wallets = group.memberships.map((m) => m.userWallet);
      const joinedByWallet = new Map(group.memberships.map((m) => [m.userWallet, m.joinedAt]));

      // Bulk-aggregate per-wallet stats. Two queries — one grouping
      // stickers by (userWallet, outcome), one counting prediction cards.
      let stickerRows: { userWallet: string; outcome: string; _count: { _all: number } }[] = [];
      let predictionRows: { userWallet: string; _count: { _all: number } }[] = [];
      if (wallets.length > 0) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          stickerRows = (await (prismaQuery.stickerMint as any).groupBy({
            by: ['userWallet', 'outcome'],
            where: { userWallet: { in: wallets } },
            _count: { _all: true },
          })) as typeof stickerRows;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          predictionRows = (await (prismaQuery.predictionCard as any).groupBy({
            by: ['userWallet'],
            where: { userWallet: { in: wallets } },
            _count: { _all: true },
          })) as typeof predictionRows;
        } catch (err) {
          return handleError(reply, 500, 'aggregation failed', 'LEADERBOARD_FAILED', err as Error);
        }
      }

      const statsByWallet = new Map<
        string,
        { predictionCount: number; hit: number; miss: number; pending: number }
      >();
      for (const w of wallets) {
        statsByWallet.set(w, { predictionCount: 0, hit: 0, miss: 0, pending: 0 });
      }
      for (const r of predictionRows) {
        const s = statsByWallet.get(r.userWallet);
        if (s) s.predictionCount = r._count._all;
      }
      for (const r of stickerRows) {
        const s = statsByWallet.get(r.userWallet);
        if (!s) continue;
        if (r.outcome === 'hit') s.hit = r._count._all;
        else if (r.outcome === 'miss') s.miss = r._count._all;
      }

      const leaderboard = wallets
        .map((wallet) => {
          const s = statsByWallet.get(wallet)!;
          const decided = s.hit + s.miss;
          const hitRate = decided > 0 ? s.hit / decided : 0;
          return {
            wallet,
            joinedAt: joinedByWallet.get(wallet)!.toISOString(),
            predictionCount: s.predictionCount,
            hitCount: s.hit,
            missCount: s.miss,
            hitRate: Number(hitRate.toFixed(4)),
            score: s.hit,
          };
        })
        .sort((a, b) => {
          if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
          if (b.score !== a.score) return b.score - a.score;
          return a.wallet.localeCompare(b.wallet);
        });

      const body = {
        success: true,
        error: null,
        data: {
          groupPda: pdaStr,
          memberCount: wallets.length,
          note: 'Hit rate is global across all fixtures, not group-specific',
          leaderboard,
        },
      };
      leaderboardCache.set(cacheKey, { at: now, body });
      return reply.code(200).send(body);
    },
  );

  // ---- GET / (list, public, paginated) ----
  app.get(
    '/',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const q = request.query as { limit?: string; cursor?: string };
      const rawLimit = Number(q.limit ?? '50');
      const limit = Math.max(1, Math.min(50, Number.isFinite(rawLimit) ? rawLimit : 50));
      const rows = await prismaQuery.group.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: limit,
        ...(q.cursor ? { skip: 1, cursor: { groupPda: q.cursor } } : {}),
      });
      const nextCursor = rows.length === limit ? rows[rows.length - 1].groupPda : null;
      return reply.code(200).send({
        success: true,
        error: null,
        data: jsonSafe({ groups: rows, nextCursor }),
      });
    },
  );

  done();
};
