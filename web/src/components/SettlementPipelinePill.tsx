/**
 * SettlementPipelinePill — fixed overlay that appears when a settlement job
 * is in-flight for the current fixture.
 *
 * State machine:
 *   settlement_started  → Awaiting → (1s) Verifying → (2s) Minting
 *   sticker_minted      → Confirmed → (3s auto-dismiss)
 *   settlement_error    → Error (dismissable)
 *
 * Multiple concurrent jobs are queued; one shown at a time.
 * Position: fixed top-24 right-6, below pillnav.
 * Mobile: icon-only pill when width < sm.
 */

import { useEffect, useRef, useState } from 'react'
import { cnm } from '@/utils/style'

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage = 'awaiting' | 'verifying' | 'minting' | 'confirmed' | 'error'

interface PillJob {
  jobId: string
  seq?: number | null
  statKey?: string | null
  error?: string
}

interface SettlementPipelinePillProps {
  /** Settlement jobs queued for this fixture. */
  queue: PillJob[]
  /** Call when a sticker_minted arrives that should advance current job to Confirmed. */
  completedJobId?: string | null
  onDismiss?: (jobId: string) => void
}

// ─── Stage config ─────────────────────────────────────────────────────────────

const STAGE_META: Record<
  Stage,
  { icon: string; label: string; color: string }
> = {
  awaiting: {
    icon: '◌',
    label: 'Fetching TxLINE proof',
    color: '#4DA2FF',
  },
  verifying: {
    icon: '◌',
    label: 'Merkle-verifying via txoracle',
    color: '#F5C842',
  },
  minting: {
    icon: '◌',
    label: 'Minting cNFT via Bubblegum',
    color: '#F97316',
  },
  confirmed: {
    icon: '✓',
    label: 'Sticker minted',
    color: '#22C55E',
  },
  error: {
    icon: '✗',
    label: 'Settlement failed',
    color: '#EF4444',
  },
}

const PIPELINE_STAGES: Stage[] = ['awaiting', 'verifying', 'minting']

// ─── Component ────────────────────────────────────────────────────────────────

