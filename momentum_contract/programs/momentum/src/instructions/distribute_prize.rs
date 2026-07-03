//! Pass 10: settle a group's SOL vault to its members based on hit-score
//! (closes F-19 trapped-SOL).
//!
//! Callable by `ADMIN` or `group.creator`. Payout math:
//!   payout_i = floor(vault_lamports * membership_i.score / total_score)
//!
//! Any rounding remainder is left in the vault (retrievable by re-invoking
//! a future distribute or by a manual sweep). A zero-total-score group
//! aborts with `ZeroTotalScore` rather than silently distributing to no
//! one.
//!
//! Reentrancy: `group_extension.prize_distributed` is flipped to `true`
//! BEFORE any SOL is moved (checks-effects-interactions).
//!
//! Membership vetting: `remaining_accounts` is untrusted, so each entry is
//! deserialized as `Membership`, its `group` field is checked against the
//! passed Group PDA, and duplicates are rejected implicitly because the
//! member's payout receiver is `membership.user` — a duplicated Membership
//! passing the group check would still route the same user twice, which is
//! acceptable (they'd just get more of their fair share) but we reject it
//! outright with a linear-scan to avoid subtle economic bugs.
//!
//! Vault: system-owned SOL account (not an Anchor account). Debit uses
//! direct lamport manipulation (Bubblegum precedent — vault has no data
//! and is rent-exempt from creation via first `create_group` deposit).

use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

use crate::errors::MomentumError;
use crate::events::PrizeDistributed;
use crate::instructions::initialize_tree_state::ADMIN;
use crate::state::{Group, GroupExtension, Membership};

#[derive(Accounts)]
#[instruction(group_id: u64)]
pub struct DistributePrize<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [b"group".as_ref(), &group_id.to_le_bytes()],
        bump = group.bump,
    )]
    pub group: Account<'info, Group>,

    /// CHECK: SOL vault, seeds-verified. Direct lamport debit is safe because
    /// the runtime enforces owner-only mutation on data, and the vault has
    /// no data (system-owned).
    #[account(mut, seeds = [b"vault", group.key().as_ref()], bump = group.vault_bump)]
    pub vault: UncheckedAccount<'info>,

    #[account(
        init_if_needed,
        payer = caller,
        space = 8 + GroupExtension::INIT_SPACE,
        seeds = [b"group_ext", group.key().as_ref()],
        bump,
    )]
    pub group_extension: Account<'info, GroupExtension>,

    pub system_program: Program<'info, System>,
    // remaining_accounts: all Memberships in the group (mut is not required
    // — we only read `score` + `user` + `group`).
}

pub fn distribute_prize_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DistributePrize<'info>>,
    _group_id: u64,
) -> Result<()> {
    let group_key = ctx.accounts.group.key();
    let caller_key = ctx.accounts.caller.key();
    let creator_key = ctx.accounts.group.creator;
    let ext_bump = ctx.bumps.group_extension;

    // Authority: ADMIN OR group.creator.
    require!(
        caller_key == ADMIN || caller_key == creator_key,
        MomentumError::Unauthorized
    );

    // Extension bootstrap on first touch.
    let ext = &mut ctx.accounts.group_extension;
    if ext.group == Pubkey::default() {
        ext.group = group_key;
        ext.bump = ext_bump;
        ext.paused = false;
        ext.prize_distributed = false;
    } else {
        require_keys_eq!(ext.group, group_key, MomentumError::GroupExtensionMismatch);
    }
    require!(!ext.paused, MomentumError::GroupPaused);
    require!(
        !ext.prize_distributed,
        MomentumError::PrizeAlreadyDistributed
    );

    // Compute rent-exempt reserve for the vault so we don't drain it below
    // the minimum and leave a dust account that can't be re-credited.
    let vault_info = ctx.accounts.vault.to_account_info();
    let rent = Rent::get()?;
    let rent_reserve = rent.minimum_balance(0);
    let vault_lamports = vault_info.lamports();
    let distributable = vault_lamports.saturating_sub(rent_reserve);
    require!(distributable > 0, MomentumError::NoMembers);

    // Remaining accounts are supplied as interleaved pairs
    // `[membership_1, recipient_1, membership_2, recipient_2, ...]`.
    // Interleaving lets us validate each pair together and avoids a
    // separate `member_count` arg.
    let remaining = ctx.remaining_accounts;
    require!(!remaining.is_empty(), MomentumError::NoMembers);
    require!(
        remaining.len() % 2 == 0,
        MomentumError::MembershipGroupMismatch
    );

    let membership_disc = Membership::DISCRIMINATOR;
    let pair_count = remaining.len() / 2;

    let mut total_score: u64 = 0;
    // entries: (recipient_index_in_remaining, score)
    let mut entries: Vec<(usize, u64)> = Vec::with_capacity(pair_count);
    let mut seen_users: Vec<Pubkey> = Vec::with_capacity(pair_count);

    for pair_idx in 0..pair_count {
        let mem_acc = &remaining[pair_idx * 2];
        let recipient_acc = &remaining[pair_idx * 2 + 1];

        require_keys_eq!(
            *mem_acc.owner,
            crate::ID,
            MomentumError::MembershipGroupMismatch
        );
        let data = mem_acc.try_borrow_data()?;
        require!(
            data.len() >= 8 && &data[..8] == membership_disc,
            MomentumError::MembershipGroupMismatch
        );
        let membership: Membership = Membership::try_deserialize(&mut &data[..])?;
        require_keys_eq!(
            membership.group,
            group_key,
            MomentumError::MembershipGroupMismatch
        );
        require_keys_eq!(
            recipient_acc.key(),
            membership.user,
            MomentumError::MembershipGroupMismatch
        );
        for u in seen_users.iter() {
            require!(
                *u != membership.user,
                MomentumError::MembershipGroupMismatch
            );
        }
        seen_users.push(membership.user);

        total_score = total_score
            .checked_add(membership.score as u64)
            .ok_or(MomentumError::NumericOverflow)?;
        entries.push((pair_idx * 2 + 1, membership.score as u64));
    }

    require!(total_score > 0, MomentumError::ZeroTotalScore);

    // Effect BEFORE interaction (CEI).
    ext.prize_distributed = true;

    // Payout loop. The vault is a system-owned PDA (no data) so we must
    // route the debit through the System program with the vault's PDA
    // signer seeds — direct lamport mutation is disallowed on accounts we
    // don't own.
    let member_count = pair_count as u32;
    let group_key_bytes = group_key.to_bytes();
    let vault_bump = ctx.accounts.group.vault_bump;
    let vault_seeds: &[&[u8]] = &[b"vault", group_key_bytes.as_ref(), &[vault_bump]];
    let signer_seeds: &[&[&[u8]]] = &[vault_seeds];

    for (recipient_offset, score) in entries.iter() {
        let payout = (distributable as u128)
            .checked_mul(*score as u128)
            .ok_or(MomentumError::NumericOverflow)?
            .checked_div(total_score as u128)
            .ok_or(MomentumError::NumericOverflow)? as u64;
        if payout == 0 {
            continue;
        }
        let recipient = &remaining[*recipient_offset];
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            Transfer {
                from: vault_info.clone(),
                to: recipient.clone(),
            },
            signer_seeds,
        );
        system_program::transfer(cpi_ctx, payout)?;
    }

    msg!(
        "Prize distributed: group={}, distributable={}, total_score={}, members={}",
        group_key,
        distributable,
        total_score,
        member_count
    );

    emit!(PrizeDistributed {
        group_pda: group_key,
        caller: caller_key,
        vault_lamports: distributable,
        total_score,
        member_count,
    });

    Ok(())
}
