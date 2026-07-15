import { useQuery } from '@tanstack/react-query'
import { cnm } from '@/utils/style'

// Matches backend /health shape (backend/src/routes/health.ts).
type WorkerStatus = 'live' | 'stale' | 'not_started' | string
type TxlineAuthStatus = 'live' | 'expired' | 'not_initialized' | string

interface HealthData {
  status: string
  version?: string
  solana?: { cluster?: string; programId?: string; keeper?: string }
  txlineAuth?: TxlineAuthStatus
  txlineJwtValidHours?: number
  workers?: {
    ingester?: WorkerStatus
    settler?: WorkerStatus
    replay?: WorkerStatus
  }
  backlog?: {
    pending?: number
    inProgress?: number
    errored?: number
    doneLast24h?: number
  }
  marketplace?: {
    activeListings?: number
    salesLast24h?: number
  }
  replayMode?: { active?: boolean }
}

function Dot({ ok, pulse }: { ok: boolean; pulse?: boolean }) {
  return (
    <span
      className={cnm(
        'inline-block w-2 h-2 rounded-full shrink-0',
        ok ? 'bg-success-500' : 'bg-error-500',
        ok && pulse && 'animate-[live-pulse_1.6s_ease-in-out_infinite]',
      )}
      aria-hidden="true"
    />
  )
}

function Row({
  label,
  ok,
  value,
}: {
  label: string
  ok: boolean
  value?: string
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2">
        <Dot ok={ok} pulse={ok} />
        <span className="text-xs font-mono text-slate-400">{label}</span>
      </div>
      {value && (
        <span className="text-xs font-mono text-slate-500 tabular-nums">
          {value}
        </span>
      )}
    </div>
  )
}

export default function HealthWidget() {
  const { data, isLoading, isError } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await fetch('http://localhost:3700/health')
      if (!res.ok) throw new Error('unreachable')
      return res.json() as Promise<HealthData>
    },
    refetchInterval: 5_000,
    retry: 1,
  })

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-ink-800 border border-white/[0.08] p-4">
        <div className="pixel-shimmer h-4 w-28 rounded mb-3" />
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="pixel-shimmer h-3 w-full rounded mb-2" />
        ))}
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="rounded-3xl bg-ink-800 border border-white/[0.08] p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block w-2 h-2 rounded-full bg-error-500 shrink-0" />
          <p className="text-xs font-mono uppercase tracking-[0.08em] text-slate-500">
            Live Status
          </p>
        </div>
        <p className="text-xs font-mono text-slate-600">
          Backend offline — start with{' '}
          <code className="bg-ink-900 px-1 rounded">bun run dev</code> in
          /backend.
        </p>
      </div>
    )
  }

  const apiOk = data.status === 'ok'
  const txlineOk = data.txlineAuth === 'live'
  const ingesterOk = data.workers?.ingester === 'live'
  const settlerOk = data.workers?.settler === 'live'
  const replayActive = data.replayMode?.active === true
  const cluster = data.solana?.cluster ?? 'devnet'
  const txlineHours =
    typeof data.txlineJwtValidHours === 'number'
      ? Math.round(data.txlineJwtValidHours)
      : null

  return (
    <div className="rounded-3xl bg-ink-800 border border-white/[0.08] p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-slate-500">
          Live Status
        </p>
        <span className="text-[10px] font-mono text-slate-700">{cluster}</span>
      </div>

      <Row label="API" ok={apiOk} value={apiOk ? 'healthy' : 'down'} />

      <Row
        label="TxLINE auth"
        ok={txlineOk}
        value={
          txlineHours != null
            ? `${txlineHours}h remaining`
            : String(data.txlineAuth ?? 'unknown')
        }
      />

      <Row
        label="Ingester"
        ok={ingesterOk || replayActive}
        value={
          replayActive
            ? 'replay'
            : ingesterOk
              ? 'live'
              : (data.workers?.ingester ?? 'down')
        }
      />

      <Row
        label="Settler"
        ok={settlerOk}
        value={settlerOk ? 'running' : (data.workers?.settler ?? 'down')}
      />

      {data.backlog && (
        <Row
          label="Settlements"
          ok={(data.backlog.pending ?? 0) < 10}
          value={`${data.backlog.pending ?? 0} pending · ${data.backlog.doneLast24h ?? 0} done 24h`}
        />
      )}

      {data.marketplace && (
        <Row
          label="Marketplace"
          ok={true}
          value={`${data.marketplace.activeListings ?? 0} listings · ${data.marketplace.salesLast24h ?? 0} sales 24h`}
        />
      )}

      {data.version && (
        <p className="mt-3 text-[10px] font-mono text-slate-700 tabular-nums">
          v{data.version}
        </p>
      )}
    </div>
  )
}
