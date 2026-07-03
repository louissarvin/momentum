//! claim_match_card — mints the summary/match-card cNFT for a fixture.
//!
//! Same orchestrator flow as [`settle_prediction`]. The keeper picks a
//! trivially-satisfied `TraderPredicate` against the fixture's final scores
//! (e.g. "total goals >= 0" via a stat chosen so the GT/EQ branch always
//! holds) so that TxLINE returns Ok and the match card gets minted with the
//! ScoresBatchSummary as anchor.
//!
//! ### Handler ordering (F-04, CEI + Effects-before-Bubblegum)
//!   1. Local guards (`require!`) — including `!card.match_card_minted`
//!   2. TxLINE CPI (`validate_stat`) — must succeed to proceed
//!   3. Persist proof lineage (`card.match_card_event_stat_root`, `..proof_ts`)
//!   4. State transition (`card.match_card_minted = true`, `next_index++`)
//!   5. Bubblegum CPI (`mint_v1`)
//!   6. `emit!(MatchCardClaimed { .. })`

use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::MintToCollectionV1CpiBuilder;
use mpl_bubblegum::types::{Collection, Creator, MetadataArgs, TokenProgramVersion, TokenStandard};
use mpl_bubblegum::utils::get_asset_id;

use crate::errors::MomentumError;
use crate::events::MatchCardClaimed;
use crate::program_ids::{MPL_TOKEN_METADATA_ID, SPL_ACCOUNT_COMPRESSION_ID, SPL_NOOP_ID};
use crate::state::{CollectionState, PredictionCard, TreeState};

