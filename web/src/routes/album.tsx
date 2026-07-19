/**
 * Album — /album
 *
 * Shows the user's sticker collection from GET /api/cards/mine.
 * Grouped by fixture, with filter/sort controls.
 * Click a sticker → StickerLineageModal.
 */

import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useWallet } from '@solana/wallet-adapter-react'
import { ExternalLink, ListFilter } from 'lucide-react'
import type { StickerMint } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import { useMyCards } from '@/hooks/queries/useCards'
import { useAuth } from '@/hooks/useAuth'
import { cardsApi } from '@/lib/api/endpoints'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { StickerLineageModal } from '@/components/StickerLineageModal'
import type { CardLineage } from '@/lib/api/types'
import { shortenAddress } from '@/utils/big'
import { solscanTx } from '@/utils/solscan'
import { StickerArt } from '@/lib/sticker-art'

export const Route = createFileRoute('/album')({ component: AlbumPage })

// ─── Streak computation ───────────────────────────────────────────────────────

interface StreakData {
  currentStreak: number
  longestStreak: number
  totalHits: number
}

function computeStreaks(cards: StickerMint[]): StreakData {
  // Sort by mintedAt descending (most recent first)
  const sorted = [...cards].sort(
    (a, b) => new Date(b.mintedAt).getTime() - new Date(a.mintedAt).getTime(),
  )

  let currentStreak = 0
  let longestStreak = 0
  let totalHits = 0
  // Walk once: current streak = leading HITs from index 0
  let currentDone = false
  let runLength = 0

  for (const card of sorted) {
    const isHit = card.outcome === 'hit'
    if (isHit) totalHits++

    if (!currentDone) {
      if (isHit) {
        currentStreak++
      } else {
        currentDone = true
      }
    }

    // Track longest anywhere in the list
    if (isHit) {
      runLength++
      if (runLength > longestStreak) longestStreak = runLength
    } else {
      runLength = 0
    }
  }

  return { currentStreak, longestStreak, totalHits }
}

// ─── Streak stats block ───────────────────────────────────────────────────────

function StreakStats({ cards }: { cards: StickerMint[] }) {
  const { currentStreak, longestStreak, totalHits } = computeStreaks(cards)
  const onFire = currentStreak >= 3

  const tiles = [
    {
      value: currentStreak,
      label: onFire ? 'on fire' : 'current streak',
      suffix: onFire ? ' 🔥' : '',
      highlight: onFire,
    },
    {
      value: longestStreak,
      label: 'best streak',
      suffix: '',
      highlight: false,
    },
    {
      value: totalHits,
      label: 'verified predictions',
      suffix: '',
      highlight: false,
    },
  ]

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cnm(
            'p-5 rounded-[var(--radius-lg)] border',
            'bg-ink-800 border-white/[0.08]',
            tile.highlight && 'border-accent-500/30 bg-accent-500/[0.05]',
          )}
        >
          <p
            className={cnm(
              'font-bold tracking-[-0.02em] mb-1',
              'text-5xl font-display',
              tile.highlight ? 'text-accent-500' : 'text-cream-50',
              cards.length === 0 && 'text-slate-600',
            )}
          >
            {cards.length === 0 ? '--' : tile.value}
            {cards.length > 0 && tile.suffix}
          </p>
          <p className="text-xs font-mono uppercase tracking-[0.1em] text-slate-500">
            {tile.label}
          </p>
        </div>
      ))}
    </div>
  )
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type Filter = 'all' | 'hits' | 'misses'
type SortKey = 'mintedAt' | 'fixture'

// ─── Sticker card ─────────────────────────────────────────────────────────────

interface StickerCardProps {
  card: StickerMint
  onViewProof: (card: StickerMint) => void
}

