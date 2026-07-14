import { createEnv } from '@t3-oss/env-core'
import { z } from 'zod'

export const env = createEnv({
  server: {
    SERVER_URL: z.string().url().optional(),
  },

  clientPrefix: 'VITE_',

  client: {
    VITE_APP_TITLE: z.string().min(1).optional(),
    VITE_API_URL: z.string().url().default('http://localhost:3700'),
    VITE_SOLANA_RPC_URL: z
      .string()
      .url()
      .default('https://api.devnet.solana.com'),
    VITE_SOLANA_CLUSTER: z.enum(['devnet', 'mainnet-beta']).default('devnet'),
    VITE_MOMENTUM_PROGRAM_ID: z
      .string()
      .default('39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT'),
    VITE_TREE: z
      .string()
      .default('2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX'),
    VITE_COLLECTION_MINT: z
      .string()
      .default('CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg'),
    VITE_APP_URL: z.string().url().default('http://localhost:3200'),
  },

  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
})
