/**
 * Solana Actions CORS plugin.
 *
 * The Solana Actions spec requires wildcard CORS on `/actions.json` and
 * `/api/actions/*` endpoints, along with an `OPTIONS` preflight that
 * echoes GET responses. Our global CORS is restricted to FRONTEND_URL, so we
 * apply this override as an `onSend` hook that fires only on the paths that
 * matter.
 *
 * Registered AFTER the global @fastify/cors plugin so the last-writer-wins
 * headers are the wildcard ones for these paths.
 *
 * Reference: https://solana.com/docs/advanced/actions
 */

import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const ACTIONS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
  'Access-Control-Expose-Headers': 'Content-Type, Content-Encoding, Content-Length',
};

function matchesActionsPath(url: string): boolean {
  // `url` on a Fastify request/reply may include the querystring — strip it.
  const path = url.split('?')[0];
  return path === '/actions.json' || path.startsWith('/api/actions/');
}

async function corsActionsPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload) => {
    if (matchesActionsPath(request.url)) {
      for (const [k, v] of Object.entries(ACTIONS_HEADERS)) {
        reply.header(k, v);
      }
    }
    return payload;
  });

  // Explicit OPTIONS preflight. Fastify won't auto-register wildcard OPTIONS,
  // so we install two handlers covering `/actions.json` and every subpath
  // under `/api/actions/*`. Response is `204 No Content` with the CORS
  // headers.
  const preflight = async (_request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    for (const [k, v] of Object.entries(ACTIONS_HEADERS)) {
      reply.header(k, v);
    }
    return reply.code(204).send();
  };

  app.options('/actions.json', preflight);
  app.options('/api/actions/*', preflight);
}

export default fp(corsActionsPlugin, { name: 'cors-actions' });
