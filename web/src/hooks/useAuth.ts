import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useWallet } from '@solana/wallet-adapter-react'
import { useQueryClient } from '@tanstack/react-query'
import bs58 from 'bs58'
import type { SessionUser } from '@/lib/api/types'
import { sessionApi } from '@/lib/api/endpoints'
import { clearJwt, getJwt, setJwt } from '@/lib/api/client'

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

  // Auto-trigger SIWS login when wallet just connected and we have no JWT yet.
  // Guarded by a ref so we don't loop if the user rejects the sign prompt.
  const attempted = useRef<string | null>(null)
  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) return
    if (jwt) return
    if (store.loading) return
    const wa = wallet.publicKey.toBase58()
    // Skip if we already tried (and possibly failed) for this exact wallet
    if (attempted.current === wa) return
    attempted.current = wa
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
