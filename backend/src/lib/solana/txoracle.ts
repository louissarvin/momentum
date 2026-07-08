import { Program, type Idl } from '@coral-xyz/anchor';
import txoracleIdl from './idls/txoracle.json' with { type: 'json' };
import { provider } from './program.ts';
import { TXLINE_PROGRAM_ID } from './pdas.ts';

/**
 * Anchor client for the TxLINE / txoracle program. Used later (Phase B)
 * to build the `subscribe(service_level, duration_weeks)` ix during
 * TxLINE auth bootstrap and to construct proof-relative accounts for
 * `settle_prediction` CPIs.
 */
const idl = txoracleIdl as unknown as Idl & { address?: string };

// txoracle IDL ships without an address field; inject the configured one.
(idl as { address: string }).address = TXLINE_PROGRAM_ID.toBase58();

export const txoracleProgram = new Program(idl as Idl, provider);
