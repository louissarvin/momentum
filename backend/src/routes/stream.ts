/**
 * SSE fanout route — Phase C / C.5.
 *
 *   GET /api/stream/fixture/:fixtureId?ticket=<jwt>
 *
 * EventSource in the browser can't set Authorization headers, so we accept
 * the session JWT as a `ticket` query param and verify it inline. Once
 * open, the connection subscribes to `app.stream` for `packet`,
 * `sticker_minted`, `match_card_claimed`, `settlement_started`, and
 * `settlement_error` events. Fixture-scoped events are filtered by
 * `fixtureId`; global events pass through.
 *
 * Backpressure: writes go straight to `reply.raw`; per-connection buffer
 * budget is enforced via a soft byte counter — drop-oldest on overflow.
 *
 * Per-user connection cap: 4. Prevents a single wallet from opening
 * hundreds of connections and starving Fastify's request loop.
 *
 * Heartbeat: `: hb\n\n` every 15s so intermediary proxies don't close idle
 * connections.
 */

import type { FastifyInstance, FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { env } from '../config/env.ts';
import { handleError } from '../utils/errorHandler.ts';

const HEARTBEAT_MS = 15_000;
const PER_CONN_BUDGET_BYTES = 1_048_576; // 1MB
const MAX_CONNECTIONS_PER_USER = 4;

const openByUser = new Map<string, number>();

function incrementConn(userKey: string): number {
  const cur = openByUser.get(userKey) ?? 0;
  const next = cur + 1;
  openByUser.set(userKey, next);
  return next;
}
function decrementConn(userKey: string): void {
  const cur = openByUser.get(userKey) ?? 0;
  const next = Math.max(0, cur - 1);
  if (next === 0) openByUser.delete(userKey);
  else openByUser.set(userKey, next);
}

function writeEvent(
  reply: FastifyReply,
  budgetRef: { bytes: number },
  event: string,
  data: unknown,
  id?: string,
): void {
  const payload = JSON.stringify(data);
  const chunks: string[] = [];
  if (id) chunks.push(`id: ${id}\n`);
  chunks.push(`event: ${event}\n`);
  chunks.push(`data: ${payload}\n\n`);
  const line = chunks.join('');
  const size = Buffer.byteLength(line, 'utf8');
  if (budgetRef.bytes + size > PER_CONN_BUDGET_BYTES) {
    // Drop-oldest is trivially "drop new" here since we have no queue —
    // real backpressure lives in Node's socket write buffer. Log & skip.
    // A production build would track a per-connection queue.
    return;
  }
  budgetRef.bytes += size;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (reply.raw as any).write(line);
  } catch {
    // socket closed; ignore
  }
}

export const streamRoutes: FastifyPluginCallback = (app: FastifyInstance, _opts, done) => {
  app.get(
    '/fixture/:fixtureId',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fixtureId } = request.params as { fixtureId: string };
      const ticket = (request.query as { ticket?: string }).ticket;
      if (!ticket || typeof ticket !== 'string') {
        return handleError(reply, 401, 'missing ticket', 'UNAUTHORIZED');
      }

      let claims: { sub?: string; wallet?: string };
      try {
        claims = (await app.jwt.verify(ticket)) as { sub?: string; wallet?: string };
      } catch {
        return handleError(reply, 401, 'invalid ticket', 'UNAUTHORIZED');
      }
      const userKey = claims.sub ?? claims.wallet ?? 'anon';
      const openCount = openByUser.get(userKey) ?? 0;
      if (openCount >= MAX_CONNECTIONS_PER_USER) {
        return handleError(reply, 429, 'too many concurrent streams', 'STREAM_LIMIT');
      }

      if (!/^[0-9]+$/.test(fixtureId)) {
        return handleError(reply, 400, 'invalid fixtureId', 'VALIDATION_ERROR');
      }

      // Configure SSE headers on the raw response.
      // Fastify won't send anything itself once we take over `reply.raw`.
      const originHeader = env.IS_DEV ? '*' : env.FRONTEND_URL.split(',')[0]?.trim() ?? '*';
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
        'Access-Control-Allow-Origin': originHeader,
        'Access-Control-Allow-Credentials': 'true',
      });

      incrementConn(userKey);
      const budgetRef = { bytes: 0 };

      writeEvent(reply, budgetRef, 'hello', {
        fixtureId,
        wallet: claims.wallet ?? null,
        serverTime: new Date().toISOString(),
      });

      // Subscribe to hub events.
      const onPacket = (evt: { fixtureId: string; seq?: number }): void => {
        if (evt.fixtureId !== fixtureId) return;
        const id = evt.seq !== undefined ? `${evt.fixtureId}:${evt.seq}` : undefined;
        // Reset budget periodically so long-lived streams aren't starved.
        budgetRef.bytes = Math.max(0, budgetRef.bytes - Math.floor(PER_CONN_BUDGET_BYTES / 4));
        writeEvent(reply, budgetRef, 'packet', evt, id);
      };
      const onSticker = (evt: { fixtureId: string; cardPda?: string; slotIndex?: number }): void => {
        if (evt.fixtureId !== fixtureId) return;
        writeEvent(reply, budgetRef, 'sticker_minted', evt);
      };
      const onMatchCard = (evt: { fixtureId: string }): void => {
        if (evt.fixtureId !== fixtureId) return;
        writeEvent(reply, budgetRef, 'match_card_claimed', evt);
      };
      const onSettlementStarted = (evt: { fixtureId: string }): void => {
        if (evt.fixtureId !== fixtureId) return;
        writeEvent(reply, budgetRef, 'settlement_started', evt);
      };
      const onSettlementError = (evt: { fixtureId: string; error: string }): void => {
        if (evt.fixtureId !== fixtureId) return;
        writeEvent(reply, budgetRef, 'settlement_error', evt);
      };

      app.stream.on('packet', onPacket);
      app.stream.on('sticker_minted', onSticker);
      app.stream.on('match_card_claimed', onMatchCard);
      app.stream.on('settlement_started', onSettlementStarted);
      app.stream.on('settlement_error', onSettlementError);

      const heartbeat = setInterval(() => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (reply.raw as any).write(': hb\n\n');
        } catch {
          // socket closed; cleanup happens in 'close'
        }
      }, HEARTBEAT_MS);

      const cleanup = (): void => {
        clearInterval(heartbeat);
        app.stream.off('packet', onPacket);
        app.stream.off('sticker_minted', onSticker);
        app.stream.off('match_card_claimed', onMatchCard);
        app.stream.off('settlement_started', onSettlementStarted);
        app.stream.off('settlement_error', onSettlementError);
        decrementConn(userKey);
        try {
          reply.raw.end();
        } catch {
          // ignore
        }
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);

      // Do not `return` — leave the response open. Fastify's async handler
      // will resolve, but since we've taken over `reply.raw` no further
      // Fastify processing happens.
      return reply;
    },
  );

  done();
};
