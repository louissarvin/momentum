import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { cnm } from '@/utils/style'

const PROGRAM_ID = '39oqYsjuQLkFLEieaP7tisN8Bq4K8A2fS2gttKaFwTAT'
const IDL_ADDR = 'G3wiyk7Q4L1t2zfxaxeZnWKyd71kqLQph46Y89Nqy6on'
const COLLECTION_MINT = 'CJwWJmcMT3KyRq43fiXY7NZKAxYWg8759YcKaNL2Kbqg'

const COLS = [
  {
    heading: 'Product',
    links: [
      { label: 'Fixtures', to: '/fixtures', external: false },
      { label: 'Album', to: '/album', external: false },
      { label: 'Marketplace', to: '/market', external: false },
      { label: 'Docs', to: '/docs', external: false },
    ],
  },
  {
    heading: 'Contract',
    links: [
      {
        label: 'Program',
        href: `https://solscan.io/address/${PROGRAM_ID}?cluster=devnet`,
        external: true,
      },
      {
        label: 'IDL',
        href: `https://solscan.io/address/${IDL_ADDR}?cluster=devnet`,
        external: true,
      },
      {
        label: 'Collection',
        href: `https://solscan.io/address/${COLLECTION_MINT}?cluster=devnet`,
        external: true,
      },
    ],
  },
  {
    heading: 'Community',
    links: [
      { label: 'Twitter', href: '#', external: true },
      { label: 'Telegram', href: '#', external: true },
      { label: 'GitHub', href: '#', external: true },
    ],
  },
] as const

export default function AppFooter() {
  return (
    <footer className="mt-auto no-print px-4 md:px-6">
      <div className="mx-auto w-full max-w-[1120px]">
        <div className="rounded-t-3xl bg-ink-800/60 border-t border-white/[0.08] px-6 md:px-10 py-8 md:py-10">
          {/* Top row: wordmark + nav columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-10">
            {/* Wordmark */}
            <div className="col-span-2 md:col-span-1">
              <Link
                to="/"
                aria-label="Momentum home"
                className="inline-flex items-center gap-2 rounded-md"
              >
                <img
                  src="/assets/logo.svg"
                  alt="MOMENTUM"
                  className="h-20 w-auto"
                />
              </Link>
              <p className="mt-3 text-xs text-slate-500 leading-[1.55] max-w-[220px]">
                On-chain football predictions. Own every moment.
              </p>
            </div>

            {/* Nav columns */}
            {COLS.map((col) => (
              <div key={col.heading}>
                <p className="text-[11px] font-medium text-slate-500 mb-3">
                  {col.heading}
                </p>
                <ul className="flex flex-col gap-2">
                  {col.links.map((link) => {
                    if ('href' in link) {
                      return (
                        <li key={link.label}>
                          <a
                            href={link.href}
                            target={link.external ? '_blank' : undefined}
                            rel={
                              link.external ? 'noopener noreferrer' : undefined
                            }
                            className={cnm(
                              'inline-flex items-center gap-1 text-[13px] text-slate-400',
                              'hover:text-cream-50 transition-colors duration-150',
                            )}
                          >
                            {link.label}
                            {link.external && (
                              <ExternalLink
                                size={10}
                                strokeWidth={1.75}
                                className="opacity-50"
                              />
                            )}
                          </a>
                        </li>
                      )
                    }
                    return (
                      <li key={link.label}>
                        <Link
                          to={link.to as string}
                          className="text-[13px] text-slate-400 hover:text-cream-50 transition-colors duration-150"
                        >
                          {link.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>

          {/* Bottom row: copyright */}
          <div className="mt-8 pt-5 border-t border-white/[0.05] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-[11px] text-slate-600">
              &copy; {new Date().getFullYear()} Momentum. Built on Solana
              devnet.
            </p>
            <div className="flex items-center gap-4">
              <span className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors duration-150 cursor-default">
                Terms
              </span>
              <span className="text-[11px] text-slate-600 hover:text-slate-400 transition-colors duration-150 cursor-default">
                Privacy
              </span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
