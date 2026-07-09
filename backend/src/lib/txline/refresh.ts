/**
 * TxLINE JWT refresh — Phase B / B.3.
 *
 * Called by the axios interceptor in client.ts on HTTP 401, and manually by
 * the ingester when the JWT is within N hours of `jwtExpiresAt`. Skips the
 * on-chain subscribe step — the subscription is already active on-chain.
 */

import { keeper } from '../solana/keeper.ts';
import { connection } from '../solana/connection.ts';
import { bootstrapTxline } from './bootstrap.ts';

let inFlight: Promise<void> | null = null;

/**
 * Serialized: concurrent callers coalesce into a single refresh attempt.
 */
export async function refreshTxline(log?: (msg: string) => void): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      await bootstrapTxline({ connection, keeper, refreshOnly: true, log });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
