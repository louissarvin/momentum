import { useCallback, useMemo, useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Skeleton, Slider } from '@heroui/react'
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import type { PredictionSlotInput } from '@/lib/api/types'
import { useAuth } from '@/hooks/useAuth'
import { predictionMeOptions } from '@/lib/api/endpoints'
import { useQuery } from '@tanstack/react-query'
import { useSubmitPredictions } from '@/hooks/mutations/useSubmitPredictions'
import { useToast } from '@/hooks/useToast'
import { ToastStack } from '@/components/ui/ToastStack'
import { cnm } from '@/utils/style'
import { useFixture } from '@/hooks/queries/useFixtures'

export const Route = createFileRoute('/fixtures/$fixtureId/predict')({
  component: PredictBuilderPage,
})

// ─── Stat catalog ─────────────────────────────────────────────────────────────
// TxLINE stat-key encoding (per 01_txline_technical_deep_dive.md §8):
//   stat_key = period_prefix + base_key
//   Base keys (1..8): P1/P2 alternating for [Goals, Yellow Cards, Red Cards, Corners]
//     1 = P1 Goals        5 = P1 Red Cards
//     2 = P2 Goals        6 = P2 Red Cards
//     3 = P1 Yellow       7 = P1 Corners
//     4 = P2 Yellow       8 = P2 Corners
//   Period prefixes: 0 Total, 1000 H1, 3000 H2 (H1-only + H2-only, not HT-agg)
//     4000 ET1, 5000 ET2, 6000 Penalties, 7000 ET Total
//
// Shots/possession are NOT stat-key-based per docs — they live in the event
// stream and cannot be settled via validate_stat. So we DON'T offer them.
//
// "Match total" = compound: statA=P1 base, statB=P2 base, op=Add. The
// on-chain contract supports this. Everything else is a single stat.

type Metric = 'goals' | 'yellow' | 'red' | 'corners'
type Side = 'total' | 'home' | 'away'
type Period = 0 | 1000 | 3000 | 4000 | 5000 | 6000 | 7000

interface StatDef {
  id: string // unique per (metric, side, period) — used for picker + de-dup
  category: 'goals' | 'cards' | 'corners' | 'other'
  metric: Metric
  side: Side
  period: Period
  label: string
  description: string
  // Resolved base keys (single OR compound):
  statAKey: number
  statBKey: number // 0 = not compound
  // Matches on-chain BinaryExpression encoding:
  //   0 = None (single stat, statBKey MUST be 0)
  //   1 = Add    (compound: statA + statB)
  //   2 = Subtract (compound: statA - statB)
  op: 0 | 1 | 2
}

const METRIC_LABEL: Record<Metric, string> = {
  goals: 'Goals',
  yellow: 'Yellow Cards',
  red: 'Red Cards',
  corners: 'Corners',
}

const METRIC_BASE_KEYS: Record<Metric, [number, number]> = {
  // [P1 base, P2 base] per TxLINE spec
  goals: [1, 2],
  yellow: [3, 4],
  red: [5, 6],
  corners: [7, 8],
}

const METRIC_CATEGORY: Record<Metric, StatDef['category']> = {
  goals: 'goals',
  yellow: 'cards',
  red: 'cards',
  corners: 'corners',
}

const PERIOD_LABELS: Record<Period, string> = {
  0: 'Full match',
  1000: 'First half',
  3000: 'Second half',
  4000: 'Extra time 1',
  5000: 'Extra time 2',
  6000: 'Penalties',
  7000: 'ET total',
}

// Short badge form for compact display on prediction card
const PERIOD_SHORT: Record<Period, string> = {
  0: 'FT',
  1000: 'H1',
  3000: 'H2',
  4000: 'ET1',
  5000: 'ET2',
  6000: 'PEN',
  7000: 'ET',
}

