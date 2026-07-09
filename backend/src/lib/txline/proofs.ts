/**
 * TxLINE proof helpers — Phase B / B.3.
 *
 * Thin wrappers around the axios client (client.ts) for the endpoints the
 * settler and backfill scripts rely on. All calls go through the shared
 * axios instance so the auth interceptor and 401-refresh apply.
 */

import { txlineHttp } from './client.ts';

export interface StatValidationProof {
  raw: unknown;
  summary?: {
    updateStats?: {
      minTimestamp?: number;
      maxTimestamp?: number;
    };
  };
  [k: string]: unknown;
}

/**
 * `stat-validation-v3` — the canonical proof payload the on-chain
 * settler consumes. Keyed on (fixtureId, seq, statKey).
 */
export async function fetchStatValidation(
  fixtureId: string | number,
  seq: number,
  statKey: string,
): Promise<StatValidationProof> {
  const path = `/api/proof/stat-validation-v3/${fixtureId}/${seq}/${encodeURIComponent(statKey)}`;
  const { data } = await txlineHttp.get<StatValidationProof>(path);
  return data;
}

/**
 * Latest score snapshot for a fixture.
 */
export async function fetchScoresSnapshot(fixtureId: string | number): Promise<unknown> {
  const { data } = await txlineHttp.get(`/api/scores/${fixtureId}`);
  return data;
}

/**
 * Historical batch endpoint — the Pass 8 "winning" endpoint used for
 * backfill when the live stream is quiet.
 * Format: /api/scores/updates/{epochDay}/{hour}/{intervalMin}
 */
export async function fetchScoresUpdates(
  epochDay: number,
  hour: number,
  intervalMin: number,
): Promise<unknown> {
  const { data } = await txlineHttp.get(
    `/api/scores/updates/${epochDay}/${hour}/${intervalMin}`,
  );
  return data;
}