#[derive(Accounts)]
#[instruction(fixture_id: i64)]
pub struct ClaimMatchCard<'info> {
    /// Permissionless keeper (payer for CU).
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// CHECK: user pubkey used only for card PDA derivation and leaf_owner check.
    pub user: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"card".as_ref(), user.key().as_ref(), &fixture_id.to_le_bytes()],
        bump = prediction_card.bump,
        has_one = user @ MomentumError::Unauthorized,
    )]
    pub prediction_card: Box<Account<'info, PredictionCard>>,

    #[account(
        mut,
        seeds = [b"tree_state"],
        bump = tree_state.bump,
        constraint = tree_state.tree == merkle_tree.key() @ MomentumError::TreeMismatch,
    )]
    pub tree_state: Box<Account<'info, TreeState>>,

    #[account(
        seeds = [b"collection_state"],
        bump = collection_state.bump,
        constraint = collection_state.collection_mint == collection_mint.key() @ MomentumError::TreeMismatch,
    )]
    pub collection_state: Box<Account<'info, CollectionState>>,

    /// CHECK: mint_auth PDA; signs Bubblegum mint CPI (tree delegate + collection authority).
    #[account(mut, seeds = [b"mint_auth"], bump = tree_state.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    // -- Bubblegum CPI accounts --
    /// CHECK: Bubblegum tree_config PDA.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: merkle tree; pinned by `tree_state` constraint above.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: recipient of the match card cNFT. Must equal `prediction_card.user` (S1).
    pub leaf_owner: UncheckedAccount<'info>,

    // -- Collection accounts (Metaplex Token Metadata) --
    /// CHECK: address pinned via `collection_state` constraint above.
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Token Metadata metadata PDA.
    #[account(
        mut,
        seeds = [b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), collection_mint.key().as_ref()],
        bump,
        seeds::program = MPL_TOKEN_METADATA_ID,
    )]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Token Metadata master edition PDA.
    #[account(
        seeds = [b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), collection_mint.key().as_ref(), b"edition"],
        bump,
        seeds::program = MPL_TOKEN_METADATA_ID,
    )]
    pub collection_edition: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's collection_cpi signer PDA.
    #[account(
        seeds = [b"collection_cpi"],
        bump,
        seeds::program = mpl_bubblegum::ID,
    )]
    pub bubblegum_signer: UncheckedAccount<'info>,

    /// CHECK: SPL noop log wrapper.
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: spl-account-compression.
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: mpl_bubblegum.
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: Token Metadata program (address-checked).
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    // -- TxLINE CPI accounts --
    /// CHECK: TxLINE program (address-checked).
    #[account(address = crate::txoracle::ID)]
    pub txline_program: UncheckedAccount<'info>,
    /// CHECK: TxLINE `daily_scores_roots` PDA (day-scoped, see settle_prediction).
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn claim_match_card_handler(
    ctx: Context<ClaimMatchCard>,
    _fixture_id: i64,
    ts: i64,
    fixture_summary: crate::txoracle::types::ScoresBatchSummary,
    fixture_proof: Vec<crate::txoracle::types::ProofNode>,
    main_tree_proof: Vec<crate::txoracle::types::ProofNode>,
    predicate: crate::txoracle::types::TraderPredicate,
    stat_a: crate::txoracle::types::StatTerm,
    stat_b: Option<crate::txoracle::types::StatTerm>,
    op: Option<crate::txoracle::types::BinaryExpression>,
    metadata_uri: String,
) -> Result<()> {
    // ---- 1) Local guards ----------------------------------------------------

    let card = &mut ctx.accounts.prediction_card;

    // S3: single-shot mint. Also serves as reentrancy guard.
    require!(
        !card.match_card_minted,
        MomentumError::MatchCardAlreadyClaimed
    );

    // S1: sticker must go to the card owner.
    require_keys_eq!(
        ctx.accounts.leaf_owner.key(),
        card.user,
        MomentumError::Unauthorized
    );

    // Snapshot fields we need after `stat_a` is moved into the CPI.
    let stat_a_event_root: [u8; 32] = stat_a.event_stat_root;

    // ---- 2) CPI: validate_stat (TxLINE proof) ------------------------------

    let cpi_accounts = crate::txoracle::cpi::accounts::ValidateStat {
        daily_scores_merkle_roots: ctx.accounts.daily_scores_merkle_roots.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.txline_program.to_account_info(), cpi_accounts);
    crate::txoracle::cpi::validate_stat(
        cpi_ctx,
        ts,
        fixture_summary,
        fixture_proof,
        main_tree_proof,
        predicate,
        stat_a,
        stat_b,
        op,
    )?;

    // ---- 3) Persist proof lineage (M-01) -----------------------------------

    card.match_card_event_stat_root = stat_a_event_root;
    card.match_card_proof_ts = ts;

    // ---- 4) State transition (before Bubblegum CPI, per F-04) --------------

    card.match_card_minted = true;

    let asset_seq = ctx.accounts.tree_state.next_index;
    ctx.accounts.tree_state.next_index = ctx
        .accounts
        .tree_state
        .next_index
        .checked_add(1)
        .ok_or(MomentumError::NumericOverflow)?;

    let user_pk = card.user;
    let fixture_id_val = card.fixture_id;
    let mint_auth_bump = ctx.accounts.tree_state.mint_auth_bump;
    let merkle_tree_key = ctx.accounts.merkle_tree.key();
    let asset_id = get_asset_id(&merkle_tree_key, asset_seq);

    // ---- 5) CPI: mint_v1 ---------------------------------------------------

    let name = format!("MOMENTUM MATCH #{}", fixture_id_val);
    let collection_mint_key = ctx.accounts.collection_mint.key();
    let metadata = MetadataArgs {
        name,
        symbol: "MMTX".to_string(),
        uri: metadata_uri,
        seller_fee_basis_points: 500,
        primary_sale_happened: false,
        is_mutable: false,
        edition_nonce: None,
        token_standard: Some(TokenStandard::NonFungible),
        collection: Some(Collection {
            verified: true,
            key: collection_mint_key,
        }),
        uses: None,
        token_program_version: TokenProgramVersion::Original,
        creators: vec![Creator {
            address: ctx.accounts.mint_auth.key(),
            verified: true,
            share: 100,
        }],
    };

    let mint_auth_seeds: &[&[u8]] = &[b"mint_auth", core::slice::from_ref(&mint_auth_bump)];
    let signer_seeds: &[&[&[u8]]] = &[mint_auth_seeds];

    // See settle_prediction.rs re: kinobi codegen bug — always pass
    // bubblegum_signer + token_metadata_program explicitly.
    MintToCollectionV1CpiBuilder::new(&ctx.accounts.bubblegum_program)
        .tree_config(&ctx.accounts.tree_config)
        .leaf_owner(&ctx.accounts.leaf_owner)
        .leaf_delegate(&ctx.accounts.leaf_owner)
        .merkle_tree(&ctx.accounts.merkle_tree)
        .payer(&ctx.accounts.keeper)
        .tree_creator_or_delegate(&ctx.accounts.mint_auth)
        .collection_authority(&ctx.accounts.mint_auth)
        .collection_authority_record_pda(None)
        .collection_mint(&ctx.accounts.collection_mint)
        .collection_metadata(&ctx.accounts.collection_metadata)
        .collection_edition(&ctx.accounts.collection_edition)
        .bubblegum_signer(&ctx.accounts.bubblegum_signer)
        .log_wrapper(&ctx.accounts.log_wrapper)
        .compression_program(&ctx.accounts.compression_program)
        .token_metadata_program(&ctx.accounts.token_metadata_program)
        .system_program(&ctx.accounts.system_program)
        .metadata(metadata)
        .invoke_signed(signer_seeds)?;

    // ---- 6) Event emission -------------------------------------------------

    emit!(MatchCardClaimed {
        user: user_pk,
        fixture_id: fixture_id_val,
        match_card_seq: asset_seq,
        event_stat_root: stat_a_event_root,
        proof_ts: ts,
        asset_id,
        merkle_tree: merkle_tree_key,
    });

    Ok(())
}
