/**
 * TxLINE HTTP client — Phase B / B.3.
 *
 * A shared axios instance keyed against `env.TXLINE_BASE_URL`. Injects both
 * TxLINE auth headers on every request:
 *
 *   Authorization: Bearer <jwt>
 *   X-Api-Token:   <apiToken>
 *
 * Tokens are pulled from the singleton `TxlineSession` row at request time
 * (fresh read every call — safe for a hackathon; a per-process cache could
 * come later). On 401, the interceptor triggers a `refresh()` and retries
 * exactly once.
 *
 * Accept-Encoding is hard-set to `identity` because Bun's zstd
 * decompression is broken on some TxLINE endpoints (documented in
 * txline_quirks memory note).
 */

import axios, {
  type AxiosInstance,
  type InternalAxiosRequestConfig,
  type AxiosResponse,
} from 'axios';
import { env } from '../../config/env.ts';
import { prismaQuery } from '../prisma.ts';

// Guard against import cycle: refresh() lives in refresh.ts which imports
// from client.ts. We resolve it lazily inside the 401 handler.
let refreshFn: (() => Promise<void>) | null = null;
export function registerTxlineRefresher(fn: () => Promise<void>): void {
  refreshFn = fn;
}

async function loadSession(): Promise<{ jwt: string; apiToken: string } | null> {
  const row = await prismaQuery.txlineSession.findUnique({ where: { id: 1 } });
  if (!row) return null;
  return { jwt: row.jwt, apiToken: row.apiToken };
}

export const txlineHttp: AxiosInstance = axios.create({
  baseURL: env.TXLINE_BASE_URL,
  timeout: 20_000,
  headers: {
    'Accept-Encoding': 'identity',
    'Content-Type': 'application/json',
  },
});

txlineHttp.interceptors.request.use(async (cfg: InternalAxiosRequestConfig) => {
  const session = await loadSession();
  if (session) {
    cfg.headers = cfg.headers ?? {};
    // Do not overwrite explicit callers.
    if (!cfg.headers['Authorization']) {
      cfg.headers['Authorization'] = `Bearer ${session.jwt}`;
    }
    if (!cfg.headers['X-Api-Token']) {
      cfg.headers['X-Api-Token'] = session.apiToken;
    }
  }
  return cfg;
});

// Response interceptor: on 401, refresh once and retry the original request.
txlineHttp.interceptors.response.use(
  (r: AxiosResponse) => r,
  async (err: unknown) => {
    // Narrow the error object. Axios errors have a `response` and `config`.
    const anyErr = err as {
      response?: { status?: number };
      config?: InternalAxiosRequestConfig & { __retriedByRefresh?: boolean };
    };
    const status = anyErr.response?.status;
    const cfg = anyErr.config;
    if (status === 401 && cfg && !cfg.__retriedByRefresh && refreshFn) {
      cfg.__retriedByRefresh = true;
      try {
        await refreshFn();
      } catch {
        // If refresh itself fails, surface the original 401 to caller.
        return Promise.reject(err);
      }
      // Clear cached auth headers so the request interceptor injects the
      // freshly rotated ones.
      if (cfg.headers) {
        delete (cfg.headers as Record<string, unknown>)['Authorization'];
        delete (cfg.headers as Record<string, unknown>)['X-Api-Token'];
      }
      return txlineHttp.request(cfg);
    }
    return Promise.reject(err);
  },
);
