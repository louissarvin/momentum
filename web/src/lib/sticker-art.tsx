/**
 * StickerArt — procedural SVG sticker visual.
 *
 * Renders crisp at any size. Zero image files.
 * Frame color = rarity. Center glyph = stat category.
 * Outcome badge top-right. MOMENTUM wordmark bottom.
 */

import { cnm } from '@/utils/style'

export type StatType =
  | 'goals'
  | 'cards'
  | 'corners'
  | 'shots'
  | 'possession'
  | 'other'

export type Predicate = 'over' | 'under' | 'exact'
export type Outcome = 'hit' | 'miss' | 'pending'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

interface Props {
  stat: StatType
  predicate?: Predicate
  outcome?: Outcome
  rarity?: Rarity
  size?: number
  threshold?: number
  className?: string
}

// ─── Rarity config ────────────────────────────────────────────────────────────

const RARITY: Record<
  Rarity,
  { frame: string; frameAlt: string; accent: string; label: string }
> = {
  common: {
    frame: '#3A3D45',
    frameAlt: '#1A1D24',
    accent: '#94969C',
    label: 'CMN',
  },
  uncommon: {
    frame: '#15803D',
    frameAlt: '#14532D',
    accent: '#22C55E',
    label: 'UNC',
  },
  rare: {
    frame: '#1D4ED8',
    frameAlt: '#1E3A8A',
    accent: '#4DA2FF',
    label: 'RARE',
  },
  epic: {
    frame: '#6D28D9',
    frameAlt: '#4C1D95',
    accent: '#8B5CF6',
    label: 'EPIC',
  },
  legendary: {
    frame: '#C2410C',
    frameAlt: '#7C2D12',
    accent: '#F97316',
    label: 'LGND',
  },
}

// ─── Stat config ──────────────────────────────────────────────────────────────

const STAT: Record<StatType, { glyph: string; color: string; label: string }> =
  {
    goals: { glyph: '⚽', color: '#F97316', label: 'GOALS' },
    cards: { glyph: '🟨', color: '#F5C842', label: 'CARDS' },
    corners: { glyph: '🚩', color: '#3CD8D8', label: 'CORNR' },
    shots: { glyph: '🎯', color: '#8B5CF6', label: 'SHOTS' },
    possession: { glyph: '🎽', color: '#22C55E', label: 'POSS' },
    other: { glyph: '📊', color: '#94969C', label: 'STAT' },
  }

// ─── Outcome badge ────────────────────────────────────────────────────────────

const OUTCOME_BADGE: Record<
  Outcome,
  { symbol: string; color: string; bg: string }
> = {
  hit: { symbol: '✓', color: '#0A0B0D', bg: '#22C55E' },
  miss: { symbol: '✗', color: '#F9F6EF', bg: '#EF4444' },
  pending: { symbol: '·', color: '#F9F6EF', bg: '#3A3D45' },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StickerArt({
  stat = 'goals',
  predicate = 'over',
  outcome = 'pending',
  rarity = 'common',
  size = 128,
  threshold,
  className,
}: Props) {
  const r = RARITY[rarity]
  const s = STAT[stat]
  const o = OUTCOME_BADGE[outcome]

  const predicateLabel =
    predicate === 'over' ? 'OVER' : predicate === 'under' ? 'UNDR' : 'XACT'
  const thresholdLabel =
    threshold != null ? String(threshold) : predicate === 'over' ? '1.5' : ''
  const bottomLabel = `${predicateLabel} ${thresholdLabel}`.trim()

  // Hex clip path for legendary, square for others
  const isLegendary = rarity === 'legendary'

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={`${s.label} sticker, ${rarity} rarity, ${outcome}`}
      className={cnm('select-none', className)}
    >
      <defs>
        <linearGradient
          id={`frame-${stat}-${rarity}`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop offset="0%" stopColor={r.frame} />
          <stop offset="100%" stopColor={r.frameAlt} />
        </linearGradient>

        {isLegendary && (
          <linearGradient id="legendary-shine" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.3" />
            <stop offset="50%" stopColor="#F5C842" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0.0" />
          </linearGradient>
        )}
      </defs>

      {/* Outer frame */}
      {isLegendary ? (
        // Hexagonal frame for legendary
        <polygon
          points="64,4 116,33 116,95 64,124 12,95 12,33"
          fill={`url(#frame-${stat}-${rarity})`}
          stroke={r.accent}
          strokeWidth="2"
        />
      ) : (
        <rect
          x="4"
          y="4"
          width="120"
          height="120"
          rx="4"
          ry="4"
          fill={`url(#frame-${stat}-${rarity})`}
          stroke={r.accent}
          strokeWidth="2"
        />
      )}

      {/* Inner content area */}
      {isLegendary ? (
        <polygon
          points="64,12 108,37 108,91 64,116 20,91 20,37"
          fill="#111318"
          opacity="0.9"
        />
      ) : (
        <rect
          x="12"
          y="12"
          width="104"
          height="104"
          rx="2"
          ry="2"
          fill="#111318"
          opacity="0.9"
        />
      )}

      {/* Legendary shimmer overlay */}
      {isLegendary && (
        <polygon
          points="64,12 108,37 108,91 64,116 20,91 20,37"
          fill="url(#legendary-shine)"
        />
      )}

      {/* Corner brackets (pixel-art detail) */}
      {/* TL */}
      <path
        d="M16,28 L16,20 L24,20"
        stroke={r.accent}
        strokeWidth="1.5"
        fill="none"
        opacity="0.7"
      />
      {/* BR */}
      <path
        d="M112,100 L112,108 L104,108"
        stroke={r.accent}
        strokeWidth="1.5"
        fill="none"
        opacity="0.7"
      />

      {/* Stat glyph — centered */}
      <text
        x="64"
        y="72"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="34"
        fontFamily="system-ui, sans-serif"
      >
        {s.glyph}
      </text>

      {/* Stat label */}
      <text
        x="64"
        y="92"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="8"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="2"
        fill={s.color}
      >
        {s.label}
      </text>

      {/* Bottom predicate label */}
      <text
        x="64"
        y="107"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="7"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="500"
        fill="#6E7079"
      >
        {bottomLabel}
      </text>

      {/* MOMENTUM wordmark */}
      <text
        x="64"
        y="118"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="5"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="2"
        fill={r.accent}
        opacity="0.6"
      >
        MOMENTUM
      </text>

      {/* Outcome badge — top right */}
      <rect x="94" y="16" width="18" height="18" rx="2" fill={o.bg} />
      <text
        x="103"
        y="25"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="10"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        fill={o.color}
      >
        {o.symbol}
      </text>

      {/* Rarity label — top left */}
      <rect
        x="16"
        y="16"
        width="20"
        height="10"
        rx="2"
        fill={r.accent}
        opacity="0.15"
      />
      <text
        x="26"
        y="21"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="5"
        fontFamily="JetBrains Mono, monospace"
        fontWeight="700"
        letterSpacing="1"
        fill={r.accent}
      >
        {r.label}
      </text>
    </svg>
  )
}
