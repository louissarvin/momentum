// Global Buffer polyfill for the browser.
// Solana web3.js, wallet adapters, and Anchor client all call `Buffer.from(...)`.
// The browser has no Node.js Buffer global, so we bind the `buffer` npm shim
// onto `globalThis` at module load time.
//
// Imported at the top of `src/routes/__root.tsx` BEFORE any Solana code runs.
// Do not use `node:buffer` — Vite externalizes it and it throws in the browser.

import { Buffer as BufferPolyfill } from 'buffer'

if (typeof globalThis.Buffer === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).Buffer = BufferPolyfill
}

// process shim — some deps (older base-x, bn.js) probe `process.env`. Provide
// a minimal object so those calls don't throw ReferenceError.
if (typeof globalThis.process === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).process = { env: {} }
}

export {}
