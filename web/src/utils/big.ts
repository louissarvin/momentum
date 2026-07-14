export const parseBig = (s: string | null | undefined): bigint | null =>
  s == null ? null : BigInt(s)

export const lamportsToSol = (l: string | bigint): number =>
  Number(BigInt(l)) / 1e9

export const solToLamports = (sol: number): bigint =>
  BigInt(Math.round(sol * 1e9))

export function shortenAddress(addr: string, startLen = 4, endLen = 4): string {
  if (addr.length <= startLen + endLen + 3) return addr
  return `${addr.slice(0, startLen)}…${addr.slice(-endLen)}`
}
