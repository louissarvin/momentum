/**
 * Server-side branded card renderer for Telegram push.
 *
 * We hand-write a compact SVG (no JSX, no font files, no external deps
 * beyond @resvg/resvg-js) that matches the Momentum design language:
 *  - dark ink background (#0A0B0D)
 *  - cream inner card (#F9F6EF)
 *  - warm orange accent (#F97316)
 *  - hexagonal sticker mark
 *  - JetBrains Mono-style monospace vibe via generic monospace fallback
 *  - Bricolage Grotesque display via generic sans-serif fallback
 *
 * Rendered to PNG @ 1200x630 (2:1 — friendly to Telegram sendPhoto and
 * X card unfurls if we ever want to reuse this endpoint for og:image).
 * resvg-js can do this in ~40ms on M1 CPU.
 *
 * Docs consulted:
 *  - https://github.com/yisibl/resvg-js#resvgoptions
 *  - https://core.telegram.org/bots/api#sendphoto (photo requirements)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Resvg } from '@resvg/resvg-js';

export type CardOutcome = 'HIT' | 'MISS' | 'PENDING';

// ---------- logo bootstrap ----------

// Pre-render the Momentum logo to a compact PNG once at module load so we
// can embed it in every card SVG as a data URI. resvg-js can't reliably
// nest complex SVGs (masks + filters + embedded PNGs) via <image href="...svg">,
// so pre-rasterising is both faster and more portable.

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOGO_SVG_PATH = join(__dirname, 'momentum-logo.svg');

interface RenderedLogo {
  base64: string; // "data:image/png;base64,..."
  width: number;
  height: number;
}

function preRenderLogo(targetWidth: number): RenderedLogo | null {
  try {
    const svg = readFileSync(LOGO_SVG_PATH, 'utf8');
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: targetWidth },
      background: 'rgba(0,0,0,0)', // transparent
      font: { loadSystemFonts: false, defaultFontFamily: 'sans-serif' },
    });
    const rendered = resvg.render();
    const png = rendered.asPng();
    const dims = rendered; // has .width / .height
    // resvg-js exposes width/height directly on the RenderedImage
    // (verified via .d.ts). We fall back to a reasonable default if not.
    const w = (dims as unknown as { width?: number }).width ?? targetWidth;
    const h =
      (dims as unknown as { height?: number }).height ??
      Math.round(targetWidth * 0.5625);
    return {
      base64: `data:image/png;base64,${Buffer.from(png).toString('base64')}`,
      width: w,
      height: h,
    };
  } catch (err) {
    // Non-fatal: card falls back to text-only header/hex if logo missing.
    // eslint-disable-next-line no-console
    console.warn('[card-image] logo pre-render failed:', (err as Error).message);
    return null;
  }
}

// Two sizes cached at module load: header (compact) + hex (large square-ish)
const LOGO_HEADER = preRenderLogo(360); // ~360 x 202 rendered
const LOGO_HEX = preRenderLogo(560); // ~560 x 315 rendered

export interface CardOpts {
  name: string;
  outcome: CardOutcome;
  fixtureLabel?: string;
  slotLabel?: string;
  txSig?: string;
  assetId?: string;
}

// ---------- helpers ----------

function svgEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function clip(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function shortAddr(s: string): string {
  if (!s) return '';
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

// Palette (locked to Momentum design language)
const PALETTE = {
  ink900: '#0A0B0D',
  ink800: '#151619',
  ink700: '#22252A',
  cream: '#F9F6EF',
  creamMuted: '#D9D4C7',
  accent: '#F97316',
  accentDim: '#B7541A',
  success: '#22C55E',
  successDim: '#166534',
  neutral: '#64748B',
  grid: 'rgba(249,246,239,0.04)',
} as const;

function outcomeColor(o: CardOutcome): { fill: string; ring: string; label: string; icon: string } {
  if (o === 'HIT') return { fill: PALETTE.success, ring: PALETTE.successDim, label: 'HIT', icon: '✓' };
  if (o === 'MISS') return { fill: PALETTE.neutral, ring: '#334155', label: 'MISS', icon: '✕' };
  return { fill: PALETTE.accent, ring: PALETTE.accentDim, label: 'PENDING', icon: '⏳' };
}

// ---------- SVG builder ----------

/**
 * 1200x630 SVG. Composed of:
 *  1. dark ink base + subtle grid pattern
 *  2. header row: MOMENTUM wordmark (left) + outcome pill (right)
 *  3. big hexagonal sticker mark centered vertically on the left third
 *  4. right two-thirds: name (huge), fixture label (medium), slot label (small mono)
 *  5. footer thin line + on-chain provenance mono row
 */
