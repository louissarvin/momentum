//! settle_prediction — settles ONE slot on a `PredictionCard`.
//!
//! ORCHESTRATOR-ONLY.  Momentum does not evaluate the predicate itself.
//!
//! ### Handler ordering (F-04, CEI + Effects-before-Bubblegum)
//!   1. Local guards (`require!`)
//!   2. TxLINE CPI (`validate_stat`) — must succeed to proceed
//!   3. Persist proof lineage (`slot.event_stat_root`, `slot.proof_ts`)
//!   4. State transition (`slot.status`, `slot.sticker_asset_seq`, `next_index++`)
//!   5. Bubblegum CPI (`mint_v1`)
//!   6. `emit!(StickerMinted { .. })`
//!
//! Rationale: (2) is verified before any state changes so a TxLINE failure
//! aborts the whole tx without touching the card. (4) happens BEFORE (5) so
//! any future Bubblegum-reentrancy vector cannot re-enter with `Pending`
//! status. (5) doesn't need any post-hoc bookkeeping — if it fails the whole
//! tx aborts atomically.
//!
//! ### Negation policy for MISS (F-05)
//! When `outcome_claim = MISS`, the keeper submits the *negated* predicate.
//! TxLINE has only `GreaterThan (0)`, `LessThan (1)`, `EqualTo (2)` — no
//! `<=` or `>=`. So a strict logical negation is not always representable in
//! one comparison, but the following table lists every allowed pair:
//!
//! | stored (user) | valid MISS submissions | Meaning |
//! |---|---|---|
//! | `GreaterThan (0)` | `LessThan (1)` OR `EqualTo (2)` | value <= threshold |
//! | `LessThan (1)`    | `GreaterThan (0)` OR `EqualTo (2)` | value >= threshold |
//! | `EqualTo (2)`     | `GreaterThan (0)` OR `LessThan (1)` | value != threshold |
//!
//! `predicate.threshold` MUST still equal `slot.threshold`. This prevents a
//! keeper from proving "value != some-other-threshold" and burning a MISS
//! sticker against an unrelated bound.
//!
//! ### Trust model
//! - `keeper` (Signer) is permissionless — anyone can pay CU to settle.
//! - The user pubkey is derived from the Card PDA; the cNFT is minted to
//!   `leaf_owner`, which is `require_keys_eq!`'d against the card's user
//!   (S1). This prevents a malicious keeper from redirecting the sticker.

use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::MintToCollectionV1CpiBuilder;
use mpl_bubblegum::types::{Collection, Creator, MetadataArgs, TokenProgramVersion, TokenStandard};
use mpl_bubblegum::utils::get_asset_id;

use crate::errors::MomentumError;
use crate::events::StickerMinted;
use crate::program_ids::{MPL_TOKEN_METADATA_ID, SPL_ACCOUNT_COMPRESSION_ID, SPL_NOOP_ID};
use crate::state::{CollectionState, PredictionCard, SlotStatus, TreeState};

/// Truth table for the MISS negation policy. See module docs above.
///
/// * `stored_cmp` = the user's stored `slot.predicate_comparison`
/// * `submitted_cmp` = the comparison the keeper is asking TxLINE to prove
#[inline]
fn is_valid_miss_negation(stored_cmp: u8, submitted_cmp: u8) -> bool {
    match (stored_cmp, submitted_cmp) {
        // GreaterThan negated -> either LessThan or EqualTo works.
        (0, 1) | (0, 2) => true,
        // LessThan negated -> either GreaterThan or EqualTo.
        (1, 0) | (1, 2) => true,
        // EqualTo negated -> either GreaterThan or LessThan.
        (2, 0) | (2, 1) => true,
        _ => false,
    }
}

