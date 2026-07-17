import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useWallet } from '@solana/wallet-adapter-react'
import { ArrowDown, ArrowUp, Clock, Tag } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { ListingWithSticker } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import { useMarketplace } from '@/hooks/queries/useMarketplace'
import { healthOptions } from '@/lib/api/endpoints'
import { lamportsToSol, shortenAddress } from '@/utils/big'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { StickerArt } from '@/lib/sticker-art'

export const Route = createFileRoute('/market/')({ component: MarketPage })

type Sort = 'price_asc' | 'price_desc' | 'createdAt'

// Sticker visual — procedural SVG matching the album grid
function StickerPlaceholder({ outcome }: { outcome: string | null }) {
  return (
    <div className="w-full aspect-square bg-ink-700">
      <StickerArt
        stat="goals"
        predicate="over"
        outcome={
          outcome === 'hit' ? 'hit' : outcome === 'miss' ? 'miss' : 'pending'
        }
        rarity="common"
        size={200}
        className="w-full h-full"
      />
    </div>
  )
}

function OutcomeBadge({ outcome }: { outcome: string | null }) {
  if (outcome === 'hit')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-success-500/15 text-success-500 font-mono text-[10px] uppercase tracking-widest font-bold">
        HIT ✓
      </span>
    )
  if (outcome === 'miss')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[4px] bg-slate-700/50 text-slate-400 font-mono text-[10px] uppercase tracking-widest font-bold">
        MISS ✗
      </span>
    )
  return null
}

