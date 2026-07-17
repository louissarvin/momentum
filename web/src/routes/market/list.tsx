import { useState } from 'react'
import {
  Link,
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { useWallet } from '@solana/wallet-adapter-react'
import { z } from 'zod'
import { ArrowLeft, Check } from 'lucide-react'
import type { StickerMint } from '@/lib/api/types'
import { cnm } from '@/utils/style'
import { useMyCards } from '@/hooks/queries/useCards'
import { useListForSale } from '@/hooks/mutations/useMarketplaceMutations'
import { useToast } from '@/hooks/useToast'
import { ToastStack } from '@/components/ui/ToastStack'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { shortenAddress, solToLamports } from '@/utils/big'
import { useAuth } from '@/hooks/useAuth'

const searchSchema = z.object({ assetId: z.string().optional() })

export const Route = createFileRoute('/market/list')({
  validateSearch: searchSchema,
  component: ListCardPage,
})

function StickerSelectCard({
  card,
  selected,
  onSelect,
}: {
  card: StickerMint
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      className={cnm(
        'rounded-2xl relative flex flex-col overflow-hidden text-left w-full',
        'rounded-[var(--radius-lg)] bg-ink-800 border transition-all duration-150 focus-ring',
        selected
          ? 'border-accent-500/60 shadow-[0_0_0_2px_rgba(249,115,22,0.2)]'
          : 'border-white/[0.08] hover:border-white/20',
      )}
      aria-pressed={selected}
      aria-label={`Select ${card.name ?? card.assetId}`}
    >
      {selected && (
        <div className="absolute top-2 right-2 z-10 w-5 h-5 rounded-full bg-accent-500 flex items-center justify-center">
          <Check size={11} strokeWidth={2.5} className="text-ink-900" />
        </div>
      )}

      <div
        className="w-full aspect-square bg-ink-700 flex items-center justify-center overflow-hidden"
        style={{ imageRendering: 'pixelated' }}
      >
        {card.image ? (
          <img
            src={card.image}
            alt={card.name ?? 'Sticker'}
            className="w-full h-full object-contain"
            style={{ imageRendering: 'pixelated' }}
          />
        ) : (
          <span
            className="font-mono text-sm font-bold uppercase tracking-widest"
            style={{
              color:
                card.outcome === 'hit'
                  ? 'var(--color-accent-500)'
                  : 'var(--color-slate-500)',
            }}
          >
            {card.outcome === 'hit' ? 'HIT' : 'MISS'}
          </span>
        )}
      </div>

      <div className="p-3">
        <p className="text-sm font-semibold text-cream-50 truncate">
          {card.name ?? 'Sticker'}
        </p>
        <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
          {shortenAddress(card.assetId ?? '', 6, 4)}
        </p>
      </div>
    </button>
  )
}

function ListCardPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/market/list' })
  const { isAuthenticated } = useAuth()
  const { publicKey } = useWallet()
  const { toasts, show: showToast, dismiss } = useToast()

  const { data: cardsData, isLoading: cardsLoading } = useMyCards()
  const listMutation = useListForSale()

  const cards = cardsData?.cards ?? []

  const [selectedAssetId, setSelectedAssetId] = useState<string>(
    search.assetId ?? '',
  )
  const [priceSOL, setPriceSOL] = useState('0.500')
  const [priceError, setPriceError] = useState('')

  const selectedCard = cards.find((c) => c.assetId === selectedAssetId)
  const priceLamports = selectedCard
    ? solToLamports(Number(priceSOL) || 0)
    : null

  function validatePrice(val: string): boolean {
    const n = Number(val)
    if (isNaN(n) || n <= 0) {
      setPriceError('Enter a positive SOL amount')
      return false
    }
    if (n > 10000) {
      setPriceError('Price too high')
      return false
    }
    setPriceError('')
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAssetId) return
    if (!validatePrice(priceSOL)) return

    try {
      const result = await listMutation.mutateAsync({
        assetId: selectedAssetId,
        priceLamports: String(priceLamports),
      })
      showToast('success', 'Card listed for sale!')
      setTimeout(
        () =>
          navigate({
            to: '/market/$listingPda',
            params: { listingPda: result.listingPda },
          }),
        1200,
      )
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Listing failed')
    }
  }

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
            You need to connect and sign in to list a card for sale.
          </p>
          <Link
            to="/market"
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors focus-ring"
          >
            Back to market
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-900">
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-10 md:py-16">
        <AnimateComponent entry="fadeInUp">
          <Link
            to="/market"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8 focus-ring rounded"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back to market
          </Link>

          <div className="mb-8">
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-3">
              List for sale
            </p>
            <h1 className="text-3xl md:text-4xl font-bold text-cream-50 tracking-[-0.02em]">
              Choose a card to list
            </h1>
            <p className="text-slate-400 text-base mt-2">
              Pick one of your owned sticker cards and set a price in SOL.
            </p>
          </div>
        </AnimateComponent>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10">
            {/* Card grid */}
            <AnimateComponent entry="fadeInUp" delay={50}>
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.1em] text-slate-500 mb-4">
                  Your cards ({cards.length})
                </p>
                {cardsLoading ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] animate-pulse"
                      >
                        <div className="aspect-square bg-ink-700" />
                        <div className="p-3 space-y-1.5">
                          <div className="h-3 bg-ink-700 rounded w-3/4" />
                          <div className="h-2.5 bg-ink-700 rounded w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : cards.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center border border-white/[0.06] rounded-[var(--radius-lg)]">
                    <p className="text-slate-400 text-sm mb-4">
                      You have no cards to list.
                    </p>
                    <Link
                      to="/fixtures"
                      className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 focus-ring"
                    >
                      Browse fixtures
                    </Link>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                    {cards.map((card) => (
                      <StickerSelectCard
                        key={card.assetId}
                        card={card}
                        selected={card.assetId === selectedAssetId}
                        onSelect={() => setSelectedAssetId(card.assetId ?? '')}
                      />
                    ))}
                  </div>
                )}
              </div>
            </AnimateComponent>

            {/* Right panel: price + preview */}
            <AnimateComponent entry="fadeInUp" delay={100}>
              <div
                className={cnm(
                  'rounded-[var(--radius-xl)] bg-ink-800 border border-white/[0.08] p-6',
                  'flex flex-col gap-6 sticky top-24',
                )}
              >
                <div>
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                    Set price
                  </p>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="price-input"
                      className="text-sm text-slate-400"
                    >
                      Price (SOL)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id="price-input"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={priceSOL}
                        onChange={(e) => {
                          setPriceSOL(e.target.value)
                          if (priceError) validatePrice(e.target.value)
                        }}
                        onBlur={(e) => validatePrice(e.target.value)}
                        className={cnm(
                          'flex-1 h-11 px-4 rounded-[var(--radius-md)] bg-transparent',
                          'border font-mono text-cream-50 text-base',
                          'focus:outline-none transition-shadow duration-150',
                          'placeholder:text-slate-500',
                          priceError
                            ? 'border-error-500 focus:shadow-[0_0_0_3px_rgba(239,68,68,0.2)]'
                            : 'border-white/[0.12] focus:border-accent-500 focus:shadow-[0_0_0_3px_rgba(249,115,22,0.2)]',
                        )}
                        placeholder="0.500"
                        aria-describedby={
                          priceError ? 'price-error' : undefined
                        }
                      />
                      <span className="font-mono text-slate-400 text-sm">
                        SOL
                      </span>
                    </div>
                    {priceError && (
                      <p
                        id="price-error"
                        className="text-error-500 text-xs font-mono"
                      >
                        {priceError}
                      </p>
                    )}
                    {priceLamports != null && !priceError && (
                      <p className="text-[11px] font-mono text-slate-500">
                        = {priceLamports.toLocaleString()} lamports
                      </p>
                    )}
                  </div>
                </div>

                {/* Preview */}
                <div className="border-t border-white/[0.06] pt-5">
                  <p className="text-xs font-mono uppercase tracking-[0.1em] text-slate-500 mb-3">
                    Preview
                  </p>
                  {selectedCard ? (
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-[var(--radius-sm)] bg-ink-700 flex items-center justify-center overflow-hidden shrink-0"
                        style={{ imageRendering: 'pixelated' }}
                      >
                        {selectedCard.image ? (
                          <img
                            src={selectedCard.image}
                            alt={selectedCard.name ?? ''}
                            className="w-full h-full object-contain"
                            style={{ imageRendering: 'pixelated' }}
                          />
                        ) : (
                          <span className="font-mono text-[10px] font-bold text-slate-400 uppercase">
                            {selectedCard.outcome === 'hit' ? 'HIT' : 'MISS'}
                          </span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-cream-50 truncate">
                          {selectedCard.name ?? 'Sticker'}
                        </p>
                        <p className="text-[11px] font-mono text-slate-500 truncate">
                          {shortenAddress(selectedCard.assetId ?? '', 6, 4)}
                        </p>
                      </div>
                      <span className="font-mono text-sm font-bold text-accent-500 shrink-0">
                        {Number(priceSOL || 0).toFixed(3)} SOL
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      Select a card above
                    </p>
                  )}
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={
                    !selectedAssetId ||
                    !priceSOL ||
                    !!priceError ||
                    listMutation.isPending
                  }
                  className={cnm(
                    'h-11 w-full rounded-full font-semibold text-sm transition-all duration-150 focus-ring',
                    'inline-flex items-center justify-center gap-2',
                    selectedAssetId &&
                      priceSOL &&
                      !priceError &&
                      !listMutation.isPending
                      ? 'bg-accent-500 text-ink-900 hover:bg-accent-600'
                      : 'bg-ink-700 text-slate-500 cursor-not-allowed border border-white/[0.06]',
                  )}
                >
                  {listMutation.isPending ? 'Signing…' : 'List for sale'}
                </button>

                {listMutation.isError && (
                  <p className="text-error-500 text-xs font-mono text-center">
                    {listMutation.error instanceof Error
                      ? listMutation.error.message
                      : 'Failed'}
                  </p>
                )}
              </div>
            </AnimateComponent>
          </div>
        </form>
      </div>
    </div>
  )
}
