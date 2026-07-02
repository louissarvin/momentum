//! initialize_collection_state — one-shot admin-gated PDA init.
//!
//! Binds the deployed program to a specific Metaplex collection NFT (created
//! off-chain via `scripts/create-collection.ts`). Additive to `TreeState` —
//! see `notes/collection-upgrade-plan.md` Q1 Option B for rationale.
//!
//! Guards:
//!   * `admin.key() == ADMIN` (same constant as `initialize_tree_state`)
//!   * `init` on PDA `[b"collection_state"]` (Anchor rejects reinit via
//!     the `AccountAlreadyInitialized 2004` error).

use anchor_lang::prelude::*;

use crate::errors::MomentumError;
use crate::events::CollectionStateInitialized;
use crate::instructions::initialize_tree_state::ADMIN;
use crate::state::CollectionState;

#[derive(Accounts)]
pub struct InitializeCollectionState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + CollectionState::INIT_SPACE,
        seeds = [b"collection_state"],
        bump,
    )]
    pub collection_state: Account<'info, CollectionState>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_collection_state_handler(
    ctx: Context<InitializeCollectionState>,
    collection_mint: Pubkey,
) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN, MomentumError::Unauthorized);

    let state = &mut ctx.accounts.collection_state;
    state.collection_mint = collection_mint;
    state.bump = ctx.bumps.collection_state;
    state.admin = ctx.accounts.admin.key();

    msg!(
        "CollectionState initialized: collection_mint={}",
        state.collection_mint
    );

    emit!(CollectionStateInitialized {
        admin: ctx.accounts.admin.key(),
        collection_mint,
    });

    Ok(())
}
