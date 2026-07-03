use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::DelegateCpiBuilder;

use crate::errors::MomentumError;
use crate::events::Cancelled;
use crate::program_ids::{SPL_ACCOUNT_COMPRESSION_ID, SPL_NOOP_ID};
use crate::state::Listing;

#[derive(Accounts)]
#[instruction(asset_id: Pubkey)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    // F-02: seed the Listing from the ix-arg `asset_id`, not the stored
    // `listing.asset_id` field (tautology). Bump is pinned from init.
    #[account(
        mut,
        close = seller,
        has_one = seller,
        seeds = [b"listing", asset_id.as_ref()],
        bump = listing.bump,
        constraint = listing.asset_id == asset_id @ MomentumError::Unauthorized,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: escrow_authority PDA, currently the leaf_delegate.
    #[account(seeds = [b"escrow_auth"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    /// CHECK: Bubblegum tree_config PDA.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: Merkle tree; must match listing.tree.
    #[account(mut, address = listing.tree)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK: mpl_bubblegum program (address-checked).
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: SPL noop log wrapper.
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: spl-account-compression program.
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: proof path.
}

pub fn cancel_listing_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CancelListing<'info>>,
    _asset_id: Pubkey,
    root: [u8; 32],
    data_hash: [u8; 32],
    creator_hash: [u8; 32],
    nonce: u64,
    index: u32,
) -> Result<()> {
    require!(ctx.accounts.listing.active, MomentumError::ListingNotActive);
    ctx.accounts.listing.active = false;

    // Restore leaf_delegate = seller (undo the escrow delegation).
    // Signed by escrow_authority PDA since it is the current leaf_delegate.
    let escrow_bump = ctx.bumps.escrow_authority;
    let escrow_seeds: &[&[u8]] = &[b"escrow_auth", core::slice::from_ref(&escrow_bump)];
    let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

    let mut binding = DelegateCpiBuilder::new(&ctx.accounts.bubblegum_program);
    let cpi = binding
        .tree_config(&ctx.accounts.tree_config)
        .leaf_owner(&ctx.accounts.seller)
        .previous_leaf_delegate(&ctx.accounts.escrow_authority)
        .new_leaf_delegate(&ctx.accounts.seller)
        .merkle_tree(&ctx.accounts.merkle_tree)
        .log_wrapper(&ctx.accounts.log_wrapper)
        .compression_program(&ctx.accounts.compression_program)
        .system_program(&ctx.accounts.system_program)
        .root(root)
        .data_hash(data_hash)
        .creator_hash(creator_hash)
        .nonce(nonce)
        .index(index);

    for proof_node in ctx.remaining_accounts.iter() {
        cpi.add_remaining_account(proof_node, false, false);
    }

    cpi.invoke_signed(signer_seeds)?;

    msg!(
        "Cancelled listing for asset {} (returned rent to seller {})",
        ctx.accounts.listing.asset_id,
        ctx.accounts.seller.key()
    );

    emit!(Cancelled {
        seller: ctx.accounts.seller.key(),
        asset_id: ctx.accounts.listing.asset_id,
    });

    Ok(())
}
