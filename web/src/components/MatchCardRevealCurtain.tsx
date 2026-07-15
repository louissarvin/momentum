/**
 * MatchCardRevealCurtain — the 5-second Match Card claim ceremony.
 *
 * Per DESIGN.md §9.6 and web-plan.md §4.1 Screen 6.
 * Trigger: match_card_claimed SSE event (game_finalised / statusId=100).
 * Demo: pass demoMode=true or use ?trigger=demo-match-card.
 *
 * 6 phases over ~5 seconds:
 *   0–500ms    Full-screen curtain + "MATCH COMPLETE" title
 *   500–1500ms Fixture summary card slides up (teams, score placeholder, time)
 *   1500–2800ms Rarity counting animation (hit-rate → rarity tier)
 *   2800–4200ms Match card mints as hexagonal collectible with rarity color
 *   4200–4800ms "Added to your Album" toast
 *   4800–5000ms Curtain fades, ceremony ends
 *
 * prefers-reduced-motion: skips to final state, no animation.
 * Skip button available throughout.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { Trophy, Volume2, VolumeX, X } from 'lucide-react'
import { cnm } from '@/utils/style'
import { gsap } from '@/lib/gsap'
import {
  isAudioEnabled,
  playChime,
  playChord,
  playTick,
  playWhistle,
  setAudioEnabled,
} from '@/lib/audio'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MatchCardClaimedEvent {
  fixtureId: string
  assetId?: string
  hitCount?: number
  slotCount?: number
}

interface Props {
  event: MatchCardClaimedEvent | null
  onClose: () => void
  demoMode?: boolean
}

// ─── Rarity config ────────────────────────────────────────────────────────────

type Rarity = 'LEGENDARY' | 'EPIC' | 'RARE' | 'UNCOMMON' | 'COMMON'

interface RarityConfig {
  label: Rarity
  minRatio: number // minimum hit/slot ratio to qualify
  gradient: string
  borderColor: string
  glowColor: string
  dotsColor: string
  dots: number
  confettiColors: string[]
}

const RARITY_TIERS: RarityConfig[] = [
  {
    label: 'LEGENDARY',
    minRatio: 0.875, // 7/8 or 8/8
    gradient: 'linear-gradient(135deg, #F97316 0%, #8B5CF6 50%, #F97316 100%)',
    borderColor: '#F97316',
    glowColor: 'rgba(249,115,22,0.35)',
    dotsColor: '#F97316',
    dots: 5,
    confettiColors: ['#F97316', '#F5C842', '#8B5CF6', '#F9F6EF', '#F97316'],
  },
  {
    label: 'EPIC',
    minRatio: 0.75, // 6/8
    gradient: 'linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)',
    borderColor: '#8B5CF6',
    glowColor: 'rgba(139,92,246,0.35)',
    dotsColor: '#8B5CF6',
    dots: 4,
    confettiColors: ['#8B5CF6', '#F97316', '#F9F6EF', '#4DA2FF'],
  },
  {
    label: 'RARE',
    minRatio: 0.5, // 4/8
    gradient: 'linear-gradient(135deg, #4DA2FF 0%, #2563EB 100%)',
    borderColor: '#4DA2FF',
    glowColor: 'rgba(77,162,255,0.3)',
    dotsColor: '#4DA2FF',
    dots: 3,
    confettiColors: ['#4DA2FF', '#F9F6EF', '#3CD8D8'],
  },
  {
    label: 'UNCOMMON',
    minRatio: 0.25, // 2/8
    gradient: 'linear-gradient(135deg, #22C55E 0%, #15803D 100%)',
    borderColor: '#22C55E',
    glowColor: 'rgba(34,197,94,0.25)',
    dotsColor: '#22C55E',
    dots: 2,
    confettiColors: ['#22C55E', '#F9F6EF', '#3CD8D8'],
  },
  {
    label: 'COMMON',
    minRatio: 0,
    gradient: 'linear-gradient(135deg, #94969C 0%, #3A3D45 100%)',
    borderColor: '#94969C',
    glowColor: 'rgba(148,150,156,0.15)',
    dotsColor: '#94969C',
    dots: 1,
    confettiColors: ['#94969C', '#F9F6EF'],
  },
]

function getRarity(hitCount: number, slotCount: number): RarityConfig {
  if (slotCount === 0) return RARITY_TIERS[4]
  const ratio = hitCount / slotCount
  return RARITY_TIERS.find((t) => ratio >= t.minRatio) ?? RARITY_TIERS[4]
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO_EVENT: MatchCardClaimedEvent = {
  fixtureId: '18237038',
  assetId: 'DemoMatchCard111111111111111111111111111111',
  hitCount: 5,
  slotCount: 8,
}

// ─── Confetti helper ──────────────────────────────────────────────────────────

function randomBetween(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function spawnConfetti(
  container: HTMLDivElement,
  colors: string[],
  count = 32,
) {
  for (let i = 0; i < count; i++) {
    const color = colors[i % colors.length]
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
      x: randomBetween(-200, 200),
      y: randomBetween(-160, -40),
      rotation: randomBetween(0, 720),
      opacity: 0,
      duration: randomBetween(0.8, 1.2),
      ease: 'power2.out',
      delay: randomBetween(0, 0.3),
      onComplete: () => el.remove(),
    })
  }
}

// ─── Rarity dot strip ─────────────────────────────────────────────────────────

function RarityDots({ config }: { config: RarityConfig }) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`${config.label} rarity`}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className="font-mono text-[13px]"
          style={{
            color:
              i < config.dots ? config.dotsColor : 'rgba(255,255,255,0.12)',
          }}
        >
          ●
        </span>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function MatchCardRevealCurtain({
  event: eventProp,
  onClose,
  demoMode = false,
}: Props) {
  const event = demoMode ? DEMO_EVENT : eventProp

  const hitCount = event?.hitCount ?? 0
  const slotCount = event?.slotCount ?? 8
  const rarity = getRarity(hitCount, slotCount)

  const [phase, setPhase] = useState<1 | 2 | 3 | 4 | 5 | 6>(1)
  const [displayCount, setDisplayCount] = useState(0)
  const [showToast, setShowToast] = useState(false)
  const [audioOn, setAudioOn] = useState(isAudioEnabled)

  function toggleAudio() {
    const next = !audioOn
    setAudioOn(next)
    setAudioEnabled(next)
  }

  const curtainRef = useRef<HTMLDivElement | null>(null)
  const titleRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const hexRef = useRef<HTMLDivElement | null>(null)
  const confettiRef = useRef<HTMLDivElement | null>(null)
  const masterTl = useRef<gsap.core.Timeline | null>(null)
  const countIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false

  useLayoutEffect(() => {
    if (!event) return

    // Reduced motion: jump straight to final state
    if (reducedMotion) {
      setPhase(5)
      setDisplayCount(hitCount)
      setShowToast(true)
      return
    }

    masterTl.current = gsap.timeline()
    const tl = masterTl.current

    // Phase 1 — whistle at t=100ms
    tl.add(() => {
      playWhistle()
    }, 0.1)

    // Phase 1 (0–500ms): curtain fades in, title flies up
    if (curtainRef.current) {
      gsap.set(curtainRef.current, { opacity: 0 })
      tl.to(
        curtainRef.current,
        { opacity: 1, duration: 0.4, ease: 'power2.out' },
        0,
      )
    }
    if (titleRef.current) {
      gsap.set(titleRef.current, { y: 80, opacity: 0 })
      tl.to(
        titleRef.current,
        { y: 0, opacity: 1, duration: 0.45, ease: 'momentum-snap' },
        0.05,
      )
    }

    // Phase 2 (500–1500ms): fixture card slides up
    tl.add(() => setPhase(2), 0.5)
    if (cardRef.current) {
      gsap.set(cardRef.current, { y: '120%', scale: 0.88, opacity: 0 })
      tl.to(
        cardRef.current,
        {
          y: '0%',
          scale: 1,
          opacity: 1,
          duration: 0.7,
          ease: 'momentum-glide',
        },
        0.5,
      )
    }

    // Phase 3 (1500–2800ms): rarity counter + ticks
    tl.add(() => {
      setPhase(3)
      let current = 0
      countIntervalRef.current = setInterval(
        () => {
          current += 1
          setDisplayCount(current)
          playTick(400 + current * 60)
          if (current >= hitCount) {
            clearInterval(countIntervalRef.current!)
          }
        },
        Math.max(80, 1200 / Math.max(hitCount, 1)),
      )
    }, 1.5)

    // Phase 4 (2800–4200ms): hex card mints + chord or chime
    tl.add(() => {
      setPhase(4)
      setDisplayCount(hitCount)
      if (countIntervalRef.current) clearInterval(countIntervalRef.current)

      // Audio: legendary gets ascending chime, others get chord
      if (rarity.label === 'LEGENDARY') {
        playChime()
      } else {
        playChord()
      }

      // Confetti on the hex
      if (confettiRef.current) {
        const count =
          rarity.label === 'LEGENDARY' ? 48 : rarity.label === 'EPIC' ? 36 : 24
        spawnConfetti(confettiRef.current, rarity.confettiColors, count)
      }
    }, 2.8)

    // Hex bounce-in
    if (hexRef.current) {
      gsap.set(hexRef.current, { scale: 0, opacity: 0 })
    }
    tl.add(() => {
      if (hexRef.current) {
        gsap.to(hexRef.current, {
          scale: 1,
          opacity: 1,
          duration: 0.5,
          ease: 'momentum-snap',
        })
        // Legendary: gentle bob after mint
        if (rarity.label === 'LEGENDARY') {
          gsap.to(hexRef.current, {
            y: '-6px',
            duration: 2.4,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            delay: 0.5,
          })
        }
      }
    }, 2.85)

    // Phase 5 (4200–4800ms): toast appears
    tl.add(() => {
      setPhase(5)
      setShowToast(true)
    }, 4.2)

    // Phase 6 (4800ms): done signal
    tl.add(() => setPhase(6), 4.8)

    return () => {
      masterTl.current?.kill()
      if (countIntervalRef.current) clearInterval(countIntervalRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  function handleSkip() {
    if (countIntervalRef.current) clearInterval(countIntervalRef.current)
    masterTl.current?.progress(1)
    setPhase(6)
    setDisplayCount(hitCount)
    setShowToast(true)
  }

  if (!event) return null

  const isLegendary = rarity.label === 'LEGENDARY'

  return (
    <div
      ref={curtainRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Match complete. ${hitCount} out of ${slotCount} slots correct. ${rarity.label} card minted.`}
      className={cnm(
        'fixed inset-0 z-[60] flex flex-col items-center justify-center',
        reducedMotion ? 'opacity-100' : '',
      )}
      style={{ background: 'rgba(10,11,13,0.92)', backdropFilter: 'blur(8px)' }}
    >
      {/* Confetti layer */}
      <div
        ref={confettiRef}
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none overflow-hidden"
      />

      {/* Skip / close */}
      <button
        onClick={phase < 6 ? handleSkip : onClose}
        aria-label={phase < 6 ? 'Skip ceremony' : 'Close'}
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

      {/* Phase 1: Title block */}
      <div
        ref={titleRef}
        className={cnm(
          'flex flex-col items-center gap-2 mb-6 pointer-events-none select-none',
          reducedMotion && 'opacity-100',
        )}
        aria-hidden="true"
      >
        <p
          className="text-[10px] font-mono uppercase tracking-[0.18em]"
          style={{ color: rarity.borderColor }}
        >
          Game finalised
        </p>
        <h1
          className="font-bold text-center leading-[1.02] tracking-[-0.03em]"
          style={{
            fontSize: 'clamp(2.5rem, 8vw, 5rem)',
            color: '#F9F6EF',
            fontFamily: 'Bricolage Grotesque, sans-serif',
          }}
        >
          MATCH COMPLETE
        </h1>
      </div>

      {/* Phase 2+: Fixture summary card */}
      {(phase >= 2 || reducedMotion) && (
        <div
          ref={cardRef}
          className={cnm(
            'rounded-3xl relative w-full max-w-md mx-4',
            'rounded-[var(--radius-2xl)] bg-ink-800 border p-6',
            'flex flex-col gap-5',
          )}
          style={{
            borderColor: `${rarity.borderColor}50`,
            boxShadow: `inset 0 0 80px ${rarity.glowColor}, 0 0 0 1px ${rarity.borderColor}20`,
          }}
        >

          {/* Teams + score */}
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 text-center">
              <p className="text-sm font-semibold text-cream-50 truncate">
                {event.fixtureId ? `Fixture ${event.fixtureId}` : 'Match'}
              </p>
              <p className="text-[10px] font-mono text-slate-500 mt-0.5 uppercase tracking-widest">
                Final
              </p>
            </div>
            <div className="shrink-0 px-4 py-2 rounded-[var(--radius-md)] bg-ink-900/60 border border-white/[0.06]">
              <p
                className="font-mono text-xl font-bold text-cream-50 tabular-nums"
                aria-label="Final score"
              >
                — · —
              </p>
            </div>
          </div>

          {/* Phase 3: Rarity counter */}
          {(phase >= 3 || reducedMotion) && (
            <div className="flex flex-col items-center gap-3 py-2 border-t border-white/[0.06]">
              <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-slate-500">
                Your hit rate
              </p>
              <div className="flex items-baseline gap-2">
                <span
                  className="font-mono font-bold tabular-nums"
                  style={{
                    fontSize: 'clamp(2rem, 6vw, 3.5rem)',
                    color: rarity.borderColor,
                  }}
                >
                  {displayCount}
                </span>
                <span className="font-mono text-xl text-slate-500">
                  / {slotCount}
                </span>
                <span className="font-mono text-sm text-slate-400">slots</span>
              </div>

              {/* Rarity label */}
              {phase >= 3 && (
                <div className="flex flex-col items-center gap-1.5">
                  <p
                    className="font-mono text-xs font-bold uppercase tracking-[0.12em]"
                    style={{ color: rarity.borderColor }}
                  >
                    {rarity.label}
                  </p>
                  <RarityDots config={rarity} />
                </div>
              )}
            </div>
          )}

          {/* Phase 4: Hex collectible */}
          {(phase >= 4 || reducedMotion) && (
            <div className="flex flex-col items-center gap-4 py-2">
              <div
                ref={hexRef}
                className={cnm(
                  'relative flex items-center justify-center',
                  isLegendary ? 'rounded-3xl' : '',
                )}
                style={{
                  width: 120,
                  height: 120,
                  clipPath:
                    'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
                  background: rarity.gradient,
                  boxShadow: `0 0 40px ${rarity.glowColor}`,
                }}
                aria-label={`${rarity.label} match card collectible`}
              >
                <div className="flex flex-col items-center gap-1">
                  <Trophy
                    size={28}
                    strokeWidth={1.5}
                    style={{
                      color: isLegendary ? '#0A0B0D' : '#F9F6EF',
                    }}
                    aria-hidden="true"
                  />
                  <span
                    className="font-mono text-[8px] font-bold uppercase tracking-widest"
                    style={{ color: isLegendary ? '#0A0B0D' : '#F9F6EF' }}
                  >
                    {rarity.label}
                  </span>
                </div>
              </div>

              <p className="text-xs font-mono text-slate-400 text-center">
                Match Card minted to your album
              </p>
            </div>
          )}

          {/* Phase 5+: Toast + done button */}
          {showToast && (
            <div className="flex flex-col gap-2 pt-2 border-t border-white/[0.06]">
              <div
                className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] border"
                style={{
                  background: `${rarity.glowColor}`,
                  borderColor: `${rarity.borderColor}30`,
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: rarity.borderColor }}
                  aria-hidden="true"
                />
                <p
                  className="text-xs font-mono"
                  style={{ color: rarity.borderColor }}
                >
                  Added to your Album
                </p>
              </div>
              <div className="flex gap-2">
                <a
                  href="/album"
                  className={cnm(
                    'flex-1 inline-flex items-center justify-center h-9 rounded-full',
                    'bg-ink-700 border border-white/[0.1] text-xs font-semibold text-slate-300',
                    'hover:text-cream-50 transition-colors focus-ring',
                  )}
                >
                  View in Album
                </a>
                <button
                  onClick={onClose}
                  className="flex-1 h-9 rounded-full text-xs font-semibold transition-colors focus-ring"
                  style={{
                    background: rarity.borderColor,
                    color: '#0A0B0D',
                  }}
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
