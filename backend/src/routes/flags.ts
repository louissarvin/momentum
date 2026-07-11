/**
 * Feature flag surface — Phase E / E.3.
 *
 *   GET /api/flags        -> the live flag map (public — frontend uses it)
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { flags } from '../lib/flags.ts';

export const flagRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/',
    {
      schema: {
        description: 'Public feature-flag map. Frontend gates optional UI paths on this response.',
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
                  kora: { type: 'boolean' },
                  turnkey: { type: 'boolean' },
                  blinks: { type: 'boolean' },
                  settler: { type: 'boolean' },
                  heliusDas: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      return reply.code(200).send({
        success: true,
        error: null,
        data: flags,
      });
    },
  );

  done();
};
