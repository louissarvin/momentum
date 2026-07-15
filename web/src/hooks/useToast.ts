import { useCallback, useState } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  kind: ToastKind
  text: string
}

/**
 * Lightweight toast state manager.
 * Render <ToastStack toasts={toasts} onDismiss={dismiss} /> alongside the component.
 */
export function useToast() {
  const [toasts, setToasts] = useState<Array<Toast>>([])

  const show = useCallback((kind: ToastKind, text: string) => {
    const id = Date.now()
    setToasts((prev) => [...prev, { id, kind, text }])
    const ttl = kind === 'error' ? 6000 : 4000
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), ttl)
  }, [])

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return { toasts, show, dismiss }
}
