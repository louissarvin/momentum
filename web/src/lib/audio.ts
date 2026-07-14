/**
 * Programmatic SFX for the reveal ceremony.
 *
 * Web Audio API — zero audio files, zero deps.
 * Volume: 0.15 by default (quiet, decorative).
 * Guards: AudioContext exists, user has interacted, localStorage preference.
 * prefers-reduced-motion: if set, all functions are no-ops.
 */

const STORAGE_KEY = 'audioEnabled'
const BASE_VOLUME = 0.15

// Lazily created context — must be created inside a user gesture (or resumed)
let ctx: AudioContext | null = null

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null
  if (!('AudioContext' in window || 'webkitAudioContext' in window)) return null

  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }

  if (ctx.state === 'suspended') {
    ctx.resume().catch(() => null)
  }

  return ctx
}

export function isAudioEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const stored = localStorage.getItem(STORAGE_KEY)
  // Default true — first visit is unmuted per spec (muted by default means the
  // toggle shows "Enable audio" but the preference starts as enabled)
  // Actually per spec: "Muted (default first visit)" — so default is false
  return stored === null ? false : stored === 'true'
}

export function setAudioEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, String(enabled))
}

function guard(): AudioContext | null {
  if (!isAudioEnabled()) return null
  return getContext()
}

// Utility: create a master gain tied to BASE_VOLUME and auto-disconnect after duration
function masterGain(ac: AudioContext, duration: number): GainNode {
  const g = ac.createGain()
  g.gain.setValueAtTime(BASE_VOLUME, ac.currentTime)
  g.connect(ac.destination)
  // Clean up after sound ends + buffer
  setTimeout(
    () => {
      try {
        g.disconnect()
      } catch {
        // already disconnected
      }
    },
    (duration + 0.2) * 1000,
  )
  return g
}

/** Phase 1: short white-noise whistle blast (~160ms) */
export function playWhistle(): void {
  const ac = guard()
  if (!ac) return

  const bufferSize = Math.floor(ac.sampleRate * 0.16)
  const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1
  }

  const source = ac.createBufferSource()
  source.buffer = buffer

  // Bandpass to make it whistle-like
  const bpf = ac.createBiquadFilter()
  bpf.type = 'bandpass'
  bpf.frequency.value = 3800
  bpf.Q.value = 8

  const env = ac.createGain()
  env.gain.setValueAtTime(0, ac.currentTime)
  env.gain.linearRampToValueAtTime(1, ac.currentTime + 0.02)
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.16)

  const mg = masterGain(ac, 0.2)
  source.connect(bpf)
  bpf.connect(env)
  env.connect(mg)
  source.start()
}

/** Phase 3: brief square wave tick at given pitch (Hz) */
export function playTick(pitch: number): void {
  const ac = guard()
  if (!ac) return

  const osc = ac.createOscillator()
  osc.type = 'square'
  osc.frequency.value = Math.min(Math.max(pitch, 100), 2000)

  const env = ac.createGain()
  env.gain.setValueAtTime(0, ac.currentTime)
  env.gain.linearRampToValueAtTime(1, ac.currentTime + 0.005)
  env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.07)

  const mg = masterGain(ac, 0.1)
  osc.connect(env)
  env.connect(mg)
  osc.start()
  osc.stop(ac.currentTime + 0.07)
}

/** Phase 4: C major triad chord (C4-E4-G4) quick attack + decay */
export function playChord(): void {
  const ac = guard()
  if (!ac) return

  const freqs = [261.63, 329.63, 392.0] // C4, E4, G4

  freqs.forEach((freq, i) => {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq

    const env = ac.createGain()
    env.gain.setValueAtTime(0, ac.currentTime)
    env.gain.linearRampToValueAtTime(0.6, ac.currentTime + 0.04)
    env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.55)

    const mg = masterGain(ac, 0.6)
    osc.connect(env)
    env.connect(mg)
    osc.start(ac.currentTime + i * 0.01)
    osc.stop(ac.currentTime + 0.55)
  })
}

/** Match Card LEGENDARY: ascending arpeggio (C4 → E4 → G4 → C5) */
export function playChime(): void {
  const ac = guard()
  if (!ac) return

  const notes = [261.63, 329.63, 392.0, 523.25] // C4, E4, G4, C5

  notes.forEach((freq, i) => {
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq

    const delay = i * 0.12
    const env = ac.createGain()
    env.gain.setValueAtTime(0, ac.currentTime + delay)
    env.gain.linearRampToValueAtTime(0.8, ac.currentTime + delay + 0.03)
    env.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + 0.5)

    const mg = masterGain(ac, delay + 0.6)
    osc.connect(env)
    env.connect(mg)
    osc.start(ac.currentTime + delay)
    osc.stop(ac.currentTime + delay + 0.5)
  })
}
