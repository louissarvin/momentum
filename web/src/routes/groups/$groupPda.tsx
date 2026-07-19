import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@heroui/react'
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Loader2,
  RefreshCw,
  Users,
} from 'lucide-react'
import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import type { Group, Membership } from '@/lib/api/types'
import { groupsApi } from '@/lib/api/endpoints'
import { useJoinGroup } from '@/hooks/mutations/useGroupMutations'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/useToast'
import { ToastStack } from '@/components/ui/ToastStack'
import { lamportsToSol, shortenAddress } from '@/utils/big'
import { solscanAcct } from '@/utils/solscan'
import { env } from '@/env'
import { cnm } from '@/utils/style'
import AnimateComponent from '@/components/elements/AnimateComponent'
import { GroupLeaderboard } from '@/components/GroupLeaderboard'

export const Route = createFileRoute('/groups/$groupPda')({
  component: GroupLobbyPage,
})

// ─── Blink URL ────────────────────────────────────────────────────────────────

function blinkUrl(groupPda: string): string {
  const apiUrl = env.VITE_API_URL
  const actionUrl = `${apiUrl}/api/actions/join-group/${encodeURIComponent(groupPda)}`
  return `https://dial.to/?action=${encodeURIComponent(`solana-action:${actionUrl}`)}`
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => null)
  }

  return (
    <button
      onClick={handleCopy}
      className={cnm(
        'inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-mono',
        'border transition-colors duration-150 focus-ring',
        copied
          ? 'bg-success-500/15 border-success-500/30 text-success-500'
          : 'bg-ink-700 border-white/[0.1] text-slate-400 hover:text-cream-50',
      )}
      aria-label={label}
    >
      {copied ? (
        <Check size={11} strokeWidth={1.75} />
      ) : (
        <Copy size={11} strokeWidth={1.75} />
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// ─── Member row ───────────────────────────────────────────────────────────────

function MemberRow({
  membership,
  isCreator,
  isYou,
}: {
  membership: Membership
  isCreator: boolean
  isYou: boolean
}) {
  const short = shortenAddress(membership.userWallet)

  return (
    <div className="flex items-center gap-3 py-3 border-b border-white/[0.06] last:border-0 hover:bg-white/[0.02] transition-colors px-4 -mx-4 rounded-[var(--radius-sm)]">
      <div className="w-7 h-7 rounded-full bg-ink-700 border border-white/[0.08] flex items-center justify-center shrink-0">
        <span className="text-xs font-mono text-slate-400">
          {short.slice(0, 2)}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <a
          href={solscanAcct(membership.userWallet)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-xs text-sui-500 hover:underline underline-offset-4 truncate block"
        >
          {short}
        </a>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isYou && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 bg-ink-700 px-2 py-0.5 rounded-full">
            You
          </span>
        )}
        {isCreator && (
          <span className="text-[10px] font-mono uppercase tracking-widest text-accent-500 bg-accent-500/10 px-2 py-0.5 rounded-full">
            Owner
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Join button ─────────────────────────────────────────────────────────────

function JoinSection({ group, isMember }: { group: Group; isMember: boolean }) {
  const { connected } = useWallet()
  const { setVisible } = useWalletModal()
  const { isAuthenticated, login, loading: authLoading } = useAuth()
  const joinGroup = useJoinGroup()
  const { toasts, show: showToast, dismiss } = useToast()

  const fee = lamportsToSol(group.entryFeeLamports)
  const isFull = group.currentSize >= group.maxSize

  async function handleJoin() {
    if (!connected) {
      setVisible(true)
      return
    }
    if (!isAuthenticated) {
      try {
        await login()
      } catch {
        showToast('error', 'Sign-in failed. Please try again.')
        return
      }
    }

    try {
      await joinGroup.mutateAsync(group.groupPda)
      showToast('success', `Joined ${group.name}.`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to join'
      if (msg.includes('declined') || msg.includes('rejected')) {
        showToast('error', 'Wallet declined the transaction.')
      } else {
        showToast('error', msg)
      }
    }
  }

  if (isMember) {
    return null
  }

  return (
    <>
      <div className="p-5 rounded-[var(--radius-xl)] bg-ink-800 border border-white/[0.08]">
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
          Join this group
        </p>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-slate-400">Entry fee</p>
          <p className="font-mono text-sm text-accent-500 tabular-nums">
            {fee === 0 ? 'Free' : `${fee.toFixed(3)} SOL`}
          </p>
        </div>
        <button
          onClick={handleJoin}
          disabled={joinGroup.isPending || authLoading || isFull}
          className={cnm(
            'w-full inline-flex items-center justify-center gap-2 h-11 rounded-full font-semibold text-sm',
            'transition-all duration-150 focus-ring active:scale-[0.97]',
            joinGroup.isPending || authLoading
              ? 'bg-accent-500/40 text-ink-900/60 cursor-not-allowed'
              : isFull
                ? 'bg-ink-700 text-slate-500 cursor-not-allowed border border-white/[0.06]'
                : 'bg-accent-500 text-ink-900 hover:bg-accent-600',
          )}
        >
          {(joinGroup.isPending || authLoading) && (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
          )}
          {isFull
            ? 'Group is full'
            : joinGroup.isPending
              ? 'Joining…'
              : 'Join group'}
        </button>
      </div>
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function LobbySkeletonContent() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 rounded-[var(--radius-xl)] pixel-shimmer bg-ink-800" />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
        <Skeleton className="h-64 rounded-[var(--radius-lg)] pixel-shimmer bg-ink-800" />
        <Skeleton className="h-40 rounded-[var(--radius-xl)] pixel-shimmer bg-ink-800" />
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function GroupLobbyPage() {
  const { groupPda } = Route.useParams()
  const { publicKey } = useWallet()
  const walletAddr = publicKey?.toBase58() ?? ''

  const {
    data: group,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['groups', groupPda],
    queryFn: () => groupsApi.get(groupPda),
    staleTime: 20_000,
    refetchInterval: 30_000,
    enabled: !!groupPda,
  })

  const isMember = walletAddr
    ? (group?.memberships ?? []).some((m) => m.userWallet === walletAddr)
    : false

  const blink = blinkUrl(groupPda)

  return (
    <div className="min-h-screen bg-ink-900">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6 py-12 md:py-16">
        {/* Back */}
        <AnimateComponent entry="fadeInUp" duration={300}>
          <Link
            to="/groups"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-cream-50 transition-colors mb-8 focus-ring rounded-full"
          >
            <ArrowLeft size={14} strokeWidth={1.75} />
            All groups
          </Link>
        </AnimateComponent>

        {isLoading && <LobbySkeletonContent />}

        {isError && (
          <div className="flex flex-col items-center py-24 text-center">
            <p className="text-base font-semibold text-cream-50 mb-2">
              Couldn't load this group.
            </p>
            <button
              onClick={() => refetch()}
              className="mt-4 inline-flex items-center gap-2 px-5 h-10 rounded-full bg-ink-700 border border-white/[0.1] text-cream-50 text-sm font-semibold"
            >
              <RefreshCw size={14} strokeWidth={1.75} />
              Retry
            </button>
          </div>
        )}

        {group && (
          <div className="space-y-8">
            {/* Group hero */}
            <AnimateComponent entry="fadeInUp" duration={500}>
              <div className="p-8 rounded-[var(--radius-xl)] bg-ink-800 border border-white/[0.08]">
                <div className="flex flex-col md:flex-row md:items-start gap-4 justify-between">
                  <div>
                    <p className="text-xs font-mono uppercase tracking-[0.12em] text-accent-500 mb-2">
                      Group Lobby
                    </p>
                    <h1 className="text-2xl md:text-3xl font-bold text-cream-50 tracking-[-0.015em] mb-4">
                      {group.name}
                    </h1>
                    <div className="flex flex-wrap gap-4">
                      <div className="flex items-center gap-1.5">
                        <Users
                          size={14}
                          strokeWidth={1.75}
                          className="text-slate-500"
                        />
                        <span className="font-mono text-sm text-slate-400 tabular-nums">
                          {group.currentSize}/{group.maxSize} members
                        </span>
                      </div>
                      <div>
                        <span className="font-mono text-sm text-accent-500 tabular-nums">
                          {lamportsToSol(group.entryFeeLamports) === 0
                            ? 'Free entry'
                            : `${lamportsToSol(group.entryFeeLamports).toFixed(3)} SOL entry`}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Creator chip */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-mono text-slate-500">
                      Creator:
                    </span>
                    <a
                      href={solscanAcct(group.creator)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-sui-500 hover:underline underline-offset-4"
                    >
                      {shortenAddress(group.creator)}
                    </a>
                  </div>
                </div>
              </div>
            </AnimateComponent>

            {/* Leaderboard */}
            <AnimateComponent entry="fadeInUp" duration={400} delay={80}>
              <GroupLeaderboard groupPda={groupPda} />
            </AnimateComponent>

            {/* Main layout */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
              {/* Members list */}
              <AnimateComponent entry="fadeInUp" duration={400} delay={100}>
                <div className="p-6 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
                    Members
                  </p>
                  {(group.memberships ?? []).length === 0 ? (
                    <div className="flex flex-col items-center py-12 text-center">
                      <p className="text-sm text-slate-500 mb-1">
                        No members yet.
                      </p>
                      <p className="text-xs text-slate-600">
                        Share the invite link to bring your crew.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {(group.memberships ?? []).map((m) => (
                        <MemberRow
                          key={m.userWallet}
                          membership={m}
                          isCreator={m.userWallet === group.creator}
                          isYou={m.userWallet === walletAddr}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </AnimateComponent>

              {/* Right panel */}
              <div className="space-y-4">
                {/* Join section */}
                <AnimateComponent entry="fadeInUp" duration={400} delay={150}>
                  <JoinSection group={group} isMember={isMember} />
                </AnimateComponent>

                {/* Blink invite */}
                <AnimateComponent entry="fadeInUp" duration={400} delay={200}>
                  <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
                    <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                      Invite via Blink
                    </p>
                    <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                      Share this link so anyone can join directly from a Solana
                      Blink.
                    </p>
                    <div className="flex items-center gap-2">
                      <a
                        href={blink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 font-mono text-[10px] text-sui-500 hover:underline underline-offset-4 truncate"
                      >
                        <Link2
                          size={11}
                          strokeWidth={1.75}
                          className="inline mr-1"
                        />
                        dial.to invite
                      </a>
                      <CopyButton text={blink} label="Copy Blink invite link" />
                    </div>
                  </div>
                </AnimateComponent>

                {/* Activity feed — placeholder for SSE (W-D) */}
                <AnimateComponent entry="fadeInUp" duration={400} delay={250}>
                  <div className="p-5 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
                    <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-3">
                      Activity
                    </p>
                    <p className="text-xs text-slate-600 italic">
                      Live activity feed wires in Phase W-D.
                    </p>
                  </div>
                </AnimateComponent>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
