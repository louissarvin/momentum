import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { env } from '../../config/env.ts';

/**
 * Load the keeper `Keypair` from either a Solana CLI keyfile path
 * (`KEEPER_KEYPAIR_PATH`) or a stringified JSON array
 * (`KEEPER_SECRET_JSON`).
 *
 * Both formats are the standard 64-byte `secretKey` byte array
 * as written by `solana-keygen new`.
 *
 * NEVER log the secret. Never accept it from user input.
 */
function loadKeeper(): Keypair {
  // Production / containerised (Railway, Fly, Docker): use the env var.
  // Local dev: fall back to the Solana CLI keyfile path.
  const rawJson = env.KEEPER_SECRET_JSON;
  if (rawJson && rawJson.trim().length > 0) {
    try {
      const arr = JSON.parse(rawJson) as number[];
      if (!Array.isArray(arr) || arr.length !== 64) {
        throw new Error(`KEEPER_SECRET_JSON must be a 64-length JSON array (got length ${Array.isArray(arr) ? arr.length : typeof arr})`);
      }
      return Keypair.fromSecretKey(Uint8Array.from(arr));
    } catch (err) {
      throw new Error(
        `Failed to parse KEEPER_SECRET_JSON: ${(err as Error).message}. ` +
        `Expected the exact contents of ~/.config/solana/id.json (a JSON array of 64 numbers).`,
      );
    }
  }

  const rawPath = env.KEEPER_KEYPAIR_PATH;
  if (!rawPath) {
    throw new Error(
      'No keeper credentials configured. Set either:\n' +
      '  - KEEPER_SECRET_JSON (a JSON array of 64 numbers, for containerised/production deploys), or\n' +
      '  - KEEPER_KEYPAIR_PATH (a filesystem path, for local dev).\n' +
      'Extract the JSON array from a Solana CLI keyfile with: cat ~/.config/solana/id.json',
    );
  }

  const expanded = rawPath.startsWith('~')
    ? resolve(homedir(), rawPath.slice(rawPath.startsWith('~/') ? 2 : 1))
    : resolve(rawPath);

  let content: string;
  try {
    content = readFileSync(expanded, 'utf-8');
  } catch (err) {
    throw new Error(
      `Keeper keyfile not found at ${expanded}. ` +
      `If deploying to Railway/Fly/Docker, set KEEPER_SECRET_JSON instead: ` +
      `paste the output of \`cat ~/.config/solana/id.json\` (a JSON array of 64 numbers) ` +
      `as the env var value. Original error: ${(err as Error).message}`,
    );
  }

  const arr = JSON.parse(content) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export const keeper: Keypair = loadKeeper();
