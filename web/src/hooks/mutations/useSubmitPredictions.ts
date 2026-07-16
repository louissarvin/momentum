import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { PredictionSlotInput } from '@/lib/api/types'
import { predictionsApi } from '@/lib/api/endpoints'
import { signAndSubmit } from '@/lib/solana/sign-and-submit'

export function useSubmitPredictions() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      fixtureId,
      slots,
    }: {
      fixtureId: string
      slots: Array<PredictionSlotInput>
    }) => {
      const result = await predictionsApi.submit(fixtureId, slots)

      // Already exists — the union discriminant is unsignedTx being null
      if (result.unsignedTx === null) {
        return {
          txSig: null as string | null,
          cardPda: result.cardPda,
          alreadyExists: true,
        }
      }

      const txEnvelope = result as {
        unsignedTx: string
        recentBlockhash: string
        lastValidBlockHeight: number
        cardPda: string
      }

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        txEnvelope.unsignedTx,
        txEnvelope.lastValidBlockHeight,
        txEnvelope.recentBlockhash,
      )

      await predictionsApi.confirm(fixtureId, txSig)
      return { txSig, cardPda: txEnvelope.cardPda, alreadyExists: false }
    },
    onSuccess: (_data, { fixtureId }) => {
      queryClient.invalidateQueries({
        queryKey: ['predictions', fixtureId, 'me'],
      })
      queryClient.invalidateQueries({ queryKey: ['fixtures', fixtureId] })
    },
  })
}