function ListingCard({
  listing,
  walletAddress,
}: {
  listing: ListingWithSticker
  walletAddress: string
}) {
  const priceSOL = lamportsToSol(listing.priceLamports)
  const isOwnedBySelf =
    walletAddress.length > 0 && listing.seller === walletAddress
  const sticker = listing.sticker

  return (
    <AnimateComponent entry="fadeInUp">
      <Link
        to="/market/$listingPda"
        params={{ listingPda: listing.listingPda }}
        className={cnm(
          'rounded-2xl relative flex flex-col overflow-hidden',
          'rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]',
          'hover:border-accent-500/35 transition-colors duration-200 group',
          'focus-ring',
        )}
        aria-label={`Listing ${sticker?.name ?? listing.assetId} for ${priceSOL.toFixed(3)} SOL`}
      >
        {/* Price pill top-right */}
        <div className="absolute top-3 right-3 z-10">
          <span className="px-2 py-1 rounded-full bg-accent-500 text-ink-900 font-mono text-xs font-bold">
            {priceSOL.toFixed(3)} SOL
          </span>
        </div>

        {/* Sticker image area */}
        <div
          className="w-full aspect-square bg-ink-700 overflow-hidden"
          style={{ imageRendering: 'pixelated' }}
        >
          {sticker?.image ? (
            <img
              src={sticker.image}
              alt={sticker.name ?? 'Sticker'}
              className="w-full h-full object-contain pixel"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : (
            <StickerPlaceholder outcome={sticker?.outcome ?? null} />
          )}
        </div>

        {/* Card body */}
        <div className="p-4 flex flex-col gap-2">
          {/* Name + outcome */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-cream-50 leading-tight line-clamp-1">
              {sticker?.name ?? 'Sticker'}
            </p>
            <OutcomeBadge outcome={sticker?.outcome ?? null} />
          </div>

          {/* Fixture context */}
          {sticker?.fixtureId && (
            <p className="text-[11px] text-slate-500 font-mono truncate">
              fixture {sticker.fixtureId}
              {sticker.slotIndex != null ? ` · slot ${sticker.slotIndex}` : ''}
            </p>
          )}

          {/* Seller — rendered as a span to avoid nested <a> inside the card <Link> */}
          <div className="flex items-center justify-between pt-1 border-t border-white/[0.06]">
            <span
              className="text-[11px] font-mono text-sui-500"
              title={listing.seller}
            >
              {shortenAddress(listing.seller)}
            </span>
            {isOwnedBySelf ? (
              <span className="text-[11px] font-mono text-slate-400 bg-ink-700 px-2 py-0.5 rounded-full border border-white/[0.08]">
                Owned
              </span>
            ) : (
              <span className="text-[11px] font-semibold text-accent-500 group-hover:underline">
                Buy →
              </span>
            )}
          </div>
        </div>
      </Link>
    </AnimateComponent>
  )
}

function EmptyState() {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-24 text-center">
      <div
        className="w-24 h-24 mb-6 flex items-center justify-center rounded-[var(--radius-lg)] bg-ink-700 border border-white/[0.06]"
        aria-hidden="true"
        style={{ imageRendering: 'pixelated' }}
      >
        <Tag size={32} strokeWidth={1.25} className="text-slate-500" />
      </div>
      <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-2">
        No listings
      </p>
      <p className="text-slate-400 text-sm mb-6 max-w-[280px]">
        The stalls are open, but nothing is on sale yet.
      </p>
      <Link
        to="/fixtures"
        className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors duration-150 focus-ring"
      >
        Back to fixtures
      </Link>
    </div>
  )
}

function MarketPage() {
  const [sort, setSort] = useState<Sort>('createdAt')
  const { publicKey } = useWallet()
  const walletAddress = publicKey?.toBase58() ?? ''

  const { data, isLoading, isPlaceholderData, isError } = useMarketplace(sort)
  const { data: health } = useQuery(healthOptions())

  const sortOptions: Array<{
    value: Sort
    label: string
    icon: React.ReactNode
  }> = [
    {
      value: 'createdAt',
      label: 'Newest',
      icon: <Clock size={13} strokeWidth={1.75} />,
    },
    {
      value: 'price_asc',
      label: 'Price: low',
      icon: <ArrowUp size={13} strokeWidth={1.75} />,
    },
    {
      value: 'price_desc',
      label: 'Price: high',
      icon: <ArrowDown size={13} strokeWidth={1.75} />,
    },
  ]

  // isPlaceholderData=true means we have empty placeholder but query is still running
  // Only show skeletons during real loading (first fetch with no placeholder yet)
  const showSkeletons = isLoading && !isPlaceholderData

  // Real backend data only — empty state renders when there are no listings.
  const listings: Array<ListingWithSticker> = data?.listings ?? []

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-10 md:py-16">
        {/* Hero strip */}
        <AnimateComponent entry="fadeInUp">
          <div className="mb-10">
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-3">
              Marketplace
            </p>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <h1 className="text-4xl md:text-5xl font-bold text-cream-50 tracking-[-0.02em]">
                  MOMENTUM Market
                </h1>
                <p className="text-slate-400 text-base mt-2 max-w-[480px]">
                  Trade verified on-chain stickers. Every card carries a Merkle
                  proof.
                </p>
              </div>
              {/* Live stats */}
              {health && (
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-2xl font-mono font-bold text-cream-50">
                      {health.marketplace.activeListings}
                    </p>
                    <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-slate-500">
                      Active listings
                    </p>
                  </div>
                  <div
                    className="w-px h-10 bg-white/[0.08]"
                    aria-hidden="true"
                  />
                  <div className="text-right">
                    <p className="text-2xl font-mono font-bold text-cream-50">
                      {health.marketplace.salesLast24h}
                    </p>
                    <p className="text-[11px] font-mono uppercase tracking-[0.1em] text-slate-500">
                      Sales 24h
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </AnimateComponent>

        {/* Filters row */}
        <AnimateComponent entry="fadeInUp" delay={100}>
          <div className="flex flex-wrap items-center gap-2 mb-8">
            <p className="text-xs font-mono text-slate-500 mr-2 uppercase tracking-widest">
              Sort
            </p>
            {sortOptions.map((o) => (
              <button
                key={o.value}
                onClick={() => setSort(o.value)}
                className={cnm(
                  'inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-semibold transition-colors duration-150 focus-ring',
                  sort === o.value
                    ? 'bg-accent-500 text-ink-900'
                    : 'bg-ink-700 border border-white/[0.08] text-slate-400 hover:text-cream-50 hover:border-white/20',
                )}
                aria-pressed={sort === o.value}
              >
                {o.icon}
                {o.label}
              </button>
            ))}

            <div className="ml-auto">
              <Link
                to="/market/list"
                className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-ink-700 border border-white/[0.1] text-sm font-semibold text-cream-50 hover:border-accent-500/40 transition-colors duration-150 focus-ring"
              >
                + List a card
              </Link>
            </div>
          </div>
        </AnimateComponent>

        {/* Error state */}
        {isError && (
          <div className="mb-6 px-4 py-3 rounded-[var(--radius-md)] bg-error-500/10 border border-error-500/20 text-error-500 text-sm font-mono">
            Backend unavailable — showing demo data.
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {showSkeletons ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] animate-pulse"
              >
                <div className="aspect-square bg-ink-700" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-ink-700 rounded w-3/4" />
                  <div className="h-3 bg-ink-700 rounded w-1/2" />
                </div>
              </div>
            ))
          ) : listings.length === 0 ? (
            <EmptyState />
          ) : (
            listings.map((listing) => (
              <ListingCard
                key={listing.listingPda}
                listing={listing}
                walletAddress={walletAddress}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
