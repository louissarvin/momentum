/**
 * Publish helpers for cross-process fanout — Phase B / B.6.
 *
 * The ingester (separate Bun process) calls these to signal the HTTP
 * process's pg-notify-bridge plugin. Payloads must stay under 8KB (Postgres
 * NOTIFY hard cap) — we send a compact envelope only; full raw packets live
 * in the `ScorePacket` table and are re-hydrated on demand by consumers.
 */

import { prismaQuery } from '../prisma.ts';
import { NOTIFY_CHANNELS } from '../../plugins/pg-notify-bridge.ts';
import type {
  StreamPacketEvent,
  StickerMintedEvent,
  MatchCardClaimedEvent,
  SettlementStartedEvent,
  SettlementErrorEvent,
} from './hub.ts';

async function pgNotify(channel: string, payload: unknown): Promise<void> {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') > 7500) {
    // Leave headroom under the 8KB Postgres cap.
    throw new Error(`pg_notify payload too large for channel ${channel}: ${json.length} bytes`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prismaQuery as any).$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, json);
}

export async function notifyPacket(evt: StreamPacketEvent): Promise<void> {
  // Trim `raw` — recipients can re-fetch by (fixtureId, seq) from ScorePacket.
  const compact = {
    fixtureId: evt.fixtureId,
    seq: evt.seq,
    ts: evt.ts,
    action: evt.action,
    statusId: evt.statusId,
    period: evt.period,
  };
  await pgNotify(NOTIFY_CHANNELS.packet, compact);
}

export async function notifyStickerMinted(evt: StickerMintedEvent): Promise<void> {
  await pgNotify(NOTIFY_CHANNELS.sticker, evt);
}

export async function notifyMatchCardClaimed(evt: MatchCardClaimedEvent): Promise<void> {
  await pgNotify(NOTIFY_CHANNELS.matchCard, evt);
}

export async function notifySettlementStarted(evt: SettlementStartedEvent): Promise<void> {
  await pgNotify(NOTIFY_CHANNELS.settlementStarted, evt);
}

export async function notifySettlementError(evt: SettlementErrorEvent): Promise<void> {
  await pgNotify(NOTIFY_CHANNELS.settlementError, evt);
}
