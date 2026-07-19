/**
 * GroupLeaderboard
 *
 * Displays group members ranked by hit-rate (tiebreak: total hits).
 * Rows animate with framer-motion `layout` prop so reordering is smooth
 * when a new sticker mints and someone leapfrogs.
 *
 * Respects prefers-reduced-motion: layout animations only run when the user
 * has NOT requested reduced motion.
 */

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { cnm } from '@/utils/style'
import { shortenAddress } from '@/utils/big'
import { solscanAcct } from '@/utils/solscan'
import { useGroupLeaderboard } from '@/hooks/queries/useGroups'
import type { LeaderboardEntry } from '@/hooks/queries/useGroups'
import { SPRING_SMOOTH_TWO } from '@/config/animation'

// ─── Rank badge ───────────────────────────────────────────────────────────────

const RANK_STYLES: Record<number, string> = {
  1: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  2: 'bg-slate-400/15 text-slate-300 border-slate-400/25',
  3: 'bg-orange-700/20 text-orange-400 border-orange-700/30',
}

function RankBadge({ rank }: { rank: number }) {
  const style =
    RANK_STYLES[rank] ?? 'bg-ink-700 text-slate-500 border-white/[0.08]'
  return (
    <span
      className={cnm(
        'inline-flex items-center justify-center',
        'w-8 h-8 rounded-lg border font-mono text-xs font-bold shrink-0 tabular-nums',
        style,
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  )
}

// ─── Leaderboard row ──────────────────────────────────────────────────────────

interface RowProps {
  entry: LeaderboardEntry
  rank: number
  shouldAnimate: boolean
}

function LeaderboardRow({ entry, rank, shouldAnimate }: RowProps) {
  const decided = entry.hitCount + entry.missCount
  const hitRatePct =
    decided > 0 ? `${Math.round(entry.hitRate * 100)}%` : '—'

  return (
    <motion.div
      layout={shouldAnimate}
      layoutId={entry.wallet}
      transition={shouldAnimate ? SPRING_SMOOTH_TWO : undefined}
      className={cnm(
        'flex items-center gap-3 px-4 py-3',
        'border-b border-white/[0.05] last:border-0',
        'hover:bg-white/[0.02] transition-colors rounded-[var(--radius-sm)]',
      )}
    >
      <RankBadge rank={rank} />

      {/* Avatar blockie */}
      <div
        className="w-7 h-7 rounded-full bg-ink-700 border border-white/[0.08] flex items-center justify-center shrink-0 overflow-hidden"
        aria-hidden="true"
      >
        <span className="font-mono text-[10px] text-slate-400">
          {entry.wallet.slice(0, 2)}
        </span>
      </div>

      {/* Wallet */}
      <div className="flex-1 min-w-0">
        <a
          href={solscanAcct(entry.wallet)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-sui-500 hover:underline underline-offset-4 truncate block"
        >
          {shortenAddress(entry.wallet, 5, 4)}
        </a>
      </div>

      {/* HITs / total */}
      <span className="font-mono text-xs text-slate-400 tabular-nums shrink-0">
        {entry.hitCount}
        <span className="text-slate-600">/{decided || '—'}</span>
      </span>

      {/* Hit rate */}
      <span
        className={cnm(
          'font-mono text-xs tabular-nums shrink-0 w-10 text-right',
          entry.hitRate >= 0.6
            ? 'text-success-500'
            : entry.hitRate >= 0.4
              ? 'text-cream-50'
              : 'text-slate-400',
        )}
      >
        {hitRatePct}
      </span>
    </motion.div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.05] last:border-0 animate-pulse">
      <div className="w-8 h-8 rounded-lg bg-ink-700 shrink-0" />
      <div className="w-7 h-7 rounded-full bg-ink-700 shrink-0" />
      <div className="flex-1 h-3 bg-ink-700 rounded" />
      <div className="w-10 h-3 bg-ink-700 rounded" />
      <div className="w-8 h-3 bg-ink-700 rounded" />
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  groupPda: string
}

export function GroupLeaderboard({ groupPda }: Props) {
  const { data, isLoading, isError } = useGroupLeaderboard(groupPda)
  const prefersReducedMotion = useReducedMotion() ?? false

  if (isLoading) {
    return (
      <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
          Leaderboard
        </p>
        <div>
          {Array.from({ length: 5 }).map((_, i) => (
            <RowSkeleton key={i} />
          ))}
        </div>
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
          Leaderboard
        </p>
        <p className="text-xs text-slate-600 italic">
          Couldn't load leaderboard.
        </p>
      </div>
    )
  }

  const { leaderboard } = data

  return (
    <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500">
          Leaderboard
        </p>
        <span className="text-[10px] font-mono text-slate-600 tabular-nums">
          {data.memberCount} member{data.memberCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Column labels */}
      {leaderboard.length > 0 && (
        <div className="flex items-center gap-3 px-4 mb-1">
          <div className="w-8 shrink-0" />
          <div className="w-7 shrink-0" />
          <div className="flex-1" />
          <span className="text-[10px] font-mono text-slate-600 w-auto shrink-0">
            H/T
          </span>
          <span className="text-[10px] font-mono text-slate-600 w-10 text-right shrink-0">
            Rate
          </span>
        </div>
      )}

      {leaderboard.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-slate-500 mb-1">No members yet.</p>
          <p className="text-xs text-slate-600">
            Share the Blink to invite friends.
          </p>
        </div>
      ) : (
        <AnimatePresence initial={false}>
          {leaderboard.map((entry, i) => (
            <LeaderboardRow
              key={entry.wallet}
              entry={entry}
              rank={i + 1}
              shouldAnimate={!prefersReducedMotion}
            />
          ))}
        </AnimatePresence>
      )}

      {/* Note */}
      <p className="mt-3 text-[10px] font-mono text-slate-700 leading-relaxed">
        {data.note}
      </p>
    </div>
  )
}
