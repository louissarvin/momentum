import { Link, createFileRoute } from '@tanstack/react-router'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useLayoutEffect, useRef } from 'react'
import { ArrowRight, ShieldCheck, Sparkles, Trophy } from 'lucide-react'
import { Wallet as WalletIcon } from 'lucide-react'
import { cnm } from '@/utils/style'
import { liveStatsOptions } from '@/lib/api/endpoints'
import { gsap } from '@/lib/gsap'
import AnimateComponent from '@/components/elements/AnimateComponent'

export const Route = createFileRoute('/')({ component: LandingPage })

// ─── Live stats counter ───────────────────────────────────────────────────────

interface StatTileProps {
  label: string
  value: number | null
  loading: boolean
}

function StatTile({ label, value, loading }: StatTileProps) {
  const numRef = useRef<HTMLSpanElement | null>(null)
  const prevValue = useRef<number>(0)

  useEffect(() => {
    if (value == null || loading) return
    const el = numRef.current
    if (!el) return

    const start = prevValue.current
    const end = value
    prevValue.current = end

    const obj = { n: start }
    gsap.to(obj, {
      n: end,
      duration: 1.2,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = Math.round(obj.n).toLocaleString()
      },
    })
  }, [value, loading])

  return (
    <div className="flex flex-col items-center gap-1 px-6 py-5 min-w-0">
      <span
        ref={numRef}
        className="font-mono text-3xl md:text-4xl font-bold text-cream-50 tabular-nums"
        aria-live="polite"
      >
        {loading || value == null ? '—' : value.toLocaleString()}
      </span>
      <span className="text-xs font-mono uppercase tracking-[0.1em] text-slate-500 text-center">
        {label}
      </span>
    </div>
  )
}

function LiveStatsStrip() {
  const { data, isLoading } = useQuery(liveStatsOptions())

  const stats = [
    { key: 'totalPredictions' as const, label: 'Total Predictions' },
    { key: 'totalStickersMinted' as const, label: 'Stickers Minted' },
    { key: 'activeGroups' as const, label: 'Active Groups' },
    { key: 'salesLast24h' as const, label: 'Sales (24h)' },
  ]

  return (
    <AnimateComponent onScroll entry="fadeInUp">
      <div
        className={cnm(
          'rounded-[var(--radius-xl)] bg-ink-900 border border-white/[0.08]',
          'grid grid-cols-2 md:grid-cols-4',
          'divide-x divide-white/[0.06] divide-y md:divide-y-0',
        )}
      >
        {stats.map(({ key, label }) => (
          <StatTile
            key={key}
            label={label}
            value={data ? (data[key as keyof typeof data] as number) : null}
            loading={isLoading}
          />
        ))}
      </div>
    </AnimateComponent>
  )
}

// ─── Feature cards (W-1) ──────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: ShieldCheck,
    title: 'Verifiable',
    body: 'Every sticker is bound to a TxLINE Merkle proof. No trust, just math. See the audit trail for every mint.',
  },
  {
    icon: Sparkles,
    title: 'Playful',
    body: 'Pixel-art collectibles for the World Cup fan. Sticker albums, group leaderboards, share-to-mint via Solana Blinks.',
  },
  {
    icon: Trophy,
    title: 'Own',
    body: 'Compressed NFTs on Solana. Fractions of a cent per mint. Sell them on the marketplace or hold them as proof-of-moment.',
  },
]

