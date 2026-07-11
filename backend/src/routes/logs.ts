/**
 * Dev-only log tail — Phase E / E.2.
 *
 *   GET /api/logs/tail?limit=200
 *
 * Only mounted when NODE_ENV=development. Returns the last N structured
 * log lines from the in-process ring buffer. Handy for demo debugging
 * when the terminal has scrolled past a keeper tx you wanted to see.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { tailLines } from '../lib/log-buffer.ts';

export const logsRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/tail',
    {
      schema: {
        description: 'Recent structured log lines (dev only). ?limit up to 500.',
        tags: ['meta'],
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as { limit?: string };
      const limit = q.limit ? Number(q.limit) : 200;
      const lines = tailLines(Number.isFinite(limit) ? limit : 200);
      return reply.code(200).send({
        success: true,
        error: null,
        data: { count: lines.length, lines },
      });
    },
  );

  done();
};
