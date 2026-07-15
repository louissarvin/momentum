import { X } from 'lucide-react'
import type { Toast } from '@/hooks/useToast'
import { cnm } from '@/utils/style'

const stripeColor: Record<Toast['kind'], string> = {
  success: 'bg-success-500',
  error: 'bg-error-500',
  info: 'bg-sui-500',
}

interface Props {
  toasts: Array<Toast>
  onDismiss: (id: number) => void
}

export function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 w-[320px] max-w-[90vw]"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cnm(
            'flex items-start gap-3 p-4 rounded-[var(--radius-lg)]',
            'bg-ink-700 border border-white/[0.08]',
            'shadow-[var(--shadow-elevated)]',
            'animate-[fadeInUp_0.22s_ease-out_forwards]',
          )}
        >
          <div
            className={cnm(
              'mt-0.5 w-1 self-stretch rounded-full shrink-0',
              stripeColor[t.kind],
            )}
          />
          <p className="text-sm text-cream-50 leading-[1.5] flex-1">{t.text}</p>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-slate-400 hover:text-cream-50 shrink-0 transition-colors"
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
