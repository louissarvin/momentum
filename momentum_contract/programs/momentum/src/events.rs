use anchor_lang::prelude::*;

/// Emitted after a slot is settled and its outcome sticker cNFT is minted.
///
/// `outcome` mirrors `SlotStatus`: 1 = Hit, 2 = Miss.
/// `sticker_asset_seq` is the `TreeState.next_index` value captured at mint
/// time. Downstream indexers can pair this with the tree pubkey to derive the
/// Bubblegum asset id via `get_asset_id(tree, nonce)`.
///
/// Proof lineage fields (`event_stat_root`, `proof_ts`) let a frontend deep-link
/// each minted sticker to the exact TxLINE Merkle root and 5-minute slot that
/// proved it — the sponsor's "tamper-evident timestamp" story made visible.
///
/// `asset_id` and `merkle_tree` are included so any indexer can navigate from
/// a `StickerMinted` log directly to the DAS record without needing to know
/// how Bubblegum derives asset ids.
#[event]
pub struct StickerMinted {
    pub user: Pubkey,
    pub fixture_id: i64,
    pub slot_index: u8,
    pub outcome: u8,
    pub sticker_asset_seq: u64,
    pub event_stat_root: [u8; 32],
    pub proof_ts: i64,
    pub asset_id: Pubkey,
    pub merkle_tree: Pubkey,
}

/// Emitted after a fixture's summary "match card" cNFT is minted.
///
/// See [`StickerMinted`] for the meaning of `event_stat_root`, `proof_ts`,
/// `asset_id`, `merkle_tree`.
#[event]
pub struct MatchCardClaimed {
    pub user: Pubkey,
    pub fixture_id: i64,
    pub match_card_seq: u64,
    pub event_stat_root: [u8; 32],
    pub proof_ts: i64,
    pub asset_id: Pubkey,
    pub merkle_tree: Pubkey,
}

/// Emitted once (per program deploy) at `initialize_tree_state`. Lets any
/// frontend or indexer display "MOMENTUM vN" and bind the deployed program
/// to its Bubblegum tree + mint authority PDA without a second RPC roundtrip.
#[event]
pub struct TreeInitialized {
    pub admin: Pubkey,
    pub tree: Pubkey,
    pub mint_auth: Pubkey,
    pub program_version: u8,
}

/// Emitted after a new social group PDA is created.
#[event]
pub struct GroupCreated {
    pub group_id: u64,
    pub creator: Pubkey,
    pub name: String,
    pub max_size: u8,
    pub entry_fee_lamports: u64,
    pub group_pda: Pubkey,
}

/// Emitted after a user joins a group (post current_size increment).
#[event]
pub struct MemberJoined {
    pub group_pda: Pubkey,
    pub user: Pubkey,
    pub current_size: u8,
    pub max_size: u8,
}

/// Emitted after a user's prediction card is committed on-chain.
#[event]
pub struct PredictionsSubmitted {
    pub user: Pubkey,
    pub fixture_id: i64,
    pub slot_count: u8,
    pub card_pda: Pubkey,
}

/// Emitted after a sticker cNFT is listed for sale.
#[event]
pub struct Listed {
    pub seller: Pubkey,
    pub asset_id: Pubkey,
    pub price_lamports: u64,
    pub tree: Pubkey,
    pub leaf_index: u32,
    pub listing_pda: Pubkey,
}

/// Emitted after a sticker cNFT is purchased and the Listing PDA is closed.
#[event]
pub struct Sold {
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub asset_id: Pubkey,
    pub price_lamports: u64,
}

/// Emitted after a seller cancels their own listing and the leaf_delegate is
/// restored back to the seller.
#[event]
pub struct Cancelled {
    pub seller: Pubkey,
    pub asset_id: Pubkey,
}

/// Emitted once when the CollectionState PDA is initialized (admin-signed).
/// Frontends can subscribe once to learn the on-chain collection mint that
/// all future sticker + match-card cNFTs will be verified into.
#[event]
pub struct CollectionStateInitialized {
    pub admin: Pubkey,
    pub collection_mint: Pubkey,
}

// Pass 10 events.

/// Emitted after a group's SOL vault has been proportionally distributed to
/// its members based on their `Membership.score`. Closes the F-19
/// trapped-SOL gap for fee-charging groups.
#[event]
pub struct PrizeDistributed {
    pub group_pda: Pubkey,
    pub caller: Pubkey,
    pub vault_lamports: u64,
    pub total_score: u64,
    pub member_count: u32,
}

/// Emitted after `pause_group` flips `GroupExtension.paused = true`.
#[event]
pub struct GroupPaused {
    pub group_pda: Pubkey,
    pub admin: Pubkey,
    pub at: i64,
}

/// Emitted after `unpause_group` flips `GroupExtension.paused = false`.
#[event]
pub struct GroupUnpaused {
    pub group_pda: Pubkey,
    pub admin: Pubkey,
    pub at: i64,
}
