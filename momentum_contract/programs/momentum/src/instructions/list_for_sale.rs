use anchor_lang::prelude::*;
use mpl_bubblegum::instructions::DelegateCpiBuilder;
use mpl_bubblegum::utils::get_asset_id;

use crate::errors::MomentumError;
use crate::events::Listed;
use crate::program_ids::{SPL_ACCOUNT_COMPRESSION_ID, SPL_NOOP_ID};
use crate::state::Listing;

#[derive(Accounts)]
#[instruction(
    price_lamports: u64,
    asset_id: Pubkey,
)]
pub struct ListForSale<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,

    #[account(
        init,
        payer = seller,
        space = 8 + Listing::INIT_SPACE,
        seeds = [b"listing", asset_id.as_ref()],
        bump,
    )]
    pub listing: Account<'info, Listing>,

    /// CHECK: escrow_authority PDA becomes cNFT delegate after this ix.
    #[account(seeds = [b"escrow_auth"], bump)]
    pub escrow_authority: UncheckedAccount<'info>,

    // Bubblegum delegate CPI accounts.
    /// CHECK: Bubblegum tree_config PDA. Verified by Bubblegum.
    #[account(mut)]
    pub tree_config: UncheckedAccount<'info>,
    /// CHECK: SPL account compression merkle tree. Verified by Bubblegum.
    #[account(mut)]
    pub merkle_tree: UncheckedAccount<'info>,

    /// CHECK: mpl_bubblegum program (address-checked).
    #[account(address = mpl_bubblegum::ID)]
    pub bubblegum_program: UncheckedAccount<'info>,
    /// CHECK: SPL noop log wrapper (address-checked).
    #[account(address = SPL_NOOP_ID)]
    pub log_wrapper: UncheckedAccount<'info>,
    /// CHECK: spl-account-compression program (address-checked).
    #[account(address = SPL_ACCOUNT_COMPRESSION_ID)]
    pub compression_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: canopy-truncated proof path.
}

pub fn list_for_sale_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, ListForSale<'info>>,
    price_lamports: u64,
    asset_id: Pubkey,
    root: [u8; 32],
    data_hash: [u8; 32],
    creator_hash: [u8; 32],
    nonce: u64,
    index: u32,
) -> Result<()> {
    require!(price_lamports > 0, MomentumError::InvalidPrice);

    // Verify the client-provided asset_id matches the derived value.
    let tree_key = ctx.accounts.merkle_tree.key();
    let derived_asset_id = get_asset_id(&tree_key, nonce);
    require_keys_eq!(asset_id, derived_asset_id, MomentumError::TreeMismatch);

    // Delegate the leaf from seller -> escrow_authority PDA. Seller signs
    // this tx (as the current leaf_owner AND previous_leaf_delegate).
    let mut binding = DelegateCpiBuilder::new(&ctx.accounts.bubblegum_program);
    let cpi = binding
        .tree_config(&ctx.accounts.tree_config)
        .leaf_owner(&ctx.accounts.seller)
        .previous_leaf_delegate(&ctx.accounts.seller)
        .new_leaf_delegate(&ctx.accounts.escrow_authority)
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

    cpi.invoke()?;

    // Populate listing after successful delegate CPI.
    let listing = &mut ctx.accounts.listing;
    listing.seller = ctx.accounts.seller.key();
    listing.asset_id = asset_id;
    listing.price_lamports = price_lamports;
    listing.tree = tree_key;
    listing.leaf_index = index;
    listing.created_at = Clock::get()?.unix_timestamp;
    listing.active = true;
    listing.bump = ctx.bumps.listing;

    msg!(
        "Listed asset {} for {} lamports (leaf_index={})",
        listing.asset_id,
        listing.price_lamports,
        listing.leaf_index
    );

    emit!(Listed {
        seller: listing.seller,
        asset_id: listing.asset_id,
        price_lamports: listing.price_lamports,
        tree: listing.tree,
        leaf_index: listing.leaf_index,
        listing_pda: ctx.accounts.listing.key(),
    });

    Ok(())
}
