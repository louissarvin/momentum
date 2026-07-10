/**
 * Postgres LISTEN/NOTIFY bridge — Phase B / B.6.
 *
 * Design decision: the ingester runs in a separate Bun process (per
 * doc 13 §6.6). Fanout to browser SSE clients happens from the HTTP
 * process. We chose Postgres LISTEN/NOTIFY (Option 1) as the bridge:
 *
 *   - No new infra dependency (Postgres is already required).
 *   - Native cross-process pub/sub in the DB layer.
 *   - 8KB payload cap is fine because we send a compact envelope
 *     ({fixtureId, seq, action, statusId, period, ts}), and the HTTP
 *     process re-reads full `raw` from ScorePacket only when a client
 *     asks for it. Big payloads bypass the notify entirely.
 *   - Prisma has no LISTEN/NOTIFY support, so we open a dedicated
 *     `pg.Client` on the same DATABASE_URL for the LISTEN side.
 *
 * The ingester calls `notifyPacket()` (helper in ../lib/stream/notify.ts)
 * which does `SELECT pg_notify('momentum_packet', $1)` via Prisma raw.
 *
 * This plugin runs in the HTTP process only. On every notification it
 * re-emits into the in-process `app.stream` hub, so any SSE route
 * subscribed to `packet` events gets fanned out.
 */

import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { Client as PgClient } from 'pg';
import { env } from '../config/env.ts';
import { streamHub } from '../lib/stream/hub.ts';

export const NOTIFY_CHANNELS = {
  packet: 'momentum_packet',
  sticker: 'momentum_sticker',
  matchCard: 'momentum_match_card',
  settlementStarted: 'momentum_settlement_started',
  settlementError: 'momentum_settlement_error',
} as const;

const pgNotifyBridge: FastifyPluginAsync = async (app) => {
  const connStr = env.DIRECT_URL ?? env.DATABASE_URL;
  const client = new PgClient({ connectionString: connStr });

  // Fail soft: a broken bridge should not take down the HTTP server. Log
  // and let the /health probe reflect the outage.
  try {
    await client.connect();
    await client.query(`LISTEN ${NOTIFY_CHANNELS.packet}`);
    await client.query(`LISTEN ${NOTIFY_CHANNELS.sticker}`);
    await client.query(`LISTEN ${NOTIFY_CHANNELS.matchCard}`);
    await client.query(`LISTEN ${NOTIFY_CHANNELS.settlementStarted}`);
    await client.query(`LISTEN ${NOTIFY_CHANNELS.settlementError}`);
    app.log.info({ channels: Object.values(NOTIFY_CHANNELS) }, 'pg LISTEN bridge active');
  } catch (err) {
    app.log.error({ err }, 'pg LISTEN bridge failed to connect');
    return;
  }

  client.on('notification', (msg) => {
    if (!msg.payload) return;
    let payload: unknown;
    try {
      payload = JSON.parse(msg.payload);
    } catch (err) {
      app.log.warn({ err, channel: msg.channel }, 'pg NOTIFY payload not JSON');
      return;
    }
    switch (msg.channel) {
      case NOTIFY_CHANNELS.packet:
        streamHub.emit('packet', payload as never);
        break;
      case NOTIFY_CHANNELS.sticker:
        streamHub.emit('sticker_minted', payload as never);
        break;
      case NOTIFY_CHANNELS.matchCard:
        streamHub.emit('match_card_claimed', payload as never);
        break;
      case NOTIFY_CHANNELS.settlementStarted:
        streamHub.emit('settlement_started', payload as never);
        break;
      case NOTIFY_CHANNELS.settlementError:
        streamHub.emit('settlement_error', payload as never);
        break;
      default:
        break;
    }
  });

  client.on('error', (err) => {
    app.log.error({ err }, 'pg LISTEN client error');
  });

  // Graceful shutdown.
  app.addHook('onClose', async () => {
    try {
      await client.end();
    } catch {
      // ignore
    }
  });
};

export default fp(pgNotifyBridge, {
  name: 'pg-notify-bridge',
  dependencies: ['stream'],
});
