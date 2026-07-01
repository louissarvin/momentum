//! Hardcoded well-known program IDs.
//!
//! We do not depend on the `spl-account-compression` or `spl-noop` crates
//! directly because their current-release versions drag in an incompatible
//! solana-program 4.x / edition2024 stack. These IDs are consensus-fixed
//! and safe to inline.
use anchor_lang::prelude::*;

/// SPL Account Compression program ID: `cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK`
pub const SPL_ACCOUNT_COMPRESSION_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("cmtDvXumGCrqC1Age74AVPhSRVXJMd8PJS91L8KbNCK");

/// SPL Noop program ID: `noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV`
pub const SPL_NOOP_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

/// Metaplex Token Metadata program ID: `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`.
/// Kept as a constant so we can `#[account(address = MPL_TOKEN_METADATA_ID)]`
/// without depending on the mpl-token-metadata crate (which is not in Cargo.toml
/// and pulls in incompatible solana-program versions).
pub const MPL_TOKEN_METADATA_ID: Pubkey =
    anchor_lang::solana_program::pubkey!("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

/// Bubblegum's `collection_cpi` signer seed. The PDA at
/// `[b"collection_cpi"]` under the Bubblegum program is what Bubblegum uses
/// to CPI into Token Metadata `set_and_verify_collection`.
/// Address: `4ewWZC5gT6TGpm5LZNDs9wVonfUT2q5PP5sc9kVbwMAK` (Bubblegum-derived).
pub const BUBBLEGUM_COLLECTION_CPI_SEED: &[u8] = b"collection_cpi";
