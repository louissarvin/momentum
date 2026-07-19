/**
 * Central environment schema for the Momentum backend.
 *
 * All process.env access happens ONCE here — every other module imports
 * the typed `env` object. Fail-fast on invalid/missing configuration.
 *
 * Follows OWASP Secrets Management guidance (validate at boot; never read
 * secrets ad-hoc from process.env at runtime).
 */

import { z } from 'zod';

// ---------- helpers ----------

const parseBool = (v: unknown): boolean => {
  if (typeof v === 'boolean') return v;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

// ---------- schema ----------

const EnvSchema = z.object({
  // App
  APP_PORT: z.coerce.number().int().positive().default(3700),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // Database
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),

  // Session / auth
  SESSION_JWT_SECRET: z.string().min(32, 'SESSION_JWT_SECRET must be at least 32 characters'),
  SESSION_JWT_EXPIRES_IN: z.string().default('24h'),

  // CORS
  FRONTEND_URL: z.string().default('http://localhost:5173'),

  // Solana
  SOLANA_RPC_URL: z.string().url().default('https://api.devnet.solana.com'),
  SOLANA_CLUSTER: z.enum(['devnet', 'mainnet', 'testnet', 'localnet']).default('devnet'),
  MOMENTUM_PROGRAM_ID: z.string().default('39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT'),
  TXLINE_PROGRAM_ID: z.string().default('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J'),
  TXLINE_BASE_URL: z.string().url().default('https://txline-dev.txodds.com'),

  // Keeper (path OR raw JSON — validated below)
  KEEPER_KEYPAIR_PATH: z.string().optional(),
  KEEPER_SECRET_JSON: z.string().optional(),

  // Optional
  HELIUS_API_KEY: z.string().optional(),
  METADATA_HOST: z.string().url().default('https://cdn.momentum.app'),
  SENTRY_DSN: z.string().url().optional(),

  // Telegram companion bot (all optional — if TELEGRAM_BOT_TOKEN is unset
  // the plugin silently no-ops so a fresh env still boots cleanly).
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),
  TELEGRAM_GROUP_CHAT_ID: z.string().min(1).optional(),
  // Shared secret protecting POST /api/notify/telegram (settler → HTTP).
  // Enforced min 16 chars ONLY when provided.
  NOTIFY_SHARED_SECRET: z.string().min(16, 'NOTIFY_SHARED_SECRET must be at least 16 characters').optional(),
  // Absolute base URL the settler uses to POST notifications back to this
  // process. Defaults to http://localhost:${APP_PORT} at runtime.
  BACKEND_INTERNAL_URL: z.string().url().optional(),
  // Public Solscan cluster query param (?cluster=devnet). Defaults derived
  // from SOLANA_CLUSTER.
  SOLSCAN_CLUSTER: z.enum(['devnet', 'mainnet-beta', 'testnet']).optional(),

  // Replay mode (Phase E / E.1)
  REPLAY_MODE: z.preprocess(parseBool, z.boolean()).default(false),
  REPLAY_FIXTURE_ID: z.string().optional(),
  REPLAY_SPEED: z.coerce.number().positive().default(5),
  REPLAY_START_SEQ: z.coerce.number().int().nonnegative().default(1),
  REPLAY_END_SEQ: z.coerce.number().int().positive().default(Number.MAX_SAFE_INTEGER),

  // Feature flags (Phase E / E.3) — MOMENTUM_FF_* prefix
  MOMENTUM_FF_KORA: z.preprocess(parseBool, z.boolean()).default(false),
  MOMENTUM_FF_TURNKEY: z.preprocess(parseBool, z.boolean()).default(false),
  MOMENTUM_FF_BLINKS: z.preprocess(parseBool, z.boolean()).default(true),
  MOMENTUM_FF_SETTLER: z.preprocess(parseBool, z.boolean()).default(true),
  MOMENTUM_FF_HELIUS_DAS: z.preprocess(parseBool, z.boolean()).optional(),
});

// ---------- parse + validate ----------

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  // eslint-disable-next-line no-console
  console.error(`\nFATAL: Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

// Cross-field: at least one keeper source in non-test environments.
// Defaulted to `~/.config/solana/id.json` if neither is set, matching Solana CLI conventions.
if (!raw.KEEPER_KEYPAIR_PATH && !raw.KEEPER_SECRET_JSON) {
  raw.KEEPER_KEYPAIR_PATH = '~/.config/solana/id.json';
}

export const env = Object.freeze({
  ...raw,
  IS_DEV: raw.NODE_ENV === 'development',
  IS_PROD: raw.NODE_ENV === 'production',
  IS_TEST: raw.NODE_ENV === 'test',
});

export type Env = typeof env;
