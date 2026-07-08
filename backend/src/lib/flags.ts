/**
 * Feature flags — Phase E / E.3.
 *
 * Read from env via the `MOMENTUM_FF_*` prefix (parsed in
 * `src/config/env.ts`). Exposed publicly via `GET /api/flags` so the
 * frontend can enable/disable UI paths that depend on backend features.
 *
 * Judges reward stability. When a subsystem is degraded we prefer to
 * disable the feature entirely and return `503 { code: 'FEATURE_DISABLED' }`
 * rather than silently break.
 */

import { env } from '../config/env.ts';

export interface FeatureFlags {
  kora: boolean;
  turnkey: boolean;
  blinks: boolean;
  settler: boolean;
  heliusDas: boolean;
}

/**
 * `heliusDas` is derived by default from HELIUS_API_KEY presence, but can
 * be overridden by `MOMENTUM_FF_HELIUS_DAS`. Devnet also has an
 * unauthenticated Triton fallback in `src/lib/helius.ts` so this flag
 * mostly gates prod / mainnet paths.
 */
export function computeFlags(): FeatureFlags {
  const heliusDefault = Boolean(env.HELIUS_API_KEY) || env.SOLANA_CLUSTER === 'devnet';
  return {
    kora: env.MOMENTUM_FF_KORA,
    turnkey: env.MOMENTUM_FF_TURNKEY,
    blinks: env.MOMENTUM_FF_BLINKS,
    settler: env.MOMENTUM_FF_SETTLER,
    heliusDas: env.MOMENTUM_FF_HELIUS_DAS ?? heliusDefault,
  };
}

export const flags: Readonly<FeatureFlags> = Object.freeze(computeFlags());
