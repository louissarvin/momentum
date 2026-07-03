use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use mpl_bubblegum::instructions::TransferCpiBuilder;

use crate::errors::MomentumError;
use crate::events::Sold;
use crate::program_ids::{SPL_ACCOUNT_COMPRESSION_ID, SPL_NOOP_ID};
use crate::state::Listing;

#[derive(Accounts)]
#[instruction(asset_id: Pubkey)]
pub struct BuyCard<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: seller receives lamports; address checked from listing.seller.
    #[account(mut, address = listing.seller)]
    pub seller: UncheckedAccount<'info>,

    // F-02: derive the Listing PDA from the ix-arg `asset_id`, NOT from
    // `listing.asset_id`. The stored-field seed was a tautology — any Listing
    // account passed in would seed-match itself, letting an attacker swap in
    // an old / cheaper / unrelated listing. We now also pin `listing.bump`
    // (persisted at init) and re-check `listing.asset_id == asset_id`.
    #[account(
        mut,
        close = seller,
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

pub fn buy_card_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, BuyCard<'info>>,
    _asset_id: Pubkey,
    root: [u8; 32],
    data_hash: [u8; 32],
    creator_hash: [u8; 32],
    nonce: u64,
    index: u32,
) -> Result<()> {
    // CEI: check + effect FIRST, then interaction.
    {
        let listing = &mut ctx.accounts.listing;
        require!(listing.active, MomentumError::ListingNotActive);
        listing.active = false;
    }

    let price = ctx.accounts.listing.price_lamports;

    // Effect 2: pay the seller.
    let pay_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.seller.to_account_info(),
        },
    );
    system_program::transfer(pay_ctx, price)?;

    // Interaction: transfer the cNFT from seller -> buyer, signed by escrow_authority PDA.
    let escrow_bump = ctx.bumps.escrow_authority;
    let escrow_seeds: &[&[u8]] = &[b"escrow_auth", core::slice::from_ref(&escrow_bump)];
    let signer_seeds: &[&[&[u8]]] = &[escrow_seeds];

    let mut binding = TransferCpiBuilder::new(&ctx.accounts.bubblegum_program);
    let cpi = binding
        .tree_config(&ctx.accounts.tree_config)
        .leaf_owner(&ctx.accounts.seller, false)
        .leaf_delegate(&ctx.accounts.escrow_authority, true)
        .new_leaf_owner(&ctx.accounts.buyer)
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
        "Bought asset {}: price={} lamports, buyer={}",
        ctx.accounts.listing.asset_id,
        price,
        ctx.accounts.buyer.key()
    );

    emit!(Sold {
        seller: ctx.accounts.seller.key(),
        buyer: ctx.accounts.buyer.key(),
        asset_id: ctx.accounts.listing.asset_id,
        price_lamports: price,
    });

    // Listing account rent returns to seller via `close = seller`.
    Ok(())
}
