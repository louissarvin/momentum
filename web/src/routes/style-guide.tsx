import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { StickerRevealCurtain } from '@/components/StickerRevealCurtain'
import { MatchCardRevealCurtain } from '@/components/MatchCardRevealCurtain'
import { StickerLineageModal } from '@/components/StickerLineageModal'
import ShareBlinkButton from '@/components/ShareBlinkButton'
import HealthWidget from '@/components/HealthWidget'
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Skeleton,
  Slider,
  Tab,
  Tabs,
  useDisclosure,
} from '@heroui/react'
import { AlertTriangle, Check, Info, Wallet, X } from 'lucide-react'
import { SettlementPipelinePill } from '@/components/SettlementPipelinePill'
import { cnm } from '@/utils/style'
import AnimateComponent from '@/components/elements/AnimateComponent'

export const Route = createFileRoute('/style-guide')({
  component: StyleGuidePage,
})

// ─── Section wrapper ──────────────────────────────────────────────────────────
function Section({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: React.ReactNode
}) {
  // No onScroll here — all sections must be immediately visible for the design reference.
  // onScroll + GSAP autoAlpha:0 would hide sections until they enter the viewport,
  // which makes the style guide unusable as a static reference.
  return (
    <AnimateComponent entry="fadeInUp" duration={400}>
      <section id={id} className="py-16 border-b border-white/[0.06]">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-3">
          {label}
        </p>
        <div className="mt-6">{children}</div>
      </section>
    </AnimateComponent>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <p className="text-xs font-mono text-slate-500 mb-3 uppercase tracking-widest">
        {label}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

// ─── Ceremonies demo ──────────────────────────────────────────────────────────

function CeremoniesDemo() {
  const [showSticker, setShowSticker] = useState(false)
  const [showMatchCard, setShowMatchCard] = useState(false)
  const [showLineage, setShowLineage] = useState(false)

  return (
    <div className="space-y-8">
      <Row label="StickerRevealCurtain (killer Merkle-proof reveal)">
        <Button
          size="sm"
          className="rounded-full bg-accent-500 text-ink-900 font-semibold"
          onPress={() => setShowSticker(true)}
        >
          Demo sticker reveal
        </Button>
        <p className="text-xs font-mono text-slate-500">
          ?trigger=demo on /fixtures/:id/live
        </p>
      </Row>

      <Row label="MatchCardRevealCurtain (match complete ceremony)">
        <Button
          size="sm"
          className="rounded-full bg-warning-500 text-ink-900 font-semibold"
          onPress={() => setShowMatchCard(true)}
        >
          Demo match card (5/8 LEGENDARY)
        </Button>
        <p className="text-xs font-mono text-slate-500">
          ?trigger=demo-match-card on /fixtures/:id/live
        </p>
      </Row>

      <Row label="StickerLineageModal">
        <Button
          size="sm"
          variant="bordered"
          className="rounded-full border-white/[0.12] text-slate-300"
          onPress={() => setShowLineage(true)}
        >
          Demo lineage modal
        </Button>
      </Row>

      <Row label="ShareBlinkButton">
        <ShareBlinkButton assetId="DemoAsset11111111111111111111111111111111111" />
        <ShareBlinkButton groupPda="DemoGroup1111111111111111111111111111111111" />
      </Row>

      <Row label="HealthWidget">
        <div className="w-64">
          <HealthWidget />
        </div>
      </Row>

      {/* Modals */}
      {showSticker && (
        <StickerRevealCurtain
          event={null}
          lineage={null}
          onClose={() => setShowSticker(false)}
          demoMode
        />
      )}
      {showMatchCard && (
        <MatchCardRevealCurtain
          event={null}
          onClose={() => setShowMatchCard(false)}
          demoMode
        />
      )}
      <StickerLineageModal
        isOpen={showLineage}
        onClose={() => setShowLineage(false)}
        lineage={null}
        loading={false}
      />
    </div>
  )
}

// ─── Toast demo ───────────────────────────────────────────────────────────────
function ToastDemo() {
  const [toasts, setToasts] = useState<
    Array<{ id: number; kind: 'success' | 'error' | 'info'; text: string }>
  >([])

  function add(kind: 'success' | 'error' | 'info', text: string) {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, kind, text }])
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      kind === 'error' ? 6000 : 4000,
    )
  }

  const stripeColor = {
    success: 'bg-success-500',
    error: 'bg-error-500',
    info: 'bg-sui-500',
  }

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button
          size="sm"
          className="rounded-full bg-success-500 text-ink-900 font-semibold"
          onPress={() => add('success', 'Sticker minted. View proof →')}
        >
          Success toast
        </Button>
        <Button
          size="sm"
          className="rounded-full bg-error-500 text-cream-50 font-semibold"
          onPress={() => add('error', 'Transaction failed. Please retry.')}
        >
          Error toast
        </Button>
        <Button
          size="sm"
          className="rounded-full bg-sui-500 text-cream-50 font-semibold"
          onPress={() =>
            add('info', 'Prediction submitted. Awaiting match start.')
          }
        >
          Info toast
        </Button>
      </div>

      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 w-[320px] max-w-[90vw]">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cnm(
              'flex items-start gap-3 p-4 rounded-[var(--radius-lg)]',
              'bg-ink-700 border border-white/[0.08]',
              'shadow-[var(--shadow-elevated)]',
              'animate-[fadeInUp_0.22s_ease-out_forwards]',
            )}
          >
            <div
              className={cnm(
                'mt-0.5 w-1 self-stretch rounded-full shrink-0',
                stripeColor[t.kind],
              )}
            />
            <p className="text-sm text-cream-50 leading-[1.5] flex-1">
              {t.text}
            </p>
            <button
              onClick={() =>
                setToasts((prev) => prev.filter((x) => x.id !== t.id))
              }
              className="text-slate-400 hover:text-cream-50 shrink-0 transition-colors"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

