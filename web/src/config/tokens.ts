// Design tokens mirroring DESIGN.md §2–§5 @theme block.
// Use these in TS/JS logic (GSAP timelines, canvas, etc.).
// In Tailwind classes, use the CSS custom property names directly.

export const colors = {
  // Primary palette
  ink900: '#0A0B0D',
  ink800: '#111318',
  ink700: '#1A1D24',
  cream50: '#F9F6EF',
  cream100: '#F1ECDE',
  paper0: '#FFFFFF',
  accent500: '#F97316',
  accent600: '#EA580C',
  sui500: '#4DA2FF',

  // Neutrals
  slate400: '#94969C',
  slate500: '#6E7079',
  slate700: '#3A3D45',

  // Semantic
  success500: '#22C55E',
  error500: '#EF4444',
  warning500: '#F5C842',
  info500: '#4DA2FF',

  // Category (prediction slots)
  catGoals: '#F97316',
  catCards: '#F5C842',
  catCorners: '#3CD8D8',
  catShots: '#8B5CF6',
  catPoss: '#22C55E',
  catOther: '#94969C',
} as const

export const radii = {
  sm: '4px',
  md: '12px',
  lg: '20px',
  xl: '28px',
  '2xl': '40px',
  full: '9999px',
  blob: '44% 56% 63% 37% / 42% 46% 54% 58%',
} as const

export const durations = {
  fast: 150,
  medium: 300,
  slow: 600,
  dramatic: 1200,
  epic: 2400,
} as const

// GSAP-compatible easing strings (registered via src/lib/gsap.ts)
export const easings = {
  momentumOut: 'momentum-out',
  momentumSnap: 'momentum-snap',
  momentumGlide: 'momentum-glide',
  momentumTick: 'momentum-tick',
  outQuint: 'power3.out',
  outExpo: 'expo.out',
  inOut: 'power2.inOut',
} as const

export const spacing = {
  0: '0px',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
  32: '128px',
} as const

export type ColorToken = keyof typeof colors
export type RadiusToken = keyof typeof radii
export type DurationToken = keyof typeof durations
export type EasingToken = keyof typeof easings
