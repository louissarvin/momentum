/**
 * Fastify plugin exposing the in-process stream hub — Phase B / B.4.
 * `fastify-plugin`-wrapped so the decorator escapes plugin scope.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { streamHub } from '../lib/stream/hub.ts';

declare module 'fastify' {
  interface FastifyInstance {
    stream: typeof streamHub;
  }
}

const streamPlugin: FastifyPluginAsync = async (app) => {
  app.decorate('stream', streamHub);
};

export default fp(streamPlugin, { name: 'stream' });
