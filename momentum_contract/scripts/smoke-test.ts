#!/usr/bin/env bun
/**
 * smoke-test.ts — Devnet smoke test for deployed Momentum program.
 *
 * Steps executed:
 *   1. create_group             (payer = admin = user)
 *   2. submit_predictions       (fixture_id = proof.summary.fixtureId, slot 0
 *                                mirrors proof.statToProve so settle can HIT)
 *   3. settle_prediction        (requires PROOF_JSON pointing at a captured
 *                                stat-validation payload). SKIPPED if unset.
 *   4. State verification + all tx sigs + Solscan links.
 *
 * Usage:
 *   bun run scripts/smoke-test.ts [--cluster devnet] [--keypair PATH] [--program-id PUBKEY]
 *
 * With proof:
 *   PROOF_JSON=tests/fixtures/proofs/proof_18213979_843_1.json \
 *     bun run scripts/smoke-test.ts
 *
 * When PROOF_JSON is set, `create_group` uses a randomized `group_id` (safe
 * re-runs) but `fixture_id` is pinned to the proof's `summary.fixtureId` so
 * the settle CPI targets the same card the earlier submit created. If the
 * card PDA already exists from a prior run, submit is skipped.
 */

import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  AnchorProvider,
  BN,
  Idl,
  Program,
  Wallet,
  setProvider,
} from "@coral-xyz/anchor";
import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

// Constants that pin external programs and the deployed collection.
const TXLINE_PROGRAM_ID = new PublicKey(
  "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
);
const BUBBLEGUM_PROGRAM_ID = new PublicKey(
  "BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY",
);
const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey(
  "cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK",
);
const SPL_NOOP_ID = new PublicKey(
  "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV",
);
const MPL_TOKEN_METADATA_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);
// Deployed devnet artifacts (see notes/build-log.md Pass 6 + 7).
const MERKLE_TREE = new PublicKey(
  "2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX",
);
const COLLECTION_MINT = new PublicKey(
  "CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg",
);
const MS_PER_DAY = 86_400_000;

type Args = {
  cluster: "localnet" | "devnet";
  keypair: string;
  programId: string;
};

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
    }
  }
  return out;
}

function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) throw new Error(`Keypair not found: ${path}`);
  const raw = readFileSync(path, "utf8");
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(raw)));
}

function clusterEndpoint(cluster: "localnet" | "devnet"): string {
  return cluster === "localnet"
    ? "http://127.0.0.1:8899"
    : "https://api.devnet.solana.com";
}

function solscanTx(sig: string, cluster: "localnet" | "devnet"): string {
  const suffix = cluster === "devnet" ? "?cluster=devnet" : "";
  return `https://solscan.io/tx/${sig}${suffix}`;
}

/**
 * TxLINE `daily_scores_roots` PDA seed layout:
 *   [b"daily_scores_roots", u16_le(epochDay)]
 * where epochDay = floor(ts_ms / 86_400_000).
 */
function deriveDailyScoresRoot(tsMs: number): PublicKey {
  const epochDay = Math.floor(tsMs / MS_PER_DAY);
  const dayBuf = Buffer.alloc(2);
  dayBuf.writeUInt16LE(epochDay & 0xffff, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("daily_scores_roots"), dayBuf],
    TXLINE_PROGRAM_ID,
  );
  return pda;
}

/** Bubblegum tree_config PDA is `[tree.toBytes()]` under Bubblegum. */
function deriveTreeConfig(tree: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [tree.toBuffer()],
    BUBBLEGUM_PROGRAM_ID,
  );
  return pda;
}