function StickerCard({ card, onViewProof }: StickerCardProps) {
  const isHit = card.outcome === 'hit'

  return (
    <AnimateComponent entry="fadeInUp">
      <div
        className={cnm(
          'rounded-2xl relative flex flex-col overflow-hidden',
          'rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]',
          'hover:border-accent-500/20 hover:translate-y-[-2px] transition-all duration-200',
          isHit
            ? 'border-t-[3px] border-t-success-500'
            : 'border-t-[3px] border-t-slate-700',
        )}
      >
        {/* Sticker image */}
        <div
          className="w-full aspect-square bg-ink-700 flex items-center justify-center overflow-hidden"
          style={{ imageRendering: 'pixelated' }}
          aria-label={card.name ?? 'Sticker'}
        >
          {card.image ? (
            <img
              src={card.image}
              alt={card.name ?? 'Sticker'}
              className="w-full h-full object-contain"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <StickerArt
              stat="goals"
              predicate="over"
              outcome={
                card.outcome === 'hit'
                  ? 'hit'
                  : card.outcome === 'miss'
                    ? 'miss'
                    : 'pending'
              }
              rarity="common"
              size={128}
              className="w-full h-full"
            />
          )}
        </div>

        {/* Card info */}
        <div className="p-3 flex flex-col gap-2">
          {/* Name */}
          <p className="text-sm font-semibold text-cream-50 truncate">
            {card.name ?? 'Sticker'}
          </p>

          {/* Outcome + slot */}
          <div className="flex items-center justify-between">
            <span
              className={cnm(
                'font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-[4px]',
                isHit
                  ? 'bg-success-500/15 text-success-500'
                  : 'bg-slate-700/40 text-slate-400',
              )}
            >
              {isHit ? 'HIT ✓' : 'MISS ✗'}
            </span>
            {card.slotIndex != null && (
              <span className="text-[10px] font-mono text-slate-500">
                slot {card.slotIndex}
              </span>
            )}
          </div>

          {/* Mint tx link */}
          {card.mintTxSig && (
            <a
              href={solscanTx(card.mintTxSig)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-[10px] text-sui-500 hover:underline focus-ring rounded w-fit"
              aria-label="View mint transaction on Solscan"
            >
              {shortenAddress(card.mintTxSig, 6, 4)}
              <ExternalLink size={9} strokeWidth={1.75} />
            </a>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 mt-1">
            <button
              onClick={() => onViewProof(card)}
              className={cnm(
                'flex-1 h-8 rounded-full text-xs font-semibold transition-colors duration-150 focus-ring',
                'bg-ink-700 border border-white/[0.1] text-slate-400 hover:text-cream-50 hover:border-white/20',
              )}
            >
              View proof
            </button>
            {card.assetId && card.assetId.startsWith('Demo') ? (
              <span
                className={cnm(
                  'flex-1 h-8 rounded-full text-[10px] font-mono uppercase tracking-widest',
                  'inline-flex items-center justify-center gap-1',
                  'bg-warning-500/10 border border-warning-500/25 text-warning-500',
                )}
                title="Seeded demo sticker. Listing requires a real on-chain cNFT."
              >
                Demo
              </span>
            ) : card.assetId ? (
              <Link
                to="/market/list"
                search={{ assetId: card.assetId }}
                className={cnm(
                  'flex-1 h-8 rounded-full text-xs font-semibold transition-colors duration-150 focus-ring',
                  'inline-flex items-center justify-center',
                  'bg-ink-700 border border-white/[0.1] text-slate-400 hover:text-cream-50 hover:border-accent-500/30',
                )}
              >
                List
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </AnimateComponent>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] animate-pulse">
      <div className="aspect-square bg-ink-700" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-ink-700 rounded w-3/4" />
        <div className="h-3 bg-ink-700 rounded w-1/2" />
        <div className="h-7 bg-ink-700 rounded" />
      </div>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyAlbum() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-24 h-24 mb-6 flex items-center justify-center rounded-[var(--radius-lg)] bg-ink-700 border border-white/[0.06]"
        aria-hidden="true"
        style={{ imageRendering: 'pixelated' }}
      >
        <span className="font-mono text-2xl font-bold text-slate-500">?</span>
      </div>
      <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-2">
        Empty album
      </p>
      <p className="text-slate-400 text-sm mb-6 max-w-[280px]">
        Your album is empty. Pick your first prediction.
      </p>
      <Link
        to="/fixtures"
        className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors duration-150 focus-ring"
      >
        Browse fixtures
      </Link>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function AlbumPage() {
  const { publicKey } = useWallet()
  const { isAuthenticated } = useAuth()
  const walletAddress = publicKey?.toBase58() ?? ''

  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey] = useState<SortKey>('mintedAt')

  // Lineage modal state
  const [lineageOpen, setLineageOpen] = useState(false)
  const [activeLineage, setActiveLineage] = useState<CardLineage | null>(null)
  const [lineageLoading, setLineageLoading] = useState(false)

  const { data, isLoading } = useMyCards()
  const allCards = data?.cards ?? []

  // Filter
  const filtered = allCards.filter((c) => {
    if (filter === 'hits') return c.outcome === 'hit'
    if (filter === 'misses') return c.outcome === 'miss'
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'mintedAt') {
      return new Date(b.mintedAt).getTime() - new Date(a.mintedAt).getTime()
    }
    return (a.fixtureId ?? '').localeCompare(b.fixtureId ?? '')
  })

  // Group by fixture
  const grouped = sorted.reduce<Record<string, StickerMint[]>>((acc, card) => {
    const key = card.fixtureId ?? 'unknown'
    if (!acc[key]) acc[key] = []
    acc[key].push(card)
    return acc
  }, {})

  async function handleViewProof(card: StickerMint) {
    if (!card.assetId) return
    setActiveLineage(null)
    setLineageLoading(true)
    setLineageOpen(true)
    try {
      const lin = await cardsApi.lineage(card.assetId)
      setActiveLineage(lin)
    } catch {
      setActiveLineage(null)
    } finally {
      setLineageLoading(false)
    }
  }

  // Not authenticated
  if (!publicKey || !isAuthenticated) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center px-6">
        <div className="text-center max-w-sm">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
            Auth required
          </p>
          <h1 className="text-2xl font-bold text-cream-50 mb-4">
            Connect your wallet
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            Sign in to see your sticker album.
          </p>
          <Link
            to="/fixtures"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors focus-ring"
          >
            Browse fixtures
          </Link>
        </div>
      </div>
    )
  }

  const fixtureCount = Object.keys(grouped).length

  return (
    <div className="min-h-screen bg-ink-900">
      {/* Lineage modal */}
      <StickerLineageModal
        isOpen={lineageOpen}
        onClose={() => setLineageOpen(false)}
        lineage={activeLineage}
        loading={lineageLoading}
      />

      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-10 md:py-16">
        {/* Header */}
        <AnimateComponent entry="fadeInUp">
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                My Album
              </p>
              <h1 className="text-4xl md:text-5xl font-bold text-cream-50 tracking-[-0.02em]">
                My Stickers
              </h1>
              <p className="text-slate-400 text-base mt-2">
                {walletAddress ? shortenAddress(walletAddress, 6, 6) : ''}
              </p>
            </div>
            {/* Count chips */}
            {data && (
              <div className="shrink-0 flex items-center gap-2 flex-wrap">
                <div className="flex items-center justify-center h-10 px-4 rounded-full bg-ink-700 border border-white/[0.08]">
                  <span className="font-mono text-base font-bold text-cream-50">
                    {data.count}
                  </span>
                  <span className="font-mono text-xs text-slate-400 ml-1.5">
                    stickers
                  </span>
                </div>
                <div className="flex items-center justify-center h-10 px-4 rounded-full bg-ink-700 border border-white/[0.08]">
                  <span className="font-mono text-base font-bold text-cream-50">
                    {fixtureCount}
                  </span>
                  <span className="font-mono text-xs text-slate-400 ml-1.5">
                    fixtures
                  </span>
                </div>
              </div>
            )}
          </div>
        </AnimateComponent>

        {/* Streak stats — always rendered; shows '--' when album is empty */}
        <AnimateComponent entry="fadeInUp" delay={40}>
          <StreakStats cards={allCards} />
        </AnimateComponent>

        {/* Filter row */}
        <AnimateComponent entry="fadeInUp" delay={80}>
          <div className="flex items-center gap-2 mb-8 flex-wrap">
            <ListFilter
              size={14}
              strokeWidth={1.75}
              className="text-slate-500"
            />
            {(
              [
                { value: 'all', label: 'All' },
                { value: 'hits', label: 'Hits' },
                { value: 'misses', label: 'Misses' },
              ] as Array<{ value: Filter; label: string }>
            ).map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={cnm(
                  'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-150 focus-ring',
                  filter === f.value
                    ? 'bg-accent-500 text-ink-900'
                    : 'bg-ink-700 border border-white/[0.08] text-slate-400 hover:text-cream-50',
                )}
                aria-pressed={filter === f.value}
              >
                {f.label}
              </button>
            ))}
          </div>
        </AnimateComponent>

        {/* Loading state */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <EmptyAlbum />
        ) : (
          /* Fixture-grouped grid */
          <div className="space-y-10">
            {Object.entries(grouped).map(([fixtureId, cards]) => (
              <section key={fixtureId}>
                {/* Fixture header bar */}
                <div className="sticky top-[64px] z-10 mb-4 flex items-center gap-3 py-2">
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.12em] text-slate-500 px-3 py-1 rounded-full bg-ink-900 border border-white/[0.06]">
                    Fixture {fixtureId}
                  </span>
                  <div className="h-px flex-1 bg-white/[0.06]" />
                  <span className="shrink-0 text-[10px] font-mono text-slate-600">
                    {cards.length} card{cards.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {/* Cards grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5">
                  {cards.map((card, idx) => (
                    <StickerCard
                      key={card.assetId ?? idx}
                      card={card}
                      onViewProof={handleViewProof}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
