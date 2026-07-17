/**
 * /profile/$wallet — public user profile page.
 *
 * Data: GET /api/users/:wallet
 * If viewer is the owner, shows "Share your profile" button.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@solana/wallet-adapter-react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { cnm } from '@/utils/style'
import { userProfileOptions } from '@/lib/api/endpoints'
import { shortenAddress } from '@/utils/big'
import { solscanAcct } from '@/utils/solscan'
import AnimateComponent from '@/components/elements/AnimateComponent'

export const Route = createFileRoute('/profile/$wallet')({
  component: ProfilePage,
})

// ─── Stat grid tile ───────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 p-4 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08]">
      <span className="font-mono text-2xl font-bold text-cream-50 tabular-nums">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
      <span className="text-xs font-mono uppercase tracking-[0.1em] text-slate-500">
        {label}
      </span>
    </div>
  )
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(text).catch(() => null)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <button
      onClick={handleCopy}
      aria-label="Copy address"
      className={cnm(
        'p-1.5 rounded-full transition-colors duration-150 focus-ring',
        'text-slate-400 hover:text-cream-50 hover:bg-white/[0.06]',
      )}
    >
      {copied ? (
        <Check size={14} strokeWidth={1.75} className="text-success-500" />
      ) : (
        <Copy size={14} strokeWidth={1.75} />
      )}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ProfilePage() {
  const { wallet: walletParam } = Route.useParams()
  const { publicKey } = useWallet()

  // Security: validate the wallet param looks like a base58 address
  // before firing a request. Reject anything that could be a path-traversal
  // or injection attempt.
  const isValidAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(walletParam)

  const {
    data: profile,
    isLoading,
    isError,
  } = useQuery({
    ...userProfileOptions(walletParam),
    enabled: isValidAddress,
  })

  const isOwner = publicKey?.toBase58() === walletParam

  function handleShareProfile() {
    navigator.clipboard.writeText(window.location.href).catch(() => null)
  }

  if (!isValidAddress) {
    return (
      <div className="min-h-screen bg-ink-900 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="font-mono text-sm text-error-500">
            Invalid wallet address.
          </p>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-accent-500 hover:underline"
          >
            Back to home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-ink-900 pt-24 pb-20">
      <div className="mx-auto w-full max-w-[1120px] px-4 md:px-6">
        {/* Hero */}
        <AnimateComponent entry="fadeInUp">
          <div
            className={cnm(
              'rounded-3xl relative',
              'p-8 rounded-[var(--radius-2xl)] bg-ink-800 border border-white/[0.08]',
              'mb-8',
            )}
          >

            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
              {/* Avatar placeholder */}
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center shrink-0 font-mono text-xl font-bold"
                style={{
                  background: 'rgba(249,115,22,0.15)',
                  color: '#F97316',
                }}
                aria-hidden="true"
              >
                {walletParam.slice(0, 2).toUpperCase()}
              </div>

              <div className="flex-1 min-w-0">
                {/* Short address + copy + Solscan */}
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-xl font-bold text-cream-50">
                    {shortenAddress(walletParam, 6, 6)}
                  </span>
                  <CopyButton text={walletParam} />
                  <a
                    href={solscanAcct(walletParam)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-sui-500 hover:text-cream-50 transition-colors"
                    aria-label="View on Solscan"
                  >
                    Solscan
                    <ExternalLink size={11} strokeWidth={1.75} />
                  </a>
                </div>

                {/* Full address — mono, truncated */}
                <p className="font-mono text-xs text-slate-500 truncate max-w-[420px]">
                  {walletParam}
                </p>

                {profile?.memberSince && (
                  <p className="text-xs text-slate-500 mt-1">
                    Member since{' '}
                    {new Date(profile.memberSince).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </p>
                )}
              </div>

              {isOwner && (
                <button
                  onClick={handleShareProfile}
                  className={cnm(
                    'shrink-0 inline-flex items-center gap-2 h-9 px-4 rounded-full',
                    'bg-ink-700 border border-white/[0.1] text-xs font-semibold text-cream-50',
                    'hover:border-white/20 transition-colors focus-ring',
                  )}
                >
                  <Copy size={13} strokeWidth={1.75} />
                  Share profile
                </button>
              )}
            </div>
          </div>
        </AnimateComponent>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className="h-20 rounded-[var(--radius-lg)] bg-ink-800 border border-white/[0.08] animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Error / empty state */}
        {isError && !isLoading && (
          <AnimateComponent entry="fadeInUp">
            <div className="text-center py-20">
              <p className="font-mono text-4xl mb-4" aria-hidden="true">
                ⚽
              </p>
              <p className="text-lg font-semibold text-cream-50 mb-2">
                This wallet hasn&apos;t predicted yet
              </p>
              <p className="text-sm text-slate-400 mb-6">
                No predictions found for this address.
              </p>
              <Link
                to="/fixtures"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent-500 text-ink-900 text-sm font-semibold hover:bg-accent-600 transition-colors focus-ring"
              >
                Browse fixtures
              </Link>
            </div>
          </AnimateComponent>
        )}

        {/* Stats grid */}
        {profile && !isLoading && (
          <>
            <AnimateComponent onScroll entry="fadeInUp">
              <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
                Stats
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
                <StatCard
                  label="Predictions"
                  value={profile.stats.predictionsSubmitted}
                />
                <StatCard label="Hits" value={profile.stats.slotsHit} />
                <StatCard label="Misses" value={profile.stats.slotsMissed} />
                <StatCard
                  label="Hit rate"
                  value={`${(profile.stats.hitRate * 100).toFixed(1)}%`}
                />
                <StatCard
                  label="Stickers"
                  value={profile.stats.stickersOwned}
                />
                <StatCard
                  label="Match cards"
                  value={profile.stats.matchCardsClaimed}
                />
                <StatCard label="Groups" value={profile.stats.groupsJoined} />
                <StatCard
                  label="Listings"
                  value={profile.stats.listingsCreated}
                />
                <StatCard label="Sales" value={profile.stats.salesCompleted} />
              </div>
            </AnimateComponent>

            {/* Recent activity */}
            {profile.recentActivity.length > 0 && (
              <AnimateComponent onScroll entry="fadeInUp">
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-slate-500 mb-4">
                  Recent activity
                </p>
                <div className="rounded-[var(--radius-xl)] bg-ink-800 border border-white/[0.08] overflow-hidden">
                  {profile.recentActivity.slice(0, 10).map((event, i) => (
                    <div
                      key={i}
                      className={cnm(
                        'flex items-center gap-4 px-5 py-3',
                        'border-b border-white/[0.05] last:border-0',
                        'hover:bg-white/[0.02] transition-colors',
                      )}
                    >
                      <span className="font-mono text-[10px] uppercase tracking-widest text-accent-500 w-20 shrink-0">
                        {event.type}
                      </span>
                      <span className="text-sm text-cream-50 flex-1 min-w-0 truncate">
                        {event.description}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        {event.txSig && (
                          <a
                            href={`https://solscan.io/tx/${encodeURIComponent(event.txSig)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sui-500 hover:text-cream-50 transition-colors"
                            aria-label="View transaction"
                          >
                            <ExternalLink size={12} strokeWidth={1.75} />
                          </a>
                        )}
                        <span className="font-mono text-xs text-slate-500">
                          {new Date(event.at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </AnimateComponent>
            )}
          </>
        )}
      </div>
    </div>
  )
}
