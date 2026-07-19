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
        // No response schema on purpose. Fastify's fast-json-stringify
        // strips any field not explicitly listed under `properties`; we want
        // the full ReplayStatus shape (active, fixtureId, startedAt,
        // processedPackets, speed, etc.) passed through verbatim so the
        // frontend ReplayModeBanner can render correctly.
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const status = await readReplayStatus();
      return reply.code(200).send({ success: true, error: null, data: status });
    },
  );

  done();
};
