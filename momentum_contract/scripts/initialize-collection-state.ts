#!/usr/bin/env bun
/**
 * initialize-collection-state.ts — Admin-signed bootstrap of the
 * `CollectionState` PDA at seeds `[b"collection_state"]`.
 *
 * Binds the deployed Momentum program to the Metaplex collection NFT created
 * by `scripts/create-collection.ts`. After this ix, `settle_prediction` and
 * `claim_match_card` can mint compressed NFTs *into* the collection via
 * Bubblegum's `MintToCollectionV1`.
 *
 * Usage:
 *   bun run scripts/initialize-collection-state.ts \
 *     --collection-mint <PUBKEY> \
 *     [--cluster localnet|devnet] \
 *     [--keypair <path>] \
 *     [--program-id <pubkey>]
 *
 * Signer MUST be the ADMIN key in
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

const DEFAULT_PROGRAM_ID = "39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT";

type Args = {
  collectionMint: string | null;
  cluster: "localnet" | "devnet";
  keypair: string;
  programId: string;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    collectionMint: null,
    cluster: "devnet",
    keypair: join(homedir(), ".config", "solana", "id.json"),
    programId: DEFAULT_PROGRAM_ID,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--collection-mint") out.collectionMint = argv[++i];
    else if (a === "--cluster") {
      const v = argv[++i];
      if (v !== "localnet" && v !== "devnet") {
        throw new Error(`--cluster must be localnet|devnet (got ${v})`);
      }
      out.cluster = v;
    } else if (a === "--keypair") out.keypair = argv[++i];
    else if (a === "--program-id") out.programId = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: bun run scripts/initialize-collection-state.ts --collection-mint PUBKEY [--cluster ..] [--keypair PATH] [--program-id PUBKEY]`,
      );
      process.exit(0);
    }
  }
  if (!out.collectionMint) {
    throw new Error(
      "Missing --collection-mint <PUBKEY>. Use the address emitted by scripts/create-collection.ts.",
    );
  }
  return out;
}

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`Keypair not found at ${path}`);
  return Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(readFileSync(path, "utf8"))),
  );
}

function clusterEndpoint(c: "localnet" | "devnet"): string {
  return c === "localnet"
    ? "http://127.0.0.1:8899"
    : "https://api.devnet.solana.com";
}

function explorerUrl(sig: string, c: "localnet" | "devnet"): string {
  const suffix = c === "devnet" ? "?cluster=devnet" : "?cluster=custom";
  return `https://explorer.solana.com/tx/${sig}${suffix}`;
}

function solscanUrl(sig: string, c: "localnet" | "devnet"): string {
  const suffix = c === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${sig}${suffix}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);
  const programId = new PublicKey(args.programId);
  const collectionMint = new PublicKey(args.collectionMint!);

  const admin = loadKeypair(args.keypair);
  const connection = new Connection(endpoint, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(admin), {
    commitment: "confirmed",
  });
  setProvider(provider);

  const idlPath = join(__dirname, "..", "target", "idl", "momentum.json");
  if (!existsSync(idlPath)) {
    throw new Error(`IDL not found at ${idlPath}. Run 'anchor build' first.`);
  }
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  const program = new Program(idl as any, provider);

  const [collectionStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_state")],
    programId,
  );

  console.log("Initializing CollectionState...");
  console.log(`  cluster              : ${args.cluster} (${endpoint})`);
  console.log(`  admin (signer)       : ${admin.publicKey.toBase58()}`);
  console.log(`  program id           : ${programId.toBase58()}`);
  console.log(`  collection mint      : ${collectionMint.toBase58()}`);
  console.log(`  collection_state PDA : ${collectionStatePda.toBase58()}`);
  console.log("");

  const sig = await program.methods
    .initializeCollectionState(collectionMint)
    .accountsPartial({
      admin: admin.publicKey,
      collectionState: collectionStatePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  console.log(`Success. tx signature: ${sig}`);
  console.log(`Explorer: ${explorerUrl(sig, args.cluster)}`);
  console.log(`Solscan : ${solscanUrl(sig, args.cluster)}`);
  console.log(`::collectionState=${collectionStatePda.toBase58()}`);
  console.log(`::collectionMint=${collectionMint.toBase58()}`);
  console.log(`::tx=${sig}`);
}

main().catch((err) => {
  console.error("initialize-collection-state failed:", err);
  process.exit(1);
});
