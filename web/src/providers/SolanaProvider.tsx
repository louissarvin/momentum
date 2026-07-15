import { useMemo } from 'react'
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import { SolflareWalletAdapter } from '@solana/wallet-adapter-solflare'
import { env } from '@/env'

// Import wallet-adapter default styles — we override specifics via Tailwind
import '@solana/wallet-adapter-react-ui/styles.css'

interface SolanaProviderProps {
  children: React.ReactNode
}

export default function SolanaProvider({ children }: SolanaProviderProps) {
  const endpoint = env.VITE_SOLANA_RPC_URL

  // Wallet Standard auto-detects injected wallets (Phantom, Backpack, etc.)
  // Explicit adapters are fallbacks for browsers without the extension
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  )

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
