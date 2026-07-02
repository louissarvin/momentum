//! Pass 10: admin kill-switch for a single group.
//!
//! `pause_group` and `unpause_group` flip a bit on the sidecar `GroupExtension`
//! PDA (seeds `[b"group_ext", group.key().as_ref()]`). Both instructions
//! use `init_if_needed` on the extension so pre-Pass-10 legacy groups on
//! devnet can be paused without requiring a separate bootstrap step.
//!
//! While paused:
//!   * `join_group` rejects with `GroupPaused` (if a client passes the
//!      optional extension account).
//!   * `distribute_prize` rejects with `GroupPaused`.
//!
//! Signer: `ADMIN` only. Rotating admin is a redeploy (documented in
//! `initialize_tree_state.rs`).

use anchor_lang::prelude::*;

use crate::errors::MomentumError;
use crate::events::{GroupPaused as GroupPausedEvent, GroupUnpaused};
use crate::instructions::initialize_tree_state::ADMIN;
use crate::state::{Group, GroupExtension};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct PauseGroup<'info> {
    #[account(mut, address = ADMIN @ MomentumError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"group".as_ref(), &group_id.to_le_bytes()],
        bump = group.bump,
    )]
    pub group: Account<'info, Group>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + GroupExtension::INIT_SPACE,
        seeds = [b"group_ext", group.key().as_ref()],
        bump,
    )]
    pub group_extension: Account<'info, GroupExtension>,

    pub system_program: Program<'info, System>,
}

pub fn pause_group_handler(ctx: Context<PauseGroup>, _group_id: u64) -> Result<()> {
    let group_key = ctx.accounts.group.key();
    let admin_key = ctx.accounts.admin.key();
    let ext_bump = ctx.bumps.group_extension;

    let ext = &mut ctx.accounts.group_extension;
    // First-time init path: set immutable fields.
    if ext.group == Pubkey::default() {
        ext.group = group_key;
        ext.bump = ext_bump;
        ext.prize_distributed = false;
    } else {
        require_keys_eq!(ext.group, group_key, MomentumError::GroupExtensionMismatch);
    }
    ext.paused = true;

    let at = Clock::get()?.unix_timestamp;
    msg!("Group paused: {} by {}", group_key, admin_key);
    emit!(GroupPausedEvent {
        group_pda: group_key,
        admin: admin_key,
        at
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct UnpauseGroup<'info> {
    #[account(mut, address = ADMIN @ MomentumError::Unauthorized)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [b"group".as_ref(), &group_id.to_le_bytes()],
        bump = group.bump,
    )]
    pub group: Account<'info, Group>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + GroupExtension::INIT_SPACE,
        seeds = [b"group_ext", group.key().as_ref()],
        bump,
    )]
    pub group_extension: Account<'info, GroupExtension>,

    pub system_program: Program<'info, System>,
}

pub fn unpause_group_handler(ctx: Context<UnpauseGroup>, _group_id: u64) -> Result<()> {
    let group_key = ctx.accounts.group.key();
    let admin_key = ctx.accounts.admin.key();
    let ext_bump = ctx.bumps.group_extension;

    let ext = &mut ctx.accounts.group_extension;
    if ext.group == Pubkey::default() {
        ext.group = group_key;
        ext.bump = ext_bump;
        ext.prize_distributed = false;
    } else {
        require_keys_eq!(ext.group, group_key, MomentumError::GroupExtensionMismatch);
    }
    ext.paused = false;

    let at = Clock::get()?.unix_timestamp;
    msg!("Group unpaused: {} by {}", group_key, admin_key);
    emit!(GroupUnpaused {
        group_pda: group_key,
        admin: admin_key,
        at
    });
    Ok(())
}
