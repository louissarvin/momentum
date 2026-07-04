#!/usr/bin/env bun
/**
 * initialize-tree-state.ts — Admin-signed bootstrap for Momentum's TreeState PDA.
 *
 * Binds the deployed Momentum program to a specific Bubblegum tree pubkey
 * (created via `scripts/create-tree.ts`). This is a one-shot ix — the
 * TreeState PDA at seeds `[b"tree_state"]` has no close instruction, so
 * pick the correct tree before running.
 *
 * Usage:
 *   bun run scripts/initialize-tree-state.ts \
 *     --tree <TREE_PUBKEY> \
 *     [--cluster localnet|devnet] \
 *     [--keypair <path>] \
 *     [--program-id <pubkey>]
 *
 * Defaults:
 *   --cluster    devnet
 *   --keypair    ~/.config/solana/id.json
 *   --program-id 39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT
 *
 * Signer MUST equal the ADMIN constant in
 * `programs/momentum/src/instructions/initialize_tree_state.rs`
 * (currently 2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV).
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  AnchorProvider,
  Program,
  Wallet,
  Idl,
  setProvider,
} from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";

// ---- CLI arg parsing ------------------------------------------------------

type Args = {
  tree: string | null;
  cluster: "localnet" | "devnet";
  keypair: string;
  programId: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    tree: null,
    cluster: "devnet",
    keypair: join(homedir(), ".config", "solana", "id.json"),
    programId: "39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT",
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
        `Usage: bun run scripts/initialize-tree-state.ts --tree <PUBKEY> [--cluster localnet|devnet] [--keypair PATH] [--program-id PUBKEY]`,
      );
      process.exit(0);
    }
  }
  if (!out.tree) {
    throw new Error(
      "Missing required --tree <PUBKEY>. Pass the pubkey emitted by scripts/create-tree.ts.",
    );
  }
  return out;
}

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new Error(`Keypair not found at ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const bytes = new Uint8Array(JSON.parse(raw));
  return Keypair.fromSecretKey(bytes);
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

// ---- Main -----------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);
  const programId = new PublicKey(args.programId);
  const tree = new PublicKey(args.tree!);

  const admin = loadKeypair(args.keypair);
  const connection = new Connection(endpoint, "confirmed");
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  setProvider(provider);

  // Load the IDL directly from target/idl so we don't depend on codegen state.
  const idlPath = join(
    __dirname,
    "..",
    "target",
    "idl",
    "momentum.json",
  );
  if (!existsSync(idlPath)) {
    throw new Error(
      `IDL not found at ${idlPath}. Run \`anchor build\` first.`,
    );
  }
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  const program = new Program(idl as any, provider);

  const [treeStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("tree_state")],
    programId,
  );
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth")],
    programId,
  );

  console.log("Initializing TreeState...");
  console.log(`  cluster        : ${args.cluster} (${endpoint})`);
  console.log(`  admin          : ${admin.publicKey.toBase58()}`);
  console.log(`  program id     : ${programId.toBase58()}`);
  console.log(`  tree           : ${tree.toBase58()}`);
  console.log(`  tree_state PDA : ${treeStatePda.toBase58()}`);
  console.log(`  mint_auth PDA  : ${mintAuthPda.toBase58()}`);
  console.log("");

  const sig = await program.methods
    .initializeTreeState(tree)
    .accountsPartial({
      admin: admin.publicKey,
      treeState: treeStatePda,
      mintAuth: mintAuthPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`Success. tx signature: ${sig}`);
  console.log(`Explorer: ${explorerUrl(sig, args.cluster)}`);
  console.log(`Solscan : ${solscanUrl(sig, args.cluster)}`);
  console.log("");
  console.log("== Bound state ==");
  console.log(`  tree_state PDA : ${treeStatePda.toBase58()}`);
  console.log(`  mint_auth PDA  : ${mintAuthPda.toBase58()}`);
  console.log(`  tree           : ${tree.toBase58()}`);

  console.log(`::treeState=${treeStatePda.toBase58()}`);
  console.log(`::mintAuth=${mintAuthPda.toBase58()}`);
  console.log(`::tx=${sig}`);
}

main().catch((err) => {
  console.error("initialize-tree-state failed:", err);
  process.exit(1);
});