export function buildCardSvg(opts: CardOpts): string {
  const W = 1200;
  const H = 630;
  const color = outcomeColor(opts.outcome);

  const name = svgEscape(clip(opts.name, 42));
  const fixtureLabel = svgEscape(clip(opts.fixtureLabel ?? '', 60));
  const slotLabel = svgEscape(clip(opts.slotLabel ?? '', 60));
  const footerAddr = opts.assetId
    ? `asset ${shortAddr(opts.assetId)}`
    : opts.txSig
      ? `tx ${shortAddr(opts.txSig)}`
      : 'devnet · solana';

  // Hexagon path (pointy-top). Centered at (280, 315), radius 190.
  const cx = 280;
  const cy = 315;
  const r = 190;
  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    return `${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`;
  }).join(' ');
  const hexInnerR = 144;
  const hexInnerPoints = Array.from({ length: 6 }, (_, i) => {
    const angle = ((-90 + i * 60) * Math.PI) / 180;
    return `${cx + hexInnerR * Math.cos(angle)},${cy + hexInnerR * Math.sin(angle)}`;
  }).join(' ');

  // Logo placement inside hex: the wordmark IS the sticker artwork.
  // Fit width to 220 (comfortably inside 288px inner-hex diameter).
  const hexLogoW = LOGO_HEX ? 220 : 0;
  const hexLogoH = LOGO_HEX ? Math.round((LOGO_HEX.height / LOGO_HEX.width) * hexLogoW) : 0;
  const hexLogoX = cx - hexLogoW / 2;
  const hexLogoY = cy - hexLogoH / 2;

  // Header stays clean text — dot + wordmark + mono status. No overlap with hex.
  const headerBlock = `
    <g transform="translate(60, 60)">
      <circle cx="14" cy="14" r="10" fill="${PALETTE.accent}"/>
      <text x="38" y="22" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="28" font-weight="700" fill="${PALETTE.cream}" letter-spacing="-0.5">MOMENTUM</text>
      <text x="38" y="46" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="13" fill="${PALETTE.creamMuted}" letter-spacing="1.5" opacity="0.7">SOLANA · DEVNET</text>
    </g>
  `;

  const hexInner = LOGO_HEX
    ? `<image href="${LOGO_HEX.base64}" x="${hexLogoX}" y="${hexLogoY}" width="${hexLogoW}" height="${hexLogoH}" preserveAspectRatio="xMidYMid meet"/>`
    : `<text x="${cx}" y="${cy + 40}" text-anchor="middle" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="140" font-weight="800" fill="${PALETTE.ink900}">M</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
      <path d="M 24 0 L 0 0 0 24" fill="none" stroke="${PALETTE.grid}" stroke-width="1"/>
    </pattern>
    <radialGradient id="accentGrad" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${color.fill}" stop-opacity="0.35"/>
      <stop offset="55%" stop-color="${color.fill}" stop-opacity="0.10"/>
      <stop offset="100%" stop-color="${color.fill}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="hexGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${PALETTE.cream}"/>
      <stop offset="100%" stop-color="${PALETTE.creamMuted}"/>
    </linearGradient>
  </defs>

  <!-- 1. Base + grid -->
  <rect width="${W}" height="${H}" fill="${PALETTE.ink900}"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>

  <!-- Accent gradient wash behind hex (adds a subtle glow tinted by outcome) -->
  <circle cx="${cx}" cy="${cy}" r="280" fill="url(#accentGrad)"/>

  <!-- 2. Header row: real Momentum logo top-left -->
  ${headerBlock}

  <!-- Outcome pill top-right -->
  <g transform="translate(${W - 60}, 72)">
    <rect x="-180" y="-4" width="180" height="48" rx="24" fill="${color.fill}"/>
    <text x="-90" y="27" text-anchor="middle" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="22" font-weight="800" fill="${PALETTE.ink900}" letter-spacing="2">${color.icon} ${color.label}</text>
  </g>

  <!-- 3. Hexagonal sticker mark with real logo centered -->
  <polygon points="${hexPoints}" fill="${PALETTE.ink800}" stroke="${color.fill}" stroke-width="5"/>
  <polygon points="${hexInnerPoints}" fill="url(#hexGrad)"/>
  ${hexInner}

  <!-- 4. Right column text -->
  <g transform="translate(560, 210)">
    <!-- Small label -->
    <text x="0" y="0" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14" fill="${color.fill}" letter-spacing="2" font-weight="700">PREDICTION MINTED</text>

    <!-- Name (huge) -->
    <text x="0" y="62" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="52" font-weight="800" fill="${PALETTE.cream}" letter-spacing="-1">${name}</text>

    ${fixtureLabel ? `
    <!-- Fixture label -->
    <text x="0" y="118" font-family="'Bricolage Grotesque', system-ui, sans-serif" font-size="24" font-weight="500" fill="${PALETTE.creamMuted}">${fixtureLabel}</text>
    ` : ''}

    ${slotLabel ? `
    <!-- Slot label (mono, muted) -->
    <text x="0" y="164" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="18" fill="${PALETTE.neutral}" letter-spacing="0.5">${slotLabel}</text>
    ` : ''}
  </g>

  <!-- 5. Footer -->
  <line x1="60" y1="${H - 88}" x2="${W - 60}" y2="${H - 88}" stroke="${PALETTE.ink700}" stroke-width="1"/>
  <g transform="translate(60, ${H - 54})">
    <text x="0" y="0" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14" fill="${PALETTE.creamMuted}" letter-spacing="1">TXLINE · MPL-BUBBLEGUM · SOLANA DEVNET</text>
  </g>
  <g transform="translate(${W - 60}, ${H - 54})">
    <text x="0" y="0" text-anchor="end" font-family="'JetBrains Mono', ui-monospace, monospace" font-size="14" fill="${PALETTE.creamMuted}" letter-spacing="0.5">${svgEscape(footerAddr)}</text>
  </g>
</svg>`;
}