// ─── Modal demo ───────────────────────────────────────────────────────────────
function ModalDemo() {
  const basic = useDisclosure()
  const confirm = useDisclosure()

  return (
    <div className="flex flex-wrap gap-3">
      <Button
        onPress={basic.onOpen}
        className="rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 font-semibold"
      >
        Basic modal
      </Button>
      <Button
        onPress={confirm.onOpen}
        className="rounded-full bg-error-500 text-cream-50 font-semibold"
      >
        Confirm modal
      </Button>

      {/* Basic */}
      <Modal
        isOpen={basic.isOpen}
        onOpenChange={basic.onOpenChange}
        classNames={{
          base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)]',
          header:
            'text-cream-50 font-semibold text-lg border-b border-white/[0.06]',
          body: 'text-slate-400',
          closeButton: 'text-slate-400 hover:text-cream-50',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Submit prediction</ModalHeader>
              <ModalBody>
                <p className="text-sm leading-[1.55]">
                  You're about to submit a prediction with 5 slots for this
                  fixture. Once submitted, the transaction is irreversible.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  onPress={onClose}
                  className="rounded-full text-slate-400"
                >
                  Cancel
                </Button>
                <Button
                  onPress={onClose}
                  className="rounded-full bg-accent-500 text-ink-900 font-semibold"
                >
                  Sign and submit
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Confirm / destructive */}
      <Modal
        isOpen={confirm.isOpen}
        onOpenChange={confirm.onOpenChange}
        classNames={{
          base: 'bg-ink-800 border border-white/[0.08] rounded-[var(--radius-2xl)]',
          header:
            'text-cream-50 font-semibold text-lg border-b border-white/[0.06]',
          body: 'text-slate-400',
          closeButton: 'text-slate-400 hover:text-cream-50',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Cancel listing</ModalHeader>
              <ModalBody>
                <p className="text-sm leading-[1.55]">
                  This will remove your sticker from the marketplace. You can
                  re-list at any time.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button
                  variant="ghost"
                  onPress={onClose}
                  className="rounded-full text-slate-400"
                >
                  Keep listing
                </Button>
                <Button
                  onPress={onClose}
                  className="rounded-full bg-error-500 text-cream-50 font-semibold"
                >
                  Cancel listing
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  )
}

// ─── Wallet connect state demo ────────────────────────────────────────────────
function WalletStateDemo() {
  const [state, setState] = useState<'disconnected' | 'pending' | 'connected'>(
    'disconnected',
  )

  return (
    <div className="flex flex-wrap items-center gap-6">
      {/* Disconnected */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Disconnected
        </p>
        <Button
          onPress={() => setState('pending')}
          className="h-9 px-4 rounded-full bg-accent-500 text-ink-900 font-semibold text-sm"
          startContent={<Wallet size={14} strokeWidth={1.75} />}
        >
          Connect Wallet
        </Button>
      </div>

      {/* Pending */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Signing…
        </p>
        <button
          className={cnm(
            'flex items-center gap-2 h-9 px-3 rounded-full',
            'bg-ink-700 border border-accent-500/40',
            'text-cream-50 text-sm font-mono animate-pulse',
          )}
        >
          <Wallet size={14} strokeWidth={1.75} className="text-slate-400" />
          <span className="text-xs text-slate-400">Signing</span>
          <span className="text-xs text-accent-500 after:content-['...'] after:animate-[ellipsis-dots_1.4s_steps(3,end)_infinite]" />
        </button>
      </div>

      {/* Connected */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
          Connected
        </p>
        <button
          className={cnm(
            'flex items-center gap-2 h-9 px-3 rounded-full',
            'bg-ink-700 border border-white/[0.1]',
            'text-cream-50 text-sm font-mono',
            'hover:border-white/20 transition-colors duration-150',
          )}
        >
          <Wallet size={14} strokeWidth={1.75} className="text-slate-400" />
          <span className="text-xs">ABCD…WXYZ</span>
        </button>
      </div>

      <Button
        size="sm"
        variant="ghost"
        onPress={() => setState('disconnected')}
        className="text-slate-500 text-xs"
      >
        Reset
      </Button>
      {state}
    </div>
  )
}

// ─── Color swatch ─────────────────────────────────────────────────────────────
function Swatch({ hex, name }: { hex: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-2 w-20">
      <div
        className="w-16 h-16 rounded-[var(--radius-lg)] border border-white/[0.08]"
        style={{ backgroundColor: hex }}
      />
      <p className="text-[10px] font-mono text-slate-400 text-center leading-tight">
        {name}
      </p>
      <p className="text-[10px] font-mono text-slate-500 uppercase">{hex}</p>
    </div>
  )
}

// ─── SettlementPipelinePill demo ──────────────────────────────────────────────
function SettlementPipelinePillDemo() {
  const [queue, setQueue] = useState<
    Array<{
      jobId: string
      seq?: number | null
      statKey?: string | null
      error?: string
    }>
  >([])
  const [completedJobId, setCompletedJobId] = useState<string | null>(null)
  const lastJobIdRef = useRef<string | null>(null)

  function triggerStage(type: 'awaiting' | 'error') {
    const jobId = `sg-${Date.now()}`
    lastJobIdRef.current = jobId
    if (type === 'error') {
      setQueue((prev) => [
        ...prev,
        { jobId, error: 'RPC timeout after 3 attempts' },
      ])
    } else {
      setQueue((prev) => [...prev, { jobId, seq: 99, statKey: '1' }])
    }
  }

  function triggerConfirmed() {
    const jobId = lastJobIdRef.current
    if (jobId) {
      setCompletedJobId(jobId)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <Button
          size="sm"
          className="rounded-full bg-sui-500/20 text-sui-500 border border-sui-500/30 font-mono"
          onPress={() => triggerStage('awaiting')}
        >
          Start pipeline (Awaiting → Verifying → Minting)
        </Button>
        <Button
          size="sm"
          className="rounded-full bg-success-500/20 text-success-500 border border-success-500/30 font-mono"
          onPress={triggerConfirmed}
        >
          Advance to Confirmed
        </Button>
        <Button
          size="sm"
          className="rounded-full bg-error-500/20 text-error-500 border border-error-500/30 font-mono"
          onPress={() => triggerStage('error')}
        >
          Trigger Error
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="rounded-full text-slate-500 font-mono"
          onPress={() => {
            setQueue([])
            setCompletedJobId(null)
          }}
        >
          Reset
        </Button>
      </div>
      <p className="text-xs font-mono text-slate-500">
        Pill renders fixed top-right. Use buttons above to cycle through states.
        Confirmed auto-dismisses after 3s. Error requires manual dismiss.
      </p>
      <SettlementPipelinePill
        queue={queue}
        completedJobId={completedJobId}
        onDismiss={(jobId) =>
          setQueue((prev) => prev.filter((j) => j.jobId !== jobId))
        }
      />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
function StyleGuidePage() {
  return (
    <div className="min-h-screen bg-ink-900">
      {/* Page header */}
      <div className="border-b border-white/[0.06] py-12">
        <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-2">
            Dev only · /style-guide
          </p>
          <h1 className="text-4xl md:text-5xl font-bold text-cream-50 tracking-[-0.02em]">
            Momentum Design System
          </h1>
          <p className="mt-3 text-slate-400 text-base">
            All 12 component patterns per DESIGN.md §6. Reference before
            building any screen.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
        {/* ─── 1. Buttons ─────────────────────────────────────────────────────── */}
        <Section id="buttons" label="01 · Buttons">
          <Row label="Primary">
            <Button className="rounded-full bg-accent-500 text-ink-900 font-semibold px-5 h-11">
              Primary
            </Button>
            <Button className="rounded-full bg-accent-600 text-ink-900 font-semibold px-5 h-11">
              Primary hover
            </Button>
            <Button
              isDisabled
              className="rounded-full bg-accent-500/40 text-ink-900/60 font-semibold px-5 h-11 cursor-not-allowed"
            >
              Disabled
            </Button>
          </Row>
          <Row label="Secondary">
            <Button className="rounded-full bg-ink-800 border border-white/[0.12] text-cream-50 font-semibold px-5 h-11">
              Secondary
            </Button>
            <Button className="rounded-full bg-ink-700 border border-white/[0.12] text-cream-50 font-semibold px-5 h-11">
              Hover
            </Button>
            <Button
              isDisabled
              className="rounded-full bg-ink-800 border border-white/[0.05] text-cream-50/40 font-semibold px-5 h-11 cursor-not-allowed"
            >
              Disabled
            </Button>
          </Row>
          <Row label="Ghost">
            <Button
              variant="ghost"
              className="rounded-full text-cream-50 font-semibold px-5 h-11 hover:bg-white/[0.06]"
            >
              Ghost
            </Button>
            <Button
              variant="ghost"
              className="rounded-full text-cream-50 bg-white/[0.06] font-semibold px-5 h-11"
            >
              Hover
            </Button>
            <Button
              isDisabled
              variant="ghost"
              className="rounded-full text-cream-50/30 font-semibold px-5 h-11 cursor-not-allowed"
            >
              Disabled
            </Button>
          </Row>
          <Row label="Icon-only">
            <button
              className={cnm(
                'w-11 h-11 flex items-center justify-center rounded-full',
                'bg-ink-800 border border-white/[0.08] text-slate-400',
                'hover:text-cream-50 hover:scale-105 transition-all duration-150 focus-ring',
              )}
              aria-label="Connect wallet"
            >
              <Wallet size={16} strokeWidth={1.75} />
            </button>
            <button
              className={cnm(
                'w-11 h-11 flex items-center justify-center rounded-full',
                'bg-accent-500 text-ink-900',
                'hover:bg-accent-600 hover:scale-105 transition-all duration-150 focus-ring',
              )}
              aria-label="Confirm"
            >
              <Check size={16} strokeWidth={1.75} />
            </button>
            <button
              disabled
              className={cnm(
                'w-11 h-11 flex items-center justify-center rounded-full',
                'bg-ink-800 border border-white/[0.04] text-slate-700',
                'cursor-not-allowed',
              )}
              aria-label="Close (disabled)"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </Row>
          <Row label="Link-style">
            <button className="text-accent-500 text-sm font-semibold hover:underline underline-offset-4 transition-all">
              Link button
            </button>
            <button className="text-accent-500 text-sm font-semibold underline underline-offset-4">
              Hover state
            </button>
          </Row>
        </Section>

        {/* ─── 2. Cards ──────────────────────────────────────────────────────── */}
        <Section id="cards" label="02 · Cards">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Default */}
            <Card className="bg-ink-800 border border-white/[0.08] rounded-[var(--radius-lg)] shadow-none">
              <CardHeader className="pb-2">
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                  Default
                </p>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-slate-400 leading-[1.55]">
                  Standard card with subtle border and no shadow. Cards elevate
                  via border + bg contrast only.
                </p>
              </CardBody>
            </Card>

            {/* Featured */}
            <Card className="corner-brackets bg-ink-800 border border-accent-500/35 rounded-[var(--radius-xl)] shadow-none text-cream-50">
              <CardHeader className="pb-2">
                <p className="text-xs font-mono text-accent-500 uppercase tracking-widest">
                  Featured
                </p>
              </CardHeader>
              <CardBody>
                <p className="text-sm text-slate-400 leading-[1.55]">
                  Accent-tinted border, larger radius, corner brackets. Used for
                  the next-kickoff fixture and most-recent album card.
                </p>
              </CardBody>
            </Card>

            {/* Marketplace */}
            <Card className="bg-ink-800 border border-white/[0.08] rounded-[var(--radius-lg)] shadow-none relative overflow-visible text-cream-50">
              <div className="absolute top-3 right-3 z-10 bg-accent-500 text-ink-900 text-xs font-mono font-semibold px-2.5 py-1 rounded-full">
                0.25 SOL
              </div>
              <CardHeader className="pb-2">
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                  Marketplace
                </p>
              </CardHeader>
              <CardBody>
                <div className="w-full aspect-square bg-ink-700 rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                  <span
                    className="text-2xl pixel"
                    aria-label="Sticker placeholder"
                  >
                    ⚽
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  Goal sticker · Epic rarity
                </p>
              </CardBody>
            </Card>

            {/* Sticker */}
            <Card className="bg-ink-800 border-t-[3px] border-t-cat-goals border-x-white/[0.08] border-b-white/[0.08] border rounded-[var(--radius-lg)] shadow-none text-cream-50">
              <CardHeader className="pb-2 flex items-center justify-between">
                <span className="text-[10px] font-mono text-cat-goals">
                  ●●●○○
                </span>
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                  Sticker
                </p>
              </CardHeader>
              <CardBody>
                <div className="w-full aspect-square bg-ink-700 rounded-[var(--radius-sm)] flex items-center justify-center mb-3">
                  <span
                    className="text-2xl pixel"
                    aria-label="Sticker placeholder"
                  >
                    🏆
                  </span>
                </div>
                <p className="text-xs font-mono text-slate-500 uppercase tracking-widest">
                  Goals · Rare
                </p>
              </CardBody>
            </Card>
          </div>
        </Section>

        {/* ─── 3. Inputs ─────────────────────────────────────────────────────── */}
        <Section id="inputs" label="03 · Inputs">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
            <Input
              label="Prediction threshold"
              placeholder="e.g. 2"
              type="number"
              classNames={{
                input: 'bg-transparent text-cream-50 font-mono',
                inputWrapper:
                  'h-11 bg-transparent border border-white/[0.12] rounded-[var(--radius-md)] hover:border-accent-500/60 data-[focus=true]:border-accent-500 data-[focus=true]:shadow-[0_0_0_3px_rgba(249,115,22,0.2)]',
                label:
                  'text-slate-400 text-xs font-mono uppercase tracking-widest',
              }}
            />
            <Input
              label="Group name"
              placeholder="The Lads"
              classNames={{
                input: 'bg-transparent text-cream-50',
                inputWrapper:
                  'h-11 bg-transparent border border-white/[0.12] rounded-[var(--radius-md)] hover:border-accent-500/60 data-[focus=true]:border-accent-500 data-[focus=true]:shadow-[0_0_0_3px_rgba(249,115,22,0.2)]',
                label:
                  'text-slate-400 text-xs font-mono uppercase tracking-widest',
              }}
            />
          </div>
          <div className="mt-6 max-w-sm">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">
              Threshold slider
            </p>
            <Slider
              label="Threshold"
              step={1}
              minValue={0}
              maxValue={10}
              defaultValue={3}
              classNames={{
                base: 'max-w-sm',
                track: 'bg-ink-700 h-2',
                filler: 'bg-accent-500',
                thumb:
                  'w-4 h-4 rounded-[var(--radius-sm)] bg-cream-50 border-2 border-accent-500',
                label:
                  'text-slate-400 text-xs font-mono uppercase tracking-widest',
                value: 'font-mono text-accent-500',
              }}
            />
          </div>
        </Section>

        {/* ─── 4. Modals ─────────────────────────────────────────────────────── */}
        <Section id="modals" label="04 · Modals">
          <ModalDemo />
        </Section>

        {/* ─── 5. Chips ──────────────────────────────────────────────────────── */}
        <Section id="chips" label="05 · Chips">
          <Row label="Semantic">
            <Chip
              className="bg-ink-700/60 text-cream-50 border border-white/[0.08] font-mono text-xs rounded-full px-3 py-1"
              size="sm"
            >
              Default
            </Chip>
            <Chip
              className="bg-success-500/15 text-success-500 border border-success-500/30 font-mono text-xs rounded-full px-3 py-1"
              size="sm"
              startContent={<Check size={11} />}
            >
              Success
            </Chip>
            <Chip
              className="bg-warning-500/15 text-warning-500 border border-warning-500/30 font-mono text-xs rounded-full px-3 py-1"
              size="sm"
              startContent={<AlertTriangle size={11} />}
            >
              Warning
            </Chip>
            <Chip
              className="bg-error-500/15 text-error-500 border border-error-500/30 font-mono text-xs rounded-full px-3 py-1"
              size="sm"
              startContent={<X size={11} />}
            >
              Error
            </Chip>
            <Chip
              className="bg-sui-500/15 text-sui-500 border border-sui-500/30 font-mono text-xs rounded-full px-3 py-1"
              size="sm"
              startContent={<Info size={11} />}
            >
              Info
            </Chip>
          </Row>
          <Row label="Category chips">
            {(
              [
                'Goals',
                'Cards',
                'Corners',
                'Shots',
                'Possession',
                'Other',
              ] as const
            ).map((cat) => {
              const color: Record<string, string> = {
                Goals: 'bg-cat-goals/15 text-cat-goals border-cat-goals/30',
                Cards: 'bg-cat-cards/15 text-cat-cards border-cat-cards/30',
                Corners:
                  'bg-cat-corners/15 text-cat-corners border-cat-corners/30',
                Shots: 'bg-cat-shots/15 text-cat-shots border-cat-shots/30',
                Possession: 'bg-cat-poss/15 text-cat-poss border-cat-poss/30',
                Other: 'bg-cat-other/15 text-cat-other border-cat-other/30',
              }
              return (
                <Chip
                  key={cat}
                  size="sm"
                  className={cnm(
                    'border font-mono text-xs rounded-full px-3 py-1',
                    color[cat],
                  )}
                >
                  {cat}
                </Chip>
              )
            })}
          </Row>
        </Section>

        {/* ─── 6. Badges ─────────────────────────────────────────────────────── */}
        <Section id="badges" label="06 · Badges">
          <Row label="Prediction outcome">
            {(
              [
                { label: 'PENDING', cls: 'bg-slate-700/60 text-slate-400' },
                { label: 'HIT', cls: 'bg-success-500/20 text-success-500' },
                { label: 'MISS', cls: 'bg-error-500/20 text-error-500' },
                { label: 'MINTED', cls: 'bg-sui-500/20 text-sui-500' },
                { label: 'LISTED', cls: 'bg-cat-shots/20 text-cat-shots' },
              ] as const
            ).map(({ label, cls }) => (
              <span
                key={label}
                className={cnm(
                  'inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)]',
                  'font-mono text-[11px] font-semibold uppercase tracking-widest',
                  cls,
                )}
              >
                {label}
              </span>
            ))}
          </Row>
          <Row label="Match status">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-success-500/15 text-success-500 font-mono text-[11px] font-semibold uppercase tracking-widest">
              <span className="live-dot w-1.5 h-1.5" />
              LIVE
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-[var(--radius-sm)] bg-warning-500/15 text-warning-500 font-mono text-[11px] font-semibold uppercase tracking-widest">
              UPCOMING
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-[var(--radius-sm)] bg-slate-700/40 text-slate-400 font-mono text-[11px] font-semibold uppercase tracking-widest">
              FINALIZED
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-[var(--radius-sm)] bg-sui-500/15 text-sui-500 font-mono text-[11px] font-semibold uppercase tracking-widest">
              REPLAY MODE
            </span>
          </Row>
        </Section>

        {/* ─── 7. Data table ─────────────────────────────────────────────────── */}
        <Section id="data-table" label="07 · Data Table">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  {['Fixture', 'Slots', 'Hit rate', 'Status', 'Minted at'].map(
                    (h) => (
                      <th
                        key={h}
                        className="pb-3 text-left text-xs font-mono uppercase tracking-widest text-slate-500 pr-6"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    fixture: 'France vs Germany',
                    slots: 8,
                    hits: 6,
                    status: 'MINTED',
                    ts: '2026-07-01',
                  },
                  {
                    fixture: 'Spain vs Brazil',
                    slots: 5,
                    hits: 3,
                    status: 'HIT',
                    ts: '2026-07-02',
                  },
                  {
                    fixture: 'Italy vs Argentina',
                    slots: 7,
                    hits: 0,
                    status: 'PENDING',
                    ts: '—',
                  },
                ].map((row, i) => (
                  <tr
                    key={i}
                    className="border-b border-white/[0.06] hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="py-3 pr-6 text-cream-50 font-medium">
                      {row.fixture}
                    </td>
                    <td className="py-3 pr-6 font-mono text-slate-400 tabular-nums">
                      {row.slots}
                    </td>
                    <td className="py-3 pr-6 font-mono text-accent-500 tabular-nums text-right">
                      {row.hits}/{row.slots}
                    </td>
                    <td className="py-3 pr-6">
                      <span
                        className={cnm(
                          'inline-flex items-center px-2 py-0.5 rounded-[var(--radius-sm)]',
                          'font-mono text-[11px] font-semibold uppercase tracking-widest',
                          row.status === 'MINTED'
                            ? 'bg-sui-500/20 text-sui-500'
                            : row.status === 'HIT'
                              ? 'bg-success-500/20 text-success-500'
                              : 'bg-slate-700/60 text-slate-400',
                        )}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 font-mono text-slate-500 text-sm">
                      {row.ts}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ─── 8. Skeleton loaders ───────────────────────────────────────────── */}
        <Section id="skeletons" label="08 · Skeleton Loaders">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.06] space-y-3"
              >
                {/* Image skeleton */}
                <Skeleton className="w-full aspect-square rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
                {/* Title skeleton */}
                <Skeleton className="h-4 w-3/4 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
                {/* Meta skeleton */}
                <Skeleton className="h-3 w-1/2 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
                <Skeleton className="h-3 w-2/3 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700" />
              </div>
            ))}
          </div>
          <div className="mt-6 max-w-md space-y-2">
            <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-3">
              Table row skeletons
            </p>
            {[80, 60, 70].map((w, i) => (
              <Skeleton
                key={i}
                className={cnm(
                  'h-8 rounded-[var(--radius-sm)] pixel-shimmer bg-ink-700',
                )}
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </Section>

        {/* ─── 9. Toast ──────────────────────────────────────────────────────── */}
        <Section id="toast" label="09 · Toast">
          <ToastDemo />
        </Section>

        {/* ─── 10. Tabs ──────────────────────────────────────────────────────── */}
        <Section id="tabs" label="10 · Tabs">
          <Tabs
            aria-label="Fixture status"
            classNames={{
              tabList: 'bg-ink-700 rounded-full p-1 gap-1',
              tab: 'rounded-full text-sm font-medium text-slate-400 data-[selected=true]:text-ink-900 data-[selected=true]:bg-accent-500 h-8 px-4',
              cursor: 'hidden',
            }}
          >
            <Tab key="upcoming" title="Upcoming">
              <div className="mt-4 text-slate-400 text-sm">
                Showing 6 upcoming fixtures. Predictions open.
              </div>
            </Tab>
            <Tab key="live" title="Live">
              <div className="mt-4 flex items-center gap-2 text-sm">
                <span className="live-dot w-2 h-2" />
                <span className="text-success-500 font-mono">
                  2 matches in progress
                </span>
              </div>
            </Tab>
            <Tab key="finalized" title="Finalized">
              <div className="mt-4 text-slate-400 text-sm">
                12 finalized fixtures this season.
              </div>
            </Tab>
          </Tabs>
        </Section>

        {/* ─── 11. Wallet-connect state ──────────────────────────────────────── */}
        <Section id="wallet" label="11 · Wallet-Connect State">
          <WalletStateDemo />
        </Section>

        {/* ─── 12. Tokens reference ──────────────────────────────────────────── */}
        <Section id="tokens" label="12 · Color Swatches · Typography · Spacing">
          {/* Colors */}
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5">
            Primary palette
          </p>
          <div className="flex flex-wrap gap-4 mb-10">
            <Swatch hex="#0A0B0D" name="ink-900" />
            <Swatch hex="#111318" name="ink-800" />
            <Swatch hex="#1A1D24" name="ink-700" />
            <Swatch hex="#F9F6EF" name="cream-50" />
            <Swatch hex="#F1ECDE" name="cream-100" />
            <Swatch hex="#FFFFFF" name="paper-0" />
            <Swatch hex="#F97316" name="accent-500" />
            <Swatch hex="#EA580C" name="accent-600" />
            <Swatch hex="#4DA2FF" name="sui-500" />
          </div>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5">
            Semantic
          </p>
          <div className="flex flex-wrap gap-4 mb-10">
            <Swatch hex="#22C55E" name="success-500" />
            <Swatch hex="#EF4444" name="error-500" />
            <Swatch hex="#F5C842" name="warning-500" />
            <Swatch hex="#94969C" name="slate-400" />
            <Swatch hex="#6E7079" name="slate-500" />
            <Swatch hex="#3A3D45" name="slate-700" />
          </div>
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5">
            Category
          </p>
          <div className="flex flex-wrap gap-4 mb-10">
            <Swatch hex="#F97316" name="cat-goals" />
            <Swatch hex="#F5C842" name="cat-cards" />
            <Swatch hex="#3CD8D8" name="cat-corners" />
            <Swatch hex="#8B5CF6" name="cat-shots" />
            <Swatch hex="#22C55E" name="cat-poss" />
            <Swatch hex="#94969C" name="cat-other" />
          </div>

          {/* Typography scale */}
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5">
            Typography scale
          </p>
          <div className="space-y-4 mb-10">
            {[
              {
                cls: 'text-[clamp(2.5rem,8vw,6rem)] font-bold tracking-[-0.03em] leading-[1.02]',
                label: 'display-xl',
              },
              {
                cls: 'text-[clamp(2rem,6vw,3.5rem)] font-bold tracking-[-0.02em] leading-[1.1]',
                label: 'display-lg',
              },
              {
                cls: 'text-[clamp(1.75rem,4vw,2.5rem)] font-semibold tracking-[-0.015em] leading-[1.15]',
                label: 'h1',
              },
              {
                cls: 'text-[clamp(1.375rem,3vw,1.75rem)] font-semibold tracking-[-0.01em] leading-[1.2]',
                label: 'h2',
              },
              { cls: 'text-lg font-semibold leading-[1.25]', label: 'h3' },
              { cls: 'text-lg font-normal leading-[1.55]', label: 'body-lg' },
              { cls: 'text-base font-normal leading-[1.55]', label: 'body' },
              { cls: 'text-sm font-normal leading-[1.5]', label: 'body-sm' },
            ].map(({ cls, label }) => (
              <div key={label} className="flex items-baseline gap-6">
                <span className="text-[10px] font-mono text-slate-600 w-20 shrink-0">
                  {label}
                </span>
                <span className={cnm(cls, 'text-cream-50')}>
                  Predict every kick.
                </span>
              </div>
            ))}
            <div className="flex items-baseline gap-6">
              <span className="text-[10px] font-mono text-slate-600 w-20 shrink-0">
                overline
              </span>
              <span className="text-xs font-mono uppercase tracking-[0.12em] font-bold text-cream-50">
                LIVE MATCH · MY CARDS
              </span>
            </div>
            <div className="flex items-baseline gap-6">
              <span className="text-[10px] font-mono text-slate-600 w-20 shrink-0">
                mono-lg
              </span>
              <span className="text-xl font-mono font-medium text-accent-500 tabular-nums">
                2 – 1 · 67&apos;
              </span>
            </div>
            <div className="flex items-baseline gap-6">
              <span className="text-[10px] font-mono text-slate-600 w-20 shrink-0">
                mono
              </span>
              <span className="text-sm font-mono text-slate-400 tabular-nums">
                ABCD…WXYZ · 0.25 SOL
              </span>
            </div>
          </div>

          {/* Spacing scale */}
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5">
            Spacing scale (4px grid)
          </p>
          <div className="flex items-end gap-2 flex-wrap">
            {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32].map((step) => (
              <div key={step} className="flex flex-col items-center gap-1">
                <div
                  className="bg-accent-500/30 border border-accent-500/50"
                  style={{ width: `${step * 4}px`, height: `${step * 4}px` }}
                />
                <span className="text-[9px] font-mono text-slate-600">
                  {step * 4}px
                </span>
              </div>
            ))}
          </div>

          {/* Radius scale */}
          <p className="text-xs font-mono text-slate-500 uppercase tracking-widest mb-5 mt-10">
            Radius scale
          </p>
          <div className="flex items-end gap-4 flex-wrap">
            {[
              { label: 'sm · 4px', r: '4px' },
              { label: 'md · 12px', r: '12px' },
              { label: 'lg · 20px', r: '20px' },
              { label: 'xl · 28px', r: '28px' },
              { label: '2xl · 40px', r: '40px' },
              { label: 'full', r: '9999px' },
            ].map(({ label, r }) => (
              <div key={label} className="flex flex-col items-center gap-2">
                <div
                  className="w-16 h-16 bg-ink-700 border border-white/[0.12]"
                  style={{ borderRadius: r }}
                />
                <span className="text-[9px] font-mono text-slate-500 text-center leading-tight">
                  {label}
                </span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* ─── 13. Ceremonies + SettlementPipelinePill ─────────────────────── */}
      <Section id="ceremonies" label="13 · Ceremonies + Pipeline Pill">
        <CeremoniesDemo />
        <div className="mt-12">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-6">
            SettlementPipelinePill — 5 states
          </p>
          <SettlementPipelinePillDemo />
        </div>
      </Section>

      {/* Footer pad */}
      <div className="h-24" />
    </div>
  )
}
