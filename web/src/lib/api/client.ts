import type { Envelope } from './types'
import { env } from '@/env'

const JWT_KEY = 'momentum.jwt'

export function getJwt(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(JWT_KEY)
}

export function setJwt(token: string): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(JWT_KEY, token)
}

export function clearJwt(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(JWT_KEY)
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  const token = getJwt()
  const headers = new Headers(init?.headers)

  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (init?.idempotencyKey) {
    headers.set('Idempotency-Key', init.idempotencyKey)
  }

  // Build URL safely — never string-concat user input
  const url = new URL(path, env.VITE_API_URL)

  const { idempotencyKey: _dropped, ...restInit } = init ?? {}

  // Abort after 5 s so offline backend doesn't hang indefinitely.
  // Merge with any caller-supplied signal so both can cancel the request.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5_000)
  const callerSignal = restInit.signal as AbortSignal | undefined
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => controller.abort(), {
      once: true,
    })
  }
  const res = await fetch(url.toString(), {
    ...restInit,
    headers,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))

  if (res.status === 401) {
    // Only clear the JWT if we actually SENT one. A 401 on a request that
    // never included a token means the caller shouldn't have hit an
    // auth-required endpoint — wiping a valid JWT here would break other
    // flows that happen to be running in parallel (e.g. SIWS just completed).
    if (token) {
      clearJwt()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session:expired'))
      }
    }
    throw new ApiError('UNAUTHORIZED', 'Session required', 401)
  }

  const body = (await res.json()) as Envelope<T>

  if (!body.success) {
    throw new ApiError(body.error.code, body.error.message, res.status)
  }

  return body.data
}

// Convenience wrappers
export const apiGet = <T>(path: string) => apiFetch<T>(path)

export const apiPost = <T>(
  path: string,
  body: unknown,
  opts?: { idempotencyKey?: string },
) =>
  apiFetch<T>(path, {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey: opts?.idempotencyKey,
  })
