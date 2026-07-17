import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useWallet } from '@solana/wallet-adapter-react'
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
} from '@heroui/react'
import { cnm } from '@/utils/style'
import { useListing } from '@/hooks/queries/useMarketplace'
import { useCardLineage } from '@/hooks/queries/useCards'
import {
  useBuyCard,
  useCancelListing,
} from '@/hooks/mutations/useMarketplaceMutations'
import { useToast } from '@/hooks/useToast'
import { ToastStack } from '@/components/ui/ToastStack'
import ShareBlinkButton from '@/components/ShareBlinkButton'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { lamportsToSol, shortenAddress } from '@/utils/big'
import { solscanAcct, solscanTx } from '@/utils/solscan'
import { useAuth } from '@/hooks/useAuth'

export const Route = createFileRoute('/market/$listingPda')({
  component: ListingDetailPage,
})

function StickerHero({
  image,
  name,
  outcome,
}: {
  image?: string | null
  name?: string | null
  outcome?: string | null
}) {
  const isHit = outcome === 'hit'
  return (
    <div
      className={cnm(
        'rounded-3xl relative w-full max-w-[320px] mx-auto aspect-square',
        'rounded-[var(--radius-xl)] overflow-hidden',
        'border-2',
        isHit ? 'border-accent-500/40' : 'border-white/[0.08]',
        'bg-ink-700',
      )}
      style={{ imageRendering: 'pixelated' }}
    >
      <span
        className="cb-tr absolute top-2 right-2 w-3.5 h-3.5 border-t-2 border-r-2 border-current"
        style={{
          color: isHit ? 'var(--color-accent-500)' : 'rgba(255,255,255,0.2)',
        }}
        aria-hidden="true"
      />
      <span
        className="cb-bl absolute bottom-2 left-2 w-3.5 h-3.5 border-b-2 border-l-2 border-current"
        style={{
          color: isHit ? 'var(--color-accent-500)' : 'rgba(255,255,255,0.2)',
        }}
        aria-hidden="true"
      />
      {image ? (
        <img
          src={image}
          alt={name ?? 'Sticker'}
          className="w-full h-full object-contain"
          style={{ imageRendering: 'pixelated' }}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <span
            className="font-mono text-3xl font-bold"
            style={{
              color: isHit
                ? 'var(--color-accent-500)'
                : 'var(--color-slate-500)',
            }}
          >
            {isHit ? 'HIT' : outcome === 'miss' ? 'MISS' : '?'}
          </span>
          <span className="text-[11px] font-mono text-slate-500 uppercase tracking-widest">
            {name ?? 'Sticker'}
          </span>
        </div>
      )}
    </div>
  )
}

