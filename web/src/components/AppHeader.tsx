import { useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from '@heroui/react'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  Menu,
  User,
  Wallet,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import { cnm } from '@/utils/style'
import { shortenAddress } from '@/utils/big'
import { solscanAcct } from '@/utils/solscan'
import { useAuth } from '@/hooks/useAuth'
import { ThemeToggle } from '@/components/ui/ThemeToggle'

const NAV_LINKS = [
  { label: 'Fixtures', to: '/fixtures' },
  { label: 'Groups', to: '/groups' },
  { label: 'Album', to: '/album' },
  { label: 'Market', to: '/market' },
  { label: 'Docs', to: '/docs' },
] as const

export default function AppHeader() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { setVisible } = useWalletModal()
  const { publicKey, connected } = useWallet()
  const { logout, isAuthenticated, loading: authLoading, login } = useAuth()
  const routerState = useRouterState()

  const walletAddress = publicKey?.toBase58() ?? ''
  const shortAddress = walletAddress ? shortenAddress(walletAddress) : ''
  const currentPath = routerState.location.pathname

  function handleCopyAddress() {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress).catch(() => null)
    }
  }

  function isActive(to: string) {
    if (to === '/') return currentPath === '/'
    return currentPath.startsWith(to)
  }

  return (
    <>
      {/* Pill nav — floating, fixed */}
      <header className="fixed top-4 left-0 right-0 z-50 flex justify-center px-4 no-print">
        <div
          className={cnm(
            'flex items-center gap-1 px-2 py-2',
            'rounded-full',
            'bg-ink-800/80 backdrop-blur-[14px]',
            'dark:shadow-[0_4px_24px_rgba(0,0,0,0.4)]',
          )}
        >
          {/* Logo */}
          <Link
            to="/"
            className="flex items-center shrink-0 pl-1 pr-2 rounded-full"
            aria-label="Momentum home"
          >
            <img src="/assets/logo.svg" alt="MOMENTUM" className="h-14 w-auto" />
          </Link>

          {/* Desktop nav links — sliding pill indicator */}
          <nav
            className="hidden md:flex items-center gap-0.5"
            aria-label="Main navigation"
          >
            {NAV_LINKS.map((link) => {
              const active = isActive(link.to)
              return (
                <Link
                  key={link.to}
                  to={link.to}
                  className={cnm(
                    'relative px-4 py-2 text-sm font-medium rounded-full transition-colors duration-150',
                    active
                      ? 'text-cream-50'
                      : 'text-slate-400 hover:text-cream-50',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="nav-active-pill"
                      className="absolute inset-0 rounded-full bg-white/[0.1]"
                      transition={{
                        type: 'spring',
                        stiffness: 380,
                        damping: 30,
                      }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative z-10">{link.label}</span>
                </Link>
              )
            })}

          </nav>

          {/* Divider */}
          <div
            className="hidden md:block w-px h-5 bg-white/[0.08] mx-1"
            aria-hidden="true"
          />

          {/* Right controls */}
          <div className="flex items-center gap-1">
            {/* Theme toggle with circular view-transition + icon crossfade */}
            <ThemeToggle />

            {/* Profile avatar — shown when connected */}
            {connected && walletAddress && (
              <Link
                to="/profile/$wallet"
                params={{ wallet: walletAddress }}
                className={cnm(
                  'w-9 h-9 flex items-center justify-center rounded-full',
                  'bg-accent-500/15 border border-accent-500/30 text-accent-500',
                  'hover:bg-accent-500/25 transition-colors duration-150',
                  'text-xs font-mono font-bold',
                )}
                aria-label="View your profile"
                title="Your profile"
              >
                <User size={14} strokeWidth={1.75} />
              </Link>
            )}

            {/* Sign-in pill — shown when connected but not authenticated */}
            {connected && !isAuthenticated && (
              <button
                onClick={() => void login()}
                disabled={authLoading}
                className={cnm(
                  'h-9 px-4 rounded-full text-xs font-semibold',
                  'bg-accent-500/15 text-accent-500 border border-accent-500/30',
                  'hover:bg-accent-500/25 transition-colors duration-150',
                  'inline-flex items-center gap-2',
                  authLoading && 'opacity-60 cursor-wait',
                )}
                title="Sign a message to authenticate with the backend"
              >
                <Wallet size={13} strokeWidth={1.75} />
                <span>{authLoading ? 'Signing…' : 'Sign in'}</span>
              </button>
            )}

            {/* Wallet */}
            {!connected ? (
              <button
                onClick={() => setVisible(true)}
                className={cnm(
                  'h-9 px-4 rounded-full text-sm font-semibold',
                  'bg-accent-500 text-ink-900',
                  'hover:bg-accent-600 transition-colors duration-150',
                  'inline-flex items-center gap-2',
                )}
              >
                <Wallet size={14} strokeWidth={1.75} />
                <span className="hidden sm:inline">Connect</span>
              </button>
            ) : (
              <Dropdown
                placement="bottom-end"
                offset={12}
                classNames={{
                  content: cnm(
                    'bg-ink-800/95 backdrop-blur-md',
                    'border border-white/[0.08]',
                    'rounded-2xl shadow-2xl shadow-black/40',
                    'p-0',
                  ),
                }}
              >
                <DropdownTrigger>
                  <button
                    className={cnm(
                      'flex items-center gap-2 h-9 px-3 rounded-full',
                      'bg-ink-700 border border-white/[0.1]',
                      'text-cream-50 text-xs font-mono',
                      'hover:border-white/20 transition-colors duration-150',
                    )}
                  >
                    <Wallet
                      size={13}
                      strokeWidth={1.75}
                      className="text-slate-400"
                    />
                    <span>{shortAddress}</span>
                    <ChevronDown
                      size={11}
                      strokeWidth={1.75}
                      className="text-slate-400"
                    />
                  </button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label="Wallet actions"
                  className="p-1.5 min-w-[240px]"
                  itemClasses={{
                    base: cnm(
                      'rounded-lg px-3 py-2.5 gap-2.5',
                      'data-[hover=true]:bg-white/[0.06]',
                      'data-[selectable=true]:focus:bg-white/[0.06]',
                    ),
                    title: 'text-sm font-medium',
                  }}
                  topContent={
                    <div className="px-3 pt-2.5 pb-3 mb-1 border-b border-white/[0.06]">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-1.5">
                        Connected wallet
                      </p>
                      <p className="text-xs font-mono text-cream-50 break-all leading-relaxed">
                        {walletAddress}
                      </p>
                    </div>
                  }
                >
                  <DropdownItem
                    key="copy"
                    onPress={handleCopyAddress}
                    startContent={
                      <Copy
                        size={14}
                        strokeWidth={1.75}
                        className="text-slate-400"
                      />
                    }
                    className="text-cream-50"
                  >
                    Copy address
                  </DropdownItem>
                  <DropdownItem
                    key="solscan"
                    onPress={() =>
                      window.open(
                        solscanAcct(walletAddress),
                        '_blank',
                        'noopener noreferrer',
                      )
                    }
                    startContent={
                      <ExternalLink
                        size={14}
                        strokeWidth={1.75}
                        className="text-slate-400"
                      />
                    }
                    className="text-cream-50"
                  >
                    View on Solscan
                  </DropdownItem>
                  <DropdownItem
                    key="disconnect"
                    onPress={logout}
                    startContent={
                      <LogOut size={14} strokeWidth={1.75} />
                    }
                    className="text-error-500 data-[hover=true]:bg-error-500/10 mt-1 border-t border-white/[0.06] rounded-none rounded-b-lg pt-3"
                  >
                    Disconnect
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            )}

            {/* Mobile hamburger */}
            <button
              className={cnm(
                'md:hidden w-9 h-9 flex items-center justify-center rounded-full',
                'text-slate-400 hover:text-cream-50 hover:bg-white/[0.06]',
                'transition-colors duration-150',
              )}
              onClick={() => setMobileOpen((v) => !v)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <X size={16} strokeWidth={1.75} />
              ) : (
                <Menu size={16} strokeWidth={1.75} />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile drawer — full screen overlay */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-ink-900/95 backdrop-blur-md flex flex-col pt-20 px-6 pb-8"
          role="dialog"
          aria-modal="true"
          aria-label="Mobile navigation"
        >
          {/* Logo at top of drawer */}
          <div className="mb-8">
            <img
              src="/assets/logo.svg"
              alt="MOMENTUM"
              className="h-10 w-auto"
            />
          </div>

          <nav className="flex flex-col gap-1" aria-label="Mobile navigation">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={() => setMobileOpen(false)}
                className={cnm(
                  'px-5 py-4 text-base font-semibold rounded-[var(--radius-lg)]',
                  'transition-colors duration-150',
                  isActive(link.to)
                    ? 'text-cream-50 bg-white/[0.08]'
                    : 'text-slate-400 hover:text-cream-50 hover:bg-white/[0.06]',
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Wallet at bottom of drawer */}
          <div className="mt-auto pt-8 border-t border-white/[0.06]">
            {!connected ? (
              <button
                onClick={() => {
                  setMobileOpen(false)
                  setVisible(true)
                }}
                className={cnm(
                  'w-full h-12 rounded-full text-sm font-semibold',
                  'bg-accent-500 text-ink-900 hover:bg-accent-600',
                  'transition-colors duration-150 inline-flex items-center justify-center gap-2',
                )}
              >
                <Wallet size={16} strokeWidth={1.75} />
                Connect Wallet
              </button>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3 rounded-full bg-ink-700 border border-white/[0.1]">
                <Wallet
                  size={14}
                  strokeWidth={1.75}
                  className="text-slate-400"
                />
                <span className="text-xs font-mono text-cream-50">
                  {shortAddress}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
