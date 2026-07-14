import { env } from '@/env'

const BASE = 'https://solscan.io'

function cluster(): string {
  return env.VITE_SOLANA_CLUSTER
}

export function solscanTx(sig: string): string {
  return `${BASE}/tx/${encodeURIComponent(sig)}?cluster=${cluster()}`
}

export function solscanAcct(addr: string): string {
  return `${BASE}/account/${encodeURIComponent(addr)}?cluster=${cluster()}`
}

export function solscanToken(mint: string): string {
  return `${BASE}/token/${encodeURIComponent(mint)}?cluster=${cluster()}`
}

export function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${encodeURIComponent(sig)}?cluster=${cluster()}`
}

export function explorerAcct(addr: string): string {
  return `https://explorer.solana.com/address/${encodeURIComponent(addr)}?cluster=${cluster()}`
}
