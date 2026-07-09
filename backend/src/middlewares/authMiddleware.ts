import type { FastifyRequest, FastifyReply } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';

/**
 * Legacy `authMiddleware` — preserved for existing routes that were written
 * against it in Phase A. Internally migrated to `@fastify/jwt` in Phase B so
 * both this middleware and `app.authenticate` speak the same token contract
 * (payload = { sub: userId, wallet }).
 *
 * NEW code should prefer `{ preHandler: [app.authenticate] }` from the auth
 * plugin — it is functionally identical but keeps route wiring uniform.
 *
 * NOTE: `@fastify/jwt` already module-augments `FastifyRequest.user` with its
 * raw JWT payload. To avoid a TS declaration merge collision, the DB-loaded
 * record is stored on `request.momentumUser`.
 */
declare module 'fastify' {
  interface FastifyRequest {
    momentumUser?: {
      id: string;
      walletAddress: string;
      nonce: string | null;
      lastSignIn: Date | null;
      createdAt: Date;
      updatedAt: Date;
    };
  }
}

export const authMiddleware = async (
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<true | FastifyReply> => {
  try {
    // request.jwtVerify() validates signature, exp, iat and attaches the
    // payload to request.user. Missing/invalid header throws with a
    // Fastify-typed error we normalize to our envelope.
    await request.jwtVerify();
  } catch (err) {
    return handleError(reply, 401, 'unauthorized', 'INVALID_TOKEN', err as Error);
  }

  const claims = request.user as { sub?: string; wallet?: string };
  if (!claims?.sub) {
    return handleError(reply, 401, 'unauthorized', 'INVALID_TOKEN_PAYLOAD');
  }

  const user = await prismaQuery.user.findUnique({ where: { id: claims.sub } });
  if (!user) {
    return handleError(reply, 401, 'unauthorized', 'USER_NOT_FOUND');
  }

  request.momentumUser = user;
  return true;
};
