import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { groupsApi } from '@/lib/api/endpoints'
import { signAndSubmit } from '@/lib/solana/sign-and-submit'

export function useCreateGroup() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      name: string
      maxSize: number
      entryFeeLamports: number | string
    }) => {
      const idempotencyKey = `create-group-${wallet.publicKey?.toBase58()}-${Date.now()}`
      const envelope = await groupsApi.create(payload, idempotencyKey)

      if (!envelope.unsignedTx) {
        throw new Error('No unsigned transaction returned')
      }

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        envelope.unsignedTx,
        envelope.lastValidBlockHeight,
        envelope.recentBlockhash,
      )

      await groupsApi.confirm(envelope.groupPda, txSig)
      return { txSig, groupPda: envelope.groupPda }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}

export function useJoinGroup() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (groupPda: string) => {
      const envelope = await groupsApi.join(groupPda)

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        envelope.unsignedTx,
        envelope.lastValidBlockHeight,
        envelope.recentBlockhash,
      )

      await groupsApi.joinConfirm(groupPda, txSig)
      return { txSig, groupPda }
    },
    onSuccess: (_data, groupPda) => {
      queryClient.invalidateQueries({ queryKey: ['groups', groupPda] })
      queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}