export function SettlementPipelinePill({
  queue,
  completedJobId,
  onDismiss,
}: SettlementPipelinePillProps) {
  const [stage, setStage] = useState<Stage>('awaiting')
  const [currentJob, setCurrentJob] = useState<PillJob | null>(null)
  const [visible, setVisible] = useState(false)
  const stageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const processedRef = useRef<Set<string>>(new Set())

  // Advance through pipeline stages automatically
  function advanceStages(startStage: Stage) {
    clearStageTimers()
    setStage(startStage)

    if (startStage === 'awaiting') {
      stageTimerRef.current = setTimeout(() => {
        setStage('verifying')
        stageTimerRef.current = setTimeout(() => {
          setStage('minting')
        }, 2000)
      }, 1000)
    } else if (startStage === 'verifying') {
      stageTimerRef.current = setTimeout(() => {
        setStage('minting')
      }, 2000)
    }
  }

  function clearStageTimers() {
    if (stageTimerRef.current) clearTimeout(stageTimerRef.current)
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
  }

  function dismiss(jobId: string) {
    clearStageTimers()
    setVisible(false)
    setCurrentJob(null)
    onDismiss?.(jobId)
  }

  // Pick up new jobs from queue
  useEffect(() => {
    if (!queue.length) return

    const unprocessed = queue.filter((j) => !processedRef.current.has(j.jobId))
    if (!unprocessed.length) return

    const next = unprocessed[0]
    if (!next) return

    // Only take over if not currently showing a terminal state
    if (!currentJob || stage === 'confirmed' || stage === 'error') {
      processedRef.current.add(next.jobId)

      if (next.error) {
        clearStageTimers()
        setStage('error')
        setCurrentJob(next)
        setVisible(true)
      } else if (completedJobId === next.jobId) {
        // completedJobId already arrived before the queue — go straight to Confirmed
        clearStageTimers()
        setStage('confirmed')
        setCurrentJob(next)
        setVisible(true)
        dismissTimerRef.current = setTimeout(() => dismiss(next.jobId), 3000)
      } else {
        setCurrentJob(next)
        setVisible(true)
        advanceStages('awaiting')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue])

  // sticker_minted triggers Confirmed
  useEffect(() => {
    if (!completedJobId || !currentJob) return
    if (completedJobId !== currentJob.jobId) return
    if (stage === 'confirmed' || stage === 'error') return

    clearStageTimers()
    setStage('confirmed')

    dismissTimerRef.current = setTimeout(() => {
      dismiss(currentJob.jobId)
    }, 3000)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedJobId])

  // Cleanup on unmount
  useEffect(() => {
    return () => clearStageTimers()
  }, [])

  if (!visible || !currentJob) return null

  const meta = STAGE_META[stage]
  const isSpinning =
    stage === 'awaiting' || stage === 'verifying' || stage === 'minting'
  const isError = stage === 'error'

  const seqLabel = currentJob.seq != null ? ` · seq ${currentJob.seq}` : ''

  return (
    <div
      role="status"
      aria-live="polite"
      className={cnm(
        'fixed top-24 right-6 z-50',
        'max-w-[280px] sm:max-w-xs',
        'rounded-[var(--radius-lg)] border bg-ink-800/95 backdrop-blur-sm',
        'shadow-[var(--shadow-elevated)]',
        'transition-all duration-200',
        isError ? 'border-error-500/30' : 'border-accent-500/25',
      )}
    >
      {/* Corner-bracket frame accent */}
      <div
        className="rounded-2xl absolute inset-0 rounded-[var(--radius-lg)] pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative px-3 py-2.5">
        {/* Header row */}
        <div className="flex items-center justify-between gap-3 mb-2">
          <span
            className="text-[10px] font-mono uppercase tracking-[0.12em]"
            style={{ color: meta.color }}
          >
            Settlement pipeline
          </span>
          {(isError || stage === 'confirmed') && (
            <button
              onClick={() => dismiss(currentJob.jobId)}
              className="text-slate-500 hover:text-cream-50 transition-colors text-[10px] font-mono leading-none focus-ring rounded"
              aria-label="Dismiss"
            >
              ✕
            </button>
          )}
        </div>

        {/* Stage pipeline dots — hidden on mobile */}
        <div className="hidden sm:flex items-center gap-1.5 mb-2.5">
          {PIPELINE_STAGES.map((s, i) => {
            const stageOrder: Record<Stage, number> = {
              awaiting: 0,
              verifying: 1,
              minting: 2,
              confirmed: 3,
              error: -1,
            }
            const current = stageOrder[stage]
            const past = current > i
            const active = current === i

            return (
              <div key={s} className="flex items-center gap-1.5">
                <div
                  className={cnm(
                    'w-1.5 h-1.5 rounded-full transition-all duration-300',
                    isError
                      ? 'bg-error-500/40'
                      : active
                        ? 'bg-accent-500'
                        : past
                          ? 'bg-success-500'
                          : 'bg-ink-600 border border-white/[0.08]',
                    active && isSpinning && 'animate-pulse',
                  )}
                />
                {i < PIPELINE_STAGES.length - 1 && (
                  <div
                    className={cnm(
                      'w-4 h-px transition-all duration-300',
                      past ? 'bg-success-500/60' : 'bg-white/[0.08]',
                    )}
                  />
                )}
              </div>
            )
          })}
          {/* Terminal state dot */}
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-px bg-white/[0.08]" />
            <div
              className={cnm(
                'w-1.5 h-1.5 rounded-full transition-all duration-300',
                stage === 'confirmed'
                  ? 'bg-success-500'
                  : stage === 'error'
                    ? 'bg-error-500'
                    : 'bg-ink-600 border border-white/[0.08]',
              )}
            />
          </div>
        </div>

        {/* Status line */}
        <div className="flex items-center gap-2">
          <span
            className={cnm(
              'font-mono text-xs shrink-0',
              isSpinning && 'animate-[spin_1s_linear_infinite] inline-block',
            )}
            style={{ color: meta.color }}
            aria-hidden="true"
          >
            {meta.icon}
          </span>
          <span className="font-mono text-xs text-slate-300 truncate">
            {isError && currentJob.error
              ? currentJob.error
              : meta.label + seqLabel}
          </span>
        </div>
      </div>
    </div>
  )
}
