/**
 * IDL shape tests — Pass 6 / P6-12.
 *
 * Guards against IDL drift between the deployed on-chain program
 * (`momentum_contract`) and the backend copy at
 * `src/lib/solana/idls/momentum.json`. If Rust adds/removes an
 * instruction or an event field these will fail loudly.
 */

import { describe, expect, it } from 'bun:test';
import idl from '../src/lib/solana/idls/momentum.json' with { type: 'json' };

interface IdlInstruction {
  name: string;
  accounts: unknown[];
  args?: unknown[];
}

interface IdlEvent {
  name: string;
  discriminator: number[];
}

interface IdlTypeField {
  name: string;
}

interface IdlTypeDef {
  name: string;
  type: { kind: string; fields?: IdlTypeField[] };
}

interface Idl {
  instructions: IdlInstruction[];
  events: IdlEvent[];
  types: IdlTypeDef[];
}

const EXPECTED_INSTRUCTIONS: Record<string, number> = {
  initialize_tree_state: 4,
  initialize_collection_state: 3,
  create_group: 5,
  join_group: 5,
  submit_predictions: 3,
  settle_prediction: 20,
  claim_match_card: 20,
  list_for_sale: 9,
  buy_card: 10,
  cancel_listing: 9,
};

const EXPECTED_EVENTS = [
  'Cancelled',
  'CollectionStateInitialized',
  'GroupCreated',
  'Listed',
  'MatchCardClaimed',
  'MemberJoined',
  'PredictionsSubmitted',
  'Sold',
  'StickerMinted',
  'TreeInitialized',
];

describe('IDL — momentum.json shape', () => {
  const typed = idl as unknown as Idl;

  it('exposes all 10 expected instructions with matching account counts', () => {
    const byName = new Map(typed.instructions.map((ix) => [ix.name, ix.accounts.length]));
    for (const [name, expectedCount] of Object.entries(EXPECTED_INSTRUCTIONS)) {
      expect(byName.has(name)).toBe(true);
      expect(byName.get(name)).toBe(expectedCount);
    }
  });

  it('exposes every expected #[event]', () => {
    const byName = new Set(typed.events.map((e) => e.name));
    for (const name of EXPECTED_EVENTS) {
      expect(byName.has(name)).toBe(true);
    }
  });

  it('every event has a unique 8-byte discriminator', () => {
    const seen = new Set<string>();
    for (const ev of typed.events) {
      expect(ev.discriminator.length).toBe(8);
      const key = ev.discriminator.join(',');
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('StickerMinted event carries the fields the backend decoder reads', () => {
    const td = typed.types.find((t) => t.name === 'StickerMinted');
    expect(td).toBeDefined();
    const fieldNames = (td!.type.fields ?? []).map((f) => f.name);
    for (const req of [
      'user',
      'fixture_id',
      'slot_index',
      'outcome',
      'sticker_asset_seq',
      'event_stat_root',
      'proof_ts',
      'asset_id',
      'merkle_tree',
    ]) {
      expect(fieldNames).toContain(req);
    }
  });

  it('MatchCardClaimed event carries the fields the backend decoder reads', () => {
    const td = typed.types.find((t) => t.name === 'MatchCardClaimed');
    expect(td).toBeDefined();
    const fieldNames = (td!.type.fields ?? []).map((f) => f.name);
    for (const req of [
      'user',
      'fixture_id',
      'match_card_seq',
      'event_stat_root',
      'proof_ts',
      'asset_id',
      'merkle_tree',
    ]) {
      expect(fieldNames).toContain(req);
    }
  });
});
