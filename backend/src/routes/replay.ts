/**
 * Replay status surface — Phase E / E.1.
 *
 *   GET /api/replay/status
 *
 * Reads the on-disk heartbeat written by the replay worker. Absence of the
 * file means replay has never run (or the tmpdir was cleared).
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { readReplayStatus } from '../lib/replay-status.ts';

export const replayRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/status',
    {
      schema: {
        description: 'Replay worker status — active fixture, current seq, ETA.',
        tags: ['meta'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'null' },
              data: { type: ['object', 'null'] },
            },
          },
        },
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const status = await readReplayStatus();
      return reply.code(200).send({ success: true, error: null, data: status });
    },
  );

  done();
};