// Short human explanation shown next to the period selector so users know
// what each period covers and the football timeline order.
const PERIOD_HINT: Record<Period, string> = {
  0: 'Regulation only — 90 min. Excludes extra time and penalties.',
  1000: 'Kick-off to half-time whistle (~45 min + stoppage).',
  3000: 'Half-time restart to full-time whistle (~45 min + stoppage).',
  4000: 'First 15 min of extra time (knockout ties only).',
  5000: 'Second 15 min of extra time.',
  6000: 'Penalty shootout — after extra time if still tied.',
  7000: 'Both extra-time halves combined (30 min).',
}

const METRICS: Array<Metric> = ['goals', 'yellow', 'red', 'corners']
const SIDES: Array<Side> = ['total', 'home', 'away']
// Picker shows period=0 (Full match) only — 12 items total. Period is a
// per-slot dropdown; changing it recomputes statAKey via `retargetSlotPeriod`.
const PICKER_PERIODS: Array<Period> = [0]
// Periods the per-slot selector exposes.
const SELECTABLE_PERIODS: Array<Period> = [0, 1000, 3000, 4000, 5000, 6000, 7000]

/**
 * Build every valid (metric × side × period) combination.
 * Home/Away picks correct base key based on which participant is home.
 * Match total constructs the compound predicate statA + statB.
 */
function buildStatCatalog(
  homeTeam: string,
  awayTeam: string,
  p1IsHome: boolean,
): Array<StatDef> {
  const items: Array<StatDef> = []
  for (const metric of METRICS) {
    const [p1, p2] = METRIC_BASE_KEYS[metric]
    const homeKey = p1IsHome ? p1 : p2
    const awayKey = p1IsHome ? p2 : p1
    for (const period of PICKER_PERIODS) {
      const periodSuffix = period === 0 ? '' : ` · ${PERIOD_LABELS[period]}`
      for (const side of SIDES) {
        const teamPart =
          side === 'total' ? 'Match total' : side === 'home' ? homeTeam : awayTeam
        const label = `${teamPart} — ${METRIC_LABEL[metric]}${periodSuffix}`
        const description =
          side === 'total'
            ? `Combined ${METRIC_LABEL[metric].toLowerCase()} across both teams${period === 0 ? '' : ` in ${PERIOD_LABELS[period].toLowerCase()}`}`
            : `${METRIC_LABEL[metric]} by ${teamPart} only${period === 0 ? '' : ` in ${PERIOD_LABELS[period].toLowerCase()}`}`
        const baseA = side === 'total' ? p1 : side === 'home' ? homeKey : awayKey
        const baseB = side === 'total' ? p2 : 0
        items.push({
          id: `${metric}-${side}-${period}`,
          category: METRIC_CATEGORY[metric],
          metric,
          side,
          period,
          label,
          description,
          statAKey: period + baseA,
          statBKey: side === 'total' ? period + baseB : 0,
          // Total = compound (Add). Home/Away = single stat (None).
          op: side === 'total' ? 1 : 0,
        })
      }
    }
  }
  return items
}

const CATEGORY_COLOR: Record<StatDef['category'], string> = {
  goals: 'bg-cat-goals/15 text-cat-goals border-cat-goals/30',
  cards: 'bg-cat-cards/15 text-cat-cards border-cat-cards/30',
  corners: 'bg-cat-corners/15 text-cat-corners border-cat-corners/30',
  other: 'bg-cat-other/15 text-cat-other border-cat-other/30',
}

const CATEGORY_STRIPE: Record<StatDef['category'], string> = {
  goals: 'bg-cat-goals',
  cards: 'bg-cat-cards',
  corners: 'bg-cat-corners',
  other: 'bg-cat-other',
}

const PREDICATE_LABELS = ['Over', 'Under', 'Exact'] as const

// ─── Slot state ───────────────────────────────────────────────────────────────

interface SlotState extends PredictionSlotInput {
  _id: number
  _stat: StatDef
}

