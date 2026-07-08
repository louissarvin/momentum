import { AnchorProvider, Program, Wallet, type Idl } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import momentumIdl from './idls/momentum.json' with { type: 'json' };
import { connection } from './connection.ts';
import { keeper } from './keeper.ts';
import { MOMENTUM_PROGRAM_ID } from './pdas.ts';

/**
 * Anchor provider with the keeper as fee-payer. User-signed txs (create_group,
 * join_group, submit_predictions, marketplace) build unsigned instructions
 * and set feePayer to the caller; they DO NOT sign as keeper.
 */
export const provider = new AnchorProvider(
  connection,
  new Wallet(keeper),
  { commitment: 'confirmed', preflightCommitment: 'confirmed' },
);

/**
 * Anchor 0.32 `Program` constructor signature is `new Program(idl, provider)`
 * — the program ID is read from `idl.address`. We assert the bundled IDL
 * matches the configured `MOMENTUM_PROGRAM_ID` env value to catch a
 * misconfigured deployment early.
 */
const idl = momentumIdl as unknown as Idl & { address?: string };
if (idl.address && idl.address !== MOMENTUM_PROGRAM_ID.toBase58()) {
  throw new Error(
    `IDL/env program id mismatch: idl.address=${idl.address} vs MOMENTUM_PROGRAM_ID=${MOMENTUM_PROGRAM_ID.toBase58()}`,
  );
}

// Ensure the runtime IDL address matches the env config (defensive; some
// downstream Anchor code paths read idl.address directly).
(idl as { address: string }).address = MOMENTUM_PROGRAM_ID.toBase58();

export const momentumProgram = new Program(idl as Idl, provider);

export const MOMENTUM_ID: PublicKey = MOMENTUM_PROGRAM_ID;
