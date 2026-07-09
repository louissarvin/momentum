import { ComputeBudgetProgram, type TransactionInstruction } from '@solana/web3.js';

/**
 * Build the two `ComputeBudgetProgram` instructions to prepend to any
 * keeper-signed tx. Defaults chosen to match the settlement smoke-test
 * (600K CU, 1000 microlamports/CU).
 *
 * Auto-escalate policy for retries lives in the settler worker (Phase C):
 *   priority: 1000 -> 5000 -> 25000 microlamports on TransactionExpired.
 */
export function withComputeBudget(
  cuLimit = 600_000,
  microLamportsPrice = 1_000,
): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: microLamportsPrice }),
  ];
}
