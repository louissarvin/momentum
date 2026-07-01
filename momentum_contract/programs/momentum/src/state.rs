use anchor_lang::prelude::*;

/// One-time bootstrap PDA. Binds Momentum to a specific Bubblegum tree
/// and caches the mint-authority PDA bump.
#[account]
#[derive(InitSpace)]
pub struct TreeState {
    pub tree: Pubkey,
    pub next_index: u64,
    pub bump: u8,
    pub mint_auth_bump: u8,
}

/// One-time PDA at seeds `[b"collection_state"]`. Binds the deployed program
/// to a specific Metaplex Token Metadata collection NFT so `settle_prediction`
/// and `claim_match_card` can mint sticker + match cNFTs *into* that collection
/// via Bubblegum's `MintToCollectionV1`.
///
/// This is Option B from `notes/collection-upgrade-plan.md` — additive PDA
/// rather than a `TreeState` schema change, so the upgrade is safe even though
/// `TreeState` is already initialized on devnet.
#[account]
#[derive(InitSpace)]
pub struct CollectionState {
    /// Metaplex NFT owned by `mint_auth`. See `scripts/create-collection.ts`.
    pub collection_mint: Pubkey,
    /// Cached canonical bump so downstream ixs don't re-derive.
    pub bump: u8,
    /// Whoever ran `initialize_collection_state`. Used for future rotate.
    pub admin: Pubkey,
}

/// User-created social group. `group_id` is stored as the first field so
/// clients can `getProgramAccounts({filters: [memcmp(offset=8, group_id)]})`
/// to enumerate a specific group by id (P-06).
#[account]
#[derive(InitSpace)]
pub struct Group {
    pub group_id: u64,
    pub creator: Pubkey,
    #[max_len(32)]
    pub name: String,
    pub max_size: u8,
    pub current_size: u8,
    pub entry_fee_lamports: u64,
    pub vault_bump: u8,
    pub created_at: i64,
    /// Cached canonical PDA bump (P-04) — saves ~1.5K CU per reader ix.
    pub bump: u8,
}

/// Per-user group membership. Score tracks running hit count.
#[account]
#[derive(InitSpace)]
pub struct Membership {
    pub group: Pubkey,
    pub user: Pubkey,
    pub joined_at: i64,
    pub score: u32,
    /// Cached canonical PDA bump (P-04).
    pub bump: u8,
}

/// User's prediction slate for a single fixture. Fixed 8-slot array
/// with `slot_count` denoting the actual used length.
///
/// `match_card_event_stat_root` + `match_card_proof_ts` are populated by
/// `claim_match_card` from the successful TxLINE proof so every claim
/// deep-links back to a specific Merkle root + timestamp (proof lineage).
#[account]
#[derive(InitSpace)]
pub struct PredictionCard {
    pub user: Pubkey,
    pub fixture_id: i64,
    pub submitted_at: i64,
    pub slots: [PredictionSlot; 8],
    pub slot_count: u8,
    pub match_card_minted: bool,
    pub match_card_event_stat_root: [u8; 32],
    pub match_card_proof_ts: i64,
    /// Cached canonical PDA bump (P-04).
    pub bump: u8,
}

/// Marketplace listing for a compressed sticker NFT.
/// `active` bool guards CEI ordering in `buy_card` / `cancel_listing`.
/// `bump` is the canonical PDA bump captured at init time so that later
/// instructions can re-derive the Listing PDA from the `asset_id` ix arg
/// (not from the potentially-attacker-supplied `listing.asset_id` field —
/// see code-review F-02).
#[account]
#[derive(InitSpace)]
pub struct Listing {
    pub seller: Pubkey,
    pub asset_id: Pubkey,
    pub price_lamports: u64,
    pub tree: Pubkey,
    pub leaf_index: u32,
    pub created_at: i64,
    pub active: bool,
    pub bump: u8,
}

/// A single stat prediction. Copy-friendly (fits in the fixed
/// `[PredictionSlot; 8]` array on PredictionCard).
///
/// Field semantics:
/// - `stat_a_key` : ScoreStat.key for primary stat (must be > 0 to be valid)
/// - `stat_b_key` : 0 = compound not used; otherwise ScoreStat.key of second term
/// - `op`         : 0 = None, 1 = Add, 2 = Subtract (BinaryExpression mirror)
/// - `predicate_comparison` : 0 = GreaterThan, 1 = LessThan, 2 = EqualTo
///                            (mirrors TxLINE `Comparison` enum ordinals)
/// - `threshold`  : Momentum-side threshold BEFORE any keeper negation
/// - `period`     : match period (e.g. 0 = full-time, 1 = 1st half, 2 = 2nd half)
/// - `status`     : SlotStatus discriminant (0 Pending, 1 Hit, 2 Miss)
/// - `sticker_asset_seq` : 0 until minted; then = TreeState.next_index at mint time
/// - `event_stat_root`   : `[0u8; 32]` until settled; then the `event_stat_root`
///                          bytes captured from the TxLINE `StatTerm` (proof lineage)
/// - `proof_ts`          : 0 until settled; then the `ts` arg passed to TxLINE
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, PartialEq, Eq, Default)]
pub struct PredictionSlot {
    pub stat_a_key: i32,
    pub stat_b_key: i32,
    pub op: u8,
    pub predicate_comparison: u8,
    pub threshold: i32,
    pub period: u16,
    pub status: u8,
    pub sticker_asset_seq: u64,
    pub event_stat_root: [u8; 32],
    pub proof_ts: i64,
}

/// Slot status u8 constants. Kept as plain constants (not a Rust enum) so
/// the enclosing `PredictionSlot` remains `Copy` and zero-init friendly.
pub struct SlotStatus;
impl SlotStatus {
    pub const PENDING: u8 = 0;
    pub const HIT: u8 = 1;
    pub const MISS: u8 = 2;
}

/// Pass-10 additive PDA. Sidecar account attached to a `Group` for the new
/// admin/creator functionality (pause + prize distribution) without altering
/// the on-chain layout of the already-deployed `Group` account (which would
/// break every existing devnet group by breaking Borsh deserialize length).
///
/// Seeds: `[b"group_ext", group.key().as_ref()]`.
///
/// Created lazily on first `pause_group` / `unpause_group` / `distribute_prize`
/// call via `init_if_needed`. Legacy groups (created before Pass 10) simply
/// don't have an extension yet and behave exactly as they did before —
/// non-breaking upgrade.
#[account]
#[derive(InitSpace)]
pub struct GroupExtension {
    /// Back-pointer to the parent Group PDA (defense-in-depth vs seed spoofing).
    pub group: Pubkey,
    /// Admin kill-switch. When true, `join_group` and `distribute_prize` reject.
    pub paused: bool,
    /// Payout replay guard. When true, `distribute_prize` rejects.
    pub prize_distributed: bool,
    /// Cached canonical PDA bump.
    pub bump: u8,
}
