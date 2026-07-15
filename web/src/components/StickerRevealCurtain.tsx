/**
 * StickerRevealCurtain — the 4-second killer Merkle-proof reveal animation.
 *
 * Per DESIGN.md §7.6 6-phase spec.
 * Audio: no audio for now (noted in spec).
 *
 * Trigger: sticker_minted SSE event + optional CardLineage (fetched async).
 * Demo mode: pass demoMode=true to play with mocked data (no live mint needed).
 *
 * Respects prefers-reduced-motion: skips GSAP animation, shows final state.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Volume2, VolumeX, X } from 'lucide-react'
import type { CardLineage } from '@/lib/api/types'
import type { StickerMintedEvent } from '@/hooks/useFixtureStream'
import { cnm } from '@/utils/style'
import { solscanTx } from '@/utils/solscan'
import { gsap } from '@/lib/gsap'
import {
  isAudioEnabled,
  playChord,
  playTick,
  playWhistle,
  setAudioEnabled,
} from '@/lib/audio'
import { StickerArt } from '@/lib/sticker-art'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  event: StickerMintedEvent | null
  lineage: CardLineage | null
  lineageLoading?: boolean
  onClose: () => void
  demoMode?: boolean
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_EVENT: StickerMintedEvent = {
  fixtureId: '18237038',
  cardPda: 'Demo1111111111111111111111111111111111111111',
  slotIndex: 2,
  assetId: 'DemoAsset11111111111111111111111111111111111',
  mintTxSig:
    '24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g',
}

const DEMO_LINEAGE: CardLineage = {
  assetId: 'DemoAsset11111111111111111111111111111111111',
  kind: 'sticker',
  fixture: {
    fixtureId: '18237038',
    homeTeam: 'Argentina',
    awayTeam: 'Brazil',
  },
  slot: 2,
  outcome: 'hit',
  eventStatRoot:
    '24ebb28c3f91a4b7cc882d109ef4a3d07c8e14b2a9f3551c6d87e2109b4f33ac',
  proofTs: '1720000732',
  mintTxSig:
    '24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g',
  mintTxSolscan:
    'https://solscan.io/tx/24JM8XGgFpGxm5uJ6eWAvb9j7xnovk1wqsErfcWGM1MERaH6hsXCBV8ZceDYnHNPiANY48QxQtnZVZo2ZMeUqv6g?cluster=devnet',
  tree: '2jKMbtBFhgnsPNNQnz9awKzDBpgisPSa87pDg5ZiU5PX',
  leafIndex: '732',
  collection: 'CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg',
  das: { asset: null, proof: null },
}

// ─── Confetti burst helper ────────────────────────────────────────────────────

const CONFETTI_COLORS = [
  '#F97316', // cat-goals
  '#F5C842', // cat-cards
  '#3CD8D8', // cat-corners
  '#8B5CF6', // cat-shots
  '#22C55E', // cat-poss
]

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

// ─── Merkle tree SVG (4-node path) ───────────────────────────────────────────

interface MerkleTreeProps {
  playing: boolean
  reducedMotion: boolean
  lineage: CardLineage | null
}

function MerkleTree({ playing, reducedMotion, lineage }: MerkleTreeProps) {
  const nodeRefs = useRef<(SVGRectElement | null)[]>([])
  const lineRefs = useRef<(SVGLineElement | null)[]>([])
  const tl = useRef<gsap.core.Timeline | null>(null)

  const nodes = [
    {
      label: 'Leaf',
      value: lineage?.eventStatRoot
        ? `${lineage.eventStatRoot.slice(0, 8)}…`
        : '24ebb28c…',
      sublabel: 'P2 goals = 2',
      x: 150,
      y: 220,
    },
    {
      label: 'SubTree Root',
      value: lineage?.tree ? `${lineage.tree.slice(0, 6)}…` : '2jKMbt…',
      sublabel: '',
      x: 100,
      y: 140,
    },
    {
      label: 'Main Root',
      value: lineage?.leafIndex ? `idx ${lineage.leafIndex}` : 'idx 732',
      sublabel: '',
      x: 200,
      y: 140,
    },
    {
      label: 'daily_scores_root',
      value: 'on-chain PDA',
      sublabel: lineage?.fixture?.fixtureId
        ? `fixture ${lineage.fixture.fixtureId}`
        : 'fixture 18237038',
      x: 150,
      y: 60,
    },
  ]

  const lines = [
    { x1: 150, y1: 220, x2: 100, y2: 145 },
    { x1: 150, y1: 220, x2: 200, y2: 145 },
    { x1: 100, y1: 130, x2: 150, y2: 70 },
    { x1: 200, y1: 130, x2: 150, y2: 70 },
  ]

  useEffect(() => {
    if (!playing) return

    if (reducedMotion) {
      nodeRefs.current.forEach(
        (n) => n && gsap.set(n, { opacity: 1, scale: 1 }),
      )
      return
    }

    tl.current = gsap.timeline()

    // Lines appear with stroke-dashoffset trick — set initial state
    lineRefs.current.forEach((l) => {
      if (!l) return
      const len = 120
      gsap.set(l, {
        strokeDasharray: len,
        strokeDashoffset: len,
        opacity: 1,
      })
    })

    // Animate lines
    lineRefs.current.forEach((l, i) => {
      if (!l) return
      tl.current!.to(
        l,
        {
          strokeDashoffset: 0,
          duration: 0.3,
          ease: 'momentum-tick',
        },
        i * 0.2,
      )
    })

    // Nodes pop in
    nodeRefs.current.forEach((n, i) => {
      if (!n) return
      gsap.set(n, { scale: 0, transformOrigin: 'center' })
      tl.current!.to(
        n,
        {
          scale: 1,
          duration: 0.18,
          ease: 'momentum-snap',
        },
        i * 0.2 + 0.1,
      )
    })

    return () => {
      tl.current?.kill()
    }
  }, [playing, reducedMotion])

  return (
    <svg
      width="300"
      height="280"
      viewBox="0 0 300 280"
      aria-hidden="true"
      className="w-full max-w-[300px] mx-auto"
    >
      {/* Lines */}
      {lines.map((l, i) => (
        <line
          key={i}
          ref={(el) => {
            lineRefs.current[i] = el
          }}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          stroke="rgba(249,115,22,0.5)"
          strokeWidth="1.5"
          opacity={reducedMotion ? 1 : 0}
        />
      ))}

      {/* Nodes */}
      {nodes.map((n, i) => (
        <g key={i}>
          <rect
            ref={(el) => {
              nodeRefs.current[i] = el
            }}
            x={n.x - 36}
            y={n.y - 18}
            width="72"
            height="36"
            rx="4"
            fill="#1A1D24"
            stroke={i === 0 ? '#F97316' : 'rgba(255,255,255,0.12)'}
            strokeWidth="1.5"
            opacity={reducedMotion ? 1 : 0}
          />
          <text
            x={n.x}
            y={n.y - 5}
            textAnchor="middle"
            fill="#94969C"
            fontSize="7"
            fontFamily="JetBrains Mono, monospace"
            opacity={reducedMotion ? 1 : 0}
          >
            {n.label}
          </text>
          <text
            x={n.x}
            y={n.y + 7}
            textAnchor="middle"
            fill={i === 0 ? '#F97316' : '#F9F6EF'}
            fontSize="8"
            fontFamily="JetBrains Mono, monospace"
            fontWeight="600"
            opacity={reducedMotion ? 1 : 0}
          >
            {n.value}
          </text>
          {n.sublabel && (
            <text
              x={n.x}
              y={n.y + 17}
              textAnchor="middle"
              fill="#22C55E"
              fontSize="7"
              fontFamily="JetBrains Mono, monospace"
              opacity={reducedMotion ? 1 : 0}
            >
              {n.sublabel}
            </text>
          )}
        </g>
      ))}
    </svg>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StickerRevealCurtain({
  event: eventProp,
  lineage: lineageProp,
  lineageLoading,
  onClose,
  demoMode = false,
}: Props) {
  const event = demoMode ? DEMO_EVENT : eventProp
  const lineage = demoMode ? DEMO_LINEAGE : lineageProp

  const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5 | 6>(1)
  const [showMerkle, setShowMerkle] = useState(false)
  const [audioOn, setAudioOn] = useState(isAudioEnabled)
  const confettiRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const masterTl = useRef<gsap.core.Timeline | null>(null)

  function toggleAudio() {
    const next = !audioOn
    setAudioOn(next)
    setAudioEnabled(next)
  }

  const isHit = lineage?.outcome === 'hit' || lineage?.outcome === 'match_card'
  const reducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

  // Run master GSAP timeline
  useLayoutEffect(() => {
    if (!event) return

    if (reducedMotion) {
      setPhase(6)
      setShowMerkle(true)
      return
    }

    masterTl.current = gsap.timeline({
      onComplete: () => {
        setPhase(6)
      },
    })

    const tl = masterTl.current

    // Phase 1 — whistle SFX at t=100ms
    tl.add(() => {
      playWhistle()
    }, 0.1)

    // Phase 1 (0–400ms): overlay fades in + title flies up
    if (overlayRef.current) {
      gsap.set(overlayRef.current, { opacity: 0 })
      tl.to(
        overlayRef.current,
        { opacity: 1, duration: 0.4, ease: 'power2.out' },
        0,
      )
    }

    if (titleRef.current) {
      gsap.set(titleRef.current, { y: 60, opacity: 0 })
      tl.to(
        titleRef.current,
        { y: 0, opacity: 1, duration: 0.35, ease: 'momentum-snap' },
        0.05,
      )
    }

    // Phase 2 (400–1200ms): card slides up
    if (cardRef.current) {
      gsap.set(cardRef.current, { y: '100%', scale: 0.92, opacity: 0 })
      tl.to(
        cardRef.current,
        {
          y: '0%',
          scale: 1,
          opacity: 1,
          duration: 0.6,
          ease: 'momentum-glide',
        },
        0.3,
      )
    }

    // Phase 3 (1200–2200ms): show Merkle tree + tick per node
    tl.add(() => {
      setPhase(3)
      setShowMerkle(true)
      // 4 Merkle nodes with rising pitches
      ;[0, 1, 2, 3].forEach((i) => {
        setTimeout(() => playTick(400 + i * 100), i * 200)
      })
    }, 1.2)

    // Phase 4 (2200–3000ms): sticker hex fold signal
    tl.add(() => {
      setPhase(4)
    }, 2.2)

    // Confetti + chord at 2.4s
    tl.add(() => {
      if (confettiRef.current && !reducedMotion) {
        spawnConfetti(confettiRef.current)
      }
      playChord()
      setPhase(5)
    }, 2.4)

    // Phase 6 (3800ms)
    tl.add(() => setPhase(6), 3.8)

    return () => {
      masterTl.current?.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  function handleSkip() {
    masterTl.current?.progress(1)
    setPhase(6)
    setShowMerkle(true)
  }

  function spawnConfetti(container: HTMLDivElement) {
    CONFETTI_COLORS.forEach((color) => {
      for (let i = 0; i < 5; i++) {
        const el = document.createElement('div')
        el.style.cssText = `
          position: absolute;
          width: 6px;
          height: 6px;
          background: ${color};
          border-radius: 2px;
          left: 50%;
          top: 50%;
          pointer-events: none;
        `
        container.appendChild(el)
        gsap.to(el, {
          x: randomBetween(-160, 160),
          y: randomBetween(-120, -40),
          rotation: randomBetween(0, 720),
          opacity: 0,
          duration: 0.9,
          ease: 'power2.out',
          onComplete: () => el.remove(),
        })
      }
    })
  }

  if (!event) return null

  const receiptColor = isHit ? '#F97316' : '#94969C'
  const receiptGlow = isHit
    ? 'inset 0 0 60px rgba(249,115,22,0.15)'
    : 'inset 0 0 40px rgba(148,150,156,0.08)'

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-live="polite"
      aria-label={`Prediction ${isHit ? 'hit' : 'miss'}. Sticker minted.`}
      className={cnm(
        'fixed inset-0 z-50 flex items-center justify-center px-4',
        reducedMotion ? 'opacity-100' : '',
      )}
      style={{ background: 'rgba(10,11,13,0.80)' }}
    >
      {/* Confetti container */}
      <div
        ref={confettiRef}
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
      />

      {/* Skip / close button */}
      <button
        onClick={phase < 6 ? handleSkip : onClose}
        aria-label={phase < 6 ? 'Skip animation' : 'Close'}
        className="absolute top-4 right-4 p-2 rounded-full bg-ink-700/80 border border-white/[0.1] text-slate-400 hover:text-cream-50 transition-colors focus-ring z-10"
      >
        <X size={16} strokeWidth={1.75} />
      </button>

      {/* Audio toggle */}
      <button
        onClick={toggleAudio}
        aria-label={audioOn ? 'Mute audio' : 'Enable audio'}
        title={audioOn ? 'Mute' : 'Enable audio'}
        className="absolute top-4 left-4 p-2 rounded-full bg-ink-700/80 border border-white/[0.1] text-slate-400 hover:text-cream-50 transition-colors focus-ring z-10"
      >
        {audioOn ? (
          <Volume2 size={16} strokeWidth={1.75} />
        ) : (
          <VolumeX size={16} strokeWidth={1.75} />
        )}
      </button>

      {/* Phase 1: Title */}
      <div
        ref={titleRef}
        aria-hidden="true"
        className={cnm(
          'absolute bottom-[calc(50%+200px)] text-center pointer-events-none select-none',
          reducedMotion && 'hidden',
        )}
      >
        <p
          className="text-5xl font-black tracking-[-0.03em]"
          style={{
            color: receiptColor,
            fontFamily: 'Bricolage Grotesque, sans-serif',
          }}
        >
          {isHit ? 'GOAL!' : 'MISS!'}
        </p>
      </div>

      {/* Receipt card — Phase 2+ */}
      <div
        ref={cardRef}
        className={cnm(
          'rounded-3xl relative w-full max-w-sm',
          'rounded-[var(--radius-2xl)] bg-ink-800 border',
          'p-6 flex flex-col gap-4',
        )}
        style={{
          borderColor: `${receiptColor}40`,
          boxShadow: receiptGlow,
        }}
      >

        {/* Outcome header */}
        <div className="flex items-center justify-between">
          <span
            className="font-mono text-xs font-bold uppercase tracking-[0.12em]"
            style={{ color: receiptColor }}
          >
            {isHit ? 'HIT — STICKER MINTED' : 'MISS — STICKER MINTED'}
          </span>
          {event.slotIndex != null && (
            <span className="font-mono text-xs text-slate-500">
              SLOT {event.slotIndex}
            </span>
          )}
        </div>

        {/* Monospace data fields */}
        <div className="space-y-1.5 bg-ink-900/50 rounded-[var(--radius-md)] p-3 border border-white/[0.06]">
          {[
            ['fixture_id', event.fixtureId ?? '—'],
            ['slot_index', String(event.slotIndex ?? '—')],
            [
              'event_stat_root',
              lineage?.eventStatRoot
                ? `${lineage.eventStatRoot.slice(0, 12)}…`
                : '24ebb28c…',
            ],
            [
              'proof_ts',
              lineage?.proofTs
                ? String(lineage.proofTs).slice(0, 12) + '…'
                : '—',
            ],
            [
              'mint_tx',
              event.mintTxSig ? `${event.mintTxSig.slice(0, 10)}…` : '—',
            ],
          ].map(([key, val]) => (
            <div
              key={key}
              className="flex items-baseline gap-2 overflow-hidden"
            >
              <span className="font-mono text-[10px] text-slate-500 shrink-0 w-28">
                {key}:
              </span>
              <span className="font-mono text-[11px] text-slate-300 truncate">
                {val}
              </span>
            </div>
          ))}
        </div>

        {/* Phase 3: Merkle tree */}
        {(showMerkle || phase >= 3 || reducedMotion) && (
          <div className="py-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-slate-500 mb-3 text-center">
              Merkle path
            </p>
            <MerkleTree
              playing={showMerkle}
              reducedMotion={reducedMotion}
              lineage={lineage}
            />
          </div>
        )}

        {/* Phase 4/5: Sticker hex fold */}
        {(phase >= 4 || reducedMotion) && (
          <div className="flex flex-col items-center gap-3">
            <div
              className={cnm(
                'flex items-center justify-center transition-all duration-500',
                phase >= 5 ? 'scale-110' : 'scale-100',
              )}
            >
              <StickerArt
                stat="goals"
                predicate="over"
                outcome={isHit ? 'hit' : 'miss'}
                rarity={isHit ? 'uncommon' : 'common'}
                size={96}
                aria-label={`${isHit ? 'Hit' : 'Miss'} sticker — ${lineage?.fixture?.homeTeam ?? ''} vs ${lineage?.fixture?.awayTeam ?? ''}`}
              />
            </div>
            <p className="text-xs font-mono text-slate-400 text-center">
              {lineage?.fixture?.homeTeam ?? 'Team A'} vs{' '}
              {lineage?.fixture?.awayTeam ?? 'Team B'}
            </p>
          </div>
        )}

        {/* Phase 6: View on Solscan toast + close */}
        {(phase === 6 || reducedMotion) && (
          <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
            <p className="text-xs font-mono text-slate-500 text-center">
              Verified sticker minted
            </p>
            <div className="flex gap-2">
              {event.mintTxSig && (
                <a
                  href={solscanTx(event.mintTxSig)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cnm(
                    'flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-full text-xs font-semibold',
                    'bg-ink-700 border border-white/[0.1] text-sui-500 hover:text-cream-50 transition-colors focus-ring',
                  )}
                >
                  View on Solscan
                </a>
              )}
              <button
                onClick={onClose}
                className="flex-1 h-9 rounded-full bg-accent-500 text-ink-900 font-semibold text-xs hover:bg-accent-600 transition-colors focus-ring"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* Loading state for lineage */}
        {lineageLoading && phase >= 3 && !lineage && (
          <p className="font-mono text-xs text-slate-500 text-center py-2">
            <span className="inline-block animate-pulse">
              Fetching proof data…
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
