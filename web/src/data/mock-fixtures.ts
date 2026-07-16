import type { Fixture, FixtureDetail } from '@/lib/api/types'

export const MOCK_FIXTURES: Array<Fixture> = [
  {
    fixtureId: '18237038',
    competitionId: '1',
    homeTeam: 'France',
    awayTeam: 'Germany',
    kickoffAt: '2026-07-21T18:00:00.000Z',
    statusId: 1,
    period: 0,
  },
  {
    fixtureId: '18237039',
    competitionId: '1',
    homeTeam: 'Spain',
    awayTeam: 'Brazil',
    kickoffAt: '2026-07-21T21:00:00.000Z',
    statusId: 2,
    period: 2,
  },
  {
    fixtureId: '18237040',
    competitionId: '1',
    homeTeam: 'Italy',
    awayTeam: 'Argentina',
    kickoffAt: '2026-07-20T15:00:00.000Z',
    statusId: 4,
    period: 0,
  },
  {
    fixtureId: '18237041',
    competitionId: '2',
    homeTeam: 'England',
    awayTeam: 'Portugal',
    kickoffAt: '2026-07-22T19:00:00.000Z',
    statusId: 1,
    period: 0,
  },
  {
    fixtureId: '18237042',
    competitionId: '2',
    homeTeam: 'Netherlands',
    awayTeam: 'Belgium',
    kickoffAt: '2026-07-22T16:00:00.000Z',
    statusId: 1,
    period: 0,
  },
  {
    fixtureId: '18237043',
    competitionId: '3',
    homeTeam: 'Mexico',
    awayTeam: 'Uruguay',
    kickoffAt: '2026-07-23T20:00:00.000Z',
    statusId: 1,
    period: 0,
  },
]

export function getMockFixtureDetail(id: string): FixtureDetail | null {
  const fixture = MOCK_FIXTURES.find((f) => f.fixtureId === id) ?? null
  if (!fixture) return null
  return { fixture, latestPacket: null }
}
