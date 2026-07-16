/**
 * useFixtureStream — SSE connection to /api/stream/fixture/:fixtureId?ticket=<jwt>
 *
 * Uses fetch() + ReadableStream because native EventSource cannot set Authorization
 * headers. The backend accepts the JWT as a `ticket` query param instead.
 *
 * Reconnects with exponential backoff (250ms base → 4s cap) on any drop.
 * Cleanup on unmount. Events are emitted into a Zustand store so components
 * can subscribe without prop-drilling.
 */

import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { env } from '@/env'
import type { SseEvent } from '@/lib/api/types'

// ─── Event shape types ────────────────────────────────────────────────────────

export type PacketEvent = Extract<SseEvent, { event: 'packet' }>['data']
export type StickerMintedEvent = Extract<
  SseEvent,
  { event: 'sticker_minted' }
>['data']
export type MatchCardClaimedEvent = Extract<
  SseEvent,
  { event: 'match_card_claimed' }
>['data']

export interface TimelineEntry {
  id: string
  ts: number
  event: SseEvent['event']
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any
}

// ─── Zustand store (persists across renders) ─────────────────────────────────

interface SSEState {
  connected: boolean
  error: string | null
  lastPacket: PacketEvent | null
  stickers: StickerMintedEvent[]
  timeline: TimelineEntry[]
  setConnected: (v: boolean) => void
  setError: (v: string | null) => void
  pushPacket: (p: PacketEvent) => void
  pushSticker: (s: StickerMintedEvent) => void
  pushTimeline: (e: TimelineEntry) => void
  reset: () => void
}

export const useSSEStore = create<SSEState>((set) => ({
  connected: false,
  error: null,
  lastPacket: null,
  stickers: [],
  timeline: [],
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  pushPacket: (lastPacket) =>
    set((s) => ({
      lastPacket,
      timeline: [
        ...s.timeline.slice(-199),
        {
          id: `pkt-${Date.now()}-${Math.random()}`,
          ts: Date.now(),
          event: 'packet',
          data: lastPacket,
        },
      ],
    })),
  pushSticker: (sticker) =>
    set((s) => ({
      stickers: [...s.stickers, sticker],
      timeline: [
        ...s.timeline.slice(-199),
        {
          id: `stk-${Date.now()}-${Math.random()}`,
          ts: Date.now(),
          event: 'sticker_minted',
          data: sticker,
        },
      ],
    })),
  pushTimeline: (entry) =>
    set((s) => ({ timeline: [...s.timeline.slice(-199), entry] })),
  reset: () =>
    set({
      connected: false,
      error: null,
      lastPacket: null,
      stickers: [],
      timeline: [],
    }),
}))

// ─── SSE text/event-stream parser ────────────────────────────────────────────

function parseEventStream(
  chunk: string,
  onEvent: (event: string, data: unknown) => void,
) {
  const messages = chunk.split('\n\n')
  for (const msg of messages) {
    if (!msg.trim()) continue
    const lines = msg.split('\n')
    let eventName = 'message'
    let dataStr = ''
    for (const line of lines) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) dataStr = line.slice(5).trim()
      // heartbeat comment — ignore
    }
    if (!dataStr) continue
    try {
      onEvent(eventName, JSON.parse(dataStr))
    } catch {
      // malformed JSON — skip silently
    }
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useFixtureStream(fixtureId: string, ticket: string | null) {
  const store = useSSEStore()
  const abortRef = useRef<AbortController | null>(null)
  const retryRef = useRef(250)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    store.reset()

    if (!ticket) {
      // Not authenticated — no SSE
      return
    }

    function connect() {
      if (!mountedRef.current) return

      abortRef.current = new AbortController()
      const { signal } = abortRef.current

      // Build URL safely
      const url = new URL(
        `/api/stream/fixture/${encodeURIComponent(fixtureId)}`,
        env.VITE_API_URL,
      )
      url.searchParams.set('ticket', ticket!)

      store.setConnected(false)
      store.setError(null)

      fetch(url.toString(), {
        signal,
        headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
      })
        .then(async (res) => {
          if (!res.ok || !res.body) {
            throw new Error(`SSE HTTP ${res.status}`)
          }

          store.setConnected(true)
          store.setError(null)
          retryRef.current = 250

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''

          while (mountedRef.current) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            // Process complete messages (end with double newline)
            const boundary = buf.lastIndexOf('\n\n')
            if (boundary !== -1) {
              const toProcess = buf.slice(0, boundary + 2)
              buf = buf.slice(boundary + 2)
              parseEventStream(toProcess, handleEvent)
            }
          }
        })
        .catch((err) => {
          if (!mountedRef.current) return
          if (err instanceof Error && err.name === 'AbortError') return
          const msg = err instanceof Error ? err.message : 'SSE error'
          store.setConnected(false)
          store.setError(msg)

          // Exponential backoff
          const delay = retryRef.current
          retryRef.current = Math.min(retryRef.current * 2, 4000)
          setTimeout(() => {
            if (mountedRef.current) connect()
          }, delay)
        })
        .finally(() => {
          if (mountedRef.current) store.setConnected(false)
        })
    }

    function handleEvent(name: string, data: unknown) {
      if (!mountedRef.current) return

      switch (name) {
        case 'hello':
          store.setConnected(true)
          break
        case 'packet':
          store.pushPacket(data as PacketEvent)
          break
        case 'sticker_minted':
          store.pushSticker(data as StickerMintedEvent)
          store.pushTimeline({
            id: `stk-${Date.now()}`,
            ts: Date.now(),
            event: 'sticker_minted',
            data,
          })
          break
        case 'match_card_claimed':
          store.pushTimeline({
            id: `mcc-${Date.now()}`,
            ts: Date.now(),
            event: 'match_card_claimed',
            data,
          })
          break
        case 'settlement_started':
        case 'settlement_error':
          store.pushTimeline({
            id: `${name}-${Date.now()}`,
            ts: Date.now(),
            event: name as SseEvent['event'],
            data,
          })
          break
        default:
          break
      }
    }

    connect()

    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureId, ticket])

  return {
    connected: store.connected,
    error: store.error,
    lastPacket: store.lastPacket,
    stickers: store.stickers,
    timeline: store.timeline,
  }
}
