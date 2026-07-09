/**
 * Normalize TxLINE packet field naming.
 *
 * The `/api/scores/updates/...` REST endpoint returns PascalCase field
 * names (FixtureId, Seq, Ts, Action, StatusId, Period). The live SSE
 * stream (per the TxLINE docs sample and reference scripts) also uses
 * PascalCase in most payloads. This helper flattens both PascalCase and
 * camelCase into a single lowercase-key shape the ingester and backfill
 * can consume.
 *
 * Non-owned fields are preserved by returning the original object as
 * `raw` so nothing is lost.
 */

export interface NormalizedPacket {
  fixtureId: string;
  seq: number;
  ts?: number;
  action?: string;
  statusId?: number;
  period?: number;
  raw: unknown;
}

function pick<T>(obj: Record<string, unknown>, keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k] as T;
  }
  return undefined;
}

/**
 * Returns null when the packet does not have both a fixture id and a seq
 * — those are our idempotency key, so a packet without them is useless.
 */
export function normalizePacket(raw: unknown): NormalizedPacket | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const fixtureId = pick<string | number>(o, ['fixtureId', 'FixtureId', 'fixture_id']);
  const seq = pick<number>(o, ['seq', 'Seq']);
  if (fixtureId === undefined || seq === undefined) return null;

  const ts = pick<number>(o, ['ts', 'Ts', 'timestamp']);
  const action = pick<string>(o, ['action', 'Action']);
  const statusId = pick<number>(o, ['statusId', 'StatusId', 'status_id']);
  const period = pick<number>(o, ['period', 'Period']);

  return {
    fixtureId: String(fixtureId),
    seq: Number(seq),
    ts: ts !== undefined ? Number(ts) : undefined,
    action: action !== undefined ? String(action) : undefined,
    statusId: statusId !== undefined ? Number(statusId) : undefined,
    period: period !== undefined ? Number(period) : undefined,
    raw,
  };
}
