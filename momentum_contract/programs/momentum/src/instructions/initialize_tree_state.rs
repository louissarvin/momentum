use anchor_lang::prelude::*;

use crate::errors::MomentumError;
use crate::events::TreeInitialized;
use crate::state::TreeState;
use crate::PROGRAM_VERSION;

/// Dev admin. Rotate to a multisig before mainnet.
pub const ADMIN: Pubkey =
    anchor_lang::solana_program::pubkey!("2QayNpSjEb5gZRRLBhP1yDk6oViSSfCdB2HWUYcxS2XV");

// Build-time guard (P-10): prevents a future maintainer from accidentally
// reintroducing the all-zero SystemProgram placeholder pubkey (`11111...`).
// The real `2QayNpSj…` key has multiple non-zero leading bytes so this
// non-zero check on the first two bytes catches the placeholder without
// false-positives against any real Ed25519 pubkey we'd rotate to. If this
// assertion fires at compile time, replace `ADMIN` with a real key BEFORE
// shipping — do not silence the assert.
const _: () = assert!(
    ADMIN.to_bytes()[0] != 0 || ADMIN.to_bytes()[1] != 0,
    "ADMIN placeholder detected (SystemProgram-shaped pubkey) — set a real admin pubkey before deploy"
);

#[derive(Accounts)]
pub struct InitializeTreeState<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + TreeState::INIT_SPACE,
        seeds = [b"tree_state"],
        bump,
    )]
    pub tree_state: Account<'info, TreeState>,

    /// CHECK: PDA that will act as the Bubblegum tree delegate + mint authority.
    /// Not initialized here; seeds are verified via constraint.
    #[account(seeds = [b"mint_auth"], bump)]
    pub mint_auth: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_tree_state_handler(
    ctx: Context<InitializeTreeState>,
    tree: Pubkey,
) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN, MomentumError::Unauthorized);

    let state = &mut ctx.accounts.tree_state;
    state.tree = tree;
    state.next_index = 0;
    state.bump = ctx.bumps.tree_state;
    state.mint_auth_bump = ctx.bumps.mint_auth;

    msg!(
        "TreeState initialized: tree={}, mint_auth_bump={}",
        state.tree,
        state.mint_auth_bump
    );

    emit!(TreeInitialized {
        admin: ctx.accounts.admin.key(),
        tree,
        mint_auth: ctx.accounts.mint_auth.key(),
        program_version: PROGRAM_VERSION,
    });

    Ok(())
}
