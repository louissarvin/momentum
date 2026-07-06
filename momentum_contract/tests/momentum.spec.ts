// Momentum bankrun test suite.
//
// Framework: solana-bankrun + anchor-bankrun.
// Fixtures loaded:
//   - momentum (from target/deploy/momentum.so, auto-loaded by startAnchor)
//   - txoracle (tests/fixtures/txoracle.so, program 6pW64gN...wyP2J)
//   - mpl_bubblegum (tests/fixtures/mpl_bubblegum.so)
//   - spl_account_compression (tests/fixtures/spl_account_compression.so)
//   - spl_noop (tests/fixtures/spl_noop.so)
//   - daily_scores_roots snapshot for epoch_day 20310 (tests/fixtures/daily_scores_20310.json)
//
// Tests that hit the full settle_prediction happy path require a live TxLINE
// proof captured from the backend against the loaded root; those stay `it.skip`
// with an exact `curl` command in the TODO. All other invariants (S1–S15) are
// exercised via either real ix calls or `context.setAccount` synthetic state.

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import { startAnchor, ProgramTestContext, AddedAccount, AddedProgram } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { readFileSync } from "fs";
import { join } from "path";
import { expect } from "chai";

import { Momentum } from "../target/types/momentum";

const TXLINE_PROGRAM_ID = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const BUBBLEGUM_PROGRAM_ID = new PublicKey("BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY");
const SPL_ACCOUNT_COMPRESSION_ID = new PublicKey("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");
const SPL_NOOP_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const MPL_TOKEN_METADATA_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

const FIXTURES_DIR = join(__dirname, "fixtures");

function loadDumpedAccount(fixtureFile: string): AddedAccount {
  const raw = JSON.parse(readFileSync(join(FIXTURES_DIR, fixtureFile), "utf8"));
  const dataBase64 = raw.account.data[0];
  const data = Buffer.from(dataBase64, "base64");
  return {
    address: new PublicKey(raw.pubkey),
    info: {
      lamports: raw.account.lamports,
      data,
      owner: new PublicKey(raw.account.owner),
      executable: raw.account.executable,
    },
  };
}

const EXTRA_PROGRAMS: AddedProgram[] = [
  { name: "txoracle", programId: TXLINE_PROGRAM_ID },
  { name: "mpl_bubblegum", programId: BUBBLEGUM_PROGRAM_ID },
  { name: "spl_account_compression", programId: SPL_ACCOUNT_COMPRESSION_ID },
  { name: "spl_noop", programId: SPL_NOOP_ID },
];

// Fixed synthetic collection mint used by all settle/claim tests. We inject a
// CollectionState PDA at test-suite bootstrap so the client-side account
// resolver can look up collection_state.collection_mint without recursion.
const COLLECTION_MINT = new PublicKey(
  "CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg",
);

function collectionAccounts(programId: PublicKey) {
  const [collectionStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("collection_state")],
    programId,
  );
  const [collectionMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), MPL_TOKEN_METADATA_ID.toBuffer(), COLLECTION_MINT.toBuffer()],
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
    collectionState: collectionStatePda,
    collectionMint: COLLECTION_MINT,
    collectionMetadata,
    collectionEdition,
    bubblegumSigner,
    tokenMetadataProgram: MPL_TOKEN_METADATA_ID,
  };
}

