/**
 * Sentry initialisation — Phase E / E.5.
 *
 * No-op when SENTRY_DSN is unset. When set, initialises `@sentry/node`
 * with sane defaults and exposes typed helpers for the error handler +
 * worker uncaught-exception paths.
 */

import * as Sentry from '@sentry/node';
import { env } from '../config/env.ts';

let initialised = false;

export function initSentry(component: 'http' | 'ingester' | 'settler' | 'replay'): boolean {
  if (initialised) return true;
  if (!env.SENTRY_DSN) return false;

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: 0.05,
    profilesSampleRate: 0.0,
    initialScope: {
      tags: {
        component,
        cluster: env.SOLANA_CLUSTER,
        programId: env.MOMENTUM_PROGRAM_ID,
      },
    },
  });

  initialised = true;
  return true;
}

export function captureError(
  err: unknown,
  tags: Record<string, string | number | undefined> = {},
): void {
  if (!initialised) return;
  Sentry.withScope((scope) => {
    for (const [k, v] of Object.entries(tags)) {
      if (v !== undefined) scope.setTag(k, String(v));
    }
    Sentry.captureException(err);
  });
}

export function isSentryActive(): boolean {
  return initialised;
}

export { Sentry };
