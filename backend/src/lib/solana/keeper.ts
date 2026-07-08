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
  const rawJson = env.KEEPER_SECRET_JSON;
  if (rawJson && rawJson.trim().length > 0) {
    const arr = JSON.parse(rawJson) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(arr));
  }

  const rawPath = env.KEEPER_KEYPAIR_PATH;
  if (!rawPath) {
    throw new Error('Neither KEEPER_KEYPAIR_PATH nor KEEPER_SECRET_JSON is set');
  }

  const expanded = rawPath.startsWith('~')
    ? resolve(homedir(), rawPath.slice(rawPath.startsWith('~/') ? 2 : 1))
    : resolve(rawPath);

  const content = readFileSync(expanded, 'utf-8');
  const arr = JSON.parse(content) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(arr));
}

export const keeper: Keypair = loadKeeper();
