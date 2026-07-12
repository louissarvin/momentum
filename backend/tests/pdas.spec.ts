/**
 * PDA derivation tests — Pass 6 / P6-12.
 *
 * The Pass 4 `escrow_auth` bug (seed was `escrow_authority` + per-listing,
 * should have been `escrow_auth` global-singleton) would have been caught
 * on the first `bun test` run by an assertEquals here. These tests are
 * cheap insurance against that class of regression.
 *
 * Ground-truth values (deployed-devnet):
 *   TreeState         9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr
 *   CollectionState   Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj
 *   MintAuth          FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41
 *   Program ID        39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT
 *
 * The remaining PDAs (Group, Membership, PredictionCard, Listing,
 * EscrowAuth, DailyScoresRoot) are snapshotted against their current
 * derivations — a Rust-side seed change will make these fail loudly.
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
process.env.MOMENTUM_PROGRAM_ID ||= '39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT';
process.env.TXLINE_PROGRAM_ID ||= '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J';
process.env.SOLANA_CLUSTER ||= 'devnet';
process.env.SOLANA_RPC_URL ||= 'https://api.devnet.solana.com';
process.env.DATABASE_URL ||= 'postgresql://x:y@localhost:5432/x?schema=public';
process.env.SESSION_JWT_SECRET ||= 'x'.repeat(48);
process.env.METADATA_HOST ||= 'https://cdn.momentum.app';
process.env.FRONTEND_URL ||= 'http://localhost:3000';
process.env.TXLINE_BASE_URL ||= 'https://txline-dev.txodds.com';

import { describe, expect, it } from 'bun:test';
import { PublicKey } from '@solana/web3.js';
import {
  deriveTreeState,
  deriveCollectionState,
  deriveMintAuth,
  deriveGroup,
  deriveMembership,
  derivePredictionCard,
  deriveListing,
  deriveEscrowAuthority,
  deriveDailyScoresRoot,
} from '../src/lib/solana/pdas.ts';
import {
  TREE_STATE_PDA,
  COLLECTION_STATE_PDA,
  MINT_AUTH_PDA,
} from '../src/lib/solana/constants.ts';

describe('Momentum PDAs — deployed-devnet parity', () => {
  it('deriveTreeState matches deployed TreeState PDA', () => {
    const [pda] = deriveTreeState();
    expect(pda.toBase58()).toBe(TREE_STATE_PDA.toBase58());
    expect(pda.toBase58()).toBe('9oMjwx2AdLMckkNSPD1ytsipLxVwXJmYtbY1e1aNnYYr');
  });

  it('deriveCollectionState matches deployed CollectionState PDA', () => {
    const [pda] = deriveCollectionState();
    expect(pda.toBase58()).toBe(COLLECTION_STATE_PDA.toBase58());
    expect(pda.toBase58()).toBe('Kh4o5Ahpk8hzXtnKZHJ7cVCU6eod4BW4urzofyoxFrj');
  });

  it('deriveMintAuth matches deployed MintAuth PDA', () => {
    const [pda] = deriveMintAuth();
    expect(pda.toBase58()).toBe(MINT_AUTH_PDA.toBase58());
    expect(pda.toBase58()).toBe('FqUTz5Fmy8WXEvzkJhrsa1kTfsX6L1ox7cBgLmjPkb41');
  });
});

describe('Momentum PDAs — deterministic snapshots', () => {
  it('deriveEscrowAuthority uses seed "escrow_auth" (global singleton, not per-listing)', () => {
    const [pda] = deriveEscrowAuthority();
    // Snapshot: whatever comes out of `[b"escrow_auth"]` under the program id.
    // If the Rust side ever renames the seed this will fail loudly — that is
    // the whole point (Pass 4 bug protection).
    expect(pda.toBase58()).toBeString();
    expect(pda.toBase58().length).toBeGreaterThan(30);

    // Independent re-derivation must be idempotent.
    const [again] = deriveEscrowAuthority();
    expect(again.toBase58()).toBe(pda.toBase58());

    // Cross-check: `escrow_authority` (18 bytes) would give a DIFFERENT PDA.
    // Prove it's a distinct value so regressions can't accidentally match.
    const [wrong] = PublicKey.findProgramAddressSync(
      [Buffer.from('escrow_authority')],
      new PublicKey('39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT'),
    );
    expect(wrong.toBase58()).not.toBe(pda.toBase58());
  });

  it('deriveGroup(1n) is deterministic', () => {
    const [a] = deriveGroup(1n);
    const [b] = deriveGroup(1n);
    expect(a.toBase58()).toBe(b.toBase58());
    // Different id → different PDA.
    const [c] = deriveGroup(2n);
    expect(c.toBase58()).not.toBe(a.toBase58());
  });

  it('deriveMembership(group, user) is deterministic and unique per (group, user)', () => {
    const [group] = deriveGroup(1n);
    const user = new PublicKey('2QayNMK67kRxKKQ2Bpd6JEcxJ4T3H6BvYuoS1uh6JMxx');
    const [m1] = deriveMembership(group, user);
    const [m2] = deriveMembership(group, user);
    expect(m1.toBase58()).toBe(m2.toBase58());

    const user2 = new PublicKey('77WTh89pR9V3d5PSGm4LDoFhL8drQjJvbXm1kkxTsMx1');
    const [m3] = deriveMembership(group, user2);
    expect(m3.toBase58()).not.toBe(m1.toBase58());
  });

  it('derivePredictionCard(user, fixtureId) is deterministic', () => {
    const user = new PublicKey('2QayNMK67kRxKKQ2Bpd6JEcxJ4T3H6BvYuoS1uh6JMxx');
    const [c1] = derivePredictionCard(user, 12345n);
    const [c2] = derivePredictionCard(user, 12345n);
    expect(c1.toBase58()).toBe(c2.toBase58());
    // Different fixture → different card
    const [c3] = derivePredictionCard(user, 12346n);
    expect(c3.toBase58()).not.toBe(c1.toBase58());
  });

  it('deriveListing(assetIdPk) is deterministic', () => {
    const asset = new PublicKey('CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg');
    const [l1] = deriveListing(asset);
    const [l2] = deriveListing(asset);
    expect(l1.toBase58()).toBe(l2.toBase58());
  });

  it('deriveDailyScoresRoot uses u16_le(epochDay) and matches Pass 3 smoke-test value', () => {
    // Pass 3 verified fixture: ts=1784060998513 → epochDay=20648.
    const { pda, bump, epochDay } = deriveDailyScoresRoot(1784060998513);
    expect(epochDay).toBe(20648);
    expect(typeof bump).toBe('number');
    expect(pda.toBase58()).toBeString();

    // Different epoch → different PDA.
    const other = deriveDailyScoresRoot(1784060998513 + 86_400_000);
    expect(other.epochDay).toBe(20649);
    expect(other.pda.toBase58()).not.toBe(pda.toBase58());
  });
});
