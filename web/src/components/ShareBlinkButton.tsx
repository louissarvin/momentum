import { Check, Share2 } from 'lucide-react'
import { cnm } from '@/utils/style'
import { useClipboard } from '@/hooks/useClipboard'
import { env } from '@/env'

interface Props {
  assetId?: string
  groupPda?: string
  /** Size variant */
  size?: 'sm' | 'md'
  className?: string
}

function buildBlinkUrl(assetId?: string, groupPda?: string): string {
  const base = env.VITE_API_URL
  if (assetId) {
    return `https://dial.to/?action=solana-action:${base}/api/actions/share-card/${encodeURIComponent(assetId)}`
  }
  if (groupPda) {
    return `https://dial.to/?action=solana-action:${base}/api/actions/join-group/${encodeURIComponent(groupPda)}`
  }
  return ''
}

export default function ShareBlinkButton({
  assetId,
  groupPda,
  size = 'md',
  className,
}: Props) {
  const { copy, copied } = useClipboard()

  const url = buildBlinkUrl(assetId, groupPda)

  async function handleShare() {
    if (!url) return
    await copy(url)
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={handleShare}
        disabled={!url}
        className={cnm(
          'inline-flex items-center gap-2 rounded-full font-semibold transition-all duration-150 focus-ring',
          size === 'sm' ? 'h-8 px-3 text-xs' : 'h-10 px-4 text-sm',
          copied
            ? 'bg-success-500/20 text-success-500 border border-success-500/30'
            : 'bg-ink-700 border border-white/[0.1] text-slate-400 hover:text-cream-50 hover:border-white/20',
          !url && 'opacity-40 cursor-not-allowed',
          className,
        )}
        title="Copy Blink URL to clipboard"
        aria-label="Copy Solana Blink URL to clipboard"
      >
        {copied ? (
          <Check size={size === 'sm' ? 12 : 14} strokeWidth={1.75} />
        ) : (
          <Share2 size={size === 'sm' ? 12 : 14} strokeWidth={1.75} />
        )}
        {copied ? 'Copied!' : 'Share as Blink'}
      </button>
      {!copied && (
        <p className="text-[11px] text-slate-500 leading-tight ml-1">
          Unfurls as a signable button in X, Discord, Telegram
        </p>
      )}
    </div>
  )
}