let idCounter = 0
function makeSlot(stat: StatDef): SlotState {
  return {
    _id: ++idCounter,
    _stat: stat,
    statAKey: stat.statAKey,
    statBKey: stat.statBKey,
    op: stat.op,
    predicateComparison: 0, // Over
    threshold: 1,
    period: stat.period,
  }
}

// Change a slot's period → recompute statAKey / statBKey by adding the
// new period prefix to the same base keys. Base = (statAKey - oldPrefix).
function retargetSlotPeriod(slot: SlotState, newPeriod: Period): Partial<SlotState> {
  const oldPrefix = (slot.period ?? 0) as Period
  const baseA = slot.statAKey - oldPrefix
  const statB = slot.statBKey ?? 0
  const baseB = statB === 0 ? 0 : statB - oldPrefix
  return {
    period: newPeriod,
    statAKey: newPeriod + baseA,
    statBKey: baseB === 0 ? 0 : newPeriod + baseB,
    _stat: {
      ...slot._stat,
      period: newPeriod,
      statAKey: newPeriod + baseA,
      statBKey: baseB === 0 ? 0 : newPeriod + baseB,
      id: `${slot._stat.metric}-${slot._stat.side}-${newPeriod}`,
    },
  }
}

// ─── Slot editor ─────────────────────────────────────────────────────────────

