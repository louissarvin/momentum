/**
 * Lightweight per-process idempotency cache.
 *
 * Used on POST routes that build+return unsigned transactions (predictions,
 * groups, marketplace) so a client that retries with the same
 * `Idempotency-Key` header inside the TTL window gets the exact same
 * response and does not double-derive PDAs / re-charge rent estimates.
 *
 * NOT a replacement for on-chain idempotency (Anchor `init` reverts on
 * dupes). This exists purely to smooth over network retries on the
 * pre-signature roundtrip.
 *
 * Prod hardening (deferred): swap the in-process Map for Redis / Postgres
 * table if we scale beyond one Bun process for the HTTP tier.
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5_000;

interface CachedResponse {
  status: number;
  body: unknown;
  storedAt: number;
}

const cache = new Map<string, CachedResponse>();

function reapExpired(): void {
  if (cache.size < MAX_ENTRIES / 2) return;
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of cache) {
    if (v.storedAt < cutoff) cache.delete(k);
  }
}

/**
 * Compose the cache key from the raw Idempotency-Key header plus the
 * caller context (path + user id). Two different users cannot collide on
 * the same key by accident.
 */
export function idempotencyCacheKey(
  headerKey: string,
  scope: string,
): string {
  return `${scope}::${headerKey}`;
}

export function getIdempotent(key: string): CachedResponse | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.storedAt > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit;
}

export function setIdempotent(key: string, status: number, body: unknown): void {
  reapExpired();
  if (cache.size >= MAX_ENTRIES) {
    // Simple eviction: drop the first entry (Map preserves insertion order).
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { status, body, storedAt: Date.now() });
}

/**
 * Extract & validate the `Idempotency-Key` header. Accepts null when the
 * caller does not send one — routes are free to require it or not.
 */
export function readIdempotencyHeader(headers: Record<string, unknown>): string | null {
  const raw = headers['idempotency-key'] ?? headers['Idempotency-Key'];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length < 8 || trimmed.length > 200) return null;
  // Only allow url-safe chars to avoid weirdness in the cache key.
  if (!/^[A-Za-z0-9._~\-:]+$/.test(trimmed)) return null;
  return trimmed;
}
