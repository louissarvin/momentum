#!/usr/bin/env bun
/**
 * set-tree-delegate.ts — Hands off the Bubblegum tree delegate to Momentum's
 * mint_auth PDA so `settle_prediction` / `claim_match_card` mint CPIs succeed.
 *
 * The tree was created with `treeCreator = admin` (per `scripts/create-tree.ts`).
 * Bubblegum's `MintV1` / `MintToCollectionV1` require the current
 * `tree_creator_or_delegate` to sign; Momentum expects that signer to be its
 * own `mint_auth` PDA (`[b"mint_auth"]`). This ix is admin-signed and moves
 * the on-chain delegate over.
 *
 * Usage:
 *   bun run scripts/set-tree-delegate.ts \
 *     [--tree <TREE_PUBKEY>] \
 *     [--cluster localnet|devnet] \
 *     [--keypair <path>] \
 *     [--program-id <pubkey>]
 *
 * Defaults:
 *   --tree       2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX (devnet)
 *   --cluster    devnet
 *   --keypair    ~/.config/solana/id.json
 *   --program-id 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT
 *
 * Verifies the delegate post-tx by fetching tree_config and decoding the
 * `tree_delegate` field via `fetchTreeConfigFromSeeds`.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PublicKey } from "@solana/web3.js";
import {
  setTreeDelegate,
  mplBubblegum,
  fetchTreeConfigFromSeeds,
  MPL_BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createSignerFromKeypair,
  keypairIdentity,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

const DEFAULT_PROGRAM_ID = "39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT";
const DEFAULT_TREE = "2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX";

type Args = {
  tree: string;
  cluster: "localnet" | "devnet";
  keypair: string;
  programId: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    tree: DEFAULT_TREE,
    cluster: "devnet",
    keypair: join(homedir(), ".config", "solana", "id.json"),
    programId: DEFAULT_PROGRAM_ID,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tree") {
      out.tree = argv[++i];
    } else if (a === "--cluster") {
      const v = argv[++i];
      if (v !== "localnet" && v !== "devnet") {
        throw new Error(`--cluster must be localnet|devnet (got ${v})`);
      }
      out.cluster = v;
    } else if (a === "--keypair") {
      out.keypair = argv[++i];
    } else if (a === "--program-id") {
      out.programId = argv[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: bun run scripts/set-tree-delegate.ts [--tree PUBKEY] [--cluster localnet|devnet] [--keypair PATH] [--program-id PUBKEY]`,
      );
      process.exit(0);
    }
  }
  return out;
}

function loadKeypairBytes(path: string): Uint8Array {
  if (!existsSync(path)) throw new Error(`Keypair not found at ${path}`);
  return new Uint8Array(JSON.parse(readFileSync(path, "utf8")));
}

function clusterEndpoint(cluster: "localnet" | "devnet"): string {
  return cluster === "localnet"
    ? "http://127.0.0.1:8899"
    : "https://api.devnet.solana.com";
}

function explorerUrl(sig: string, cluster: "localnet" | "devnet"): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "?cluster=custom";
  return `https://explorer.solana.com/tx/${sig}${suffix}`;
}

function solscanUrl(sig: string, cluster: "localnet" | "devnet"): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${sig}${suffix}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);

  const umi = createUmi(endpoint).use(mplBubblegum());
  const secret = loadKeypairBytes(args.keypair);
  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  const admin = createSignerFromKeypair(umi, kp);
  umi.use(keypairIdentity(admin));

  const programId = new PublicKey(args.programId);
  const treePk = new PublicKey(args.tree);
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth")],
    programId,
  );
  const [treeConfigPda] = PublicKey.findProgramAddressSync(
    [treePk.toBuffer()],
    new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID.toString()),
  );

  console.log("Setting Bubblegum tree delegate...");
  console.log(`  cluster         : ${args.cluster} (${endpoint})`);
  console.log(`  admin (signer)  : ${admin.publicKey}`);
  console.log(`  program id      : ${programId.toBase58()}`);
  console.log(`  tree            : ${treePk.toBase58()}`);
  console.log(`  tree_config PDA : ${treeConfigPda.toBase58()}`);
  console.log(`  new delegate    : ${mintAuthPda.toBase58()} (mint_auth PDA)`);
  console.log("");

  // Pre-check: dump current delegate so the operator sees the before-state.
  try {
    const cfgBefore = await fetchTreeConfigFromSeeds(umi, {
      merkleTree: umiPk(treePk.toBase58()),
    });
    console.log(`  before: tree_creator = ${cfgBefore.treeCreator}`);
    console.log(`  before: tree_delegate = ${cfgBefore.treeDelegate}`);
  } catch (e) {
    console.warn(`  (could not fetch tree_config pre-tx: ${(e as Error).message})`);
  }

  const builder = setTreeDelegate(umi, {
    merkleTree: umiPk(treePk.toBase58()),
    treeCreator: admin,
    newTreeDelegate: umiPk(mintAuthPda.toBase58()),
  });

  const result = await builder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });

  // Umi returns the signature as a Uint8Array (raw bytes). Encode as base58 for
  // Explorer / Solscan links. Solana web3.js has no shipped helper for this;
  // pull in a small inline base58 encoder.
  const sigBase58 = bs58encode(result.signature);
  console.log("");
  console.log(`Success. tx signature: ${sigBase58}`);
  console.log(`Explorer: ${explorerUrl(sigBase58, args.cluster)}`);
  console.log(`Solscan : ${solscanUrl(sigBase58, args.cluster)}`);

  // Post-check: confirm the delegate flipped. Re-create umi so the RPC read
  // isn't served from any stale cache and uses finalized commitment.
  const verifyUmi = createUmi(endpoint, { commitment: "finalized" }).use(
    mplBubblegum(),
  );
  const cfgAfter = await fetchTreeConfigFromSeeds(verifyUmi, {
    merkleTree: umiPk(treePk.toBase58()),
  });
  console.log("");
  console.log("== Post-tx tree_config ==");
  console.log(`  tree_creator  : ${cfgAfter.treeCreator}`);
  console.log(`  tree_delegate : ${cfgAfter.treeDelegate}`);

  if (cfgAfter.treeDelegate.toString() !== mintAuthPda.toBase58()) {
    throw new Error(
      `Verification failed: tree_delegate=${cfgAfter.treeDelegate} expected ${mintAuthPda.toBase58()}`,
    );
  }
  console.log("  verification  : OK (delegate = mint_auth PDA)");

  console.log(`::tree=${treePk.toBase58()}`);
  console.log(`::treeConfig=${treeConfigPda.toBase58()}`);
  console.log(`::mintAuth=${mintAuthPda.toBase58()}`);
  console.log(`::tx=${sigBase58}`);
}

// Minimal base58 encoder for tx signatures (avoids adding a new dep).
function bs58encode(bytes: Uint8Array): string {
  const ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const size = Math.ceil(((bytes.length - zeros) * 138) / 100) + 1;
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    let j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    length = j;
  }
  let it = size - length;
  while (it < size && b58[it] === 0) it++;
  let str = "1".repeat(zeros);
  for (; it < size; it++) str += ALPHABET[b58[it]];
  return str;
}

main().catch((err) => {
  console.error("set-tree-delegate failed:", err);
  process.exit(1);
});
