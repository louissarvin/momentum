import { Link, createFileRoute } from '@tanstack/react-router'
import { Skeleton } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, Radio, RefreshCw, Zap } from 'lucide-react'
import type { Fixture } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { useFixture } from '@/hooks/queries/useFixtures'
import { useAuth } from '@/hooks/useAuth'
import { predictionMeOptions } from '@/lib/api/endpoints'
import { solscanAcct } from '@/utils/solscan'

export const Route = createFileRoute('/fixtures/$fixtureId/')({
  component: FixtureDetailPage,
})

// ─── Status helpers ───────────────────────────────────────────────────────────

function getStatus(f: Fixture): 'live' | 'upcoming' | 'finished' {
  if (f.statusId === null) return 'upcoming'
  if (f.statusId === 2 || f.statusId === 3) return 'live'
  if (f.statusId >= 4) return 'finished'
  return 'upcoming'
}

function StatusBadge({ f }: { f: Fixture }) {
  const s = getStatus(f)
  if (s === 'live') {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] bg-success-500/15 text-success-500 font-mono text-xs font-semibold uppercase tracking-widest">
        <span className="live-dot w-2 h-2" />
        LIVE · Period {f.period ?? '?'}
      </span>
    )
  }
  if (s === 'finished') {
    return (
      <span className="inline-flex items-center px-3 py-1 rounded-[var(--radius-sm)] bg-slate-700/40 text-slate-400 font-mono text-xs font-semibold uppercase tracking-widest">
        FINAL
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-[var(--radius-sm)] bg-warning-500/15 text-warning-500 font-mono text-xs font-semibold uppercase tracking-widest">
      UPCOMING
    </span>
  )
}

// ─── Hero card ────────────────────────────────────────────────────────────────