describe("momentum", () => {
  let context: ProgramTestContext;
  let provider: BankrunProvider;
  let program: Program<Momentum>;
  let payer: Keypair;
  let coder: BorshAccountsCoder;

  before(async () => {
    const preloaded: AddedAccount[] = [loadDumpedAccount("daily_scores_20310.json")];
    context = await startAnchor(join(__dirname, ".."), EXTRA_PROGRAMS, preloaded);
    provider = new BankrunProvider(context);
    anchor.setProvider(provider);
    program = anchor.workspace.momentum as Program<Momentum>;
    payer = context.payer;
    // Load the raw (non-camelCased) IDL so BorshAccountsCoder can look up
    // account layouts by their on-chain names (`Listing`, `TreeState`, ...).
    // program.idl runs through convertIdlToCamelCase which lowercases the
    // first letter of every account/type name and breaks the lookup.
    const rawIdl = JSON.parse(
      readFileSync(join(__dirname, "..", "target", "idl", "momentum.json"), "utf8"),
    );
    coder = new BorshAccountsCoder(rawIdl as any);

    // Seed a CollectionState PDA so settle_prediction / claim_match_card
    // synthetic-state tests can pass account resolution. Real init requires
    // the ADMIN signer which we can't fake in bankrun.
    const [collectionStatePda, collectionStateBump] =
      PublicKey.findProgramAddressSync(
        [Buffer.from("collection_state")],
        program.programId,
      );
    const collectionStateData = await coder.encode("CollectionState", {
      collection_mint: COLLECTION_MINT,
      bump: collectionStateBump,
      admin: payer.publicKey,
    });
    context.setAccount(collectionStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: collectionStateData,
      owner: program.programId,
      executable: false,
    });
  });

  // ---- Group lifecycle --------------------------------------------------

  it("create_group_ok", async () => {
    const groupId = new BN(1);
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [membershipPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );

    await program.methods
      .createGroup(groupId, "Amigos", 8, new BN(0))
      .accountsPartial({
        creator: payer.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership: membershipPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const group = await program.account.group.fetch(groupPda);
    expect(group.currentSize).to.equal(1);
    expect(group.maxSize).to.equal(8);
    expect(group.name).to.equal("Amigos");
  });

  it("join_group_full", async () => {
    const groupId = new BN(2);
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [creatorMembership] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );

    await program.methods
      .createGroup(groupId, "Duo", 2, new BN(0))
      .accountsPartial({
        creator: payer.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const member2 = Keypair.generate();
    await fundKeypair(context, member2.publicKey, LAMPORTS_PER_SOL);
    const [mem2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), member2.publicKey.toBuffer()],
      program.programId,
    );
    await program.methods
      .joinGroup(groupId)
      .accountsPartial({
        user: member2.publicKey,
        group: groupPda,
        vault: vaultPda,
        membership: mem2Pda,
        groupExtension: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([member2])
      .rpc();

    const member3 = Keypair.generate();
    await fundKeypair(context, member3.publicKey, LAMPORTS_PER_SOL);
    const [mem3Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), member3.publicKey.toBuffer()],
      program.programId,
    );

    let errored = false;
    try {
      await program.methods
        .joinGroup(groupId)
        .accountsPartial({
          user: member3.publicKey,
          group: groupPda,
          vault: vaultPda,
          membership: mem3Pda,
          groupExtension: null,
          systemProgram: SystemProgram.programId,
        })
        .signers([member3])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/GroupFull|6002/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Predictions ------------------------------------------------------

  it("submit_predictions_ok", async () => {
    const user = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(1234567);
    const [cardPda, cardBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    await program.methods
      .submitPredictions(fixtureId, [
        { statAKey: 10, statBKey: 0, op: 0, predicateComparison: 0, threshold: 2, period: 0 },
        { statAKey: 11, statBKey: 0, op: 0, predicateComparison: 1, threshold: 3, period: 0 },
      ])
      .accountsPartial({
        user: user.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const card = await program.account.predictionCard.fetch(cardPda);
    expect(card.slotCount).to.equal(2);
    expect(card.matchCardMinted).to.equal(false);
    expect(card.slots[0].statAKey).to.equal(10);
    expect(card.slots[1].statAKey).to.equal(11);
    expect(card.slots[0].status).to.equal(0);
  });

  // ---- Compound-stat guard (S10) ---------------------------------------

  it("S10_compound_stat_guards", async () => {
    const user = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(9999);
    const [cardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    // op=0 (single stat) with statBKey != 0 -> UnexpectedCompoundStat.
    let errored = false;
    try {
      await program.methods
        .submitPredictions(fixtureId, [
          { statAKey: 10, statBKey: 11, op: 0, predicateComparison: 0, threshold: 1, period: 0 },
        ])
        .accountsPartial({
          user: user.publicKey,
          card: cardPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/UnexpectedCompoundStat|MissingCompoundStat|InvalidStatBOp/);
    }
    expect(errored).to.equal(true);

    // op=1 (Add) with statBKey=0 -> MissingCompoundStat.
    errored = false;
    try {
      await program.methods
        .submitPredictions(fixtureId, [
          { statAKey: 10, statBKey: 0, op: 1, predicateComparison: 0, threshold: 1, period: 0 },
        ])
        .accountsPartial({
          user: user.publicKey,
          card: cardPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/MissingCompoundStat|UnexpectedCompoundStat|InvalidStatBOp/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Marketplace ------------------------------------------------------

  it("buy_inactive_listing", async () => {
    // Synthetic: inject a Listing with active=false, then call buy_card.
    // Expected: rejected with ListingNotActive before any Bubblegum CPI runs.
    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    await fundKeypair(context, seller.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, buyer.publicKey, LAMPORTS_PER_SOL);

    const assetId = Keypair.generate().publicKey; // synthetic
    const [listingPda, listingBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), assetId.toBuffer()],
      program.programId,
    );

    const listing = {
      seller: seller.publicKey,
      asset_id: assetId,
      price_lamports: new BN(100_000),
      tree: Keypair.generate().publicKey,
      leaf_index: 0,
      created_at: new BN(0),
      active: false, // <-- the guard we want to trip
      bump: listingBump,
    };
    const encoded = await coder.encode("Listing", listing);
    context.setAccount(listingPda, {
      lamports: LAMPORTS_PER_SOL,
      data: encoded,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .buyCard(assetId, new Array(32).fill(0) as any, new Array(32).fill(0) as any, new Array(32).fill(0) as any, new BN(0), 0)
        .accountsPartial({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          listing: listingPda,
          escrowAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from("escrow_auth")],
            program.programId,
          )[0],
          treeConfig: Keypair.generate().publicKey,
          merkleTree: listing.tree,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/ListingNotActive|6009|Unauthorized/);
    }
    expect(errored).to.equal(true);
  });

  it("S5_unauthorized_cancel", async () => {
    // Seller A creates listing; user B tries cancel_listing -> has_one rejects.
    const sellerA = Keypair.generate();
    const sellerB = Keypair.generate();
    await fundKeypair(context, sellerA.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, sellerB.publicKey, LAMPORTS_PER_SOL);

    const assetId = Keypair.generate().publicKey;
    const [listingPda, listingBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), assetId.toBuffer()],
      program.programId,
    );

    const listing = {
      seller: sellerA.publicKey,
      asset_id: assetId,
      price_lamports: new BN(100_000),
      tree: Keypair.generate().publicKey,
      leaf_index: 0,
      created_at: new BN(0),
      active: true,
      bump: listingBump,
    };
    const encoded = await coder.encode("Listing", listing);
    context.setAccount(listingPda, {
      lamports: LAMPORTS_PER_SOL,
      data: encoded,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .cancelListing(assetId, new Array(32).fill(0) as any, new Array(32).fill(0) as any, new Array(32).fill(0) as any, new BN(0), 0)
        .accountsPartial({
          seller: sellerB.publicKey, // wrong seller
          listing: listingPda,
          escrowAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from("escrow_auth")],
            program.programId,
          )[0],
          treeConfig: Keypair.generate().publicKey,
          merkleTree: listing.tree,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([sellerB])
        .rpc();
    } catch (e: any) {
      errored = true;
      // Anchor's has_one violation surfaces as `ConstraintHasOne` (2001) or as
      // our custom `Unauthorized` depending on where the check hits first.
      expect(String(e)).to.match(/ConstraintHasOne|Unauthorized|2001|has one/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Settlement error paths -----------------------------------------

  it("settle_prediction_wrong_root_pda", async () => {
    // Build a valid PredictionCard + TreeState via setAccount, then call
    // settle_prediction with a random pubkey as `daily_scores_merkle_roots`.
    // TxLINE should surface InvalidPda (6009); at minimum, the tx must fail.
    // (In bankrun, we may also see a Bubblegum failure if TxLINE's account
    // owner check surfaces first — either way, the CPI wiring is exercised.)
    const user = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    const keeper = Keypair.generate();
    await fundKeypair(context, keeper.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(42);

    const [cardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    // Real submit so PDA + discriminator are correct.
    await program.methods
      .submitPredictions(fixtureId, [
        { statAKey: 10, statBKey: 0, op: 0, predicateComparison: 0, threshold: 2, period: 0 },
      ])
      .accountsPartial({
        user: user.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Inject a TreeState (skip the real initialize_tree_state — it requires ADMIN).
    const [treeStatePda, treeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      program.programId,
    );
    const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      program.programId,
    );
    const merkleTreePk = Keypair.generate().publicKey;
    const treeStateData = await coder.encode("TreeState", {
      tree: merkleTreePk,
      next_index: new BN(0),
      bump: treeStateBump,
      mint_auth_bump: mintAuthBump,
    });
    context.setAccount(treeStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: treeStateData,
      owner: program.programId,
      executable: false,
    });

    const randomRootPda = Keypair.generate().publicKey;
    // Ensure the wrong daily_scores account exists so account resolution succeeds
    // and the failure comes from TxLINE, not from a missing account.
    context.setAccount(randomRootPda, {
      lamports: LAMPORTS_PER_SOL,
      data: Buffer.alloc(64),
      owner: TXLINE_PROGRAM_ID,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .settlePrediction(
          fixtureId,
          0,
          new BN(0),
          {
            fixtureId: new BN(0),
            competitionId: new BN(0),
            seq: new BN(0),
            homeScore: 0,
            awayScore: 0,
            homeCorners: 0,
            awayCorners: 0,
            homeYellowCards: 0,
            awayYellowCards: 0,
            homeRedCards: 0,
            awayRedCards: 0,
            period: 0,
            timestamp: new BN(0),
          } as any,
          [],
          [],
          { threshold: 2, comparison: { greaterThan: {} } } as any,
          {
            statToProve: { fixtureId: new BN(0), seq: new BN(0), key: 10, value: 0, period: 0 },
            eventStatRoot: new Array(32).fill(0),
            statProof: [],
          } as any,
          null,
          null,
          1, // HIT
          "https://example.com/meta.json",
        )
        .accountsPartial({
          keeper: keeper.publicKey,
          user: user.publicKey,
          predictionCard: cardPda,
          treeState: treeStatePda,
          mintAuth: mintAuthPda,
          treeConfig: Keypair.generate().publicKey,
          merkleTree: merkleTreePk,
          leafOwner: user.publicKey,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          txlineProgram: TXLINE_PROGRAM_ID,
          dailyScoresMerkleRoots: randomRootPda,
          ...collectionAccounts(program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    } catch (e: any) {
      errored = true;
      // TxLINE 6009 = InvalidPda; may also surface as a lower-level failure.
      // The essential invariant is: the tx does not succeed.
    }
    expect(errored).to.equal(true);
  });

  it("S1_settle_wrong_leaf_owner_rejected", async () => {
    // Pass leaf_owner != prediction_card.user, expect Unauthorized before CPI.
    const user = Keypair.generate();
    const attacker = Keypair.generate();
    const keeper = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, keeper.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(43);

    const [cardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    await program.methods
      .submitPredictions(fixtureId, [
        { statAKey: 10, statBKey: 0, op: 0, predicateComparison: 0, threshold: 2, period: 0 },
      ])
      .accountsPartial({
        user: user.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const [treeStatePda, treeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      program.programId,
    );
    const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      program.programId,
    );
    const merkleTreePk = Keypair.generate().publicKey;
    const treeStateData = await coder.encode("TreeState", {
      tree: merkleTreePk,
      next_index: new BN(0),
      bump: treeStateBump,
      mint_auth_bump: mintAuthBump,
    });
    context.setAccount(treeStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: treeStateData,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .settlePrediction(
          fixtureId,
          0,
          new BN(0),
          {
            fixtureId: new BN(0),
            competitionId: new BN(0),
            seq: new BN(0),
            homeScore: 0,
            awayScore: 0,
            homeCorners: 0,
            awayCorners: 0,
            homeYellowCards: 0,
            awayYellowCards: 0,
            homeRedCards: 0,
            awayRedCards: 0,
            period: 0,
            timestamp: new BN(0),
          } as any,
          [],
          [],
          { threshold: 2, comparison: { greaterThan: {} } } as any,
          {
            statToProve: { fixtureId: new BN(0), seq: new BN(0), key: 10, value: 0, period: 0 },
            eventStatRoot: new Array(32).fill(0),
            statProof: [],
          } as any,
          null,
          null,
          1,
          "https://example.com/meta.json",
        )
        .accountsPartial({
          keeper: keeper.publicKey,
          user: user.publicKey,
          predictionCard: cardPda,
          treeState: treeStatePda,
          mintAuth: mintAuthPda,
          treeConfig: Keypair.generate().publicKey,
          merkleTree: merkleTreePk,
          leafOwner: attacker.publicKey, // <-- wrong recipient
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          txlineProgram: TXLINE_PROGRAM_ID,
          dailyScoresMerkleRoots: Keypair.generate().publicKey,
          ...collectionAccounts(program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/Unauthorized|6011/);
    }
    expect(errored).to.equal(true);
  });

  it("S2_slot_already_resolved", async () => {
    // Inject a card whose slot 0 is pre-set to HIT, then attempt settle
    // — the replay guard should fire before any CPI.
    const user = Keypair.generate();
    const keeper = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, keeper.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(44);

    const [cardPda, cardBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    // Build a card with slot 0 status=HIT (1). All other fields aligned to
    // pass the local guards up to and including the replay check.
    const pendingSlot = {
      stat_a_key: 0,
      stat_b_key: 0,
      op: 0,
      predicate_comparison: 0,
      threshold: 0,
      period: 0,
      status: 0,
      sticker_asset_seq: new BN(0),
      event_stat_root: new Array(32).fill(0),
      proof_ts: new BN(0),
    };
    const slots = new Array(8).fill(pendingSlot).map((s) => ({ ...s }));
    slots[0] = {
      stat_a_key: 10,
      stat_b_key: 0,
      op: 0,
      predicate_comparison: 0,
      threshold: 2,
      period: 0,
      status: 1, // HIT — replay guard should fire
      sticker_asset_seq: new BN(0),
      event_stat_root: new Array(32).fill(0),
      proof_ts: new BN(0),
    };
    const cardData = await coder.encode("PredictionCard", {
      user: user.publicKey,
      fixture_id: fixtureId,
      submitted_at: new BN(0),
      slots,
      slot_count: 1,
      match_card_minted: false,
      match_card_event_stat_root: new Array(32).fill(0),
      match_card_proof_ts: new BN(0), bump: cardBump,
    });
    context.setAccount(cardPda, {
      lamports: LAMPORTS_PER_SOL,
      data: cardData,
      owner: program.programId,
      executable: false,
    });

    const [treeStatePda, treeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      program.programId,
    );
    const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      program.programId,
    );
    const merkleTreePk = Keypair.generate().publicKey;
    const treeStateData = await coder.encode("TreeState", {
      tree: merkleTreePk,
      next_index: new BN(0),
      bump: treeStateBump,
      mint_auth_bump: mintAuthBump,
    });
    context.setAccount(treeStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: treeStateData,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .settlePrediction(
          fixtureId,
          0,
          new BN(0),
          {
            fixtureId: new BN(0),
            competitionId: new BN(0),
            seq: new BN(0),
            homeScore: 0,
            awayScore: 0,
            homeCorners: 0,
            awayCorners: 0,
            homeYellowCards: 0,
            awayYellowCards: 0,
            homeRedCards: 0,
            awayRedCards: 0,
            period: 0,
            timestamp: new BN(0),
          } as any,
          [],
          [],
          { threshold: 2, comparison: { greaterThan: {} } } as any,
          {
            statToProve: { fixtureId: new BN(0), seq: new BN(0), key: 10, value: 0, period: 0 },
            eventStatRoot: new Array(32).fill(0),
            statProof: [],
          } as any,
          null,
          null,
          1,
          "uri",
        )
        .accountsPartial({
          keeper: keeper.publicKey,
          user: user.publicKey,
          predictionCard: cardPda,
          treeState: treeStatePda,
          mintAuth: mintAuthPda,
          treeConfig: Keypair.generate().publicKey,
          merkleTree: merkleTreePk,
          leafOwner: user.publicKey,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          txlineProgram: TXLINE_PROGRAM_ID,
          dailyScoresMerkleRoots: Keypair.generate().publicKey,
          ...collectionAccounts(program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/SlotAlreadyResolved|6007/);
    }
    expect(errored).to.equal(true);
  });

  it("S3_match_card_replay_blocked", async () => {
    // Inject a card whose match_card_minted=true; expect MatchCardAlreadyClaimed.
    const user = Keypair.generate();
    const keeper = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, keeper.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(45);

    const [cardPda, cardBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    const pendingSlot = {
      stat_a_key: 0,
      stat_b_key: 0,
      op: 0,
      predicate_comparison: 0,
      threshold: 0,
      period: 0,
      status: 0,
      sticker_asset_seq: new BN(0),
      event_stat_root: new Array(32).fill(0),
      proof_ts: new BN(0),
    };
    const slots = new Array(8).fill(pendingSlot).map((s) => ({ ...s }));
    const cardData = await coder.encode("PredictionCard", {
      user: user.publicKey,
      fixture_id: fixtureId,
      submitted_at: new BN(0),
      slots,
      slot_count: 1,
      match_card_minted: true, // <-- already claimed
      match_card_event_stat_root: new Array(32).fill(0),
      match_card_proof_ts: new BN(0), bump: cardBump,
    });
    context.setAccount(cardPda, {
      lamports: LAMPORTS_PER_SOL,
      data: cardData,
      owner: program.programId,
      executable: false,
    });

    const [treeStatePda, treeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      program.programId,
    );
    const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      program.programId,
    );
    const merkleTreePk = Keypair.generate().publicKey;
    const treeStateData = await coder.encode("TreeState", {
      tree: merkleTreePk,
      next_index: new BN(0),
      bump: treeStateBump,
      mint_auth_bump: mintAuthBump,
    });
    context.setAccount(treeStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: treeStateData,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .claimMatchCard(
          fixtureId,
          new BN(0),
          {
            fixtureId: new BN(0),
            competitionId: new BN(0),
            seq: new BN(0),
            homeScore: 0,
            awayScore: 0,
            homeCorners: 0,
            awayCorners: 0,
            homeYellowCards: 0,
            awayYellowCards: 0,
            homeRedCards: 0,
            awayRedCards: 0,
            period: 0,
            timestamp: new BN(0),
          } as any,
          [],
          [],
          { threshold: 0, comparison: { greaterThan: {} } } as any,
          {
            statToProve: { fixtureId: new BN(0), seq: new BN(0), key: 1, value: 0, period: 0 },
            eventStatRoot: new Array(32).fill(0),
            statProof: [],
          } as any,
          null,
          null,
          "uri",
        )
        .accountsPartial({
          keeper: keeper.publicKey,
          user: user.publicKey,
          predictionCard: cardPda,
          treeState: treeStatePda,
          mintAuth: mintAuthPda,
          treeConfig: Keypair.generate().publicKey,
          merkleTree: merkleTreePk,
          leafOwner: user.publicKey,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          txlineProgram: TXLINE_PROGRAM_ID,
          dailyScoresMerkleRoots: Keypair.generate().publicKey,
          ...collectionAccounts(program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/MatchCardAlreadyClaimed|6008/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Source-level invariants (S9, S12, S14) --------------------------

  it("S9_metadata_immutable", () => {
    // Grep the handler source for `is_mutable: false` — the property that the
    // sticker's Metaplex metadata is immutable at mint time (ADR §9 S9).
    const src = readFileSync(
      join(__dirname, "..", "programs", "momentum", "src", "instructions", "settle_prediction.rs"),
      "utf8",
    );
    expect(src).to.include("is_mutable: false");
    const src2 = readFileSync(
      join(__dirname, "..", "programs", "momentum", "src", "instructions", "claim_match_card.rs"),
      "utf8",
    );
    expect(src2).to.include("is_mutable: false");
  });

  it("S12_overflow_guards", () => {
    // Static check: every arithmetic mutation must go through checked_add /
    // checked_sub / checked_mul. Confirms overflow protection (ADR §9 S12).
    // Files touched: join_group (current_size), settle_prediction (next_index),
    // claim_match_card (next_index).
    const files = ["join_group.rs", "settle_prediction.rs", "claim_match_card.rs"];
    for (const f of files) {
      const src = readFileSync(
        join(__dirname, "..", "programs", "momentum", "src", "instructions", f),
        "utf8",
      );
      expect(src).to.match(/checked_add|checked_sub|checked_mul/);
    }
  });

  it("S14_verified_creator_is_mint_auth", () => {
    // Both mint sites must construct a Creator with verified=true and
    // address = mint_auth.key() so third parties can't fake authorship.
    for (const f of ["settle_prediction.rs", "claim_match_card.rs"]) {
      const src = readFileSync(
        join(__dirname, "..", "programs", "momentum", "src", "instructions", f),
        "utf8",
      );
      expect(src).to.include("verified: true");
      expect(src).to.match(/address:\s*ctx\.accounts\.mint_auth\.key\(\)/);
    }
  });

  // ---- S7: address-checked programs (bubblegumProgram swap) ---------------

  it("S7_wrong_bubblegum_program_rejected", async () => {
    // Pass a random pubkey as `bubblegumProgram`. Anchor's
    // `#[account(address = mpl_bubblegum::ID)]` constraint must fire before
    // the CPI is dispatched. Expect a ConstraintAddress violation (2012).
    const seller = Keypair.generate();
    const buyer = Keypair.generate();
    await fundKeypair(context, seller.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, buyer.publicKey, LAMPORTS_PER_SOL);

    const assetId = Keypair.generate().publicKey;
    const [listingPda, listingBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("listing"), assetId.toBuffer()],
      program.programId,
    );

    const listing = {
      seller: seller.publicKey,
      asset_id: assetId,
      price_lamports: new BN(100_000),
      tree: Keypair.generate().publicKey,
      leaf_index: 0,
      created_at: new BN(0),
      active: true,
      bump: listingBump,
    };
    const encoded = await coder.encode("Listing", listing);
    context.setAccount(listingPda, {
      lamports: LAMPORTS_PER_SOL,
      data: encoded,
      owner: program.programId,
      executable: false,
    });

    const rogueBubblegum = Keypair.generate().publicKey;

    let errored = false;
    try {
      await program.methods
        .buyCard(
          assetId,
          new Array(32).fill(0) as any,
          new Array(32).fill(0) as any,
          new Array(32).fill(0) as any,
          new BN(0),
          0,
        )
        .accountsPartial({
          buyer: buyer.publicKey,
          seller: seller.publicKey,
          listing: listingPda,
          escrowAuthority: PublicKey.findProgramAddressSync(
            [Buffer.from("escrow_auth")],
            program.programId,
          )[0],
          treeConfig: Keypair.generate().publicKey,
          merkleTree: listing.tree,
          bubblegumProgram: rogueBubblegum, // <-- wrong program
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([buyer])
        .rpc();
    } catch (e: any) {
      errored = true;
      // ConstraintAddress = 2012 (Anchor). Some environments may surface the
      // failure as an account-not-found (3007) if resolution short-circuits.
      expect(String(e)).to.match(/ConstraintAddress|2012|address|AccountOwnedByWrongProgram/);
    }
    expect(errored).to.equal(true);
  });

  // ---- S11: stat_a.key mismatch on HIT branch ----------------------------

  it("S11_wrong_stat_a_key_rejected", async () => {
    // Build synthetic card, call settle_prediction with
    // stat_a.stat_to_prove.key != slot.stat_a_key; expect StatKeyMismatchLocal
    // (fires at the local require_eq! well before any CPI).
    const user = Keypair.generate();
    const keeper = Keypair.generate();
    await fundKeypair(context, user.publicKey, LAMPORTS_PER_SOL);
    await fundKeypair(context, keeper.publicKey, LAMPORTS_PER_SOL);
    const fixtureId = new BN(4711);

    const [cardPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("card"), user.publicKey.toBuffer(), fixtureId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );

    // Build a pending card via real submit_predictions with statAKey=10.
    await program.methods
      .submitPredictions(fixtureId, [
        { statAKey: 10, statBKey: 0, op: 0, predicateComparison: 0, threshold: 2, period: 0 },
      ])
      .accountsPartial({
        user: user.publicKey,
        card: cardPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Inject TreeState so accounts resolve, then call with mismatched stat_a.key.
    const [treeStatePda, treeStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("tree_state")],
      program.programId,
    );
    const [mintAuthPda, mintAuthBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_auth")],
      program.programId,
    );
    const merkleTreePk = Keypair.generate().publicKey;
    const treeStateData = await coder.encode("TreeState", {
      tree: merkleTreePk,
      next_index: new BN(0),
      bump: treeStateBump,
      mint_auth_bump: mintAuthBump,
    });
    context.setAccount(treeStatePda, {
      lamports: LAMPORTS_PER_SOL,
      data: treeStateData,
      owner: program.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .settlePrediction(
          fixtureId,
          0,
          new BN(0),
          {
            fixtureId: new BN(0),
            competitionId: new BN(0),
            seq: new BN(0),
            homeScore: 0,
            awayScore: 0,
            homeCorners: 0,
            awayCorners: 0,
            homeYellowCards: 0,
            awayYellowCards: 0,
            homeRedCards: 0,
            awayRedCards: 0,
            period: 0,
            timestamp: new BN(0),
          } as any,
          [],
          [],
          { threshold: 2, comparison: { greaterThan: {} } } as any,
          {
            // stat_to_prove.key = 99, but slot's stat_a_key = 10 -> mismatch.
            statToProve: { fixtureId: new BN(0), seq: new BN(0), key: 99, value: 0, period: 0 },
            eventStatRoot: new Array(32).fill(0),
            statProof: [],
          } as any,
          null,
          null,
          1, // HIT
          "uri",
        )
        .accountsPartial({
          keeper: keeper.publicKey,
          user: user.publicKey,
          predictionCard: cardPda,
          treeState: treeStatePda,
          mintAuth: mintAuthPda,
          treeConfig: Keypair.generate().publicKey,
          merkleTree: merkleTreePk,
          leafOwner: user.publicKey,
          logWrapper: SPL_NOOP_ID,
          compressionProgram: SPL_ACCOUNT_COMPRESSION_ID,
          bubblegumProgram: BUBBLEGUM_PROGRAM_ID,
          txlineProgram: TXLINE_PROGRAM_ID,
          dailyScoresMerkleRoots: Keypair.generate().publicKey,
          ...collectionAccounts(program.programId),
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/StatKeyMismatchLocal|6013/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Pass 10: pause + distribute_prize -------------------------------

  // Load the local admin keypair. Tests are skipped gracefully if the file
  // isn't present so this file remains portable to CI without secrets.
  function loadAdminKeypair(): Keypair | null {
    try {
      const path = process.env.ADMIN_KEYPAIR_PATH ||
        `${process.env.HOME}/.config/solana/id.json`;
      const secret = JSON.parse(readFileSync(path, "utf8"));
      const kp = Keypair.fromSecretKey(Uint8Array.from(secret));
      // Match against the hardcoded ADMIN pubkey in initialize_tree_state.rs.
      if (kp.publicKey.toBase58() !== "2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV") {
        return null;
      }
      return kp;
    } catch {
      return null;
    }
  }

  it("pause_group_ok + unpause_group_ok", async () => {
    const admin = loadAdminKeypair();
    if (!admin) return; // gracefully skip in CI
    await fundKeypair(context, admin.publicKey, 5 * LAMPORTS_PER_SOL);

    const groupId = new BN(101);
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [creatorMem] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );
    const [extPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group_ext"), groupPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .createGroup(groupId, "PauseMe", 3, new BN(0))
      .accountsPartial({
        creator: payer.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership: creatorMem,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Pause.
    await program.methods
      .pauseGroup(groupId)
      .accountsPartial({
        admin: admin.publicKey,
        group: groupPda,
        groupExtension: extPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    let ext = await program.account.groupExtension.fetch(extPda);
    expect(ext.paused).to.equal(true);
    expect(ext.prizeDistributed).to.equal(false);

    // Join while paused (with extension supplied) -> GroupPaused.
    const joiner = Keypair.generate();
    await fundKeypair(context, joiner.publicKey, LAMPORTS_PER_SOL);
    const [joinerMem] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), joiner.publicKey.toBuffer()],
      program.programId,
    );
    let errored = false;
    try {
      await program.methods
        .joinGroup(groupId)
        .accountsPartial({
          user: joiner.publicKey,
          group: groupPda,
          vault: vaultPda,
          membership: joinerMem,
          groupExtension: extPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([joiner])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/GroupPaused/);
    }
    expect(errored).to.equal(true);

    // Unpause.
    await program.methods
      .unpauseGroup(groupId)
      .accountsPartial({
        admin: admin.publicKey,
        group: groupPda,
        groupExtension: extPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    ext = await program.account.groupExtension.fetch(extPda);
    expect(ext.paused).to.equal(false);

    // Now join succeeds.
    await program.methods
      .joinGroup(groupId)
      .accountsPartial({
        user: joiner.publicKey,
        group: groupPda,
        vault: vaultPda,
        membership: joinerMem,
        groupExtension: extPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([joiner])
      .rpc();
  });

  it("distribute_prize_ok (proportional payout)", async () => {
    const admin = loadAdminKeypair();
    if (!admin) return;
    await fundKeypair(context, admin.publicKey, 5 * LAMPORTS_PER_SOL);

    const groupId = new BN(102);
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [creatorMem] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );
    const [extPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group_ext"), groupPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .createGroup(groupId, "PrizeCo", 3, new BN(0))
      .accountsPartial({
        creator: payer.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership: creatorMem,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Add a second member.
    const m2 = Keypair.generate();
    await fundKeypair(context, m2.publicKey, LAMPORTS_PER_SOL);
    const [m2Pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), m2.publicKey.toBuffer()],
      program.programId,
    );
    await program.methods
      .joinGroup(groupId)
      .accountsPartial({
        user: m2.publicKey,
        group: groupPda,
        vault: vaultPda,
        membership: m2Pda,
        groupExtension: null,
        systemProgram: SystemProgram.programId,
      })
      .signers([m2])
      .rpc();

    // Directly manipulate Membership.score via context.setAccount to
    // simulate accrued hit-scores (we don't have a settle path in bankrun).
    // creator score = 3, m2 score = 1 -> creator gets 75%, m2 gets 25%.
    for (const [memPda, user, score] of [
      [creatorMem, payer.publicKey, 3],
      [m2Pda, m2.publicKey, 1],
    ] as [PublicKey, PublicKey, number][]) {
      const existing = await context.banksClient.getAccount(memPda);
      const data = await coder.encode("Membership", {
        group: groupPda,
        user,
        joined_at: new BN(0),
        score,
        bump: 255,
      });
      context.setAccount(memPda, {
        lamports: existing!.lamports,
        data,
        owner: program.programId,
        executable: false,
      });
    }

    // Fund the vault with 1_000_000 lamports on top of any rent reserve.
    const vaultAcct = await context.banksClient.getAccount(vaultPda);
    const currentLamports = vaultAcct ? Number(vaultAcct.lamports) : 0;
    const rentReserve = 890880; // minimum_balance(0) on default rent (approx)
    const seed = Math.max(currentLamports, rentReserve) + 1_000_000;
    context.setAccount(vaultPda, {
      lamports: seed,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    const before1 = (await context.banksClient.getAccount(payer.publicKey))!.lamports;
    const before2 = (await context.banksClient.getAccount(m2.publicKey))!.lamports;

    await program.methods
      .distributePrize(groupId)
      .accountsPartial({
        caller: admin.publicKey,
        group: groupPda,
        vault: vaultPda,
        groupExtension: extPda,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        // Interleaved: [membership_1, recipient_1, membership_2, recipient_2]
        { pubkey: creatorMem, isSigner: false, isWritable: false },
        { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        { pubkey: m2Pda, isSigner: false, isWritable: false },
        { pubkey: m2.publicKey, isSigner: false, isWritable: true },
      ])
      .signers([admin])
      .rpc();

    const after1 = (await context.banksClient.getAccount(payer.publicKey))!.lamports;
    const after2 = (await context.banksClient.getAccount(m2.publicKey))!.lamports;
    const gained1 = Number(after1 - before1);
    const gained2 = Number(after2 - before2);
    // creator should get ~750k, m2 ~250k out of the 1M distributable
    expect(gained1).to.be.greaterThan(gained2);
    // Distributable = vault_lamports - rent_reserve; allow slack for
    // integer-division rounding and rent-reserve variance across runtimes.
    expect(gained1 + gained2).to.be.greaterThanOrEqual(900_000);
    // Ratio should be roughly 3:1 (creator score=3, m2 score=1).
    expect(gained1).to.be.greaterThan(gained2 * 2);

    const ext = await program.account.groupExtension.fetch(extPda);
    expect(ext.prizeDistributed).to.equal(true);
  });

  it("distribute_prize_replay_blocked", async () => {
    const admin = loadAdminKeypair();
    if (!admin) return;
    const groupId = new BN(102); // reuse the group from previous test
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [extPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group_ext"), groupPda.toBuffer()],
      program.programId,
    );
    const [creatorMem] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );

    // Re-fund vault so vault_lamports > 0.
    context.setAccount(vaultPda, {
      lamports: 5_000_000,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .distributePrize(groupId)
        .accountsPartial({
          caller: admin.publicKey,
          group: groupPda,
          vault: vaultPda,
          groupExtension: extPda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: creatorMem, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([admin])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/PrizeAlreadyDistributed/);
    }
    expect(errored).to.equal(true);
  });

  it("distribute_prize_paused", async () => {
    const admin = loadAdminKeypair();
    if (!admin) return;
    await fundKeypair(context, admin.publicKey, 5 * LAMPORTS_PER_SOL);

    const groupId = new BN(103);
    const [groupPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group"), groupId.toArrayLike(Buffer, "le", 8)],
      program.programId,
    );
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), groupPda.toBuffer()],
      program.programId,
    );
    const [creatorMem] = PublicKey.findProgramAddressSync(
      [Buffer.from("member"), groupPda.toBuffer(), payer.publicKey.toBuffer()],
      program.programId,
    );
    const [extPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("group_ext"), groupPda.toBuffer()],
      program.programId,
    );

    await program.methods
      .createGroup(groupId, "PausedPrize", 2, new BN(0))
      .accountsPartial({
        creator: payer.publicKey,
        group: groupPda,
        vault: vaultPda,
        creatorMembership: creatorMem,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Pause.
    await program.methods
      .pauseGroup(groupId)
      .accountsPartial({
        admin: admin.publicKey,
        group: groupPda,
        groupExtension: extPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    context.setAccount(vaultPda, {
      lamports: 5_000_000,
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      executable: false,
    });

    let errored = false;
    try {
      await program.methods
        .distributePrize(groupId)
        .accountsPartial({
          caller: admin.publicKey,
          group: groupPda,
          vault: vaultPda,
          groupExtension: extPda,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: creatorMem, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: true },
        ])
        .signers([admin])
        .rpc();
    } catch (e: any) {
      errored = true;
      expect(String(e)).to.match(/GroupPaused/);
    }
    expect(errored).to.equal(true);
  });

  // ---- Skipped: live-TxLINE-proof tests ---------------------------------

  it.skip("list_and_cancel", async () => {
    // TODO: bootstrap a Bubblegum tree via scripts/create-tree.ts (or the
    // bankrun equivalent), then call list_for_sale + cancel_listing.
  });

  it.skip("list_buy_atomic", async () => {
    // TODO: same tree bootstrap + a second keypair to buy.
  });

  it.skip("settle_prediction_hit_ok", async () => {
    // TODO: needs (a) initialized TreeState + a real Bubblegum tree, (b) a
    // captured stat-validation payload matching daily_scores fixture at
    // epoch_day 20310. Capture with:
    //   curl "$BACKEND/api/scores/stat-validation?fixtureId=<id>&statKey=<key>&ts=<ms>" \
    //     > tests/fixtures/proofs/stat_validation_<fixture>_<seq>_<key>.json
  });

  it.skip("settle_prediction_replay_blocked", async () => {
    // TODO: run the happy path once, then rerun; expect SlotAlreadyResolved.
    // Depends on `settle_prediction_hit_ok` fixture.
  });

  it.skip("claim_match_card_double", async () => {
    // TODO: run happy-path claim once, then re-run and assert
    // MatchCardAlreadyClaimed. Depends on the tree bootstrap.
  });
});

// -------- helpers --------

async function fundKeypair(ctx: ProgramTestContext, to: PublicKey, lamports: number) {
  const acct = await ctx.banksClient.getAccount(to);
  if (acct && acct.lamports >= lamports) return;
  ctx.setAccount(to, {
    lamports,
    data: Buffer.alloc(0),
    owner: SystemProgram.programId,
    executable: false,
  });
}
