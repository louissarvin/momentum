import { Connection } from '@solana/web3.js';
import { env } from '../../config/env.ts';

/**
 * Single shared Solana `Connection`. `confirmed` commitment matches the
 * smoke-test settler reference and gives us fast enough visibility for
 * both read and keeper-write paths.
 */
export const connection = new Connection(env.SOLANA_RPC_URL, {
  commitment: 'confirmed',
});