function FixtureHero({ fixture }: { fixture: Fixture }) {
  const status = getStatus(fixture)
  const kickoffDate = fixture.kickoffAt ? new Date(fixture.kickoffAt) : null

  return (
    <div
      className={cnm(
        'rounded-3xl relative p-8 md:p-10 rounded-[var(--radius-2xl)]',
        'bg-ink-800 border',
        status === 'live' ? 'border-success-500/30' : 'border-accent-500/30',
      )}
    >

      {/* Status */}
      <div className="mb-6">
        <StatusBadge f={fixture} />
      </div>

      {/* Teams */}
      <div className="grid grid-cols-3 items-center gap-4">
        <div>
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-2">
            Home
          </p>
          <h2 className="text-2xl md:text-3xl font-bold text-cream-50 leading-tight">
            {fixture.homeTeam}
          </h2>
        </div>

        <div className="text-center">
          {/* Score placeholder — SSE wires in W-D */}
          <p className="text-3xl md:text-4xl font-mono font-medium text-accent-500 tabular-nums">
            – : –
          </p>
          {status === 'upcoming' && kickoffDate && (
            <p className="mt-2 text-xs font-mono text-slate-500 tabular-nums">
              {kickoffDate.toLocaleDateString([], {
                month: 'short',
                day: 'numeric',
              })}{' '}
              {kickoffDate.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>

        <div className="text-right">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-2">
            Away
          </p>
          <h2 className="text-2xl md:text-3xl font-bold text-cream-50 leading-tight">
            {fixture.awayTeam}
          </h2>
        </div>
      </div>

      {(fixture.competitionName || fixture.competitionId) && (
        <div className="mt-6 pt-5 border-t border-white/[0.06]">
          <p className="text-xs font-mono text-slate-500">
            Competition:{' '}
            <span className="text-slate-400">
              {fixture.competitionName ?? `#${fixture.competitionId}`}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

// ─── CTA section ──────────────────────────────────────────────────────────────

function PredictCTA({ fixture }: { fixture: Fixture }) {
  const status = getStatus(fixture)
  const canPredict = status === 'upcoming'

  if (!canPredict) {
    return (
      <div className="p-4 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08] text-center">
        <p className="text-sm text-slate-400">
          {status === 'live'
            ? 'Match in progress — predictions closed.'
            : 'This match has ended.'}
        </p>
      </div>
    )
  }

  return (
    <Link
      to="/fixtures/$fixtureId/predict"
      params={{ fixtureId: fixture.fixtureId }}
      className={cnm(
        'inline-flex items-center justify-center gap-2 w-full sm:w-auto',
        'px-8 py-3 rounded-full',
        'bg-accent-500 text-ink-900 font-semibold text-base',
        'hover:bg-accent-600 active:scale-[0.97] transition-all duration-150 focus-ring',
      )}
    >
      <Zap size={16} strokeWidth={1.75} />
      Build Prediction Card
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── Your prediction card (auth-gated) ───────────────────────────────────────

// Reverse-map on-chain stat keys back to human labels. Mirrors the
// buildStatCatalog logic in predict.tsx:
//   stat_key = period_prefix + base_key
//   Base keys: 1=P1 Goals, 2=P2 Goals, 3=P1 Yellow, 4=P2 Yellow,
//              5=P1 Red,   6=P2 Red,   7=P1 Corners, 8=P2 Corners
const METRIC_BY_BASE: Record<number, string> = {
  1: 'Goals',
  2: 'Goals',
  3: 'Yellow Cards',
  4: 'Yellow Cards',
  5: 'Red Cards',
  6: 'Red Cards',
  7: 'Corners',
  8: 'Corners',
}

const PERIOD_LABEL: Record<number, string> = {
  0: 'Full match',
  1000: 'First half',
  3000: 'Second half',
  4000: 'Extra time 1',
  5000: 'Extra time 2',
  6000: 'Penalties',
  7000: 'Extra time total',
}

function describeSlot(
  slot: { statAKey?: number; statBKey?: number; op?: number; period?: number },
  homeTeam: string,
  awayTeam: string,
  p1IsHome: boolean,
): { title: string; period: string } {
  const statA = slot.statAKey ?? 0
  const period = slot.period ?? 0
  const baseA = statA % 1000 || statA
  const metric = METRIC_BY_BASE[baseA] ?? `Stat ${baseA}`
  const periodStr = PERIOD_LABEL[period] ?? `Period ${period}`

  // Compound (Match total) → op = 1 (Add) with statBKey set
  const isCompound = (slot.op ?? 0) !== 0 && (slot.statBKey ?? 0) !== 0
  if (isCompound) {
    return { title: `Match total — ${metric}`, period: periodStr }
  }

  // Single: odd base = P1, even base = P2
  const isP1 = baseA % 2 === 1
  const team = isP1 === p1IsHome ? homeTeam : awayTeam
  return { title: `${team} — ${metric}`, period: periodStr }
}

function YourPredictionCard({ fixture }: { fixture: Fixture }) {
  const { isAuthenticated } = useAuth()
  const { data: card } = useQuery({
    ...predictionMeOptions(fixture.fixtureId),
    enabled: isAuthenticated,
  })

  if (!isAuthenticated || !card) return null

  const slots = card.slots ?? []
  const activeSlots = slots.filter(
    (s) => s.statAKey != null && s.statAKey > 0,
  )
  if (activeSlots.length === 0) return null

  const p1IsHome = fixture.participant1IsHome ?? true

  return (
    <AnimateComponent entry="fadeInUp" duration={400} delay={100}>
      <div className="p-5 md:p-6 rounded-3xl bg-success-500/[0.04] border border-success-500/25">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2
                size={16}
                strokeWidth={2}
                className="text-success-500"
              />
              <p className="text-xs font-mono uppercase tracking-[0.12em] text-success-500">
                Your prediction card
              </p>
            </div>
            <p className="text-sm text-slate-400">
              {activeSlots.length} slot{activeSlots.length === 1 ? '' : 's'}{' '}
              submitted on-chain
            </p>
          </div>
          <a
            href={solscanAcct(card.cardPda)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] font-mono text-sui-500 hover:text-cream-50 transition-colors shrink-0"
          >
            view on solscan ↗
          </a>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {activeSlots.map((slot, i) => {
            const cmp = ['Over', 'Under', 'Exact'][
              slot.predicateComparison ?? 0
            ]
            const { title, period } = describeSlot(
              slot,
              fixture.homeTeam,
              fixture.awayTeam,
              p1IsHome,
            )
            const isDefaultPeriod = (slot.period ?? 0) === 0
            return (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-xl bg-ink-800/60 border border-white/[0.05]"
              >
                <div className="w-1 self-stretch min-h-6 rounded-full bg-accent-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-cream-50 leading-tight break-words">
                    {title}
                  </p>
                  {!isDefaultPeriod && (
                    <p className="text-[10px] text-accent-500/80 font-mono uppercase tracking-wider mt-0.5">
                      {period}
                    </p>
                  )}
                </div>
                <span className="text-xs font-mono text-accent-500 shrink-0">
                  {cmp} {slot.threshold}
                </span>
              </div>
            )
          })}
        </div>

        <p className="mt-4 text-[11px] font-mono text-slate-500">
          Settled slots turn into cNFT stickers as TxLINE proves each stat.
        </p>
      </div>
    </AnimateComponent>
  )
}

function FixtureDetailPage() {
  const { fixtureId } = Route.useParams()

  const { data, isLoading, isError, refetch } = useFixture(fixtureId)

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        <AnimateComponent entry="fadeInUp" duration={300}>
          <Link
            to="/fixtures"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8 focus-ring rounded-full"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            All fixtures
          </Link>
        </AnimateComponent>

        {isLoading && (
          <div className="space-y-6">
            <Skeleton className="h-48 rounded-[var(--radius-2xl)] pixel-shimmer bg-ink-800" />
            <Skeleton className="h-12 w-48 rounded-full pixel-shimmer bg-ink-800" />
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center py-24 text-center">
            <p className="text-base font-semibold text-cream-50 mb-2">
              Couldn't load this fixture.
            </p>
            <button
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center gap-2 px-5 h-10 rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 text-sm font-semibold"
            >
              <RefreshCw size={14} strokeWidth={1.75} />
              Retry
            </button>
          </div>
        )}

        {data && (
          <div className="space-y-8">
            <AnimateComponent entry="fadeInUp" duration={500}>
              <FixtureHero fixture={data.fixture} />
            </AnimateComponent>

            <YourPredictionCard fixture={data.fixture} />

            <AnimateComponent entry="fadeInUp" duration={400} delay={100}>
              <div className="flex flex-col sm:flex-row gap-3">
                <PredictCTA fixture={data.fixture} />
                <Link
                  to="/fixtures/$fixtureId/live"
                  params={{ fixtureId: data.fixture.fixtureId }}
                  title="Real-time match view — SSE stream + settlement reveal ceremony"
                  className={cnm(
                    'inline-flex items-center justify-center gap-2 w-full sm:w-auto',
                    'px-8 py-3 rounded-full',
                    'bg-ink-800 border border-white/[0.12] text-cream-50 font-semibold text-base',
                    'hover:border-accent-500/40 active:scale-[0.97] transition-all duration-150 focus-ring',
                  )}
                >
                  <Radio size={16} strokeWidth={1.75} />
                  Watch Live
                </Link>
              </div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                <span className="font-mono uppercase text-slate-600 tracking-wider">
                  Live view:
                </span>{' '}
                streams TxLINE packets in real time. When a scoring event hits
                one of your slots, the settler mints a cNFT sticker to your
                wallet and the reveal ceremony plays.
              </p>
            </AnimateComponent>

            {data.latestPacket && (
              <AnimateComponent entry="fadeInUp" duration={400} delay={150}>
                <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                    Latest update
                  </p>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-slate-400 tabular-nums">
                      seq {data.latestPacket.seq}
                    </span>
                    {data.latestPacket.action && (
                      <span className="px-2 py-0.5 rounded-[var(--radius-sm)] bg-ink-700 font-mono text-xs text-cream-50 uppercase">
                        {data.latestPacket.action}
                      </span>
                    )}
                  </div>
                </div>
              </AnimateComponent>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
