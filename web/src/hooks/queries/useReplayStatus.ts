import { useQuery } from '@tanstack/react-query'
import { metaApi } from '@/lib/api/endpoints'

export function useReplayStatus() {
  return useQuery({
    queryKey: ['replay', 'status'],
    queryFn: () => metaApi.replayStatus(),
    refetchInterval: 5_000,
    staleTime: 4_000,
    retry: false,
  })
}