function BuyModal({
  isOpen,
  onClose,
  listingPda,
  priceLamports,
  name,
  onSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  listingPda: string
  priceLamports: string
  name: string
  onSuccess: (txSig: string) => void
}) {
  const { publicKey } = useWallet()
  const { isAuthenticated } = useAuth()
  const buyMutation = useBuyCard()
  const priceSOL = lamportsToSol(priceLamports)

  async function handleConfirm() {
    try {
      const result = await buyMutation.mutateAsync(listingPda)
      onSuccess(result.txSig)
      onClose()
    } catch {
      // error surface handled by mutation state
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      classNames={{
        backdrop: 'bg-ink-900/72 backdrop-blur-[6px]',
        base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)]',
        header:
          'text-cream-50 font-semibold text-lg border-b border-white/[0.06]',
        body: 'py-6',
        footer: 'border-t border-white/[0.06]',
      }}
    >
      <ModalContent>
        <ModalHeader>Buy Sticker</ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-400">Card</p>
                <p className="text-cream-50 font-semibold">{name}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-400">Price</p>
                <p className="font-mono text-xl font-bold text-accent-500">
                  {priceSOL.toFixed(3)} SOL
                </p>
              </div>
            </div>

            {!isAuthenticated && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-warning-500/10 border border-warning-500/20">
                <AlertTriangle
                  size={14}
                  strokeWidth={1.75}
                  className="text-warning-500 mt-0.5 shrink-0"
                />
                <p className="text-warning-500 text-xs">
                  You need to connect and authenticate your wallet to buy.
                </p>
              </div>
            )}

            {buyMutation.isError && (
              <p className="text-error-500 text-xs font-mono">
                {buyMutation.error instanceof Error
                  ? buyMutation.error.message
                  : 'Buy failed'}
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button
            variant="bordered"
            onPress={onClose}
            className="rounded-full border-white/[0.1] text-slate-400 hover:text-cream-50"
          >
            Cancel
          </Button>
          <Button
            onPress={handleConfirm}
            isDisabled={!publicKey || !isAuthenticated || buyMutation.isPending}
            isLoading={buyMutation.isPending}
            className="rounded-full bg-accent-500 text-ink-900 font-semibold hover:bg-accent-600 focus-ring"
          >
            {buyMutation.isPending ? 'Signing…' : 'Confirm buy'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function ChangePriceModal({
  isOpen,
  onClose,
  listingPda,
}: {
  isOpen: boolean
  onClose: () => void
  listingPda: string
  assetId: string
  currentPriceLamports: string
}) {
  const cancelMutation = useCancelListing()

  async function handleCancel() {
    await cancelMutation.mutateAsync(listingPda)
    onClose()
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="sm"
      classNames={{
        backdrop: 'bg-ink-900/72 backdrop-blur-[6px]',
        base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)]',
        header:
          'text-cream-50 font-semibold text-lg border-b border-white/[0.06]',
        body: 'py-6',
        footer: 'border-t border-white/[0.06]',
      }}
    >
      <ModalContent>
        <ModalHeader>Manage Listing</ModalHeader>
        <ModalBody>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-slate-400">
              Cancel this listing to take it off the market. The sticker returns
              to your album.
            </p>
            {cancelMutation.isError && (
              <p className="text-error-500 text-xs font-mono">
                {cancelMutation.error instanceof Error
                  ? cancelMutation.error.message
                  : 'Failed'}
              </p>
            )}
          </div>
        </ModalBody>
        <ModalFooter className="gap-2">
          <Button
            variant="bordered"
            onPress={onClose}
            className="rounded-full border-white/[0.1] text-slate-400 hover:text-cream-50"
          >
            Keep listed
          </Button>
          <Button
            color="danger"
            onPress={handleCancel}
            isLoading={cancelMutation.isPending}
            className="rounded-full font-semibold"
          >
            Cancel listing
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

function ListingDetailPage() {
  const { listingPda } = Route.useParams()
  const navigate = useNavigate()
  const { publicKey } = useWallet()
  const walletAddress = publicKey?.toBase58() ?? ''
  const {
    isOpen: buyOpen,
    onOpen: openBuy,
    onClose: closeBuy,
  } = useDisclosure()
  const {
    isOpen: manageOpen,
    onOpen: openManage,
    onClose: closeManage,
  } = useDisclosure()
  const { toasts, show: showToast, dismiss } = useToast()

  const { data, isLoading, isError } = useListing(listingPda)
  const listing = data?.listing
  const sticker = data?.sticker

  // Fetch lineage for on-chain audit trail
  const { data: lineage } = useCardLineage(listing?.assetId ?? '')

  const isSeller = !!walletAddress && listing?.seller === walletAddress
  const priceSOL = listing ? lamportsToSol(listing.priceLamports) : 0

  function handleBuySuccess(txSig: string) {
    showToast('success', `Sticker purchased! Tx: ${txSig.slice(0, 8)}…`)
    setTimeout(() => navigate({ to: '/album' }), 2000)
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ink-900">
        <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-10 md:py-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 animate-pulse">
            <div className="aspect-square rounded-[var(--radius-xl)] bg-ink-800" />
            <div className="space-y-4">
              <div className="h-6 bg-ink-800 rounded w-1/3" />
              <div className="h-10 bg-ink-800 rounded w-2/3" />
              <div className="h-4 bg-ink-800 rounded w-1/2" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isError || !listing) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
            Error
          </p>
          <h1 className="text-2xl font-bold text-cream-50 mb-4">
            Listing not found
          </h1>
          <Link
            to="/market"
            className="inline-flex items-center gap-2 text-sm text-accent-500 hover:underline focus-ring rounded"
          >
            <ArrowLeft size={14} /> Back to marketplace
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-900">
      <ToastStack toasts={toasts} onDismiss={dismiss} />

      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-10 md:py-16">
        {/* Back link */}
        <AnimateComponent entry="fadeInUp">
          <Link
            to="/market"
            className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8 focus-ring rounded"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            Back to market
          </Link>
        </AnimateComponent>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16">
          {/* Left: sticker hero */}
          <AnimateComponent entry="fadeInUp">
            <StickerHero
              image={sticker?.image}
              name={sticker?.name}
              outcome={sticker?.outcome}
            />
          </AnimateComponent>

          {/* Right: details */}
          <AnimateComponent entry="fadeInUp" delay={100}>
            <div className="flex flex-col gap-6">
              {/* Title */}
              <div>
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-2">
                  Sticker card
                </p>
                <h1 className="text-3xl md:text-4xl font-bold text-cream-50 tracking-[-0.02em]">
                  {sticker?.name ?? 'Sticker'}
                </h1>
                {sticker?.fixtureId && (
                  <p className="text-slate-400 text-sm mt-2 font-mono">
                    fixture {sticker.fixtureId}
                    {sticker.slotIndex != null
                      ? ` · slot ${sticker.slotIndex}`
                      : ''}
                  </p>
                )}
              </div>

              {/* Price */}
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-mono font-bold text-accent-500">
                  {priceSOL.toFixed(3)}
                </span>
                <span className="text-xl font-mono text-slate-400">SOL</span>
              </div>

              {/* Seller */}
              <div className="flex flex-col gap-1">
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500">
                  Seller
                </p>
                <a
                  href={solscanAcct(listing.seller)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-sm text-sui-500 hover:underline focus-ring rounded w-fit"
                >
                  {shortenAddress(listing.seller, 6, 6)}
                  <ExternalLink size={12} strokeWidth={1.75} />
                </a>
              </div>

              {/* Listed date */}
              <p className="text-xs font-mono text-slate-500">
                Listed{' '}
                {new Date(listing.createdAt).toLocaleDateString(undefined, {
                  dateStyle: 'medium',
                })}
              </p>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                {isSeller ? (
                  <button
                    onClick={openManage}
                    className="h-11 px-6 rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 font-semibold text-sm hover:border-white/20 transition-colors focus-ring"
                  >
                    Manage listing
                  </button>
                ) : (
                  <button
                    onClick={openBuy}
                    className="h-11 px-6 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm hover:bg-accent-600 transition-colors focus-ring"
                  >
                    Buy for {priceSOL.toFixed(3)} SOL
                  </button>
                )}
                <ShareBlinkButton assetId={listing.assetId} />
              </div>

              {/* On-chain audit trail */}
              {(sticker?.mintTxSig || lineage) && (
                <div className="border border-white/[0.06] rounded-[var(--radius-lg)] p-5 flex flex-col gap-4">
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500">
                    Verified on-chain
                  </p>

                  {(sticker?.mintTxSig ?? lineage?.mintTxSig) && (
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">
                        Mint transaction
                      </p>
                      <a
                        href={solscanTx(
                          sticker?.mintTxSig ?? lineage?.mintTxSig ?? '',
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-sui-500 hover:underline break-all focus-ring rounded"
                      >
                        {(sticker?.mintTxSig ?? lineage?.mintTxSig ?? '').slice(
                          0,
                          20,
                        )}
                        …
                        <ExternalLink
                          size={11}
                          strokeWidth={1.75}
                          className="shrink-0"
                        />
                      </a>
                    </div>
                  )}

                  {(sticker?.eventStatRoot ?? lineage?.eventStatRoot) && (
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">
                        TxLINE Merkle root
                      </p>
                      <p className="font-mono text-xs text-slate-400 break-all">
                        {sticker?.eventStatRoot ?? lineage?.eventStatRoot}
                      </p>
                    </div>
                  )}

                  {lineage?.proofTs && (
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">
                        Proof timestamp
                      </p>
                      <p className="font-mono text-xs text-slate-400">
                        {new Date(
                          Number(lineage.proofTs) * 1000,
                        ).toLocaleString()}
                      </p>
                    </div>
                  )}

                  {lineage?.tree && (
                    <div>
                      <p className="text-[11px] text-slate-500 mb-1">
                        Merkle tree
                      </p>
                      <a
                        href={solscanAcct(lineage.tree)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-xs text-sui-500 hover:underline break-all focus-ring rounded"
                      >
                        {shortenAddress(lineage.tree, 8, 8)}
                        <ExternalLink
                          size={11}
                          strokeWidth={1.75}
                          className="shrink-0"
                        />
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </AnimateComponent>
        </div>
      </div>

      {/* Buy modal */}
      <BuyModal
        isOpen={buyOpen}
        onClose={closeBuy}
        listingPda={listingPda}
        priceLamports={listing.priceLamports}
        name={sticker?.name ?? 'Sticker'}
        onSuccess={handleBuySuccess}
      />

      {/* Manage modal */}
      {isSeller && (
        <ChangePriceModal
          isOpen={manageOpen}
          onClose={closeManage}
          listingPda={listingPda}
          assetId={listing.assetId}
          currentPriceLamports={listing.priceLamports}
        />
      )}
    </div>
  )
}
