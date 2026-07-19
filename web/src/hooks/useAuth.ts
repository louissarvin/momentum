import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useWallet } from '@solana/wallet-adapter-react'
import { useQueryClient } from '@tanstack/react-query'
import bs58 from 'bs58'
import type { SessionUser } from '@/lib/api/types'
import { sessionApi } from '@/lib/api/endpoints'
import { clearJwt, getJwt, setJwt } from '@/lib/api/client'

/**
 * Decode a JWT payload without needing a lib. Returns null on any parse
 * error — we treat unknown-shape JWTs as "not for this wallet" so the auth
 * flow re-triggers rather than silently continuing with a stale token.
 */
function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return null
    // base64url → base64 → binary → json
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    const decoded = JSON.parse(json)
    return typeof decoded === 'object' && decoded !== null ? decoded : null
  } catch {
    return null
  }
}

/**
 * Extract the wallet address the JWT was issued for.
 * Returns null if we can't determine (parse fail, missing claim, etc).
 * Callers should treat null as "unknown, don't take destructive action".
 */
function jwtWalletOrNull(jwt: string): string | null {
  const payload = decodeJwtPayload(jwt)
  if (!payload) return null
  // Backend session.ts signs the JWT with `{ sub, wallet }`.
  const jwtWallet =
    (typeof payload.wallet === 'string' && payload.wallet) ||
    (typeof payload.walletAddress === 'string' && payload.walletAddress) ||
    null
  return jwtWallet || null
}

interface AuthState {
  jwt: string | null
  user: SessionUser | null
  loading: boolean
  error: string | null
  setJwtAndUser: (jwt: string, user: SessionUser) => void
  clearAuth: () => void
  setLoading: (v: boolean) => void
  setError: (msg: string | null) => void
}

const useAuthStore = create<AuthState>((set) => ({
  jwt: null,
  user: null,
  loading: false,
  error: null,
  setJwtAndUser: (jwt, user) => {
    setJwt(jwt)
    set({ jwt, user, error: null })
  },
  clearAuth: () => {
    clearJwt()
    set({ jwt: null, user: null, error: null })
  },
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
}))

export function useAuth() {
  const store = useAuthStore()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  const login = async () => {
    if (!wallet.publicKey || !wallet.signMessage) {
      store.setError('Wallet not connected or does not support message signing')
      return
    }

    store.setLoading(true)
    store.setError(null)

    try {
      const walletAddress = wallet.publicKey.toBase58()

      // 1. Get challenge nonce
      const challenge = await sessionApi.challenge(walletAddress)

      // 2. Sign the challenge message
      const encoded = new TextEncoder().encode(challenge.message)
      const signatureBytes = await wallet.signMessage(encoded)

      // 3. Encode signature as base58 per backend expectation
      const signature = bs58.encode(signatureBytes)

      // 4. Login
      const result = await sessionApi.walletLogin({
        wallet: walletAddress,
        signature,
      })

      store.setJwtAndUser(result.token, result.user)
      queryClient.setQueryData(['session', 'me'], result.user)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      store.setError(msg)
    } finally {
      store.setLoading(false)
    }
  }

  const logout = async () => {
    store.clearAuth()
    queryClient.clear()
    try {
      await wallet.disconnect()
    } catch {
      // Wallet may already be disconnected; not a hard error
    }
  }

  // Restore JWT from localStorage on first call (hydration)
  const storedJwt = getJwt()
  const jwt = store.jwt ?? storedJwt

  // Auto-trigger SIWS login when wallet just connected and we have no JWT
  // yet. Also re-triggers on genuine wallet swaps in Phantom.
  //
  // Design tradeoffs (learned the hard way):
  //  - Do NOT clear JWT on wallet.connected=false. The adapter briefly
  //    flips connected off during page navigation / hot-reload, which
  //    would wipe a valid session on every route change.
  //  - `attempted` is scoped per-wallet AND stores a timestamp so we can
  //    allow re-attempts after 10 seconds instead of permanently blocking.
  //  - If JWT decode fails for any reason (malformed, network hiccup),
  //    treat it as valid and keep it — clearing on parse error caused
  //    "Session required" toasts on transient issues.
  const attempted = useRef<{ wa: string; at: number } | null>(null)
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) return
    if (store.loading) return
    const wa = wallet.publicKey.toBase58()

    // Genuine wallet-swap detection: only clear when we can PROVE the JWT
    // is for a different wallet (parse succeeded + claim mismatch). If the
    // decoder returns null (parse failure), assume the JWT is fine.
    if (jwt) {
      const jwtWallet = jwtWalletOrNull(jwt)
      if (jwtWallet !== null && jwtWallet !== wa) {
        store.clearAuth()
        attempted.current = null
        return
      }
      return // valid JWT for this wallet, nothing to do
    }

    // No JWT yet — attempt login. Guard against tight loops with a 10s
    // cooldown per wallet, so if the user rejects Phantom's prompt they
    // can retry by reconnecting (or clicking `login` from the header).
    const prev = attempted.current
    const now = Date.now()
    if (prev && prev.wa === wa && now - prev.at < 10_000) return
    attempted.current = { wa, at: now }
    void login()
  }, [wallet.connected, wallet.publicKey?.toBase58(), jwt, store.loading])

  return {
    jwt,
    user: store.user,
    isAuthenticated: !!jwt,
    loading: store.loading,
    error: store.error,
    login,
    logout,
  }
}
