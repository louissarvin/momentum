/**
 * Small utility to make JSON responses safe when the payload contains
 * BigInt or Anchor `BN` values. Fastify's default serializer throws on
 * BigInt.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function jsonSafe<T = any>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === 'bigint') return v.toString();
      // Anchor BN.js exposes `.toString(10)`
      if (v && typeof v === 'object' && typeof (v as { toString?: unknown }).toString === 'function' && (v as { _bn?: unknown; words?: unknown[] }).words && (v as { negative?: number }).negative !== undefined) {
        return (v as { toString: (radix: number) => string }).toString(10);
      }
      return v;
    }),
  ) as T;
}
