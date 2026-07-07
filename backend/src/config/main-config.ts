/**
 * Centralized configuration re-exports.
 *
 * The real validated env lives in `./env.ts` (Zod-parsed, fail-fast).
 * This file preserves the legacy named exports the starter code and
 * `backend/CLAUDE.md` documented so existing modules keep working.
 *
 * Prefer importing `env` from './env.ts' directly in new code.
 */

import { env } from './env.ts';

export { env };

// --- Legacy named exports (preserved for backwards compatibility) ---

export const APP_PORT: number = env.APP_PORT;
export const NODE_ENV: string = env.NODE_ENV;
export const IS_DEV: boolean = env.IS_DEV;
export const IS_PROD: boolean = env.IS_PROD;

export const DATABASE_URL: string = env.DATABASE_URL;

/**
 * @deprecated use `env.SESSION_JWT_SECRET`. Kept so existing modules that
 * import `JWT_SECRET` keep compiling until they are migrated.
 */
export const JWT_SECRET: string = env.SESSION_JWT_SECRET;
export const JWT_EXPIRES_IN: string = env.SESSION_JWT_EXPIRES_IN;

// Error log worker config (unchanged from starter)
export const ERROR_LOG_MAX_RECORDS: number = 10000;
export const ERROR_LOG_CLEANUP_INTERVAL: string = '0 * * * *';

export default {
  APP_PORT,
  NODE_ENV,
  IS_DEV,
  IS_PROD,
  DATABASE_URL,
  JWT_SECRET,
  JWT_EXPIRES_IN,
  ERROR_LOG_MAX_RECORDS,
  ERROR_LOG_CLEANUP_INTERVAL,
};
