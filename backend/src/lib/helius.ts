/**
 * Thin Helius DAS RPC wrapper — reads cNFTs owned by a wallet.
 *
 * Docs: https://www.helius.dev/docs/das-api. We only need
 * `getAssetsByOwner` and `getAsset` for the Album view.
 *
 * If `HELIUS_API_KEY` is unset the caller should fall back to the on-chain
 * `StickerMint` mirror in Prisma.
 */

import { env } from '../config/env.ts';

const HELIUS_DEVNET = 'https://devnet.helius-rpc.com';
const HELIUS_MAINNET = 'https://mainnet.helius-rpc.com';
/** Free public DAS-compatible endpoint (Triton rpcpool) — used as a
 *  no-API-key fallback on devnet only. Rate-limited; not for prod. */
const RPCPOOL_DEVNET = 'https://devnet.rpcpool.com';

function endpoint(): { url: string; needsKey: boolean } {
  if (env.HELIUS_API_KEY) {
    const base = env.SOLANA_CLUSTER === 'mainnet' ? HELIUS_MAINNET : HELIUS_DEVNET;
    return { url: `${base}/?api-key=${encodeURIComponent(env.HELIUS_API_KEY)}`, needsKey: false };
  }
  // No key — fall back to rpcpool devnet. Mainnet requires a real key.
  if (env.SOLANA_CLUSTER !== 'devnet') {
    return { url: HELIUS_MAINNET, needsKey: true };
  }
  return { url: RPCPOOL_DEVNET, needsKey: false };
}

/**
 * True whenever DAS calls should succeed. Includes the rpcpool devnet
 * fallback path so marketplace/album still work without an API key on
 * devnet — the tradeoff is stricter rate limits.
 */
export function heliusAvailable(): boolean {
  if (env.HELIUS_API_KEY) return true;
  return env.SOLANA_CLUSTER === 'devnet';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc(method: string, params: unknown): Promise<any> {
  const ep = endpoint();
  if (ep.needsKey) throw new Error('HELIUS_API_KEY required for this cluster');
  const res = await fetch(ep.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'identity' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'momentum', method, params }),
  });
  if (!res.ok) {
    throw new Error(`DAS ${method} failed: ${res.status}`);
  }
  const body = (await res.json()) as { error?: unknown; result?: unknown };
  if (body.error) {
    throw new Error(`DAS ${method} error: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

export interface DasAsset {
  id: string;
  content?: {
    metadata?: { name?: string; symbol?: string };
    json_uri?: string;
    files?: Array<{ uri?: string; cdn_uri?: string; mime?: string }>;
    links?: { image?: string };
  };
  ownership?: { owner?: string };
  compression?: { compressed?: boolean; tree?: string; leaf_id?: number };
  grouping?: Array<{ group_key?: string; group_value?: string }>;
  [k: string]: unknown;
}

export async function getAssetsByOwner(
  owner: string,
  page = 1,
  limit = 100,
): Promise<{ items: DasAsset[]; total: number; limit: number; page: number }> {
  return await rpc('getAssetsByOwner', {
    ownerAddress: owner,
    page,
    limit,
    displayOptions: { showCollectionMetadata: true },
  });
}

export async function getAsset(assetId: string): Promise<DasAsset> {
  return await rpc('getAsset', { id: assetId });
}

export interface DasAssetProof {
  root: string;         // base58 32-byte
  proof: string[];      // base58 32-byte each; canopy already trimmed by DAS
  node_index: number;
  leaf: string;         // base58 32-byte (leaf hash)
  tree_id: string;      // base58 tree pubkey
}

export async function getAssetProof(assetId: string): Promise<DasAssetProof> {
  return await rpc('getAssetProof', { id: assetId });
}
