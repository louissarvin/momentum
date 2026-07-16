import { useQuery } from '@tanstack/react-query'
import { fixturesApi } from '@/lib/api/endpoints'
import { MOCK_FIXTURES, getMockFixtureDetail } from '@/data/mock-fixtures'

export function useFixtures() {
  return useQuery({
    queryKey: ['fixtures'],
    queryFn: async () => {
      try {
        return await fixturesApi.list()
      } catch {
        // Backend offline — return mock fixtures flagged for display
        return MOCK_FIXTURES
      }
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  })
}

export function useFixture(id: string) {
  return useQuery({
    queryKey: ['fixtures', id],
    queryFn: async () => {
      try {
        return await fixturesApi.get(id)
      } catch {
        const mock = getMockFixtureDetail(id)
        if (mock) return mock
        throw new Error('Fixture not found')
      }
    },
    staleTime: 10_000,
    enabled: !!id,
    retry: false,
  })
}