function SlotEditor({
  slot,
  index,
  onUpdate,
  onRemove,
}: {
  slot: SlotState
  index: number
  onUpdate: (id: number, patch: Partial<SlotState>) => void
  onRemove: (id: number) => void
}) {
  const cat = slot._stat.category

  return (
    <div className="relative flex gap-0 rounded-[var(--radius-md)] overflow-hidden border border-white/[0.08] bg-ink-800">
      {/* Category stripe */}
      <div className={cnm('w-1 shrink-0', CATEGORY_STRIPE[cat])} />

      <div className="flex-1 p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-0.5">
              Slot {index + 1}
            </p>
            <p className="text-sm font-semibold text-cream-50">
              {slot._stat.label}
            </p>
          </div>
          <button
            onClick={() => onRemove(slot._id)}
            className="text-slate-600 hover:text-error-500 transition-colors p-1 rounded focus-ring"
            aria-label={`Remove slot ${index + 1}`}
          >
            <Trash2 size={13} strokeWidth={1.75} />
          </button>
        </div>

        {/* Predicate toggle */}
        <div className="mb-3">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2">
            Condition
          </p>
          <div className="flex gap-1">
            {PREDICATE_LABELS.map((label, i) => (
              <button
                key={label}
                onClick={() =>
                  onUpdate(slot._id, { predicateComparison: i as 0 | 1 | 2 })
                }
                className={cnm(
                  'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors duration-150 focus-ring',
                  slot.predicateComparison === i
                    ? 'bg-accent-500 text-ink-900'
                    : 'bg-ink-700 text-slate-400 hover:text-cream-50 border border-white/[0.08]',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Threshold */}
        <div className="mb-3">
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-2">
            Threshold
          </p>
          <div className="flex items-center gap-3">
            <Slider
              size="sm"
              step={1}
              minValue={0}
              maxValue={10}
              value={slot.threshold}
              onChange={(v) =>
                onUpdate(slot._id, { threshold: Array.isArray(v) ? v[0] : v })
              }
              classNames={{
                base: 'flex-1',
                track: 'bg-ink-700 h-1.5',
                filler: 'bg-accent-500',
                thumb:
                  'w-3.5 h-3.5 rounded-[var(--radius-sm)] bg-cream-50 border-2 border-accent-500',
                label: 'hidden',
                value: 'hidden',
              }}
            />
            <span className="font-mono text-sm text-accent-500 tabular-nums w-8 text-right">
              {slot.threshold}
            </span>
          </div>
        </div>

        {/* Period */}
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
              When
            </p>
            <p className="text-[10px] font-mono text-slate-700">
              H1 → H2 → ET → PEN
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {SELECTABLE_PERIODS.map((value) => (
              <button
                key={value}
                onClick={() =>
                  onUpdate(slot._id, retargetSlotPeriod(slot, value))
                }
                className={cnm(
                  'px-2.5 py-1 rounded-full text-xs font-medium transition-colors duration-150 focus-ring',
                  slot.period === value
                    ? 'bg-ink-700 text-cream-50 border border-white/[0.2]'
                    : 'text-slate-500 hover:text-slate-400',
                )}
              >
                {PERIOD_LABELS[value]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-slate-500 leading-snug">
            {PERIOD_HINT[(slot.period ?? 0) as Period]}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Card preview ─────────────────────────────────────────────────────────────

function CardPreview({
  slots,
  homeTeam,
  awayTeam,
}: {
  slots: Array<SlotState>
  homeTeam: string
  awayTeam: string
}) {
  return (
    <div className="rounded-2xl sticky top-24 p-6 rounded-[var(--radius-xl)] bg-ink-800 border border-accent-500/25 text-cream-50">
      {/* Card header */}
      <div className="mb-5">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-1">
          Prediction Card
        </p>
        <p className="text-sm font-semibold text-cream-50 leading-tight">
          {homeTeam} vs {awayTeam}
        </p>
      </div>

      {/* Slot list — grows from 0 as user adds. Max 8. */}
      {slots.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-xs font-mono text-slate-600 uppercase tracking-widest mb-2">
            Empty card
          </p>
          <p className="text-xs text-slate-500 max-w-[220px] mx-auto leading-relaxed">
            Pick a prediction from the right to start your card. Up to 8 slots.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {slots.map((slot) => {
            const predicateLabel = PREDICATE_LABELS[slot.predicateComparison]
            const cat = slot._stat.category
            const period = (slot.period ?? 0) as Period
            return (
              <div
                key={slot._id}
                className="flex items-center gap-2 min-h-10 py-2 rounded-[var(--radius-sm)] bg-ink-700/60 border border-white/[0.08] px-3"
              >
                <div
                  className={cnm(
                    'w-1 self-stretch min-h-5 rounded-full shrink-0',
                    CATEGORY_STRIPE[cat],
                  )}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-cream-50 leading-tight break-words">
                    {slot._stat.label.replace(/ · .+$/, '')}
                  </p>
                  {period !== 0 && (
                    <p className="mt-0.5 text-[10px] font-mono uppercase tracking-widest text-accent-500/80">
                      {PERIOD_SHORT[period]}
                    </p>
                  )}
                </div>
                <span className="text-xs font-mono text-slate-400 shrink-0">
                  {predicateLabel} {slot.threshold}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between">
        <p className="text-xs font-mono text-slate-500 tabular-nums">
          {slots.length} slot{slots.length === 1 ? '' : 's'}
          {slots.length >= 8 && ' — card full'}
        </p>
        <p
          className="text-[10px] font-mono text-slate-700"
          title="Prediction cards are fixed at 8 slots on-chain (Solana account layout constraint)."
        >
          {slots.length < 8 ? `${8 - slots.length} more available` : '8 / 8 max'}
        </p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function PredictBuilderPage() {
  const { fixtureId } = Route.useParams()
  const navigate = useNavigate()
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { isAuthenticated, login, loading: authLoading } = useAuth()
  const { toasts, show: showToast, dismiss } = useToast()

  const [slots, setSlots] = useState<Array<SlotState>>([])
  const [submitPhase, setSubmitPhase] = useState<
    'idle' | 'signing' | 'submitting' | 'confirming'
  >('idle')
  const [catFilter, setCatFilter] = useState<StatDef['category'] | 'all'>('all')

  const { data, isLoading } = useFixture(fixtureId)

  // Prevent double-submit: check if the user already has a card on-chain
  // for this fixture. PredictionCard PDA is init-only (one per user × fixture),
  // so trying to submit twice would be a silent no-op on the backend.
  const { data: existingCard } = useQuery({
    ...predictionMeOptions(fixtureId),
    enabled: isAuthenticated,
  })
  const activeSlotCount = (existingCard?.slots ?? []).filter(
    (s) => s.statAKey != null && s.statAKey > 0,
  ).length
  const hasExistingCard = !!existingCard && activeSlotCount > 0

  // Build the stat catalog with real team names, e.g. "Australia — Goals"
  // instead of "Home Goals" — no confusion about which team a slot references.
  // p1IsHome resolves TxLINE's P1/P2 base-key semantics to the actual home team.
  const statCatalog = useMemo(
    () =>
      buildStatCatalog(
        data?.fixture.homeTeam ?? 'Home',
        data?.fixture.awayTeam ?? 'Away',
        data?.fixture.participant1IsHome ?? true,
      ),
    [
      data?.fixture.homeTeam,
      data?.fixture.awayTeam,
      data?.fixture.participant1IsHome,
    ],
  )

  const submitMutation = useSubmitPredictions()

  const addSlot = useCallback(
    (stat: StatDef) => {
      if (slots.length >= 8) {
        showToast('info', 'Maximum 8 slots per prediction card.')
        return
      }
      // Allow duplicates of the same stat — user might want e.g.
      // "Match total goals over 1.5" AND "over 3.5" as separate bets.
      // Contract accepts any slot mix; only warn on truly identical
      // duplicates (same stat + threshold + comparison + period) since
      // those settle to the same outcome.
      setSlots((prev) => [...prev, makeSlot(stat)])
    },
    [slots, showToast],
  )

  const updateSlot = useCallback((id: number, patch: Partial<SlotState>) => {
    setSlots((prev) => prev.map((s) => (s._id === id ? { ...s, ...patch } : s)))
  }, [])

  const removeSlot = useCallback((id: number) => {
    setSlots((prev) => prev.filter((s) => s._id !== id))
  }, [])

  const filteredStats =
    catFilter === 'all'
      ? statCatalog
      : statCatalog.filter((s) => s.category === catFilter)

  const addedIds = new Set(slots.map((s) => s._stat.id))

  async function handleSubmit() {
    if (!connected) {
      setVisible(true)
      return
    }
    if (!isAuthenticated) {
      setSubmitPhase('signing')
      try {
        await login()
      } catch {
        showToast('error', 'Sign-in failed. Please try again.')
        setSubmitPhase('idle')
        return
      }
      setSubmitPhase('idle')
      // Let the user re-click after sign-in
      return
    }
    if (slots.length === 0) {
      showToast('info', 'Add at least one prediction slot.')
      return
    }

    setSubmitPhase('submitting')

    try {
      const slotInputs: Array<PredictionSlotInput> = slots.map((s) => ({
        statAKey: s.statAKey,
        statBKey: s.statBKey ?? 0,
        op: s.op ?? 0,
        predicateComparison: s.predicateComparison,
        threshold: s.threshold,
        period: s.period ?? 0,
      }))

      setSubmitPhase('confirming')
      const result = await submitMutation.mutateAsync({
        fixtureId,
        slots: slotInputs,
      })
      if (result.alreadyExists) {
        // Backend detected an existing card — no tx was sent, no new slots
        // were persisted. Be honest with the user.
        showToast(
          'info',
          'You already have a card on this fixture. Redirecting to view it.',
        )
      } else {
        showToast('success', 'Prediction card confirmed on-chain.')
      }
      setTimeout(() => {
        navigate({ to: '/fixtures/$fixtureId', params: { fixtureId } })
      }, 1400)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transaction failed'
      if (msg.includes('User rejected') || msg.includes('declined')) {
        showToast('error', 'Wallet declined signing. You can retry.')
      } else if (msg.includes('insufficient') || msg.includes('balance')) {
        showToast(
          'error',
          'Insufficient SOL. Get devnet SOL at faucet.solana.com.',
        )
      } else {
        showToast('error', `Failed: ${msg}`)
      }
    } finally {
      setSubmitPhase('idle')
    }
  }

  const submitLabel =
    submitPhase === 'signing'
      ? 'Signing in…'
      : submitPhase === 'submitting'
        ? 'Submitting to Solana…'
        : submitPhase === 'confirming'
          ? 'Confirming…'
          : slots.length === 0
            ? 'Add slots to predict'
            : `Submit ${slots.length}/8 slots`

  const fixture = data?.fixture

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        {/* Back nav */}
        <Link
          to="/fixtures/$fixtureId"
          params={{ fixtureId }}
          className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8 focus-ring rounded-full"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back to fixture
        </Link>

        {/* Page header */}
        <div className="mb-8">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-2">
            Prediction Builder
          </p>
          {isLoading ? (
            <Skeleton className="h-9 w-64 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-800" />
          ) : (
            <h1 className="text-3xl md:text-4xl font-bold text-cream-50 tracking-[-0.02em]">
              {fixture
                ? `${fixture.homeTeam} vs ${fixture.awayTeam}`
                : 'Fixture'}
            </h1>
          )}
        </div>

        {/* Already have a card — block the builder, guide back to fixture */}
        {hasExistingCard && (
          <div className="mb-8 p-6 rounded-3xl bg-warning-500/[0.06] border border-warning-500/25">
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-warning-500 mb-2">
              You already predicted this match
            </p>
            <h2 className="text-xl font-semibold text-cream-50 mb-2">
              Your card has {activeSlotCount} slot
              {activeSlotCount === 1 ? '' : 's'}
            </h2>
            <p className="text-sm text-slate-400 mb-5 max-w-[520px] leading-relaxed">
              On-chain rules: one prediction card per wallet per fixture.
              To pick again you'd need a different fixture or a different
              wallet. Your existing card is already earning stickers as
              TxLINE proves each stat.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/fixtures/$fixtureId"
                params={{ fixtureId }}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors"
              >
                View your card
              </Link>
              <Link
                to="/fixtures/$fixtureId/live"
                params={{ fixtureId }}
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-ink-800 border border-white/[0.12] text-cream-50 font-semibold text-sm hover:border-accent-500/40 transition-colors"
              >
                Watch Live
              </Link>
              <Link
                to="/fixtures"
                className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-slate-500 font-semibold text-sm hover:text-cream-50 transition-colors"
              >
                Pick a different match
              </Link>
            </div>
          </div>
        )}

        {/* Main layout — hidden when user already has an on-chain card
            for this fixture (one card per wallet × fixture on-chain rule). */}
        <div
          className={cnm(
            'grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-8',
            hasExistingCard && 'hidden',
          )}
        >
          {/* Left: slot builder + stat catalog */}
          <div className="space-y-6">
            {/* Current slots */}
            {slots.length > 0 && (
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                  Your slots ({slots.length}/8)
                </p>
                <div className="space-y-2">
                  {slots.map((slot, i) => (
                    <SlotEditor
                      key={slot._id}
                      slot={slot}
                      index={i}
                      onUpdate={updateSlot}
                      onRemove={removeSlot}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Stat catalog */}
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                Add predictions
              </p>

              {/* Category filter */}
              <div className="flex flex-wrap gap-1.5 mb-4">
                {(['all', 'goals', 'corners', 'cards'] as const).map(
                  (cat) => (
                    <button
                      key={cat}
                      onClick={() => setCatFilter(cat)}
                      className={cnm(
                        'px-3 py-1 rounded-full text-xs font-mono font-medium border transition-colors duration-150 focus-ring',
                        catFilter === cat
                          ? cat === 'all'
                            ? 'bg-accent-500 text-ink-900 border-transparent'
                            : cnm(
                                'border',
                                CATEGORY_COLOR[cat as StatDef['category']],
                              )
                          : 'bg-ink-700/40 text-slate-500 border-white/[0.06] hover:text-slate-400',
                      )}
                    >
                      {cat === 'all'
                        ? 'All'
                        : cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ),
                )}
              </div>

              {/* Stat list — a stat can be added multiple times with different
                  thresholds / periods (e.g. "Over 1.5" AND "Over 3.5"). Only
                  the card's 8-slot max gates adds. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredStats.map((stat) => {
                  const addedCount = slots.filter(
                    (s) => s._stat.id === stat.id,
                  ).length
                  const atMax = slots.length >= 8
                  return (
                    <button
                      key={stat.id}
                      onClick={() => addSlot(stat)}
                      disabled={atMax}
                      className={cnm(
                        'flex items-start gap-3 p-3 rounded-[var(--radius-md)] text-left transition-all duration-150 focus-ring',
                        'border',
                        atMax
                          ? 'bg-ink-800 border-white/[0.06] opacity-40 cursor-not-allowed'
                          : 'bg-ink-800 border-white/[0.08] hover:border-accent-500/40 hover:bg-ink-700 cursor-pointer',
                      )}
                    >
                      <div
                        className={cnm(
                          'w-1.5 self-stretch min-h-8 rounded-full shrink-0',
                          CATEGORY_STRIPE[stat.category],
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-cream-50 leading-snug break-words">
                          {stat.label}
                        </p>
                        <p className="text-xs text-slate-500 leading-snug break-words mt-0.5">
                          {stat.description}
                        </p>
                      </div>
                      {!atMax && addedCount === 0 && (
                        <Plus
                          size={14}
                          strokeWidth={1.75}
                          className="text-slate-500 shrink-0"
                        />
                      )}
                      {!atMax && addedCount > 0 && (
                        <span
                          className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-accent-500/15 text-accent-500 text-[10px] font-mono font-bold shrink-0"
                          title={`Added ${addedCount} time${addedCount === 1 ? '' : 's'}`}
                        >
                          ×{addedCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Right: card preview */}
          <div className="lg:block">
            {fixture ? (
              <CardPreview
                slots={slots}
                homeTeam={fixture.homeTeam}
                awayTeam={fixture.awayTeam}
              />
            ) : (
              <Skeleton className="h-64 rounded-[var(--radius-xl)] pixel-shimmer bg-ink-800" />
            )}
          </div>
        </div>
      </div>

      {/* Sticky submit bar — appears when at least 1 slot filled */}
      {slots.length > 0 && (
        <div
          className={cnm(
            'fixed bottom-0 left-0 right-0 z-50',
            'bg-ink-700/90 backdrop-blur-md border-t border-white/[0.08]',
            'px-4 py-4',
          )}
        >
          <div className="mx-auto w-full max-w-[1120px] flex items-center justify-between gap-4">
            <p className="text-sm text-slate-400">
              <span className="font-mono text-cream-50 font-semibold">
                {slots.length}
              </span>
              /8 slots · ready to submit
            </p>
            <button
              onClick={handleSubmit}
              disabled={submitPhase !== 'idle' || authLoading}
              className={cnm(
                'inline-flex items-center gap-2 px-6 h-11 rounded-full font-semibold text-sm',
                'transition-all duration-150 focus-ring active:scale-[0.97]',
                submitPhase !== 'idle' || authLoading
                  ? 'bg-accent-500/40 text-ink-900/60 cursor-not-allowed'
                  : 'bg-accent-500 text-ink-900 hover:bg-accent-600',
              )}
            >
              {(submitPhase !== 'idle' || authLoading) && (
                <Loader2
                  size={14}
                  strokeWidth={1.75}
                  className="animate-spin"
                />
              )}
              {submitLabel}
            </button>
          </div>
        </div>
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
