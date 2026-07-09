/**
 * Fastify auth plugin — Phase B / B.2.
 *
 * Decorates the app with `authenticate` — a preHandler that runs
 * `request.jwtVerify()` (from @fastify/jwt) and then loads the associated
 * Prisma `User` onto `request.momentumUser`. Routes that need both the
 * JWT claims (`request.user`) and the DB record use this decorator.
 *
 * Convention: `request.user` is the raw JWT payload (@fastify/jwt owns that
 * field). `request.momentumUser` is the DB record. See jwt_user_collision
 * memory note.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { prismaQuery } from '../lib/prisma.ts';
import { handleError } from '../utils/errorHandler.ts';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply>;
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void | FastifyReply> => {
      try {
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
    },
  );
};

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/jwt'],
});