// ---------- PNG render ----------

// Small in-memory LRU keyed by (name+outcome+fixture+slot+asset+tx). Repeat
// pushes for the same card hit the cache instead of re-rendering.
const CACHE = new Map<string, Buffer>();
const CACHE_MAX = 100;

function cacheKey(opts: CardOpts): string {
  return `${opts.name}|${opts.outcome}|${opts.fixtureLabel ?? ''}|${opts.slotLabel ?? ''}|${opts.assetId ?? ''}|${opts.txSig ?? ''}`;
}

/**
 * Render a Momentum-branded card PNG for the given options.
 * Returns a Buffer suitable for direct HTTP response with
 * `content-type: image/png`.
 */
export function renderCardPng(opts: CardOpts): Buffer {
  const key = cacheKey(opts);
  const hit = CACHE.get(key);
  if (hit) {
    // LRU: move to end.
    CACHE.delete(key);
    CACHE.set(key, hit);
    return hit;
  }
  const svg = buildCardSvg(opts);
  const resvg = new Resvg(svg, {
    // Fit output to 1200x630 exactly (viewBox already matches).
    fitTo: { mode: 'width', value: 1200 },
    background: PALETTE.ink900,
    // resvg falls back to a bundled DejaVu-Sans if the requested font isn't
    // available. That's fine for a hackathon demo — the layout is
    // font-metric-tolerant.
    font: {
      loadSystemFonts: true,
      defaultFontFamily: 'sans-serif',
    },
  });
  const png = Buffer.from(resvg.render().asPng());
  if (CACHE.size >= CACHE_MAX) {
    // Evict oldest.
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, png);
  return png;
}
