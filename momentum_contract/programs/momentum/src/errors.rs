use anchor_lang::prelude::*;

#[error_code]
pub enum MomentumError {
    #[msg("Group name exceeds 32 bytes")]
    NameTooLong,
    #[msg("Group max_size must be in 2..=12")]
    InvalidGroupSize,
    #[msg("Group is already full")]
    GroupFull,
    /// DEPRECATED: uniqueness enforced by `init` on the `Membership` PDA
    /// (`seeds = [b"member", group, user]`). Kept to preserve IDL error
    /// index stability for already-deployed clients.
    #[msg("Member is already in this group")]
    DuplicateMember,
    /// DEPRECATED: uniqueness enforced by `init` on the `PredictionCard` PDA
    /// (`seeds = [b"card", user, fixture_id_le]`). Kept to preserve IDL error
    /// index stability for already-deployed clients.
    #[msg("Prediction card for this fixture already submitted")]
    AlreadySubmitted,
    #[msg("Slot count exceeds 8")]
    TooManySlots,
    #[msg("Slots vector is empty")]
    EmptySlots,
    #[msg("Slot has already been resolved")]
    SlotAlreadyResolved,
    #[msg("Match card has already been claimed for this fixture")]
    MatchCardAlreadyClaimed,
    #[msg("Listing is not active")]
    ListingNotActive,
    #[msg("Numeric overflow")]
    NumericOverflow,
    #[msg("Signer is not authorized for this action")]
    Unauthorized,
    #[msg("Provided merkle tree does not match TreeState.tree")]
    TreeMismatch,
    #[msg("stat_a.key / stat_b.key does not match the slot's stored stat key")]
    StatKeyMismatchLocal,
    #[msg("Provided predicate does not match the slot's stored predicate (HIT branch)")]
    PredicateFieldMismatch,
    #[msg("Compound stat expected: stat_b is required but missing")]
    MissingCompoundStat,
    #[msg("Compound stat unexpected: stat_b was provided but slot is single-stat")]
    UnexpectedCompoundStat,
    #[msg("Invalid stat_b op discriminant (must be 1=Add or 2=Subtract when set)")]
    InvalidStatBOp,
    #[msg("Listing price must be greater than zero")]
    InvalidPrice,
    #[msg("Slot index out of bounds (must be < slot_count and < 8)")]
    BadSlotIndex,
    // Pass 10 additions.
    #[msg("Group is paused")]
    GroupPaused,
    #[msg("Prize has already been distributed for this group")]
    PrizeAlreadyDistributed,
    #[msg("No members supplied for prize distribution")]
    NoMembers,
    #[msg("Total member score is zero; cannot distribute proportionally")]
    ZeroTotalScore,
    #[msg("Provided Membership account does not belong to this group")]
    MembershipGroupMismatch,
    #[msg("Provided GroupExtension does not match the referenced Group PDA")]
    GroupExtensionMismatch,
}
