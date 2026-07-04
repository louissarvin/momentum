#!/usr/bin/env bun
/**
 * create-collection.ts — Mints the MOMENTUM collection NFT via Metaplex Token
 * Metadata. Owned by, and update-authoritied by, Momentum's `mint_auth` PDA
 * so Bubblegum's `MintToCollectionV1` CPI can sign `collection_authority`
 * via `invoke_signed`.
 *
 * Usage:
 *   bun run scripts/create-collection.ts \
 *     [--cluster localnet|devnet] \
 *     [--keypair <path>] \
 *     [--program-id <pubkey>] \
 *     [--name MOMENTUM] \
 *     [--symbol MMT] \
 *     [--uri https://cdn.momentum.app/collection.json]
 *
 * Prints and emits `::collectionMint=`, `::collectionMetadata=`,
 * `::collectionEdition=`, `::tx=` for downstream scripts.
 *
 * Docs: https://developers.metaplex.com/token-metadata/collections
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  createNft,
  mplTokenMetadata,
  findMetadataPda,
  findMasterEditionPda,
  updateV1,
} from "@metaplex-foundation/mpl-token-metadata";
import {
  createSignerFromKeypair,
  generateSigner,
  keypairIdentity,
  percentAmount,
  publicKey as umiPk,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

const DEFAULT_PROGRAM_ID = "39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT";

type Args = {
  cluster: "localnet" | "devnet";
  keypair: string;
  programId: string;
  name: string;
  symbol: string;
  uri: string;
  existingMint: string | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    cluster: "devnet",
    keypair: join(homedir(), ".config", "solana", "id.json"),
    programId: DEFAULT_PROGRAM_ID,
    name: "MOMENTUM",
    symbol: "MMT",
    uri: "https://cdn.momentum.app/collection.json",
    existingMint: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cluster") {
      const v = argv[++i];
      if (v !== "localnet" && v !== "devnet") {
        throw new Error(`--cluster must be localnet|devnet (got ${v})`);
      }
      out.cluster = v;
    } else if (a === "--keypair") out.keypair = argv[++i];
    else if (a === "--program-id") out.programId = argv[++i];
    else if (a === "--name") out.name = argv[++i];
    else if (a === "--symbol") out.symbol = argv[++i];
    else if (a === "--uri") out.uri = argv[++i];
    else if (a === "--existing-mint") out.existingMint = argv[++i];
    else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: bun run scripts/create-collection.ts [--cluster ..] [--keypair PATH] [--program-id PUBKEY] [--name STR] [--symbol STR] [--uri URI]`,
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);

  const umi = createUmi(endpoint).use(mplTokenMetadata());
  const secret = loadKeypairBytes(args.keypair);
  const kp = umi.eddsa.createKeypairFromSecretKey(secret);
  const admin = createSignerFromKeypair(umi, kp);
  umi.use(keypairIdentity(admin));

  const programId = new PublicKey(args.programId);
  const [mintAuthPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_auth")],
    programId,
  );

  const mintAuthUmi = umiPk(mintAuthPda.toBase58());
  // If --existing-mint is set, skip createNft and just do the update-authority
  // handoff. Useful for resuming after a partial-failure run.
  const collectionMint = args.existingMint
    ? { publicKey: umiPk(args.existingMint), secretKey: new Uint8Array(64) }
    : generateSigner(umi);

  console.log("Creating MOMENTUM collection NFT...");
  console.log(`  cluster            : ${args.cluster} (${endpoint})`);
  console.log(`  admin (payer,auth) : ${admin.publicKey}`);
  console.log(`  mint_auth PDA      : ${mintAuthPda.toBase58()}`);
  console.log(`  collection mint    : ${collectionMint.publicKey}`);
  console.log(`  name / symbol      : ${args.name} / ${args.symbol}`);
  console.log(`  uri                : ${args.uri}`);
  console.log("");

  let createSig = "(skipped — reusing existing mint)";
  if (!args.existingMint) {
    // Step 1: create the NFT with admin as update authority. Token Metadata's
    // createV1 refuses to accept a PDA as initial updateAuthority because the
    // create ix requires the update authority to sign — a PDA cannot sign an
    // off-chain ix. So we create as admin, then hand off in step 2.
    //
    // `tokenOwner` is set directly to the mint_auth PDA — this only requires
    // the token account to exist under that owner, no signature needed.
    const createBuilder = createNft(umi, {
      mint: collectionMint as any,
      name: args.name,
      symbol: args.symbol,
      uri: args.uri,
      sellerFeeBasisPoints: percentAmount(5.0, 2),
      isCollection: true,
      tokenOwner: mintAuthUmi,
      // updateAuthority defaults to identity (admin) — leave it, transfer in step 2.
      // Set the collection's on-chain creator to mint_auth so the sticker
      // cNFTs (whose Creator is also mint_auth) share provenance. Verified
      // must be false at create-time because mint_auth can't sign.
      creators: [
        {
          address: mintAuthUmi,
          verified: false,
          share: 100,
        },
      ],
    });

    const createResult = await createBuilder.sendAndConfirm(umi, {
      confirm: { commitment: "confirmed" },
    });
    createSig = bs58encode(createResult.signature);
    console.log(`  create tx: ${createSig}`);
  }

  // Step 2: transfer updateAuthority from admin to mint_auth PDA so that
  // Bubblegum's MintToCollectionV1 CPI can sign `collection_authority`
  // via invoke_signed. Pass metadata + edition explicitly so the resolver
  // doesn't guess a token account (we don't want a token account passed at
  // all for a pure update-authority handoff).
  const [metadataPda] = findMetadataPda(umi, {
    mint: collectionMint.publicKey,
  });
  const [editionPda] = findMasterEditionPda(umi, {
    mint: collectionMint.publicKey,
  });
  // The token account is the ATA of mint_auth for the collection mint (created
  // by createNft in step 1). Token Metadata's UpdateV1 handler needs to see it
  // to determine holder-vs-authority state.
  const tokenAta = getAssociatedTokenAddressSync(
    new PublicKey(collectionMint.publicKey),
    mintAuthPda,
    true, // allowOwnerOffCurve — mint_auth is a PDA
  );
  const updateBuilder = updateV1(umi, {
    mint: collectionMint.publicKey,
    metadata: metadataPda,
    edition: editionPda,
    token: umiPk(tokenAta.toBase58()),
    authority: admin,
    newUpdateAuthority: mintAuthUmi,
  });
  const updateResult = await updateBuilder.sendAndConfirm(umi, {
    confirm: { commitment: "confirmed" },
  });
  const updateSig = bs58encode(updateResult.signature);
  console.log(`  update-authority handoff tx: ${updateSig}`);

  const sigBase58 = createSig;

  const collectionMintPk = new PublicKey(collectionMint.publicKey);
  const [collectionMetadata] = findMetadataPda(umi, {
    mint: umiPk(collectionMintPk.toBase58()),
  });
  const [collectionEdition] = findMasterEditionPda(umi, {
    mint: umiPk(collectionMintPk.toBase58()),
  });

  console.log(`Success. tx signature: ${sigBase58}`);
  console.log(`Explorer: ${explorerUrl(sigBase58, args.cluster)}`);
  console.log(`Solscan : ${solscanUrl(sigBase58, args.cluster)}`);
  console.log("");
  console.log("== Collection addresses ==");
  console.log(`  collection_mint     : ${collectionMintPk.toBase58()}`);
  console.log(`  collection_metadata : ${collectionMetadata.toString()}`);
  console.log(`  collection_edition  : ${collectionEdition.toString()}`);
  console.log(`  update authority    : ${mintAuthPda.toBase58()} (mint_auth PDA)`);
  console.log(`  token owner         : ${mintAuthPda.toBase58()} (mint_auth PDA)`);

  console.log(`::collectionMint=${collectionMintPk.toBase58()}`);
  console.log(`::collectionMetadata=${collectionMetadata.toString()}`);
  console.log(`::collectionEdition=${collectionEdition.toString()}`);
  console.log(`::tx=${sigBase58}`);
}

main().catch((err) => {
  console.error("create-collection failed:", err);
  process.exit(1);
});
