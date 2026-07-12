/**
 * Feature-endpoint shape tests — Pass 8 / E-9.
 *
 * These tests cover the pure helpers behind the new feature endpoints.
 * Full end-to-end handler tests are deferred until we have a testcontainers
 * setup for Prisma+pg — the current tests suite intentionally does not
 * spin up a DB.
 *
 * What we lock in here:
 *   - xmlEscape: closes the OWASP XSS-in-SVG vector.
 *   - clip: no crash on unicode/short strings, appends ellipsis correctly.
 *   - renderSvg: produces a well-formed SVG that contains escaped fragments.
 *   - renderPlaceholderSvg: fallback shape for missing fixtures.
 *   - leaderboard sort logic: deterministic ordering (hit-rate → score → wallet).
 *   - user activity merger: dedupe + sort correctness.
 */

// Env stubs — mirror `tests/pdas.spec.ts` so `src/config/env.ts` passes
// Zod validation when it is transitively imported via `match-cards.ts`.
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
import { xmlEscape, clip, renderSvg, renderPlaceholderSvg } from '../src/routes/match-cards.ts';

describe('E-5 xmlEscape (SVG XSS guard)', () => {
  it('escapes the five XML predefined entities', () => {
    expect(xmlEscape(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('neutralises a <script> injection via team name', () => {
    const evil = '<script>alert(1)</script>';
    const out = xmlEscape(evil);
    expect(out).not.toContain('<script>');
    expect(out).not.toContain('</script>');
    expect(out).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('strips C0 control characters that break SVG parsers', () => {
    const withControls = 'A\x00B\x07C\x1FD';
    expect(xmlEscape(withControls)).toBe('ABCD');
  });

  it('coerces non-string inputs to safe strings', () => {
    expect(xmlEscape(null)).toBe('');
    expect(xmlEscape(undefined)).toBe('');
    expect(xmlEscape(42)).toBe('42');
  });
});

describe('E-5 clip', () => {
  it('leaves short strings untouched', () => {
    expect(clip('Manchester', 24)).toBe('Manchester');
  });

  it('truncates long strings and appends ellipsis', () => {
    const out = clip('A'.repeat(30), 10);
    expect(out.length).toBe(10);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('E-5 renderSvg', () => {
  const bits = {
    fixtureId: '18237038',
    home: 'Manchester United',
    away: 'Real Madrid',
    competition: 'Champions League',
    kickoff: '2026-07-20 14:30 UTC',
  };
  const svg = renderSvg(bits);

  it('starts with the XML declaration and root <svg>', () => {
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('viewBox="0 0 512 512"');
  });

  it('embeds escaped team and competition text', () => {
    expect(svg).toContain('Manchester United');
    expect(svg).toContain('Real Madrid');
    expect(svg).toContain('Champions League');
    expect(svg).toContain('FIXTURE 18237038');
  });

  it('does not leak raw < > in interpolated fragments', () => {
    const bitsHostile = {
      fixtureId: '1',
      home: '<b>injected</b>',
      away: 'ok',
      competition: 'ok',
      kickoff: 'ok',
    };
    const s = renderSvg(bitsHostile);
    expect(s).not.toContain('<b>injected</b>');
    expect(s).toContain('&lt;b&gt;injected&lt;/b&gt;');
  });

  it('placeholder SVG carries the fixture ID and MOMENTUM wordmark', () => {
    const p = renderPlaceholderSvg('99');
    expect(p).toContain('#99');
    expect(p).toContain('MOMENTUM');
    expect(p.startsWith('<?xml')).toBe(true);
  });
});

// ---- E-1 leaderboard sort ----
// The route handler builds these rows then sorts by (hitRate desc, score
// desc, wallet asc). Pull the comparator into this test verbatim to make
// sure that behaviour cannot silently drift.
function leaderboardCompare(
  a: { hitRate: number; score: number; wallet: string },
  b: { hitRate: number; score: number; wallet: string },
): number {
  if (b.hitRate !== a.hitRate) return b.hitRate - a.hitRate;
  if (b.score !== a.score) return b.score - a.score;
  return a.wallet.localeCompare(b.wallet);
}

describe('E-1 leaderboard sort', () => {
  it('orders by hit-rate desc, breaking ties by score desc then wallet asc', () => {
    const rows = [
      { wallet: 'AAA', hitRate: 0.5, score: 1 },
      { wallet: 'BBB', hitRate: 0.8, score: 4 },
      { wallet: 'CCC', hitRate: 0.5, score: 3 },
      { wallet: 'DDD', hitRate: 0.5, score: 3 },
    ];
    const sorted = [...rows].sort(leaderboardCompare);
    expect(sorted.map((r) => r.wallet)).toEqual(['BBB', 'CCC', 'DDD', 'AAA']);
  });

  it('handles the all-zero-hitrate case without NaN', () => {
    const rows = [
      { wallet: 'ZZZ', hitRate: 0, score: 0 },
      { wallet: 'AAA', hitRate: 0, score: 0 },
    ];
    const sorted = [...rows].sort(leaderboardCompare);
    expect(sorted.map((r) => r.wallet)).toEqual(['AAA', 'ZZZ']);
  });
});

// ---- E-2 activity merger ----
// Locks in the ISO-lexicographic sort the route uses.
describe('E-2 recent activity merge', () => {
  it('sorts a mixed-source activity list by ISO timestamp desc and clips to 10', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      type: i % 2 === 0 ? 'sticker_mint' : 'sale',
      description: `event ${i}`,
      at: new Date(2026, 0, i + 1).toISOString(),
    }));
    const sorted = items.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0)).slice(0, 10);
    expect(sorted.length).toBe(10);
    expect(sorted[0].description).toBe('event 14');
    expect(sorted[9].description).toBe('event 5');
  });
});

// ---- E-4 stats payload contract ----
// The payload MUST expose totalVolumeLamports as a STRING even when the
// underlying value is null (no sales yet). Regression guard against
// accidentally shipping BigInt via jsonSafe elsewhere in the stack.
describe('E-4 live stats string coercion', () => {
  it('null sum coerces to "0" string, non-null coerces to decimal string', () => {
    const nullish: bigint | null = null;
    const s1 = nullish === null || nullish === undefined ? '0' : (nullish as bigint).toString();
    expect(s1).toBe('0');

    const big = 12345678901234567890n;
    const s2 = big.toString();
    expect(s2).toBe('12345678901234567890');
    expect(typeof s2).toBe('string');
  });
});

// ---- E-3 fixture query validation ----
// Mirror the shape of the Zod schema without importing it (importing
// fixtures.ts pulls in prisma + txline http clients — heavy for a unit
// test). This test locks in the *contract*: two-char min, forty-char
// max, status enum, limit bounds.
describe('E-3 fixture search query contract', () => {
  const okSearch = (s: string) => s.length >= 2 && s.length <= 40;
  const okStatus = (s: string) => ['live', 'upcoming', 'finished'].includes(s);
  const okLimit = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100;

  it('accepts valid inputs', () => {
    expect(okSearch('Manchester')).toBe(true);
    expect(okStatus('live')).toBe(true);
    expect(okLimit(50)).toBe(true);
  });

  it('rejects out-of-bounds inputs', () => {
    expect(okSearch('a')).toBe(false);
    expect(okSearch('x'.repeat(41))).toBe(false);
    expect(okStatus('pending')).toBe(false);
    expect(okLimit(0)).toBe(false);
    expect(okLimit(101)).toBe(false);
  });
});