function FeatureStrip() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
      {FEATURES.map((f, i) => (
        <AnimateComponent
          key={f.title}
          onScroll
          entry="fadeInUp"
          delay={i * 100}
        >
          <div
            className={cnm(
              'relative group h-full flex flex-col',
              'p-8 rounded-3xl bg-ink-800',
              'border border-white/[0.08]',
              'hover:-translate-y-1 hover:border-accent-500/30',
              'hover:shadow-[0_0_32px_rgba(249,115,22,0.1)]',
              'transition-all duration-200',
              'text-cream-50',
            )}
          >

            <f.icon
              size={28}
              strokeWidth={1.5}
              className="text-accent-500 mb-5"
              aria-hidden="true"
            />
            <h3 className="text-xl font-bold text-cream-50 mb-3 tracking-[-0.01em]">
              {f.title}
            </h3>
            <p className="text-sm text-slate-400 leading-[1.6]">{f.body}</p>
          </div>
        </AnimateComponent>
      ))}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LandingPage() {
  const { setVisible } = useWalletModal()
  const { connected } = useWallet()
  const heroRef = useRef<HTMLDivElement | null>(null)

  // Orchestrated GSAP entrance timeline for the hero.
  // Uses gsap.from() — elements are visible by default in CSS. GSAP briefly
  // animates them FROM a hidden state. If the effect is cancelled or reverted
  // (StrictMode, hot reload, theme toggle re-render), elements simply remain
  // in their final CSS state — never invisible.
  useLayoutEffect(() => {
    if (!heroRef.current) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return // Skip animation entirely on reduced-motion

    const ctx = gsap.context(() => {
      const eyebrow = heroRef.current!.querySelector('[data-hero="eyebrow"]')
      const words = heroRef.current!.querySelectorAll('[data-hero="word"]')
      const sub = heroRef.current!.querySelector('[data-hero="sub"]')
      const ctas = heroRef.current!.querySelectorAll('[data-hero="cta"]')
      const logo = heroRef.current!.querySelector('[data-hero="logo"]')
      const blob = heroRef.current!.querySelector('[data-hero="blob"]')

      const tl = gsap.timeline({
        defaults: { ease: 'power3.out', duration: 0.7 },
      })
      tl.from(logo, { opacity: 0, y: 24 })
        .from(eyebrow, { opacity: 0, y: 24 }, '-=0.55')
        .from(
          words,
          { opacity: 0, y: 24, stagger: 0.08, duration: 0.85 },
          '-=0.45',
        )
        .from(sub, { opacity: 0, y: 24 }, '-=0.6')
        .from(ctas, { opacity: 0, y: 24, stagger: 0.08 }, '-=0.5')
        .from(
          blob,
          { opacity: 0, scale: 0.85, duration: 1.2, ease: 'expo.out' },
          '-=1.1',
        )
    }, heroRef)

    return () => ctx.revert()
  }, [])

  return (
    <div className="min-h-screen bg-ink-900 overflow-hidden">
      {/* Hero section */}
      <section
        ref={heroRef}
        className="relative min-h-[calc(100vh-5rem)] flex items-center"
      >
        {/* Background grid texture (subtle) */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(249,115,22,0.6) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto w-full max-w-[1120px] px-4 md:px-6">
          <div className="flex flex-col md:flex-row items-center gap-12 md:gap-16 py-20">
            {/* Left — copy */}
            <div className="flex-1 text-center md:text-left">
              {/* Hero logo — bigger than pill nav */}
              <div
                data-hero="logo"
                className="flex justify-center md:justify-start mb-6"
              >
                <img
                  src="/assets/logo.svg"
                  alt="MOMENTUM"
                  className="h-16 md:h-24 w-auto"
                />
              </div>
              <p
                data-hero="eyebrow"
                className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-4"
              >
                On-chain · Devnet
              </p>

              <h1
                className={cnm(
                  'text-[clamp(2.5rem,8vw,6rem)] font-bold leading-[1.02] tracking-[-0.03em]',
                  'text-cream-50 mb-6',
                )}
              >
                <span
                  data-hero="word"
                  className="inline-block will-change-transform"
                >
                  Call the match.
                </span>
                <br />
                <span
                  data-hero="word"
                  className="inline-block text-accent-500 will-change-transform"
                >
                  Own the proof.
                </span>
              </h1>

              <p
                data-hero="sub"
                className="text-lg text-slate-400 leading-[1.55] max-w-[480px] mx-auto md:mx-0 mb-10"
              >
                Momentum turns football predictions into on-chain collectibles.
                Every correct call mints a cNFT sticker with a verifiable Merkle
                receipt — yours forever, tradeable on the open market.
              </p>

              <div className="flex flex-col sm:flex-row items-center gap-3 justify-center md:justify-start">
                {!connected ? (
                  <button
                    data-hero="cta"
                    onClick={() => setVisible(true)}
                    className={cnm(
                      'inline-flex items-center gap-2 px-6 py-3 rounded-full',
                      'bg-accent-500 text-ink-900 text-sm font-semibold',
                      'hover:bg-accent-600 transition-colors duration-150',
                      'focus-ring active:scale-[0.97]',
                    )}
                  >
                    <WalletIcon size={16} strokeWidth={1.75} />
                    Connect Wallet
                  </button>
                ) : (
                  <Link
                    data-hero="cta"
                    to="/fixtures"
                    className={cnm(
                      'inline-flex items-center gap-2 px-6 py-3 rounded-full',
                      'bg-accent-500 text-ink-900 text-sm font-semibold',
                      'hover:bg-accent-600 transition-colors duration-150',
                      'focus-ring active:scale-[0.97]',
                    )}
                  >
                    Browse Fixtures
                    <ArrowRight size={16} strokeWidth={1.75} />
                  </Link>
                )}

                <Link
                  data-hero="cta"
                  to="/fixtures"
                  className={cnm(
                    'inline-flex items-center gap-2 px-6 py-3 rounded-full',
                    'bg-transparent text-cream-50 text-sm font-semibold',
                    'border border-white/[0.12] hover:bg-white/[0.06]',
                    'transition-colors duration-150 focus-ring',
                  )}
                >
                  Explore fixtures
                  <ArrowRight size={16} strokeWidth={1.75} />
                </Link>
              </div>
            </div>

            {/* Right — blob hero */}
            <div
              className="relative flex-shrink-0 flex items-center justify-center"
              aria-hidden="true"
            >
              <div
                data-hero="blob"
                className="blob-hero animate-[blob-morph_12s_ease-in-out_infinite_alternate]"
                style={{
                  width: 'min(440px, 55vw)',
                  opacity: 0.85,
                }}
              />
              {/* Floating pixel-art accent orbs */}
              <div
                className="absolute top-[15%] left-[10%] w-3 h-3 rounded-sm bg-accent-500 opacity-60 animate-[float_4s_ease-in-out_infinite_alternate]"
                style={{ animationDelay: '0s' }}
              />
              <div
                className="absolute top-[70%] right-[8%] w-2 h-2 rounded-sm bg-cat-corners opacity-50 animate-[float_5.5s_ease-in-out_infinite_alternate]"
                style={{ animationDelay: '1.2s' }}
              />
              <div
                className="absolute bottom-[20%] left-[20%] w-2 h-2 rounded-sm bg-cat-shots opacity-50 animate-[float_3.8s_ease-in-out_infinite_alternate]"
                style={{ animationDelay: '0.7s' }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Feature strip — W-1 */}
      <section className="py-20 md:py-32 bg-ink-900">
        <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
          <AnimateComponent onScroll entry="fadeInUp">
            <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-400 mb-3 text-center">
              Why Momentum
            </p>
            <h2 className="text-3xl md:text-5xl font-bold text-cream-50 text-center mb-12 tracking-[-0.02em]">
              Predict. Prove. Collect.
            </h2>
          </AnimateComponent>

          <FeatureStrip />

          {/* Live stats counter — W-2 */}
          <div className="mt-12">
            <LiveStatsStrip />
          </div>
        </div>
      </section>

      {/* How it works — 3 steps */}
      <section className="py-20 md:py-32">
        <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
          <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-400 mb-3 text-center">
            How it works
          </p>
          <h2 className="text-3xl md:text-5xl font-bold text-cream-50 text-center mb-12 tracking-[-0.02em]">
            Three steps, one collectible.
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
            {STEPS.map((step, i) => (
              <AnimateComponent
                key={i}
                onScroll
                entry="fadeInUp"
                delay={i * 80}
              >
                <div
                  className={cnm(
                    'h-full flex flex-col',
                    'p-8 rounded-3xl bg-ink-800',
                    'border border-white/[0.08]',
                    'text-cream-50',
                  )}
                >
                  <p className="text-xs font-mono text-accent-500 uppercase tracking-[0.12em] mb-4">
                    0{i + 1}
                  </p>
                  <h3 className="text-xl font-semibold text-cream-50 mb-3">
                    {step.title}
                  </h3>
                  <p className="text-sm text-slate-400 leading-[1.55]">
                    {step.body}
                  </p>
                </div>
              </AnimateComponent>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA — contained card (wageguard/pullcast pattern) */}
      <ClosingCta connected={connected} setVisible={setVisible} />
    </div>
  )
}

// ─── Closing CTA card ─────────────────────────────────────────────────────────

interface ClosingCtaProps {
  connected: boolean
  setVisible: (v: boolean) => void
}

function ClosingCta({ connected, setVisible }: ClosingCtaProps) {
  return (
    <section className="pb-24 md:pb-32">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
        <AnimateComponent onScroll entry="fadeInUp">
          <div
            className={cnm(
              'relative overflow-hidden rounded-3xl',
              'bg-accent-500 text-ink-900',
              'px-8 py-14 md:px-16 md:py-20',
            )}
          >
            {/* Subtle radial dot texture (pullcast pattern) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-40"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(10,11,13,0.14) 1px, transparent 1px)',
                backgroundSize: '24px 24px',
              }}
            />

            <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
              <div className="max-w-[560px]">
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-ink-900/70 mb-3">
                  Ready when you are
                </p>
                <h3 className="text-3xl md:text-4xl font-bold text-ink-900 leading-[1.1] tracking-[-0.02em]">
                  Ready to call the match?
                </h3>
                <p className="mt-3 text-[15px] text-ink-900/75 leading-[1.55]">
                  Connect a wallet, pick a fixture, and turn your football takes
                  into on-chain collectibles.
                </p>
              </div>

              {!connected ? (
                <button
                  onClick={() => setVisible(true)}
                  className={cnm(
                    'group inline-flex items-center gap-2 rounded-full shrink-0',
                    'bg-ink-900 px-7 py-3.5 text-[14px] font-semibold text-cream-50',
                    'transition-all duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
                    'hover:bg-ink-800 active:scale-[0.98]',
                    'focus-visible:outline-2 focus-visible:outline-ink-900 focus-visible:outline-offset-[3px]',
                  )}
                >
                  <WalletIcon size={16} strokeWidth={1.75} />
                  Connect wallet
                  <ArrowRight
                    size={16}
                    strokeWidth={1.75}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </button>
              ) : (
                <Link
                  to="/fixtures"
                  className={cnm(
                    'group inline-flex items-center gap-2 rounded-full shrink-0',
                    'bg-ink-900 px-7 py-3.5 text-[14px] font-semibold text-cream-50',
                    'transition-all duration-300 ease-[cubic-bezier(0.22,0.61,0.36,1)]',
                    'hover:bg-ink-800 active:scale-[0.98]',
                    'focus-visible:outline-2 focus-visible:outline-ink-900 focus-visible:outline-offset-[3px]',
                  )}
                >
                  Browse fixtures
                  <ArrowRight
                    size={16}
                    strokeWidth={1.75}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </Link>
              )}
            </div>
          </div>
        </AnimateComponent>
      </div>
    </section>
  )
}

const STEPS = [
  {
    title: 'Build your card',
    body: 'Pick a fixture and fill up to 8 prediction slots — goals, corners, shots, cards. Set a threshold and submit. It writes to Solana.',
  },
  {
    title: 'Watch it settle live',
    body: 'TxLINE streams every match packet. Your slots resolve in real time, each hit verified by an on-chain CPI call you can audit.',
  },
  {
    title: 'Collect the receipt',
    body: 'Every correct call mints a Bubblegum cNFT with a Merkle proof attached. Trade it, share it, or just keep it in your album.',
  },
]
