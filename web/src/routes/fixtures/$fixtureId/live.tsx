/**
 * Live Match View — /fixtures/$fixtureId/live
 *
 * Layout: fixture header + your prediction slots + live packet feed.
 * On `?trigger=demo`  → plays the sticker reveal ceremony
 * On `?trigger=demo-match-card` → plays the match-card reveal ceremony
 *
 * When SSE delivers a real sticker_minted / match_card_claimed event for
 * the connected wallet on this fixture, the ceremony triggers automatically.
 */

import { useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { ArrowLeft, Radio, Share2 } from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'

import { cnm } from '@/utils/style'
import { useAuth } from '@/hooks/useAuth'
import { useFixtureStream } from '@/hooks/useFixtureStream'
import type {
  StickerMintedEvent,
  TimelineEntry,
} from '@/hooks/useFixtureStream'
import { fixturesApi, predictionMeOptions } from '@/lib/api/endpoints'
import type { Fixture, PredictionCard } from '@/lib/api/types'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { StickerRevealCurtain } from '@/components/StickerRevealCurtain'
import {
  MatchCardRevealCurtain,
  type MatchCardClaimedEvent,
} from '@/components/MatchCardRevealCurtain'

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute('/fixtures/$fixtureId/live')({
  validateSearch: z.object({
    trigger: z.enum(['demo', 'demo-match-card']).optional(),
  }),
  component: LiveMatchPage,
})

// ─── Slot pill (compact) ─────────────────────────────────────────────────────

const METRIC_BY_BASE: Record<number, string> = {
  1: 'Goals',
  2: 'Goals',
  3: 'Yellow',
  4: 'Yellow',
  5: 'Red',
  6: 'Red',
  7: 'Corners',
  8: 'Corners',
}

const PERIOD_SHORT: Record<number, string> = {
  0: '',
  1000: 'H1',
  3000: 'H2',
  4000: 'ET1',
  5000: 'ET2',
  6000: 'PEN',
  7000: 'ET',
}

interface SlotChipProps {
  slot: PredictionCard['slots'][number]
  fixture: Fixture
}

function SlotChip({ slot, fixture }: SlotChipProps) {
  const status = slot.status ?? 0 // 0 pending, 1 hit, 2 miss
  const isHit = status === 1
  const isMiss = status === 2
  const statA = slot.statAKey ?? 0
  const period = slot.period ?? 0
  const baseA = statA % 1000 || statA
  const metric = METRIC_BY_BASE[baseA] ?? `#${baseA}`
  const isCompound = (slot.op ?? 0) !== 0 && (slot.statBKey ?? 0) !== 0
  const p1IsHome = fixture.participant1IsHome ?? true
  const isP1 = baseA % 2 === 1
  const teamPart = isCompound
    ? 'Total'
    : (isP1 === p1IsHome ? fixture.homeTeam : fixture.awayTeam).slice(0, 12)
  const cmp = ['Over', 'Under', 'Exact'][slot.predicateComparison ?? 0]
  const periodShort = PERIOD_SHORT[period]

  return (
    <div
      className={cnm(
        'flex items-center gap-2 min-h-9 py-2 px-3 rounded-xl border transition-colors',
        isHit
          ? 'bg-success-500/10 border-success-500/30'
          : isMiss
            ? 'bg-ink-800 border-slate-700/40 opacity-70'
            : 'bg-ink-800 border-white/[0.08]',
      )}
    >
      <span
        className={cnm(
          'inline-block w-1.5 h-4 rounded-full shrink-0',
          isHit
            ? 'bg-success-500'
            : isMiss
              ? 'bg-slate-600'
              : 'bg-accent-500 animate-pulse',
        )}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-cream-50 truncate">
          {teamPart} · {metric}
          {periodShort ? ` · ${periodShort}` : ''}
        </p>
      </div>
      <span className="text-[11px] font-mono text-slate-400 shrink-0 tabular-nums">
        {cmp} {slot.threshold}
      </span>
      {isHit && (
        <span className="text-[10px] font-mono font-bold text-success-500 shrink-0">
          HIT
        </span>
      )}
      {isMiss && (
        <span className="text-[10px] font-mono font-bold text-slate-500 shrink-0">
          MISS
        </span>
      )}
    </div>
  )
}

// ─── Feed item ────────────────────────────────────────────────────────────────

function FeedItem({ entry }: { entry: TimelineEntry }) {
  const meta: Record<string, { icon: string; color: string }> = {
    packet: { icon: '⚡', color: '#94969C' },
    sticker_minted: { icon: '🎴', color: '#F97316' },
    match_card_claimed: { icon: '🏆', color: '#F5C842' },
    settlement_started: { icon: '⚙️', color: '#4DA2FF' },
    settlement_error: { icon: '⚠️', color: '#EF4444' },
  }
  const m = meta[entry.event] ?? { icon: '·', color: '#94969C' }
  const time = new Date(entry.ts).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const d = entry.data as Record<string, unknown>
  const label =
    typeof d.action === 'string' ? d.action : entry.event.replace(/_/g, ' ')
  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-white/[0.04] last:border-0">
      <span className="shrink-0 text-[11px]" aria-hidden="true">
        {m.icon}
      </span>
      <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0 w-16">
        {time}
      </span>
      <span
        className="font-mono text-xs truncate uppercase"
        style={{ color: m.color }}
      >
        {label}
      </span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LiveMatchPage() {
  const { fixtureId } = Route.useParams()
  const { trigger } = Route.useSearch()
  const isDemoSticker = trigger === 'demo'
  const isDemoMatchCard = trigger === 'demo-match-card'

  const { jwt, isAuthenticated } = useAuth()
  const { publicKey } = useWallet()
  const queryClient = useQueryClient()

  const { data: fixtureData, isLoading: fixtureLoading } = useQuery({
    queryKey: ['fixtures', fixtureId],
    queryFn: () => fixturesApi.get(fixtureId),
    staleTime: 10_000,
  })

  const { data: card } = useQuery({
    ...predictionMeOptions(fixtureId),
    enabled: isAuthenticated,
  })

  // SSE stream — auto-connects when authed
  const { connected, timeline } = useFixtureStream(
    fixtureId,
    isAuthenticated ? jwt : null,
  )

  // Ceremony state — driven by ?trigger= OR by real SSE events
  const [showSticker, setShowSticker] = useState(false)
  const [showMatchCard, setShowMatchCard] = useState(false)
  const [stickerEvent, setStickerEvent] = useState<StickerMintedEvent | null>(
    null,
  )
  const [matchCardEvent, setMatchCardEvent] =
    useState<MatchCardClaimedEvent | null>(null)

  // Demo triggers
  useEffect(() => {
    if (isDemoSticker) setShowSticker(true)
  }, [isDemoSticker])
  useEffect(() => {
    if (isDemoMatchCard) setShowMatchCard(true)
  }, [isDemoMatchCard])

  // Live: when SSE delivers a sticker_minted for THIS user, trigger reveal.
  useEffect(() => {
    const walletStr = publicKey?.toBase58()
    if (!walletStr) return
    // Look at most recent event
    const last = timeline[timeline.length - 1]
    if (!last) return
    if (last.event === 'sticker_minted' && !showSticker) {
      const ev = last.data as StickerMintedEvent
      if (ev.userWallet === walletStr && String(ev.fixtureId) === fixtureId) {
        setStickerEvent(ev)
        setShowSticker(true)
      }
    }
    if (last.event === 'match_card_claimed' && !showMatchCard) {
      const ev = last.data as MatchCardClaimedEvent
      if (ev.userWallet === walletStr && String(ev.fixtureId) === fixtureId) {
        setMatchCardEvent(ev)
        setShowMatchCard(true)
      }
    }
  }, [timeline, publicKey, fixtureId, showSticker, showMatchCard])

  function closeSticker() {
    setShowSticker(false)
    setStickerEvent(null)
    queryClient.invalidateQueries({ queryKey: ['cards', 'mine'] })
    queryClient.invalidateQueries({
      queryKey: ['predictions', fixtureId, 'me'],
    })
  }

  function closeMatchCard() {
    setShowMatchCard(false)
    setMatchCardEvent(null)
    queryClient.invalidateQueries({ queryKey: ['cards', 'mine'] })
    queryClient.invalidateQueries({
      queryKey: ['predictions', fixtureId, 'me'],
    })
  }

  const fixture = fixtureData?.fixture

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        {/* Back */}
        <AnimateComponent entry="fadeInUp" duration={300}>
          <Link
            to="/fixtures/$fixtureId"
            params={{ fixtureId }}
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            Fixture detail
          </Link>
        </AnimateComponent>

        {/* Fixture header */}
        {fixtureLoading && (
          <div className="h-32 pixel-shimmer rounded-3xl bg-ink-800 mb-8" />
        )}

        {fixture && (
          <AnimateComponent entry="fadeInUp" duration={500}>
            <div className="p-6 md:p-8 rounded-3xl bg-ink-800 border border-white/[0.08] mb-8">
              <div className="flex items-center gap-2 mb-4">
                <Radio
                  size={14}
                  strokeWidth={1.75}
                  className={cnm(
                    connected ? 'text-success-500' : 'text-slate-500',
                  )}
                />
                <p
                  className={cnm(
                    'text-xs font-mono uppercase tracking-widest',
                    connected ? 'text-success-500' : 'text-slate-500',
                  )}
                >
                  {connected ? 'Live · watching stream' : 'Offline'}
                </p>
                <span className="text-[10px] font-mono text-slate-700 ml-auto">
                  {fixture.competitionName ?? `#${fixture.competitionId}`}
                </span>
              </div>
              <div className="grid grid-cols-3 items-center gap-4">
                <div>
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                    Home
                  </p>
                  <h1 className="text-xl md:text-2xl font-bold text-cream-50">
                    {fixture.homeTeam}
                  </h1>
                </div>
                <p className="text-center text-3xl md:text-4xl font-mono text-accent-500 tabular-nums">
                  – : –
                </p>
                <div className="text-right">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1">
                    Away
                  </p>
                  <h1 className="text-xl md:text-2xl font-bold text-cream-50">
                    {fixture.awayTeam}
                  </h1>
                </div>
              </div>
            </div>
          </AnimateComponent>
        )}

        {/* What this page is */}
        <AnimateComponent entry="fadeInUp" duration={400} delay={50}>
          <div className="mb-6 p-4 md:p-5 rounded-3xl bg-accent-500/[0.06] border border-accent-500/20">
            <div className="flex flex-col md:flex-row md:items-center gap-4">
              <div className="flex-1">
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-1">
                  What happens here
                </p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  When this match is live, TxLINE streams every scoring event
                  to the settler. Each hit on your card triggers a Merkle-
                  proof CPI, mints a cNFT sticker to your wallet, and plays
                  the reveal ceremony below in real time.
                </p>
              </div>
              <button
                onClick={() => setShowSticker(true)}
                className="shrink-0 inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors"
              >
                ▶ Preview the reveal
              </button>
            </div>
          </div>
        </AnimateComponent>

        {/* Two-column layout: prediction slots + live feed */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* Your card */}
          <AnimateComponent entry="fadeInUp" duration={400} delay={100}>
            <div className="p-5 rounded-3xl bg-ink-800 border border-white/[0.08]">
              <p className="text-xs font-mono uppercase tracking-widest text-slate-500 mb-4">
                Your slots
              </p>
              {!isAuthenticated ? (
                <p className="text-sm text-slate-500 py-4">
                  Connect your wallet to see your prediction slots.
                </p>
              ) : !card || !card.slots ? (
                <p className="text-sm text-slate-500 py-4">
                  No prediction card on this fixture yet.{' '}
                  <Link
                    to="/fixtures/$fixtureId/predict"
                    params={{ fixtureId }}
                    className="text-accent-500 hover:underline"
                  >
                    Build one →
                  </Link>
                </p>
              ) : (
                <div className="space-y-2">
                  {card.slots
                    .filter((s) => s.statAKey != null && s.statAKey > 0)
                    .map((slot, i) =>
                      fixture ? (
                        <SlotChip key={i} slot={slot} fixture={fixture} />
                      ) : null,
                    )}
                </div>
              )}

              {/* Demo triggers — always visible so anyone can preview
                  the killer ceremonies even when no match is live. */}
              <div className="mt-6 pt-4 border-t border-white/[0.06]">
                <p className="text-[10px] font-mono uppercase tracking-widest text-slate-600 mb-2">
                  Preview ceremonies
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setShowSticker(true)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink-700 border border-white/[0.1] text-xs text-slate-300 hover:text-cream-50 hover:border-accent-500/40 transition-colors"
                  >
                    <span>▶</span> Sticker reveal (~4s)
                  </button>
                  <button
                    onClick={() => setShowMatchCard(true)}
                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink-700 border border-white/[0.1] text-xs text-slate-300 hover:text-cream-50 hover:border-warning-500/40 transition-colors"
                  >
                    <span>▶</span> Match card (~5s)
                  </button>
                </div>
              </div>
            </div>
          </AnimateComponent>

          {/* Live feed */}
          <AnimateComponent entry="fadeInUp" duration={400} delay={200}>
            <div className="p-5 rounded-3xl bg-ink-800 border border-white/[0.08] h-full">
              <div className="flex items-center justify-between mb-4">
                <p className="text-xs font-mono uppercase tracking-widest text-slate-500">
                  Event feed
                </p>
                <span className="text-[10px] font-mono text-slate-700 tabular-nums">
                  {timeline.length}
                </span>
              </div>
              {timeline.length === 0 ? (
                <div className="py-6 text-center">
                  <div
                    className="w-10 h-10 mx-auto mb-3 rounded-full bg-ink-700 border border-white/[0.06] flex items-center justify-center"
                    aria-hidden="true"
                  >
                    <span className="w-2 h-2 rounded-full bg-slate-600 animate-pulse" />
                  </div>
                  <p className="text-xs text-slate-500 mb-2 leading-relaxed">
                    No packets yet.
                  </p>
                  <p className="text-[11px] text-slate-700 leading-relaxed max-w-[220px] mx-auto">
                    Match hasn't started or TxLINE isn't streaming for this
                    fixture yet. Preview a settlement using the buttons on the
                    left.
                  </p>
                </div>
              ) : (
                <div className="space-y-0.5 max-h-[420px] overflow-y-auto">
                  {timeline.slice(-40).reverse().map((entry, i) => (
                    <FeedItem key={i} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          </AnimateComponent>
        </div>

        {/* Share bar */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={() => {
              navigator.clipboard.writeText(window.location.href)
            }}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ink-800 border border-white/[0.08] text-xs font-mono text-slate-400 hover:text-cream-50 hover:border-white/20 transition-colors"
          >
            <Share2 size={12} strokeWidth={1.75} />
            Copy link
          </button>
        </div>
      </div>

      {/* Ceremonies */}
      {showSticker && (
        <StickerRevealCurtain
          event={stickerEvent}
          lineage={null}
          onClose={closeSticker}
          demoMode={isDemoSticker || stickerEvent === null}
        />
      )}
      {showMatchCard && (
        <MatchCardRevealCurtain
          event={matchCardEvent}
          onClose={closeMatchCard}
          demoMode={isDemoMatchCard || matchCardEvent === null}
        />
      )}
    </div>
  )
}
