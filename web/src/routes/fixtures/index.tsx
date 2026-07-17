import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Skeleton, Tab, Tabs } from '@heroui/react'
import { Calendar, RefreshCw } from 'lucide-react'
import type { Fixture } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { useFixtures } from '@/hooks/queries/useFixtures'

export const Route = createFileRoute('/fixtures/')({ component: FixturesPage })

// ─── Status helpers ───────────────────────────────────────────────────────────

type FilterTab = 'all' | 'live' | 'upcoming' | 'finished'

function getFixtureStatus(f: Fixture): 'live' | 'upcoming' | 'finished' {
  // statusId: 1=Not started, 2=In play, 3=Paused, 4=Finished, 5=Suspended, 100=game_finalised
  if (f.statusId === null) return 'upcoming'
  if (f.statusId === 2 || f.statusId === 3) return 'live'
  if (f.statusId >= 4) return 'finished'
  return 'upcoming'
}

function StatusBadge({ fixture }: { fixture: Fixture }) {
  const status = getFixtureStatus(fixture)

  if (status === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] bg-success-500/15 text-success-500 font-mono text-[11px] font-semibold uppercase tracking-widest">
        <span className="live-dot w-1.5 h-1.5" />
        LIVE
      </span>
    )
  }
  if (status === 'finished') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] bg-slate-700/40 text-slate-400 font-mono text-[11px] font-semibold uppercase tracking-widest">
        FINAL
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)] bg-warning-500/15 text-warning-500 font-mono text-[11px] font-semibold uppercase tracking-widest">
      UPCOMING
    </span>
  )
}

