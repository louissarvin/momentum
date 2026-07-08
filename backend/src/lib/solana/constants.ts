/**
 * Deployed devnet program IDs, PDAs, and reusable settlement infra.
 * Sourced from Pass 8 smoke-test verification + `momentum_contract/scripts/smoke-test.ts`.
 */

import { PublicKey } from '@solana/web3.js';

// ---- external programs ----

export const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY',
);

export const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey(
  'cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK',
);

export const SPL_NOOP_ID = new PublicKey(
  'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV',
);

export const MPL_TOKEN_METADATA_ID = new PublicKey(
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
);

// ---- Momentum deployed collection artifacts (Pass 6+7) ----

export const MERKLE_TREE = new PublicKey(
  '2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX',
);

export const TREE_CONFIG_PDA = new PublicKey(
  'FH11cU3FJZGyutv6DKynbncjnkK8aTf1NwCBQD1cCfdc',
);

export const TREE_STATE_PDA = new PublicKey(
  '9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr',
);

export const COLLECTION_STATE_PDA = new PublicKey(
  'Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj',
);

export const COLLECTION_MINT = new PublicKey(
  'CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg',
);

export const COLLECTION_METADATA = new PublicKey(
  'm82nwvqoxZ27LnfjeMzCGe7j1XsQQMdHTWhm4C6vk3D',
);

export const COLLECTION_EDITION = new PublicKey(
  'Fen6DcmpQK6gkFYqom8BuSCEps54X9shY763XyLU56tL',
);

export const MINT_AUTH_PDA = new PublicKey(
  'FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41',
);

/** Pre-provisioned Address Lookup Table for settle_prediction (Pass 8). */
export const SETTLE_ALT_ADDRESS = new PublicKey(
  'E6HMUAQswijWbVDAz2L884y9QbTmqj96Tt9VKky1rLH9',
);

/** Bubblegum `collection_cpi` PDA — well-known helper. */
export const BUBBLEGUM_SIGNER_PDA = PublicKey.findProgramAddressSync(
  [Buffer.from('collection_cpi')],
  BUBBLEGUM_PROGRAM_ID,
)[0];
