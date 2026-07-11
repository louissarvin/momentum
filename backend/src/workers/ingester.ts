#!/usr/bin/env bun
/**
 * TxLINE SSE ingester — Phase B / B.5.
 *
 * Separate Bun process (per doc 13 §6.6 restart isolation). Run with:
 *
 *   bun run worker:ingester
 *
 * Responsibilities:
 *   1. Wait for `TxlineSession` singleton (up to 30s poll) — the HTTP
 *      process's bootstrap owns activation.
 *   2. Open SSE `${TXLINE_BASE_URL}/api/scores/stream` with dual-header
 *      auth. Manual parser (no EventSource — cannot set headers).
 *   3. For each packet: upsert into ScorePacket (unique on fixtureId+seq),
 *      publish via pg NOTIFY, enqueue SettlementJob rows on relevant
 *      actions.
 *   4. Bump `TxlineSession.lastPacketAt` on every packet (heartbeat for
 *      /health).
 *   5. Backoff: 250ms → 4s cap on drops. On 401, call refreshTxline() and
 *      retry. Per-fixture monotonic `seq` tracking is provided by the
 *      unique(fixtureId, seq) constraint (upsert with skipDuplicates
 *      semantics via `create-or-update`).
 *
 * State machine: IDLE → CONNECT → OPEN → (401) REAUTH → (drop) BACKFILL → OPEN
 */

import '../../dotenv.ts';
import { initSentry, captureError } from '../lib/sentry.ts';
initSentry('ingester');

import { env } from '../config/env.ts';
import { prismaQuery } from '../lib/prisma.ts';
import { createSseParser } from '../lib/txline/sse.ts';
import { refreshTxline } from '../lib/txline/refresh.ts';
import { notifyPacket } from '../lib/stream/notify.ts';
import { normalizePacket } from '../lib/txline/normalize.ts';

const STREAM_PATH = '/api/scores/stream';
const HEARTBEAT_INTERVAL_MS = 1000;
const CONNECT_BACKOFF_MIN_MS = 250;
const CONNECT_BACKOFF_MAX_MS = 4000;
const SESSION_WAIT_TOTAL_MS = 30_000;
const SESSION_WAIT_STEP_MS = 500;

interface TxlineCreds {
  jwt: string;
  apiToken: string;
}

async function readCreds(): Promise<TxlineCreds | null> {
  const row = await prismaQuery.txlineSession.findUnique({ where: { id: 1 } });
  if (!row) return null;
  return { jwt: row.jwt, apiToken: row.apiToken };
}

