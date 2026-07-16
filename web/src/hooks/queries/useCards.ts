import { useQuery } from '@tanstack/react-query'
import { cardLineageOptions, cardsMineOptions } from '@/lib/api/endpoints'
import { useAuth } from '@/hooks/useAuth'

// Gated on isAuthenticated so an anonymous visit to /album does NOT fire an
// auth-required request → 401 → api client wipes the JWT for OTHER
// concurrent flows (SIWS just completed, wallet reconnecting, etc.).
export function useMyCards() {
  const { isAuthenticated } = useAuth()
  return useQuery({
    ...cardsMineOptions(),
    enabled: isAuthenticated,
  })
}

export function useCardLineage(assetId: string) {
  return useQuery(cardLineageOptions(assetId))
}
