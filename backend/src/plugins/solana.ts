import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Connection, Keypair } from '@solana/web3.js';
import type { Program } from '@coral-xyz/anchor';

import { connection } from '../lib/solana/connection.ts';
import { keeper } from '../lib/solana/keeper.ts';
import { momentumProgram } from '../lib/solana/program.ts';
import { txoracleProgram } from '../lib/solana/txoracle.ts';
import * as pdas from '../lib/solana/pdas.ts';
import { withComputeBudget } from '../lib/solana/compute-budget.ts';

export interface SolanaContext {
  connection: Connection;
  keeper: Keypair;
  momentum: Program;
  txoracle: Program;
  pdas: typeof pdas;
  withComputeBudget: typeof withComputeBudget;
}

declare module 'fastify' {
  interface FastifyInstance {
    solana: SolanaContext;
  }
}

/**
 * Fastify plugin that decorates the app with a shared Solana context.
 * Wrapped in `fastify-plugin` so the decorator escapes plugin scope and
 * is visible to every route.
 */
const solanaPlugin: FastifyPluginAsync = async (app) => {
  const ctx: SolanaContext = {
    connection,
    keeper,
    momentum: momentumProgram,
    txoracle: txoracleProgram,
    pdas,
    withComputeBudget,
  };

  app.decorate('solana', ctx);

  app.log.info(
    {
      cluster: process.env.SOLANA_CLUSTER,
      programId: momentumProgram.programId.toBase58(),
      keeper: keeper.publicKey.toBase58(),
    },
    'Solana context ready',
  );
};

export default fp(solanaPlugin, {
  name: 'solana',
});
