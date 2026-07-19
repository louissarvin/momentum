/**
 * ReplayModeBanner
 *
 * Persistent pill shown in the live-view header when the replay worker is
 * active. Gives judges clear visual feedback that archived score packets are
 * being re-fired through the pipeline — not a broken or faked stream.
 *
 * Hidden when replay is inactive (returns null).
 * Respects prefers-reduced-motion: pulse animation is disabled when the user
 * prefers reduced motion.
 */

import { useEffect, useRef, useState } from 'react'
import { cnm } from '@/utils/style'
import { useReplayStatus } from '@/hooks/queries/useReplayStatus'

interface Props {
  /** Optional override for the fixture label (e.g. "Arsenal vs Chelsea"). */
  fixtureLabel?: string
}

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function ReplayModeBanner({ fixtureLabel }: Props) {
  const { data: status } = useReplayStatus()

  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Tick elapsed timer every second from startedAt.
  // Effect re-runs when active/startedAt changes.
  const isActive = status?.active === true
  const startedAt = status?.startedAt ?? null

  useEffect(() => {
    if (!isActive || !startedAt) {
      setElapsed(0)
      return
    }

    const startMs = new Date(startedAt).getTime()

    function tick() {
      setElapsed(Date.now() - startMs)
    }

    tick()
    intervalRef.current = setInterval(tick, 1000)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isActive, startedAt])

  if (!isActive) return null

  const label =
    fixtureLabel ??
    (status?.fixtureId ? `Fixture ${status.fixtureId}` : 'Replay')

  return (
    <div
      className={cnm(
        'inline-flex items-center gap-2',
        'bg-accent-500 text-ink-900',
        'rounded-full px-3 py-1.5',
        'select-none shrink-0',
      )}
      role="status"
      aria-label={`Replay mode active: ${label}`}
    >
      {/* Pulsing dot */}
      <span
        className={cnm(
          'inline-block w-2 h-2 rounded-full bg-ink-900/40 shrink-0',
          'motion-safe:animate-pulse',
        )}
        aria-hidden="true"
      />

      {/* Label */}
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] whitespace-nowrap">
        Replaying
      </span>

      <span className="hidden sm:inline text-[11px] font-semibold opacity-70 truncate max-w-[160px]">
        · {label}
      </span>

      {/* Elapsed timer */}
      <span className="font-mono text-[11px] tabular-nums whitespace-nowrap">
        · {formatElapsed(elapsed)}
      </span>
    </div>
  )
}
