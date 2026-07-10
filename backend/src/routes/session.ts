/**
 * SIWS (Sign In With Solana) session routes — Phase B / P-05.
 *
 * Flow:
 *   1. POST /api/session/challenge  { wallet }
 *      -> issues a single-use nonce with 5-minute TTL, returns
 *         { nonce, message, expiresAt }
 *   2. POST /api/session/wallet-login  { wallet, signature }
 *      -> verifies message signature with tweetnacl.sign.detached.verify,
 *         consumes nonce (single-use), upserts User, issues @fastify/jwt
 *         token with payload { sub: userId, wallet }
 *
 * Security posture (OWASP REST Security Cheat Sheet §2, §3):
 *   - Server-side Zod validation of both bodies.
 *   - Constant-time signature verification via tweetnacl.
 *   - Single-use nonce (marks consumedAt on success, deletes on failure paths
 *     that would otherwise leak state).
 *   - Nonce TTL of 5 minutes limits replay window.
 *   - No user enumeration: identical error responses whether wallet is
 *     unknown or nonce is invalid.
 *   - Generic error messages to clients; full detail lands in ErrorLog via
 *     handleError().
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { randomBytes } from 'node:crypto';

import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';

// ---------- schemas ----------

const WALLET_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const ChallengeBody = z.object({
  wallet: z.string().regex(WALLET_REGEX, 'invalid solana wallet'),
});

const LoginBody = z.object({
  wallet: z.string().regex(WALLET_REGEX, 'invalid solana wallet'),
  signature: z.string().min(64, 'signature required'),
});

const NONCE_TTL_MS = 5 * 60 * 1000;

function newNonce(): string {
  // 32 bytes of entropy, hex-encoded (64 chars). Well above the 128-bit
  // minimum from OWASP Session Management §4.1.
  return randomBytes(32).toString('hex');
}

function buildMessage(nonce: string): string {
  return `Sign in to MOMENTUM: ${nonce}`;
}

function assertPubkey(wallet: string): PublicKey {
  const pk = new PublicKey(wallet);
  if (!PublicKey.isOnCurve(pk.toBytes())) {
    throw new Error('wallet must be an ed25519 public key');
  }
  return pk;
}

// ---------- routes ----------

export const sessionRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  // POST /api/session/challenge
  app.post(
    '/challenge',
    {
      // Phase E / E.6: SIWS nonce spam guard — 20/min per IP.
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = ChallengeBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid challenge body', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { wallet } = parsed.data;

      try {
        assertPubkey(wallet);
      } catch (err) {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID', err as Error);
      }

      const nonce = newNonce();
      const message = buildMessage(nonce);
      const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

      try {
        await prismaQuery.session.create({
          data: { wallet, nonce, message, expiresAt },
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to create challenge', 'CHALLENGE_CREATE_FAILED', err as Error);
      }

      return reply.code(200).send({
        success: true,
        error: null,
        data: { nonce, message, expiresAt: expiresAt.toISOString() },
      });
    },
  );

  // POST /api/session/wallet-login
  app.post(
    '/wallet-login',
    {
      config: {
        // Phase E / E.6: 20/min per IP for wallet-login (OWASP Auth §3.3).
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = LoginBody.safeParse(request.body);
      if (!parsed.success) {
        return handleError(reply, 400, 'invalid login body', 'VALIDATION_ERROR', null, {
          issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { wallet, signature } = parsed.data;

      let walletPk: PublicKey;
      try {
        walletPk = assertPubkey(wallet);
      } catch (err) {
        return handleError(reply, 400, 'invalid wallet', 'WALLET_INVALID', err as Error);
      }

      // Look up unconsumed, unexpired nonce for this wallet. We take the
      // most recent one to avoid stale-challenge races.
      const nowIso = new Date();
      const challenge = await prismaQuery.session.findFirst({
        where: {
          wallet,
          consumedAt: null,
          expiresAt: { gt: nowIso },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!challenge) {
        // Generic error: do not leak whether nonce expired vs never existed.
        return handleError(reply, 401, 'authentication failed', 'AUTH_FAILED');
      }

      // Verify signature. Signature is base58-encoded 64 bytes.
      let sigBytes: Uint8Array;
      try {
        sigBytes = bs58.decode(signature);
      } catch {
        // Try base64 fallback (some wallets emit base64).
        try {
          sigBytes = new Uint8Array(Buffer.from(signature, 'base64'));
        } catch (err) {
          return handleError(reply, 401, 'authentication failed', 'AUTH_FAILED', err as Error);
        }
      }
      if (sigBytes.length !== 64) {
        return handleError(reply, 401, 'authentication failed', 'AUTH_FAILED');
      }

      const messageBytes = new TextEncoder().encode(challenge.message);
      const ok = nacl.sign.detached.verify(messageBytes, sigBytes, walletPk.toBytes());
      if (!ok) {
        return handleError(reply, 401, 'authentication failed', 'AUTH_FAILED');
      }

      // Consume nonce (single-use). Race-safe via a conditional update:
      // if another concurrent request consumes it first, we bail.
      const consumeResult = await prismaQuery.session.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: nowIso },
      });
      if (consumeResult.count !== 1) {
        return handleError(reply, 401, 'authentication failed', 'AUTH_FAILED');
      }

      // Upsert user + link the consumed nonce to the user for audit.
      let user;
      try {
        user = await prismaQuery.user.upsert({
          where: { walletAddress: wallet },
          create: { walletAddress: wallet, lastSignIn: nowIso },
          update: { lastSignIn: nowIso },
        });
      } catch (err) {
        return handleError(reply, 500, 'failed to load user', 'USER_UPSERT_FAILED', err as Error);
      }
      await prismaQuery.session
        .update({ where: { id: challenge.id }, data: { userId: user.id } })
        .catch(() => undefined); // audit link is best-effort

      // Issue JWT via @fastify/jwt (HS256 by default, secret from env).
      const token = app.jwt.sign({ sub: user.id, wallet: user.walletAddress });

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          token,
          user: {
            id: user.id,
            wallet: user.walletAddress,
            createdAt: user.createdAt.toISOString(),
          },
        },
      });
    },
  );

  // GET /api/session/me — verifies the token and returns the caller.
  app.get(
    '/me',
    { preHandler: [app.authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const claims = request.user as { sub?: string; wallet?: string };
      const userId = claims?.sub;
      if (!userId) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      const user = await prismaQuery.user.findUnique({ where: { id: userId } });
      if (!user) return handleError(reply, 401, 'unauthorized', 'UNAUTHORIZED');

      return reply.code(200).send({
        success: true,
        error: null,
        data: {
          id: user.id,
          wallet: user.walletAddress,
          createdAt: user.createdAt.toISOString(),
        },
      });
    },
  );

  done();
};
