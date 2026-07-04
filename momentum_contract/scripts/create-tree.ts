#!/usr/bin/env bun
/**
 * create-tree.ts — Bootstraps the Momentum Bubblegum tree.
 *
 * Creates a compressed-NFT tree (maxDepth=14, maxBufferSize=64, canopyDepth=8
 *  -> 16,384 leaves, canopy shrinks proof paths to 6 accounts per transfer)
 * with `public: false` so only the Momentum program's `mint_auth` PDA
 * (as tree delegate) can mint into it.
 *
 * Usage:
 *   bun run scripts/create-tree.ts \
 *     [--cluster localnet|devnet] \
 *     [--keypair <path>] \
 *     [--program-id <pubkey>]
 *
 * Defaults:
 *   --cluster    devnet
 *   --keypair    ~/.config/solana/id.json
 *   --program-id 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT (Momentum devnet)
 *
 * Prints the created tree pubkey + tree config PDA and the follow-up command
 * for the operator to run. Does NOT call `initialize_tree_state` — that
 * bootstrap step is admin-signed and gated on the ADMIN key configured in
 * `programs/momentum/src/instructions/initialize_tree_state.rs`.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PublicKey } from "@solana/web3.js";
import {
  createTree,
  mplBubblegum,
  MPL_BUBBLEGUM_PROGRAM_ID,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  generateSigner,
  createSignerFromKeypair,
  keypairIdentity,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

// ---- CLI arg parsing ------------------------------------------------------

type Args = { cluster: "localnet" | "devnet"; keypair: string; programId: string };

function parseArgs(argv: string[]): Args {
  const out: Args = {
    cluster: "devnet",
    keypair: join(homedir(), ".config", "solana", "id.json"),
    programId: "39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cluster") {
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
      console.log(`Usage: bun run scripts/create-tree.ts [--cluster localnet|devnet] [--keypair PATH] [--program-id PUBKEY]`);
      process.exit(0);
    }
  }
  return out;
}

function loadKeypairBytes(path: string): Uint8Array {
  if (!existsSync(path)) {
    throw new Error(`Keypair not found at ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  return new Uint8Array(JSON.parse(raw));
}

function clusterEndpoint(cluster: "localnet" | "devnet"): string {
  return cluster === "localnet"
    ? "http://127.0.0.1:8899"
    : "https://api.devnet.solana.com";
}

// ---- Main -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);

  const umi = createUmi(endpoint).use(mplBubblegum());
  const secret = loadKeypairBytes(args.keypair);
  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  const payer = createSignerFromKeypair(umi, kp);
  umi.use(keypairIdentity(payer));

  // Derive Momentum's mint_auth PDA — this becomes the tree delegate.
  const programId = new PublicKey(args.programId);
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth")],
    programId,
  );

  const merkleTree = generateSigner(umi);

  console.log("Creating Bubblegum tree...");
  console.log(`  cluster       : ${args.cluster} (${endpoint})`);
  console.log(`  payer         : ${payer.publicKey}`);
  console.log(`  program id    : ${programId.toBase58()}`);
  console.log(`  mint_auth PDA : ${mintAuthPda.toBase58()}`);
  console.log(`  tree pubkey   : ${merkleTree.publicKey}`);
  console.log(`  maxDepth=14 maxBufferSize=64 canopyDepth=8 public=false`);
  console.log("");

  const builder = await createTree(umi, {
    merkleTree,
    maxDepth: 14,
    maxBufferSize: 64,
    canopyDepth: 8,
    public: false,
    treeCreator: payer,
    // treeCreator signs create; then the on-chain delegate is set separately
    // by the Momentum program via initialize_tree_state (mint_auth PDA is used
    // as tree_creator_or_delegate when calling mint_v1).
  });

  const result = await builder.sendAndConfirm(umi);
  const signature = Buffer.from(result.signature).toString("base64");
  console.log(`Tree created. tx signature (base64): ${signature}`);

  // Derive the tree config PDA (same seed Bubblegum uses).
  const [treeConfigPda] = PublicKey.findProgramAddressSync(
    [new PublicKey(merkleTree.publicKey).toBuffer()],
    new PublicKey(MPL_BUBBLEGUM_PROGRAM_ID.toString()),
  );

  console.log("");
  console.log("== Summary ==");
  console.log(`  tree pubkey       : ${merkleTree.publicKey}`);
  console.log(`  tree config PDA   : ${treeConfigPda.toBase58()}`);
  console.log(`  mint_auth PDA     : ${mintAuthPda.toBase58()}`);
  console.log("");
  console.log("Next step (admin-signed):");
  console.log(`  anchor run initialize-tree-state -- ${merkleTree.publicKey}`);
  console.log("");
  console.log("Note: initialize_tree_state must be signed by the ADMIN key");
  console.log("configured in initialize_tree_state.rs (currently:");
  console.log("2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV).");

  // Also emit a machine-parsable line for scripting.
  console.log(`::tree=${merkleTree.publicKey}`);
  console.log(`::treeConfig=${treeConfigPda.toBase58()}`);
  console.log(`::mintAuth=${mintAuthPda.toBase58()}`);
}

// Silence unused-import for `umiPk`; it is a re-export the caller may want.
void umiPk;

main().catch((err) => {
  console.error("create-tree failed:", err);
  process.exit(1);
});
