import { useQuery } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api/endpoints'
import { getJwt } from '@/lib/api/client'

export function useGroups(params?: { limit?: number; cursor?: string }) {
  return useQuery({
    queryKey: ['groups', params ?? {}],
    queryFn: () => groupsApi.list(params),
    staleTime: 30_000,
    retry: false,
  })
}

export function useGroup(pda: string) {
  return useQuery({
    queryKey: ['groups', pda],
    queryFn: () => groupsApi.get(pda),
    staleTime: 20_000,
    enabled: !!pda,
    retry: false,
  })
}

export function useMyPrediction(fixtureId: string) {
  return useQuery({
    queryKey: ['predictions', fixtureId, 'me'],
    queryFn: () =>
      import('@/lib/api/endpoints').then((m) => m.predictionsApi.me(fixtureId)),
    staleTime: 5_000,
    enabled: !!fixtureId && !!getJwt(),
    retry: false,
  })
}
