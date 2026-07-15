import { useCallback, useState } from 'react'

type Status = 'idle' | 'copied' | 'error'

export function useClipboard(resetAfter = 2000) {
  const [status, setStatus] = useState<Status>('idle')

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          // Fallback for older browsers
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
          document.body.appendChild(ta)
          ta.focus()
          ta.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(ta)
          if (!ok) throw new Error('execCommand failed')
        }
        setStatus('copied')
        setTimeout(() => setStatus('idle'), resetAfter)
        return true
      } catch {
        setStatus('error')
        setTimeout(() => setStatus('idle'), resetAfter)
        return false
      }
    },
    [resetAfter],
  )

  return { copy, status, copied: status === 'copied' }
}