/** All the collection-derived PDAs settle_prediction needs. */
function collectionAccounts(programId: PublicKey) {
  const [collectionState] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_state")],
    programId,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_ID.toBuffer(),
      COLLECTION_MINT.toBuffer(),
    ],
    MPL_TOKEN_METADATA_ID,
  );
  const [collectionEdition] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_ID.toBuffer(),
      COLLECTION_MINT.toBuffer(),
      Buffer.from("edition"),
    ],
    MPL_TOKEN_METADATA_ID,
  );
  const [bubblegumSigner] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_cpi")],
    BUBBLEGUM_PROGRAM_ID,
  );
  return {
    collectionState,
    collectionMint: COLLECTION_MINT,
    collectionMetadata,
    collectionEdition,
    bubblegumSigner,
    tokenMetadataProgram: MPL_TOKEN_METADATA_ID,
  };
}

/** Convert TxLINE JSON proof (camelCase) to Anchor snake_case shape. */
function loadProof(path: string) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const proofNode = (p: { hash: number[]; isRightSibling: boolean }) => ({
    hash: p.hash,
    isRightSibling: p.isRightSibling,
  });
  // TxLINE's `validate_stat` requires `ts == summary.updateStats.minTimestamp`
  // (both drive the same 5-min-slot index inside the daily_scores_roots PDA).
  // The top-level `raw.ts` in the JSON is the latest event ts in the batch
  // (== maxTimestamp), NOT what the CPI expects — see TxLINE
  // TimestampMismatch (6010) in validate_stat.rs:25.
  return {
    ts: new BN(raw.summary.updateStats.minTimestamp),
    fixtureId: raw.summary.fixtureId,
    fixtureSummary: {
      fixtureId: new BN(raw.summary.fixtureId),
      updateStats: {
        updateCount: raw.summary.updateStats.updateCount,
        minTimestamp: new BN(raw.summary.updateStats.minTimestamp),
        maxTimestamp: new BN(raw.summary.updateStats.maxTimestamp),
      },
      eventsSubTreeRoot: raw.summary.eventStatsSubTreeRoot,
    },
    fixtureProof: raw.subTreeProof.map(proofNode),
    mainTreeProof: raw.mainTreeProof.map(proofNode),
    predicate: {
      threshold: 0,
      comparison: { greaterThan: {} },
    },
    statA: {
      statToProve: {
        key: raw.statToProve.key,
        value: raw.statToProve.value,
        period: raw.statToProve.period,
      },
      eventStatRoot: raw.eventStatRoot,
      statProof: raw.statProof.map(proofNode),
    },
    slotShape: {
      statAKey: raw.statToProve.key,
      period: raw.statToProve.period,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const endpoint = clusterEndpoint(args.cluster);
  const programId = new PublicKey(args.programId);
  const admin = loadKeypair(args.keypair);

  const connection = new Connection(endpoint, "confirmed");
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  setProvider(provider);

  const idlPath = join(__dirname, "..", "target", "idl", "momentum.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8")) as Idl;
  const program = new Program(idl as any, provider);

  const proofPath = process.env.PROOF_JSON;
  const proof = proofPath && existsSync(proofPath) ? loadProof(proofPath) : null;

  // group_id is always fresh so runs can be re-executed idempotently.
  const runId = Date.now() % 1_000_000_000;
  const groupId = new BN(runId);
  // fixture_id: if we have a proof, pin to the proof's fixture; else fresh id.
  const fixtureId = proof ? new BN(proof.fixtureId) : new BN(runId + 1);

  console.log("Momentum devnet smoke test");
  console.log(`  cluster    : ${args.cluster} (${endpoint})`);
  console.log(`  payer      : ${admin.publicKey.toBase58()}`);
  console.log(`  program id : ${programId.toBase58()}`);
  console.log(`  run id     : ${runId}`);
  console.log(`  fixture id : ${fixtureId.toString()}`);
  console.log(`  proof      : ${proof ? proofPath : "(none — settle SKIPPED)"}`);
  console.log("");

  // SKIP_CREATE_GROUP=1 skips step 1 — useful when re-running the settle path
  // after burning SOL on prior partial runs. Card/group state from any earlier
  // successful run remains valid.
  const skipCreateGroup = process.env.SKIP_CREATE_GROUP === "1";
  let createSig: string | null = null;

  // ---- Step 1: create_group ------------------------------------------------
  const [groupPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
    programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), groupPda.toBuffer()],
    programId,
  );
  const [creatorMembership] = PublicKey.findProgramAddressSync(
    [Buffer.from("member"), groupPda.toBuffer(), admin.publicKey.toBuffer()],
    programId,
  );

  if (skipCreateGroup) {
    console.log("Step 1/3: create_group — SKIPPED (SKIP_CREATE_GROUP=1)");
  } else {
    console.log(`Step 1/3: create_group(group_id=${runId})`);
    createSig = await program.methods
      .createGroup(groupId, "SmokeGroup", 4, new BN(0))
      .accountsPartial({
        creator: admin.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  tx        : ${createSig}`);
    console.log(`  group PDA : ${groupPda.toBase58()}`);
    console.log(`  Solscan   : ${solscanTx(createSig, args.cluster)}`);
  }
  console.log("");

  // ---- Step 2: submit_predictions -----------------------------------------
  const [cardPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("card"),
      admin.publicKey.toBuffer(),
      fixtureId.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );

  const existingCard = await connection.getAccountInfo(cardPda, "confirmed");
  let submitSig: string | null = null;
  if (existingCard) {
    console.log(`Step 2/3: submit_predictions — SKIPPED (card PDA exists)`);
    console.log(`  card PDA  : ${cardPda.toBase58()}`);
  } else if (proof) {
    // Slot 0 mirrors the captured stat exactly so the HIT branch validates.
    // We use `predicate_comparison = 0 (GreaterThan)` and `threshold = 0`
    // so `value > 0` is trivially TRUE for the captured stat_a value.
    const slots = [
      {
        statAKey: proof.slotShape.statAKey,
        statBKey: 0,
        op: 0,
        predicateComparison: 0, // GreaterThan
        threshold: 0,
        period: proof.slotShape.period,
      },
    ];
    console.log(`Step 2/3: submit_predictions(fixture=${fixtureId.toString()}, 1 slot mirroring proof)`);
    submitSig = await program.methods
      .submitPredictions(fixtureId, slots)
      .accountsPartial({
        user: admin.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  tx        : ${submitSig}`);
    console.log(`  card PDA  : ${cardPda.toBase58()}`);
    console.log(`  Solscan   : ${solscanTx(submitSig, args.cluster)}`);
  } else {
    // No proof — legacy 3-slot smoke test for backward compat.
    console.log(`Step 2/3: submit_predictions(fixture=${fixtureId.toString()}, 3 slots)`);
    submitSig = await program.methods
      .submitPredictions(fixtureId, [
        { statAKey: 1, statBKey: 0, op: 0, predicateComparison: 0, threshold: 2, period: 0 },
        { statAKey: 4, statBKey: 0, op: 0, predicateComparison: 0, threshold: 5, period: 0 },
        { statAKey: 1001, statBKey: 0, op: 0, predicateComparison: 1, threshold: 1, period: 100 },
      ])
      .accountsPartial({
        user: admin.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`  tx        : ${submitSig}`);
    console.log(`  card PDA  : ${cardPda.toBase58()}`);
    console.log(`  Solscan   : ${solscanTx(submitSig, args.cluster)}`);
  }
  console.log("");

  // ---- Step 3: settle_prediction ------------------------------------------
  let settleSig: string | null = null;
  if (proof) {
    const dailyScoresRoot = deriveDailyScoresRoot(proof.ts.toNumber());
    const treeConfig = deriveTreeConfig(MERKLE_TREE);
    const [treeState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      programId,
    );
    const [mintAuth] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      programId,
    );
    const colAccts = collectionAccounts(programId);

    console.log(`Step 3/3: settle_prediction (HIT branch)`);
    console.log(`  ts                 : ${proof.ts.toString()}`);
    console.log(`  fixture_id         : ${fixtureId.toString()}`);
    console.log(`  stat_a.key         : ${proof.slotShape.statAKey}`);
    console.log(`  stat_a.value       : ${proof.statA.statToProve.value}`);
    console.log(`  daily_scores_root  : ${dailyScoresRoot.toBase58()}`);
    console.log(`  tree_config        : ${treeConfig.toBase58()}`);
    console.log(`  tree_state         : ${treeState.toBase58()}`);
    console.log(`  mint_auth          : ${mintAuth.toBase58()}`);
    console.log(`  collection_state   : ${colAccts.collectionState.toBase58()}`);
    console.log(`  collection_metadata: ${colAccts.collectionMetadata.toBase58()}`);
    console.log(`  collection_edition : ${colAccts.collectionEdition.toBase58()}`);
    console.log(`  bubblegum_signer   : ${colAccts.bubblegumSigner.toBase58()}`);

    // TxLINE Merkle verify + Bubblegum MintToCollectionV1 needs ~450K CU.
    // Default 200K is not enough (Bubblegum runs out during append).
    const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 600_000,
    });

    // Build the settle ix (do NOT .rpc() — legacy tx is > 1232 bytes with all
    // 20+ accounts + ~1KB proof payload). We pack it into a v0 tx backed by an
    // Address Lookup Table containing the 12 static program/PDA accounts.
    const settleIx = await program.methods
      .settlePrediction(
        fixtureId,
        0, // slot_index
        proof.ts,
        proof.fixtureSummary as any,
        proof.fixtureProof as any,
        proof.mainTreeProof as any,
        proof.predicate as any,
        proof.statA as any,
        null, // stat_b
        null, // op
        1, // outcome_claim = HIT
        "ar://m",
      )
      .accountsPartial({
        keeper: admin.publicKey,
        user: admin.publicKey,
        predictionCard: cardPda,
        treeState,
        collectionState: colAccts.collectionState,
        mintAuth,
        treeConfig,
        merkleTree: MERKLE_TREE,
        leafOwner: admin.publicKey,
        collectionMint: colAccts.collectionMint,
        collectionMetadata: colAccts.collectionMetadata,
        collectionEdition: colAccts.collectionEdition,
        bubblegumSigner: colAccts.bubblegumSigner,
        logWrapper: SPL_NOOP_ID,
        compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
        bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
        tokenMetadataProgram: colAccts.tokenMetadataProgram,
        txlineProgram: TXLINE_PROGRAM_ID,
        dailyScoresMerkleRoots: dailyScoresRoot,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    // ---- Build (or reuse) the ALT ------------------------------------------
    // Static accounts that never change per settle: program ids + collection
    // PDAs + Momentum PDAs. Placing 12 of them in the ALT reduces the tx
    // account-refs from 32 bytes each to 1 byte each — plenty of headroom.
    const staticLutEntries: PublicKey[] = [
      TXLINE_PROGRAM_ID,
      BUBBLEGUM_PROGRAM_ID,
      SPL_ACCOUNT_COMPRESSION_ID,
      SPL_NOOP_ID,
      MPL_TOKEN_METADATA_ID,
      programId,
      treeState,
      mintAuth,
      colAccts.collectionState,
      colAccts.collectionMint,
      colAccts.collectionMetadata,
      colAccts.collectionEdition,
      colAccts.bubblegumSigner,
      MERKLE_TREE,
      treeConfig,
      SystemProgram.programId,
    ];

    const lutCachePath = join(__dirname, "..", ".smoke-lut.json");
    let lutAddress: PublicKey | null = null;
    if (existsSync(lutCachePath)) {
      const cached = JSON.parse(readFileSync(lutCachePath, "utf8"));
      lutAddress = new PublicKey(cached.address);
      // Verify still exists on-chain.
      const info = await connection.getAccountInfo(lutAddress, "confirmed");
      if (!info) lutAddress = null;
    }

    if (!lutAddress) {
      console.log(`  Creating new Address Lookup Table for settle...`);
      const recentSlot = await connection.getSlot("finalized");
      const [createLutIx, lutAddr] =
        AddressLookupTableProgram.createLookupTable({
          authority: admin.publicKey,
          payer: admin.publicKey,
          recentSlot,
        });
      const extendLutIx = AddressLookupTableProgram.extendLookupTable({
        payer: admin.publicKey,
        authority: admin.publicKey,
        lookupTable: lutAddr,
        addresses: staticLutEntries,
      });
      const setupTx = new Transaction().add(createLutIx, extendLutIx);
      const setupSig = await provider.sendAndConfirm(setupTx, [admin], {
        commitment: "confirmed",
      });
      console.log(`  LUT setup tx: ${setupSig}`);
      console.log(`  LUT address : ${lutAddr.toBase58()}`);
      lutAddress = lutAddr;
      require("fs").writeFileSync(
        lutCachePath,
        JSON.stringify({ address: lutAddr.toBase58() }, null, 2),
      );
      // ALTs need to be one slot old before they can be used. Sleep briefly.
      await new Promise((r) => setTimeout(r, 3000));
    } else {
      console.log(`  Reusing cached LUT : ${lutAddress.toBase58()}`);
    }

    const lutAccount = (await connection.getAddressLookupTable(lutAddress))
      .value;
    if (!lutAccount) throw new Error(`LUT ${lutAddress.toBase58()} not found`);

    const bh = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({
      payerKey: admin.publicKey,
      recentBlockhash: bh.blockhash,
      instructions: [computeIx, settleIx],
    }).compileToV0Message([lutAccount]);
    const vtx = new VersionedTransaction(msg);
    vtx.sign([admin]);
    console.log(`  serialized settle tx bytes: ${vtx.serialize().length}`);

    settleSig = await connection.sendTransaction(vtx, {
      skipPreflight: true,
      maxRetries: 5,
    });
    console.log(`  sent settle tx sig: ${settleSig}`);
    await connection.confirmTransaction(
      {
        signature: settleSig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      "confirmed",
    );

    console.log(`  tx        : ${settleSig}`);
    console.log(`  Solscan   : ${solscanTx(settleSig, args.cluster)}`);
  } else {
    console.log("Step 3/3: settle_prediction — SKIPPED (no PROOF_JSON)");
  }
  console.log("");

  // ---- State verification --------------------------------------------------
  const groupAcct = await (program.account as any).group.fetch(groupPda);
  const cardAcct = await (program.account as any).predictionCard.fetch(cardPda);
  console.log("== State verification ==");
  console.log(`  group.groupId      : ${groupAcct.groupId?.toString?.() ?? groupAcct.groupId}`);
  console.log(`  group.currentSize  : ${groupAcct.currentSize}`);
  console.log(`  group.maxSize      : ${groupAcct.maxSize}`);
  console.log(`  card.bump          : ${cardAcct.bump}`);
  console.log(`  card.slotCount     : ${cardAcct.slotCount}`);
  const slot0 = cardAcct.slots[0];
  console.log(`  card.slots[0].statAKey   : ${slot0.statAKey}`);
  console.log(`  card.slots[0].status     : ${slot0.status} (0=Pending, 1=HIT, 2=MISS)`);
  console.log(`  card.slots[0].proofTs    : ${slot0.proofTs?.toString?.()}`);
  console.log(`  card.slots[0].stickerSeq : ${slot0.stickerAssetSeq?.toString?.()}`);
  const eventRoot = slot0.eventStatRoot as number[];
  const eventRootHex = Buffer.from(eventRoot).toString("hex");
  console.log(`  card.slots[0].eventRoot  : ${eventRootHex}`);
  console.log("");

  console.log("Smoke test complete.");
  console.log(`::createGroup=${createSig}`);
  if (submitSig) console.log(`::submitPredictions=${submitSig}`);
  if (settleSig) console.log(`::settlePrediction=${settleSig}`);
  console.log(`::groupPda=${groupPda.toBase58()}`);
  console.log(`::cardPda=${cardPda.toBase58()}`);
}

main().catch((err) => {
  console.error("smoke-test failed:", err);
  if (err?.logs) {
    console.error("== Program logs ==");
    for (const l of err.logs) console.error(l);
  }
  process.exit(1);
});
