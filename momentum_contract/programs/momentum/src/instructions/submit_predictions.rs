use anchor_lang::prelude::*;

use crate::errors::MomentumError;
use crate::events::PredictionsSubmitted;
use crate::state::{PredictionCard, PredictionSlot, SlotStatus};

/// Client-side input shape. Mirrored to `PredictionSlot` server-side with
/// `status = Pending` and `sticker_asset_seq = 0`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct PredictionSlotInput {
    pub stat_a_key: i32,
    pub stat_b_key: i32,
    pub op: u8,
    pub predicate_comparison: u8,
    pub threshold: i32,
    pub period: u16,
}

#[derive(Accounts)]
#[instruction(fixture_id: i64)]
pub struct SubmitPredictions<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + PredictionCard::INIT_SPACE,
        seeds = [b"card".as_ref(), user.key().as_ref(), &fixture_id.to_le_bytes()],
        bump,
    )]
    pub card: Account<'info, PredictionCard>,

    pub system_program: Program<'info, System>,
}

pub fn submit_predictions_handler(
    ctx: Context<SubmitPredictions>,
    fixture_id: i64,
    slots: Vec<PredictionSlotInput>,
) -> Result<()> {
    require!(!slots.is_empty(), MomentumError::EmptySlots);
    require!(slots.len() <= 8, MomentumError::TooManySlots);

    // Validate each slot before persisting anything.
    for slot in slots.iter() {
        require!(slot.stat_a_key > 0, MomentumError::StatKeyMismatchLocal);
        require!(
            slot.predicate_comparison <= 2,
            MomentumError::PredicateFieldMismatch
        );
        // op: 0 = None (single stat). 1 = Add, 2 = Subtract (compound with stat_b).
        match slot.op {
            0 => {
                // Single stat: stat_b_key must be 0.
                require!(slot.stat_b_key == 0, MomentumError::UnexpectedCompoundStat);
            }
            1 | 2 => {
                // Compound stat: stat_b_key must be a real key (> 0).
                require!(slot.stat_b_key > 0, MomentumError::MissingCompoundStat);
            }
            _ => return err!(MomentumError::InvalidStatBOp),
        }
    }

    let slot_count = slots.len() as u8;

    // Copy inputs into fixed [PredictionSlot; 8] array, zero-padding the tail
    // via `PredictionSlot::default()` (F-18). `SlotStatus::PENDING == 0` so the
    // derived `Default` yields the exact same all-zero shape as the previous
    // manual initializer. Proof-lineage fields (`event_stat_root`, `proof_ts`)
    // remain zeroed here and are populated by `settle_prediction` from a
    // successful TxLINE proof.
    let mut fixed: [PredictionSlot; 8] = [PredictionSlot::default(); 8];

    for (i, s) in slots.iter().enumerate() {
        fixed[i] = PredictionSlot {
            stat_a_key: s.stat_a_key,
            stat_b_key: s.stat_b_key,
            op: s.op,
            predicate_comparison: s.predicate_comparison,
            threshold: s.threshold,
            period: s.period,
            status: SlotStatus::PENDING,
            sticker_asset_seq: 0,
            event_stat_root: [0u8; 32],
            proof_ts: 0,
        };
    }

    let card_bump = ctx.bumps.card;
    let card = &mut ctx.accounts.card;
    card.user = ctx.accounts.user.key();
    card.fixture_id = fixture_id;
    card.submitted_at = Clock::get()?.unix_timestamp;
    card.slots = fixed;
    card.slot_count = slot_count;
    card.match_card_minted = false;
    card.match_card_event_stat_root = [0u8; 32];
    card.match_card_proof_ts = 0;
    card.bump = card_bump;

    msg!(
        "PredictionCard submitted: user={}, fixture_id={}, slot_count={}",
        card.user,
        card.fixture_id,
        card.slot_count
    );

    emit!(PredictionsSubmitted {
        user: card.user,
        fixture_id: card.fixture_id,
        slot_count: card.slot_count,
        card_pda: ctx.accounts.card.key(),
    });

    Ok(())
}
