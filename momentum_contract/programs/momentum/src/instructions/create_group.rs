use anchor_lang::prelude::*;

use crate::errors::MomentumError;
use crate::events::GroupCreated;
use crate::state::{Group, Membership};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct CreateGroup<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Group::INIT_SPACE,
        seeds = [b"group".as_ref(), &group_id.to_le_bytes()],
        bump,
    )]
    pub group: Account<'info, Group>,

    /// CHECK: SOL vault, seeds-verified. Not a data account.
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Membership::INIT_SPACE,
        seeds = [b"member", group.key().as_ref(), creator.key().as_ref()],
        bump,
    )]
    pub creator_membership: Account<'info, Membership>,

    pub system_program: Program<'info, System>,
}

pub fn create_group_handler(
    ctx: Context<CreateGroup>,
    group_id: u64,
    name: String,
    max_size: u8,
    entry_fee_lamports: u64,
) -> Result<()> {
    require!(name.len() <= 32, MomentumError::NameTooLong);
    require!(
        (2..=12).contains(&max_size),
        MomentumError::InvalidGroupSize
    );

    let now = Clock::get()?.unix_timestamp;
    let group_key = ctx.accounts.group.key();
    let creator_key = ctx.accounts.creator.key();
    let vault_bump = ctx.bumps.vault;
    let group_bump = ctx.bumps.group;
    let membership_bump = ctx.bumps.creator_membership;

    let group = &mut ctx.accounts.group;
    group.group_id = group_id;
    group.creator = creator_key;
    group.name = name;
    group.max_size = max_size;
    group.current_size = 1;
    group.entry_fee_lamports = entry_fee_lamports;
    group.vault_bump = vault_bump;
    group.created_at = now;
    group.bump = group_bump;

    let group_name = group.name.clone();
    let group_max = group.max_size;
    let group_fee = group.entry_fee_lamports;

    let membership = &mut ctx.accounts.creator_membership;
    membership.group = group_key;
    membership.user = creator_key;
    membership.joined_at = now;
    membership.score = 0;
    membership.bump = membership_bump;

    msg!(
        "Group created: name={}, max_size={}, entry_fee={}",
        group_name,
        group_max,
        group_fee
    );

    emit!(GroupCreated {
        group_id,
        creator: creator_key,
        name: group_name,
        max_size: group_max,
        entry_fee_lamports: group_fee,
        group_pda: group_key,
    });

    Ok(())
}
