import { useQuery } from '@tanstack/react-query'
import type { ListingWithSticker } from '@/lib/api/types'
import { marketplaceApi } from '@/lib/api/endpoints'

const EMPTY_RESULT = {
  listings: [] as Array<ListingWithSticker>,
  nextCursor: null,
}

export function useMarketplace(
  sort?: 'price_asc' | 'price_desc' | 'createdAt',
) {
  return useQuery({
    queryKey: ['marketplace', { sort }],
    queryFn: () => marketplaceApi.list({ sort }),
    staleTime: 15_000,
    retry: 0,
    // Show empty result immediately so the component can render the demo fallback
    placeholderData: EMPTY_RESULT,
  })
}

export function useListing(pda: string) {
  return useQuery({
    queryKey: ['marketplace', pda],
    queryFn: () => marketplaceApi.get(pda),
    staleTime: 15_000,
    retry: 0,
    enabled: !!pda,
  })
}