async function waitForCreds(): Promise<TxlineCreds> {
  const deadline = Date.now() + SESSION_WAIT_TOTAL_MS;
  while (Date.now() < deadline) {
    const creds = await readCreds();
    if (creds) return creds;
    await sleep(SESSION_WAIT_STEP_MS);
  }
  throw new Error('TxlineSession not initialized after 30s — is the HTTP process running?');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Actions that we treat as settlement-relevant. This list is intentionally
// generous; Phase C's settler will re-check and no-op on non-matching cards.
const SCORING_ACTIONS = new Set(['goal', 'goal_confirmed', 'red_card', 'yellow_card', 'half_time']);

async function handlePacket(rawStr: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStr);
  } catch (err) {
    console.warn('[Ingester] non-JSON SSE payload; dropping', err);
    return;
  }
  const packet = normalizePacket(parsed);
  if (!packet) return;

  // Ensure Fixture parent row exists (FK requirement). Use minimal columns
  // — a routes-owned fixtures sync will backfill the rest later.
  await prismaQuery.fixture.upsert({
    where: { fixtureId: packet.fixtureId },
    create: {
      fixtureId: packet.fixtureId,
      homeTeam: 'unknown',
      awayTeam: 'unknown',
      statusId: packet.statusId,
      period: packet.period,
    },
    update: {
      statusId: packet.statusId,
      period: packet.period,
    },
  });

  // Idempotent write on (fixtureId, seq). If duplicate, skip enqueue too
  // — we've already seen this seq.
  try {
    await prismaQuery.scorePacket.create({
      data: {
        fixtureId: packet.fixtureId,
        seq: packet.seq,
        ts: packet.ts !== undefined ? BigInt(packet.ts) : null,
        action: packet.action ?? null,
        statusId: packet.statusId ?? null,
        period: packet.period ?? null,
        raw: packet.raw as unknown as object,
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      // Duplicate seq — safe replay path.
      return;
    }
    throw err;
  }

  // Cross-process fanout.
  try {
    await notifyPacket({
      fixtureId: packet.fixtureId,
      seq: packet.seq,
      ts: packet.ts,
      action: packet.action ?? null,
      statusId: packet.statusId ?? null,
      period: packet.period ?? null,
      raw: null, // trimmed for size — subscribers can re-read from DB
    });
  } catch (err) {
    console.warn('[Ingester] pg_notify failed; continuing', err);
  }

  // Classify. NOTE: docs originally said (action='game_finalised' AND
  // statusId=100 AND period=100), but real TxLINE game_finalised packets
  // omit `period` entirely — StatusId=100 alone is the terminal marker
  // (confirmed in Pass 8 backfill of fixture 18237038). Period stays as a
  // secondary check only when present.
  const isFinal =
    packet.action === 'game_finalised' &&
    packet.statusId === 100 &&
    (packet.period === undefined || packet.period === 100);
  if (isFinal) {
    await enqueueJob('match_card', packet.fixtureId, packet.seq, null);
  } else if (packet.action && SCORING_ACTIONS.has(packet.action)) {
    await enqueueJob('settle', packet.fixtureId, packet.seq, packet.action);
  }
}

async function enqueueJob(
  type: 'settle' | 'match_card',
  fixtureId: string,
  seq: number,
  statKey: string | null,
): Promise<void> {
  try {
    await prismaQuery.settlementJob.create({
      data: {
        type,
        fixtureId,
        seq,
        statKey,
        payload: { enqueuedBy: 'ingester', at: new Date().toISOString() },
      },
    });
  } catch (err) {
    console.warn('[Ingester] enqueue failed', err);
  }
}

async function bumpHeartbeat(): Promise<void> {
  try {
    await prismaQuery.txlineSession.update({
      where: { id: 1 },
      data: { lastPacketAt: new Date() },
    });
  } catch (err) {
    // Non-fatal.
    console.warn('[Ingester] heartbeat update failed', err);
  }
}

async function markIngesterStarted(): Promise<void> {
  try {
    await prismaQuery.txlineSession.update({
      where: { id: 1 },
      data: { ingesterStartedAt: new Date() },
    });
  } catch (err) {
    console.warn('[Ingester] ingesterStartedAt update failed', err);
  }
}

/**
 * Open a single SSE connection. Returns when the stream ends or errors.
 * Bumps the last-packet heartbeat every second regardless of packet flow.
 */
async function runOnce(creds: TxlineCreds): Promise<'reauth' | 'reconnect'> {
  const url = `${env.TXLINE_BASE_URL}${STREAM_PATH}`;
  console.log(`[Ingester] CONNECT ${url}`);

  const controller = new AbortController();
  const heartbeat = setInterval(() => void bumpHeartbeat(), HEARTBEAT_INTERVAL_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${creds.jwt}`,
        'X-Api-Token': creds.apiToken,
        'Accept': 'text/event-stream',
        'Accept-Encoding': 'gzip',
      },
      signal: controller.signal,
    });

    if (res.status === 401) {
      console.warn('[Ingester] 401 on stream — triggering refresh');
      return 'reauth';
    }
    if (!res.ok) {
      console.warn(`[Ingester] stream open failed: ${res.status}`);
      return 'reconnect';
    }
    if (!res.body) {
      console.warn('[Ingester] stream body missing');
      return 'reconnect';
    }

    console.log('[Ingester] OPEN — awaiting packets');
    const parser = createSseParser();
    const decoder = new TextDecoder('utf-8');
    const reader = res.body.getReader();

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        console.log('[Ingester] stream closed by server');
        return 'reconnect';
      }
      const chunk = decoder.decode(value, { stream: true });
      const events = parser.push(chunk);
      for (const evt of events) {
        if (!evt.data) continue;
        try {
          await handlePacket(evt.data);
        } catch (err) {
          console.error('[Ingester] handlePacket error', err);
        }
      }
    }
  } catch (err) {
    console.warn('[Ingester] stream fetch error', err);
    return 'reconnect';
  } finally {
    clearInterval(heartbeat);
    controller.abort();
  }
}

async function main(): Promise<void> {
  // Phase E / E.1: don't run the live ingester when replay is active —
  // we would double-emit every packet.
  if (env.REPLAY_MODE) {
    console.warn('[Ingester] REPLAY_MODE=true → skipping live ingester');
    process.exit(0);
  }

  console.log('[Ingester] starting');
  const initial = await waitForCreds();
  await markIngesterStarted();
  let creds: TxlineCreds = initial;
  let backoff = CONNECT_BACKOFF_MIN_MS;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const outcome = await runOnce(creds);
    if (outcome === 'reauth') {
      try {
        await refreshTxline((m) => console.log(m));
        const rotated = await readCreds();
        if (rotated) creds = rotated;
        backoff = CONNECT_BACKOFF_MIN_MS;
      } catch (err) {
        console.error('[Ingester] refresh failed', err);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, CONNECT_BACKOFF_MAX_MS);
      }
    } else {
      // reconnect
      await sleep(backoff);
      backoff = Math.min(backoff * 2, CONNECT_BACKOFF_MAX_MS);
      // Re-read creds each loop in case they rotated externally.
      const latest = await readCreds();
      if (latest) creds = latest;
    }
  }
}

process.on('SIGINT', () => {
  console.log('[Ingester] SIGINT — exiting');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[Ingester] SIGTERM — exiting');
  process.exit(0);
});

main().catch((err) => {
  console.error('[Ingester] fatal', err);
  captureError(err, { component: 'ingester' });
  process.exit(1);
});