#[derive(Accounts)]
#[instruction(fixture_id: i64, slot_index: u8)]
pub struct SettlePrediction<'info> {
    /// Permissionless keeper. Pays CU and rent for tx.
    #[account(mut)]
    pub keeper: Signer<'info>,

    /// CHECK: user pubkey only used for card PDA derivation and leaf_owner check.
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

    /// Binds the mint to the on-chain Metaplex collection NFT so cNFTs land
    /// in the "MOMENTUM" wallet group. Additive PDA per plan Q1 Option B.
    #[account(
        seeds = [b"collection_state"],
        bump = collection_state.bump,
        constraint = collection_state.collection_mint == collection_mint.key() @ MomentumError::TreeMismatch,
    )]
    pub collection_state: Box<Account<'info, CollectionState>>,

    /// CHECK: mint authority PDA; signs the Bubblegum mint CPI both as tree
    /// delegate AND as collection authority (via invoke_signed).
    #[account(mut, seeds = [b"mint_auth"], bump = tree_state.mint_auth_bump)]
    pub mint_auth: UncheckedAccount<'info>,

    // -- Bubblegum CPI accounts --
    /// CHECK: Bubblegum tree_config PDA. Verified by Bubblegum internally.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: merkle tree. `tree_state` constraint above pins it to `TreeState.tree`.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,
    /// CHECK: recipient of the sticker cNFT. Must equal `prediction_card.user` (S1).
    pub leaf_owner: UncheckedAccount<'info>,

    // -- Collection accounts (Metaplex Token Metadata) --
    /// CHECK: address pinned via `collection_state` constraint above.
    pub collection_mint: UncheckedAccount<'info>,
    /// CHECK: Token Metadata metadata PDA `[b"metadata", MPL_META_ID, mint]`.
    #[account(
        mut,
        seeds = [b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), collection_mint.key().as_ref()],
        bump,
        seeds::program = MPL_TOKEN_METADATA_ID,
    )]
    pub collection_metadata: UncheckedAccount<'info>,
    /// CHECK: Token Metadata master edition PDA
    /// `[b"metadata", MPL_META_ID, mint, b"edition"]`.
    #[account(
        seeds = [b"metadata", MPL_TOKEN_METADATA_ID.as_ref(), collection_mint.key().as_ref(), b"edition"],
        bump,
        seeds::program = MPL_TOKEN_METADATA_ID,
    )]
    pub collection_edition: UncheckedAccount<'info>,
    /// CHECK: Bubblegum's collection_cpi signer PDA `[b"collection_cpi"]`
    /// under the Bubblegum program. Well-known helper PDA that Bubblegum uses
    /// to CPI into Token Metadata's set_and_verify_collection.
    #[account(
        seeds = [b"collection_cpi"],
        bump,
        seeds::program = mpl_bubblegum::ID,
    )]
    pub bubblegum_signer: UncheckedAccount<'info>,

    /// CHECK: SPL noop log wrapper (address-checked).
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: SPL account compression program (address-checked).
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,
    /// CHECK: mpl_bubblegum program (address-checked).
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: Token Metadata program (address-checked).
    #[account(address = MPL_TOKEN_METADATA_ID)]
    pub token_metadata_program: UncheckedAccount<'info>,

    // -- TxLINE CPI accounts --
    /// CHECK: TxLINE program (address-checked).
    #[account(address = crate::txoracle::ID)]
    pub txline_program: UncheckedAccount<'info>,
    /// CHECK: TxLINE `daily_scores_roots` PDA.
    /// Seeds `[b"daily_scores_roots", u16_le(epoch_day)]` — day-scoped account,
    /// TxLINE indexes into the 288 five-minute-slot roots inside using `ts`.
    /// TxLINE re-derives + validates internally; wrong PDA -> `InvalidPda 6009`.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn settle_prediction_handler(
    ctx: Context<SettlePrediction>,
    _fixture_id: i64,
    slot_index: u8,
    ts: i64,
    fixture_summary: crate::txoracle::types::ScoresBatchSummary,
    fixture_proof: Vec<crate::txoracle::types::ProofNode>,
    main_tree_proof: Vec<crate::txoracle::types::ProofNode>,
    predicate: crate::txoracle::types::TraderPredicate,
    stat_a: crate::txoracle::types::StatTerm,
    stat_b: Option<crate::txoracle::types::StatTerm>,
    op: Option<crate::txoracle::types::BinaryExpression>,
    outcome_claim: u8,
    metadata_uri: String,
) -> Result<()> {
    // ---- 1) Local guards ----------------------------------------------------

    require!(slot_index < 8, MomentumError::BadSlotIndex);
    let card = &mut ctx.accounts.prediction_card;
    require!(
        (slot_index as usize) < card.slot_count as usize,
        MomentumError::BadSlotIndex
    );

    // S1: sticker must go to the card owner, not to the keeper.
    require_keys_eq!(
        ctx.accounts.leaf_owner.key(),
        card.user,
        MomentumError::Unauthorized
    );

    require!(
        outcome_claim == SlotStatus::HIT || outcome_claim == SlotStatus::MISS,
        MomentumError::PredicateFieldMismatch
    );

    let slot = &mut card.slots[slot_index as usize];

    // S2: replay guard. Also acts as the reentrancy gate.
    require!(
        slot.status == SlotStatus::PENDING,
        MomentumError::SlotAlreadyResolved
    );

    // S10: compound stat integrity.
    if slot.stat_b_key != 0 {
        require!(
            stat_b.is_some() && op.is_some(),
            MomentumError::MissingCompoundStat
        );
    } else {
        require!(
            stat_b.is_none() && op.is_none(),
            MomentumError::UnexpectedCompoundStat
        );
    }

    // S11: stat_a.key must match slot.stat_a_key.
    require_eq!(
        stat_a.stat_to_prove.key as i32,
        slot.stat_a_key,
        MomentumError::StatKeyMismatchLocal
    );
    if let Some(ref b) = stat_b {
        require_eq!(
            b.stat_to_prove.key as i32,
            slot.stat_b_key,
            MomentumError::StatKeyMismatchLocal
        );
    }

    // S11: predicate integrity depends on outcome branch.
    require_eq!(
        predicate.threshold,
        slot.threshold,
        MomentumError::PredicateFieldMismatch
    );
    let submitted_cmp = predicate.comparison.clone() as u8;
    if outcome_claim == SlotStatus::HIT {
        // Hit: keeper must prove the user's original predicate verbatim.
        require_eq!(
            submitted_cmp,
            slot.predicate_comparison,
            MomentumError::PredicateFieldMismatch
        );
    } else {
        // Miss: keeper must submit an explicitly-allowed negation of the stored
        // comparison (see is_valid_miss_negation truth table above).
        require!(
            is_valid_miss_negation(slot.predicate_comparison, submitted_cmp),
            MomentumError::PredicateFieldMismatch
        );
    }

    // Snapshot stat_a fields we still need after `stat_a` is moved into the CPI.
    let stat_a_event_root: [u8; 32] = stat_a.event_stat_root;

    // ---- 2) CPI: validate_stat (Merkle + predicate proof in one shot) ------

    let cpi_accounts = crate::txoracle::cpi::accounts::ValidateStat {
        daily_scores_merkle_roots: ctx.accounts.daily_scores_merkle_roots.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.txline_program.to_account_info(), cpi_accounts);
    // TxLINE aborts on any 6xxx error; the tx never reaches the mint below (S8).
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

    slot.event_stat_root = stat_a_event_root;
    slot.proof_ts = ts;

    // ---- 4) State transition (before Bubblegum CPI, per F-04) --------------

    let asset_seq = ctx.accounts.tree_state.next_index;
    slot.status = outcome_claim;
    slot.sticker_asset_seq = asset_seq;
    ctx.accounts.tree_state.next_index = ctx
        .accounts
        .tree_state
        .next_index
        .checked_add(1)
        .ok_or(MomentumError::NumericOverflow)?;

    // Persist the local values we need after the mutable borrow drops.
    let user_pk = card.user;
    let fixture_id_val = card.fixture_id;
    let mint_auth_bump = ctx.accounts.tree_state.mint_auth_bump;
    let merkle_tree_key = ctx.accounts.merkle_tree.key();
    let asset_id = get_asset_id(&merkle_tree_key, asset_seq);

    // ---- 5) CPI: mint_v1 ----------------------------------------------------

    let outcome_label = if outcome_claim == SlotStatus::HIT {
        "HIT"
    } else {
        "MISS"
    };
    let name = format!("MMT-{} #{} {}", fixture_id_val, slot_index, outcome_label);
    let collection_mint_key = ctx.accounts.collection_mint.key();
    let metadata = MetadataArgs {
        name,
        symbol: "MMT".to_string(),
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

    // Kinobi codegen bug (mpl-bubblegum 2.1.1): `bubblegum_signer` and
    // `token_metadata_program` builder defaults are hardcoded to the Bubblegum
    // program ID. Always pass explicitly. See notes/collection-upgrade-plan.md Q2.
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

    // ---- 6) Event emission --------------------------------------------------

    emit!(StickerMinted {
        user: user_pk,
        fixture_id: fixture_id_val,
        slot_index,
        outcome: outcome_claim,
        sticker_asset_seq: asset_seq,
        event_stat_root: stat_a_event_root,
        proof_ts: ts,
        asset_id,
        merkle_tree: merkle_tree_key,
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn miss_negation_truth_table() {
        // Complete 3x3 truth table for (stored, submitted, expected).
        // stored/submitted comparisons: 0 = GreaterThan, 1 = LessThan, 2 = EqualTo.
        // The diagonal (stored == submitted) is INVALID — that's the HIT case,
        // not a valid MISS negation.
        let cases: &[(u8, u8, bool)] = &[
            // Stored: GreaterThan
            (0, 0, false),
            (0, 1, true),
            (0, 2, true),
            // Stored: LessThan
            (1, 0, true),
            (1, 1, false),
            (1, 2, true),
            // Stored: EqualTo
            (2, 0, true),
            (2, 1, true),
            (2, 2, false),
        ];
        for (stored, submitted, expected) in cases {
            let got = is_valid_miss_negation(*stored, *submitted);
            assert_eq!(
                got, *expected,
                "is_valid_miss_negation({}, {}) expected {} got {}",
                stored, submitted, expected, got
            );
        }

        // Out-of-range values are always invalid.
        for bad in &[3u8, 4, 10, 255] {
            assert!(!is_valid_miss_negation(*bad, 0));
            assert!(!is_valid_miss_negation(0, *bad));
            assert!(!is_valid_miss_negation(*bad, *bad));
        }
    }
}