function KickoffTime({ kickoffAt }: { kickoffAt: string | null }) {
  if (!kickoffAt)
    return <span className="text-slate-500 font-mono text-xs">TBD</span>

  const date = new Date(kickoffAt)
  const now = new Date()
  const diff = date.getTime() - now.getTime()

  let label: string
  if (diff < 0) {
    label = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } else if (diff < 3600_000) {
    const mins = Math.floor(diff / 60000)
    label = `in ${mins}m`
  } else if (diff < 86_400_000) {
    const hrs = Math.floor(diff / 3600_000)
    label = `in ${hrs}h`
  } else {
    label = date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  return (
    <span className="font-mono text-xs text-slate-400 tabular-nums">
      {label}
    </span>
  )
}

// ─── Fixture card ─────────────────────────────────────────────────────────────

function FixtureCard({
  fixture,
  featured,
}: {
  fixture: Fixture
  featured?: boolean
}) {
  const status = getFixtureStatus(fixture)

  return (
    <Link
      to="/fixtures/$fixtureId"
      params={{ fixtureId: fixture.fixtureId }}
      className={cnm(
        'group block p-5 rounded-[var(--radius-lg)] transition-all duration-200',
        'border focus-ring',
        featured
          ? 'rounded-2xl bg-ink-800 border-accent-500/35 rounded-[var(--radius-xl)] text-cream-50'
          : 'bg-ink-800 border-white/[0.08] text-cream-50',
        'hover:border-accent-500/40 hover:translate-y-[-2px]',
        status === 'live' && 'border-success-500/25',
      )}
    >
      {/* Category row */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500">
          {fixture.competitionName ?? (fixture.competitionId ? `Comp ${fixture.competitionId}` : 'Fixture')}
        </span>
        <StatusBadge fixture={fixture} />
      </div>

      {/* Teams */}
      <div className="space-y-3 mb-4">
        <p className="text-lg font-semibold text-cream-50 leading-tight truncate group-hover:text-accent-500 transition-colors duration-150">
          {fixture.homeTeam}
        </p>
        <p className="text-xs font-mono text-slate-500 uppercase tracking-[0.12em]">
          vs
        </p>
        <p className="text-lg font-semibold text-cream-50 leading-tight truncate">
          {fixture.awayTeam}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Calendar size={12} strokeWidth={1.75} />
          <KickoffTime kickoffAt={fixture.kickoffAt} />
        </div>
        <span className="text-xs font-semibold text-accent-500 group-hover:underline underline-offset-4 transition-all">
          Predict →
        </span>
      </div>
    </Link>
  )
}

// ─── Skeleton card ────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] space-y-3">
      <div className="flex justify-between">
        <Skeleton className="h-3 w-20 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
        <Skeleton className="h-5 w-16 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      </div>
      <Skeleton className="h-6 w-full rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      <Skeleton className="h-3 w-8 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      <Skeleton className="h-6 w-3/4 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      <div className="flex justify-between pt-3 border-t border-white/[0.06]">
        <Skeleton className="h-3 w-16 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
        <Skeleton className="h-3 w-12 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
      <div className="w-24 h-24 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] flex items-center justify-center mb-6 pixel text-4xl">
        🏟️
      </div>
      <p className="text-base font-semibold text-cream-50 mb-2">
        No matches right now.
      </p>
      <p className="text-sm text-slate-400">The whistle will blow soon.</p>
    </div>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
      <p className="text-base font-semibold text-cream-50 mb-2">
        Failed to load fixtures.
      </p>
      <p className="text-sm text-slate-400 mb-6">
        Check that the backend is running at localhost:3700.
      </p>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-5 h-10 rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 text-sm font-semibold hover:bg-ink-800 transition-colors"
      >
        <RefreshCw size={14} strokeWidth={1.75} />
        Retry
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function FixturesPage() {
  const [filter, setFilter] = useState<FilterTab>('all')

  const { data: fixtures, isLoading, isError, refetch } = useFixtures()

  // Filter by tab, then sort so the most relevant match to a fan is on top:
  //   live > upcoming (soonest first) > finished (most recent first).
  // Fixtures without a kickoff time sort last within their status bucket.
  const statusRank = { live: 0, upcoming: 1, finished: 2 } as const
  const ts = (f: Fixture) =>
    f.kickoffAt ? new Date(f.kickoffAt).getTime() : Number.POSITIVE_INFINITY

  const filtered = (
    fixtures?.filter((f) => {
      if (filter === 'all') return true
      return getFixtureStatus(f) === filter
    }) ?? []
  ).slice().sort((a, b) => {
    const sa = getFixtureStatus(a)
    const sb = getFixtureStatus(b)
    if (sa !== sb) return statusRank[sa] - statusRank[sb]
    // Same status: finished sorts newest-first; live/upcoming sort soonest-first.
    return sa === 'finished' ? ts(b) - ts(a) : ts(a) - ts(b)
  })

  const liveCount =
    fixtures?.filter((f) => getFixtureStatus(f) === 'live').length ?? 0

  // Most imminent upcoming fixture for featured card
  const soonestUpcoming = fixtures
    ?.filter((f) => getFixtureStatus(f) === 'upcoming' && f.kickoffAt)
    .sort(
      (a, b) =>
        new Date(a.kickoffAt!).getTime() - new Date(b.kickoffAt!).getTime(),
    )[0]

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        {/* Header */}
        <AnimateComponent entry="fadeInUp" duration={400}>
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-3">
            Matches
          </p>
          <h1 className="text-3xl md:text-5xl font-bold text-cream-50 tracking-[-0.02em] mb-6">
            Pick your next prediction
          </h1>
        </AnimateComponent>

        {/* Filter tabs */}
        <AnimateComponent entry="fadeInUp" duration={400}>
          <div className="overflow-x-auto pb-1 mb-8">
            <Tabs
              selectedKey={filter}
              onSelectionChange={(k) => setFilter(k as FilterTab)}
              aria-label="Filter fixtures"
              classNames={{
                tabList: 'bg-ink-700/60 rounded-full p-1 gap-1 flex-nowrap',
                tab: 'rounded-full text-sm font-medium text-slate-400 data-[selected=true]:text-ink-900 data-[selected=true]:bg-accent-500 h-8 px-4 whitespace-nowrap',
                cursor: 'hidden',
              }}
            >
              <Tab key="all" title="All" />
              <Tab
                key="live"
                title={
                  liveCount > 0 ? (
                    <span className="flex items-center gap-1.5">
                      <span className="live-dot w-1.5 h-1.5" />
                      Live {liveCount > 0 && `(${liveCount})`}
                    </span>
                  ) : (
                    'Live'
                  )
                }
              />
              <Tab key="upcoming" title="Upcoming" />
              <Tab key="finished" title="Finished" />
            </Tabs>
          </div>
        </AnimateComponent>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {isLoading &&
            Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}

          {isError && <ErrorState onRetry={() => refetch()} />}

          {!isLoading && !isError && filtered.length === 0 && <EmptyState />}

          {!isLoading &&
            !isError &&
            filtered.map((fixture, i) => (
              <AnimateComponent
                key={fixture.fixtureId}
                entry="fadeInUp"
                duration={500}
                delay={i * 60}
              >
                <FixtureCard
                  fixture={fixture}
                  featured={fixture.fixtureId === soonestUpcoming?.fixtureId}
                />
              </AnimateComponent>
            ))}
        </div>
      </div>
    </div>
  )
}
