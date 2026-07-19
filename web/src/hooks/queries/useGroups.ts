import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { groupsApi } from '@/lib/api/endpoints'
import { apiGet, getJwt } from '@/lib/api/client'
import { useSSEStore } from '@/hooks/useFixtureStream'

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

// ─── Leaderboard types ────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  wallet: string
  joinedAt: string
  predictionCount: number
  hitCount: number
  missCount: number
  hitRate: number
  score: number
}

export interface GroupLeaderboardData {
  groupPda: string
  memberCount: number
  note: string
  leaderboard: LeaderboardEntry[]
}

// ─── useGroupLeaderboard ──────────────────────────────────────────────────────

export function useGroupLeaderboard(groupPda: string) {
  const queryClient = useQueryClient()
  const timeline = useSSEStore((s) => s.timeline)

  // Invalidate the leaderboard whenever a stickerMinted event fires on the
  // shared SSE store. This is best-effort — the store is fixture-scoped but
  // any new sticker means rankings may have shifted.
  useEffect(() => {
    if (timeline.length === 0) return
    const last = timeline[timeline.length - 1]
    if (last.event === 'sticker_minted') {
      void queryClient.invalidateQueries({
        queryKey: ['groups', groupPda, 'leaderboard'],
      })
    }
  }, [timeline, groupPda, queryClient])

  return useQuery({
    queryKey: ['groups', groupPda, 'leaderboard'],
    queryFn: () =>
      apiGet<GroupLeaderboardData>(`/api/groups/${encodeURIComponent(groupPda)}/leaderboard`),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    enabled: !!groupPda,
    retry: false,
  })
}
