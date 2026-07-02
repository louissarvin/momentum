use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::MomentumError;
use crate::events::MemberJoined;
use crate::state::{Group, GroupExtension, Membership};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct JoinGroup<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"group".as_ref(), &group_id.to_le_bytes()],
        bump = group.bump,
    )]
    pub group: Account<'info, Group>,

    /// CHECK: SOL vault, seeds-verified.
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump = group.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + Membership::INIT_SPACE,
        seeds = [b"member", group.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub membership: Account<'info, Membership>,

    /// Optional (Pass 10). If a client passes the `GroupExtension` PDA,
    /// join is rejected when `paused = true`. Legacy clients that omit the
    /// account skip the pause check entirely — non-breaking upgrade.
    #[account(
        seeds = [b"group_ext", group.key().as_ref()],
        bump = group_extension.bump,
        constraint = group_extension.group == group.key() @ MomentumError::GroupExtensionMismatch,
    )]
    pub group_extension: Option<Account<'info, GroupExtension>>,

    pub system_program: Program<'info, System>,
}

pub fn join_group_handler(ctx: Context<JoinGroup>, _group_id: u64) -> Result<()> {
    let group_key = ctx.accounts.group.key();
    let user_key = ctx.accounts.user.key();
    let entry_fee = ctx.accounts.group.entry_fee_lamports;
    let now = Clock::get()?.unix_timestamp;
    let membership_bump = ctx.bumps.membership;

    require!(
        ctx.accounts.group.current_size < ctx.accounts.group.max_size,
        MomentumError::GroupFull
    );

    // Pass 10: pause gate when the extension is supplied. Legacy clients
    // that don't pass it skip this check (safe: existing groups pre-Pass-10
    // never had an extension).
    if let Some(ext) = ctx.accounts.group_extension.as_ref() {
        require!(!ext.paused, MomentumError::GroupPaused);
    }

    // Transfer entry fee to vault (skip if fee is zero).
    if entry_fee > 0 {
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, entry_fee)?;
    }

    let group = &mut ctx.accounts.group;
    group.current_size = group
        .current_size
        .checked_add(1)
        .ok_or(MomentumError::NumericOverflow)?;
    let new_size = group.current_size;
    let max_size = group.max_size;

    let membership = &mut ctx.accounts.membership;
    membership.group = group_key;
    membership.user = user_key;
    membership.joined_at = now;
    membership.score = 0;
    membership.bump = membership_bump;

    msg!(
        "User {} joined group {} ({}/{})",
        user_key,
        group_key,
        new_size,
        max_size
    );

    emit!(MemberJoined {
        group_pda: group_key,
        user: user_key,
        current_size: new_size,
        max_size,
    });

    Ok(())
}
