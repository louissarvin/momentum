import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import type { UnsignedTxEnvelope } from '@/lib/api/types'
import { cardsApi, marketplaceApi } from '@/lib/api/endpoints'
import { signAndSubmit } from '@/lib/solana/sign-and-submit'
import { apiPost } from '@/lib/api/client'

export function useListForSale() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { assetId: string; priceLamports: string }) => {
      const envelope = await apiPost<
        UnsignedTxEnvelope & {
          assetId: string
          listingPda: string
          priceLamports: string
        }
      >('/api/marketplace/list', payload)

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        envelope.unsignedTx,
        envelope.lastValidBlockHeight,
        envelope.recentBlockhash,
      )

      const confirmed = await apiPost<{ listing: unknown }>(
        '/api/marketplace/list/confirm',
        {
          txSig,
          assetId: payload.assetId,
          priceLamports: payload.priceLamports,
        },
      )

      return { txSig, listingPda: envelope.listingPda, confirmed }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] })
      queryClient.invalidateQueries({ queryKey: ['cards', 'mine'] })
    },
  })
}

export function useBuyCard() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (listingPda: string) => {
      const envelope = await marketplaceApi.buy(listingPda)

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        envelope.unsignedTx,
        envelope.lastValidBlockHeight,
        envelope.recentBlockhash,
      )

      const result = await marketplaceApi.buyConfirm(listingPda, txSig)
      return { txSig, ...result }
    },
    onSuccess: (_data, listingPda) => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] })
      queryClient.invalidateQueries({ queryKey: ['marketplace', listingPda] })
      queryClient.invalidateQueries({ queryKey: ['cards', 'mine'] })
    },
  })
}

export function useCancelListing() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (listingPda: string) => {
      const envelope = await marketplaceApi.cancel(listingPda)

      const { txSig } = await signAndSubmit(
        connection,
        wallet,
        envelope.unsignedTx,
        envelope.lastValidBlockHeight,
        envelope.recentBlockhash,
      )

      const result = await marketplaceApi.cancelConfirm(listingPda, txSig)
      return { txSig, ...result }
    },
    onSuccess: (_data, listingPda) => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] })
      queryClient.invalidateQueries({ queryKey: ['marketplace', listingPda] })
    },
  })
}

export function useChangePriceOrRelist() {
  const { connection } = useConnection()
  const wallet = useWallet()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      listingPda: string
      assetId: string
      newPriceLamports: string
    }) => {
      // Cancel current listing
      const cancelEnvelope = await marketplaceApi.cancel(payload.listingPda)
      const { txSig: cancelSig } = await signAndSubmit(
        connection,
        wallet,
        cancelEnvelope.unsignedTx,
        cancelEnvelope.lastValidBlockHeight,
        cancelEnvelope.recentBlockhash,
      )
      await marketplaceApi.cancelConfirm(payload.listingPda, cancelSig)

      // Relist at new price
      const listEnvelope = await apiPost<
        UnsignedTxEnvelope & {
          assetId: string
          listingPda: string
          priceLamports: string
        }
      >('/api/marketplace/list', {
        assetId: payload.assetId,
        priceLamports: payload.newPriceLamports,
      })

      const { txSig: listSig } = await signAndSubmit(
        connection,
        wallet,
        listEnvelope.unsignedTx,
        listEnvelope.lastValidBlockHeight,
        listEnvelope.recentBlockhash,
      )

      await apiPost('/api/marketplace/list/confirm', {
        txSig: listSig,
        assetId: payload.assetId,
        priceLamports: payload.newPriceLamports,
      })

      return { newListingPda: listEnvelope.listingPda }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketplace'] })
      queryClient.invalidateQueries({ queryKey: ['cards', 'mine'] })
    },
  })
}

// Re-export cardsApi for use in list-form route
export { cardsApi }
