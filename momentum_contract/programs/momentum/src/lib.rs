use anchor_lang::prelude::*;

declare_id!("39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT");

/// Momentum program version. Bump on any breaking schema/behavior change.
/// Emitted in the `TreeInitialized` event so indexers and frontends can
/// display the deployed version and detect upgrades.
pub const PROGRAM_VERSION: u8 = 1;

// Reads idls/txoracle.json at build time and generates typed CPI + accounts
// modules under `txoracle::cpi` / `txoracle::accounts` / `txoracle::types`.
declare_program!(txoracle);

pub mod errors;
pub mod events;
pub mod instructions;
pub mod program_ids;
pub mod state;

pub use instructions::*;

#[program]
pub mod momentum {
    use super::*;

    pub fn initialize_tree_state(ctx: Context<InitializeTreeState>, tree: Pubkey) -> Result<()> {
        instructions::initialize_tree_state::initialize_tree_state_handler(ctx, tree)
    }

    pub fn initialize_collection_state(
        ctx: Context<InitializeCollectionState>,
        collection_mint: Pubkey,
    ) -> Result<()> {
        instructions::initialize_collection_state::initialize_collection_state_handler(
            ctx,
            collection_mint,
        )
    }

    pub fn create_group(
        ctx: Context<CreateGroup>,
        group_id: u64,
        name: String,
        max_size: u8,
        entry_fee_lamports: u64,
    ) -> Result<()> {
        instructions::create_group::create_group_handler(
            ctx,
            group_id,
            name,
            max_size,
            entry_fee_lamports,
        )
    }

    pub fn join_group(ctx: Context<JoinGroup>, group_id: u64) -> Result<()> {
        instructions::join_group::join_group_handler(ctx, group_id)
    }

    pub fn submit_predictions(
        ctx: Context<SubmitPredictions>,
        fixture_id: i64,
        slots: Vec<PredictionSlotInput>,
    ) -> Result<()> {
        instructions::submit_predictions::submit_predictions_handler(ctx, fixture_id, slots)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn settle_prediction(
        ctx: Context<SettlePrediction>,
        fixture_id: i64,
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
        instructions::settle_prediction::settle_prediction_handler(
            ctx,
            fixture_id,
            slot_index,
            ts,
            fixture_summary,
            fixture_proof,
            main_tree_proof,
            predicate,
            stat_a,
            stat_b,
            op,
            outcome_claim,
            metadata_uri,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn claim_match_card(
        ctx: Context<ClaimMatchCard>,
        fixture_id: i64,
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
        instructions::claim_match_card::claim_match_card_handler(
            ctx,
            fixture_id,
            ts,
            fixture_summary,
            fixture_proof,
            main_tree_proof,
            predicate,
            stat_a,
            stat_b,
            op,
            metadata_uri,
        )
    }

    pub fn list_for_sale<'info>(
        ctx: Context<'_, '_, '_, 'info, ListForSale<'info>>,
        price_lamports: u64,
        asset_id: Pubkey,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        nonce: u64,
        index: u32,
    ) -> Result<()> {
        instructions::list_for_sale::list_for_sale_handler(
            ctx,
            price_lamports,
            asset_id,
            root,
            data_hash,
            creator_hash,
            nonce,
            index,
        )
    }

    pub fn buy_card<'info>(
        ctx: Context<'_, '_, '_, 'info, BuyCard<'info>>,
        asset_id: Pubkey,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        nonce: u64,
        index: u32,
    ) -> Result<()> {
        instructions::buy_card::buy_card_handler(
            ctx,
            asset_id,
            root,
            data_hash,
            creator_hash,
            nonce,
            index,
        )
    }

    pub fn cancel_listing<'info>(
        ctx: Context<'_, '_, '_, 'info, CancelListing<'info>>,
        asset_id: Pubkey,
        root: [u8; 32],
        data_hash: [u8; 32],
        creator_hash: [u8; 32],
        nonce: u64,
        index: u32,
    ) -> Result<()> {
        instructions::cancel_listing::cancel_listing_handler(
            ctx,
            asset_id,
            root,
            data_hash,
            creator_hash,
            nonce,
            index,
        )
    }

    // Pass 10 additions.

    pub fn pause_group(ctx: Context<PauseGroup>, group_id: u64) -> Result<()> {
        instructions::pause_group::pause_group_handler(ctx, group_id)
    }

    pub fn unpause_group(ctx: Context<UnpauseGroup>, group_id: u64) -> Result<()> {
        instructions::pause_group::unpause_group_handler(ctx, group_id)
    }

    pub fn distribute_prize<'info>(
        ctx: Context<'_, '_, '_, 'info, DistributePrize<'info>>,
        group_id: u64,
    ) -> Result<()> {
        instructions::distribute_prize::distribute_prize_handler(ctx, group_id)
    }
}
