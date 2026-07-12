/**
 * Serialization tests — Pass 6 / P6-12.
 *
 * Verifies that `jsonSafe()` round-trips BigInt-carrying rows (as Prisma
 * emits them for i64/u64 columns) without throwing. Fastify's default
 * serializer throws on BigInt — a regression here breaks every
 * marketplace/album route.
 */

import { describe, expect, it } from 'bun:test';
import { BN } from '@coral-xyz/anchor';
import { jsonSafe } from '../src/utils/serialize.ts';

describe('jsonSafe — BigInt & BN round-trip', () => {
  it('serializes a Prisma PredictionCard-shaped row with BigInt fields', () => {
    const row = {
      cardPda: 'CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg',
      userWallet: '2QayNMK67kRxKKQ2Bpd6JEcxJ4T3H6BvYuoS1uh6JMxx',
      fixtureId: '18237038',
      slots: [{ statAKey: 2, threshold: 0, predicateComparison: 0 }],
      matchCardMinted: false,
      submittedAt: new Date('2026-07-18T20:00:00Z'),
      // i64/u64-like fields as BigInt (what Prisma returns).
      seq: 732n,
      ts: 1784060998513n,
    };
    const result = jsonSafe(row);
    expect(typeof result.seq).toBe('string');
    expect(result.seq).toBe('732');
    expect(typeof result.ts).toBe('string');
    expect(result.ts).toBe('1784060998513');
    // Non-BigInt fields survive.
    expect(result.cardPda).toBe(row.cardPda);
    expect(result.matchCardMinted).toBe(false);
    expect(Array.isArray(result.slots)).toBe(true);
  });

  it('serializes Anchor BN values to strings (via BN.toJSON) without throwing', () => {
    // BN defines .toJSON() → hex string by default, so it survives
    // JSON.stringify without our replacer needing to intervene. The
    // contract we care about is: no throw, and the result is a string
    // (not a bare object) so downstream JSON.parse works.
    const payload = {
      fixtureId: new BN('18237038'),
      ts: new BN('1784060998513'),
      nested: { seq: new BN(42) },
    };
    const result = jsonSafe(payload);
    expect(typeof result.fixtureId).toBe('string');
    expect(typeof result.ts).toBe('string');
    expect(typeof result.nested.seq).toBe('string');
    // Sanity: values round-trip losslessly (hex is fine — decoders can BN it back).
    expect(new BN(result.fixtureId as unknown as string, 16).toString(10)).toBe('18237038');
    expect(new BN(result.ts as unknown as string, 16).toString(10)).toBe('1784060998513');
  });

  it('does not throw on a nested object graph containing BigInts', () => {
    const graph = {
      outer: {
        middle: {
          inner: [1n, 2n, 3n],
          meta: { count: 100n },
        },
      },
    };
    const roundTripped = JSON.stringify(jsonSafe(graph));
    expect(roundTripped).toContain('"1"');
    expect(roundTripped).toContain('"100"');
  });

  it('leaves plain numbers, strings, booleans, and null untouched', () => {
    const p = { a: 1, b: 'two', c: true, d: null };
    const r = jsonSafe(p);
    expect(r).toEqual(p);
  });
});
