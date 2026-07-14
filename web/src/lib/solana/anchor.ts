import { useMemo } from 'react'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { AnchorProvider, Program } from '@coral-xyz/anchor'
import { PublicKey } from '@solana/web3.js'
import idl from './idls/momentum.json'
import type { Idl } from '@coral-xyz/anchor'

const PROGRAM_ID = new PublicKey('39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT')

// Hook returns a read-only Program when no wallet is connected,
// or a fully-signed Program when wallet is connected.
export function useMomentumProgram() {
  const { connection } = useConnection()
  const wallet = useWallet()

  return useMemo(() => {
    const provider = wallet.publicKey
      ? new AnchorProvider(
          connection,
          // AnchorProvider expects a wallet with signTransaction/signAllTransactions

          wallet as any,
          AnchorProvider.defaultOptions(),
        )
      : new AnchorProvider(
          connection,
          // Read-only stub — does not sign anything
          {
            publicKey: PublicKey.default,
            signTransaction: async (tx) => tx,
            signAllTransactions: async (txs) => txs,
          },
          AnchorProvider.defaultOptions(),
        )

    return new Program(idl as Idl, provider)
  }, [connection, wallet])
}

export { PROGRAM_ID }
