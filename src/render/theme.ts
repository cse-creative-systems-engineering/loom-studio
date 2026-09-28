/**
 * Output design tokens.
 *
 * The single biggest quality gap in the designed artifact was that every
 * colour, radius, size, and shadow was a literal inside `styleFor()`. Two
 * authors then produced two unrelated apps, and re-skinning meant editing every
 * node. This module is the token layer that fixes that.
 *
 * A document carries a `theme` (a name plus optional overrides); the renderer
 * resolves every literal through `resolveTheme()`, so a theme change is ONE
 * edit at the document level rather than N per node.
 *
 * These are the DESIGNED OUTPUT's tokens. The editor chrome has its own
 * (`ui.css`); the two must not bleed into each other.
 */

export interface Theme {
  name: string

  /* colour roles — semantic, so a theme change re-maps them */
  textPrimary: string
  textSecondary: string
  textMuted: string
  accent: string
  accentHover: string
  /**
   * Text seated on a filled accent/danger control. A hardcoded white fails AA
   * on light accents (measured: white on contrast `#7ea6ff` = 2.39:1, on
   * midnight `#5b8cff` = 3.16:1), so this is per-theme, not a literal.
   */
  textOnAccent: string
  danger: string
  success: string
  warning: string

  /**
   * Whether the theme is dark or light, for the parts of a control the
   * browser still draws (a select's option list, a date picker's popup and
   * icon, scrollbars). Left unset they are drawn light on a dark design.
   */
  colorScheme: 'dark' | 'light'

  /* surfaces */
  bg: string
  surface: string
  surfaceGlass: string
  border: string
  borderStrong: string

  /* type scale — a real ratio, not ad-hoc values */
  fontFamily: string
  fontMono: string
  textXs: number
  textSm: number
  textMd: number
  textLg: number
  textXl: number
  textXxl: number
  weightNormal: number
  weightMedium: number
  weightSemibold: number
  weightBold: number
  lineHeight: number

  /* spacing scale — authors pick steps, not arbitrary numbers */
  space1: number
  space2: number
  space3: number
  space4: number
  space5: number
  space6: number
  space8: number

  /* shape */
  radiusSm: number
  radiusMd: number
  radiusLg: number
  radiusFull: number

  /* elevation */
  shadowSm: string
  shadowMd: string
  shadowLg: string
  shadowGlow: string

  /* motion — micro-interactions are part of the premium bar */
  motionFast: number
  motionBase: number
  motionSlow: number
  ease: string
}

export const THEME_NAMES = ['midnight', 'daylight', 'contrast'] as const
export type ThemeName = (typeof THEME_NAMES)[number]

const BASE: Theme = {
  name: 'midnight',

  textPrimary: '#f2f5fa',
  textSecondary: '#a8b2c5',
  textMuted: '#7d879b',
  accent: '#5b8cff',
  accentHover: '#7aa0ff',
  textOnAccent: '#0b0d13',
  danger: '#e2564d',
  success: '#2fbf8f',
  warning: '#d9a13a',

  colorScheme: 'dark',
  bg: '#0b0d13',
  surface: '#151a26',
  surfaceGlass: 'rgba(24, 29, 44, 0.66)',
  border: 'rgba(255, 255, 255, 0.09)',
  borderStrong: 'rgba(255, 255, 255, 0.16)',

  // The output ships its own face (render/fonts.ts), so it is named FIRST:
  // behind `ui-sans-serif` it never won, and the design fell to SF, Segoe or
  // DejaVu depending on the machine it was opened on.
  fontFamily: "'Inter Variable', 'Inter', ui-sans-serif, system-ui, sans-serif",
  fontMono: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, monospace",

  // ~1.2 ratio on a 15px base.
  textXs: 11,
  textSm: 13,
  textMd: 15,
  textLg: 18,
  textXl: 22,
  textXxl: 28,

  weightNormal: 400,
  weightMedium: 500,
  weightSemibold: 600,
  weightBold: 700,
  lineHeight: 1.45,

  space1: 4,
  space2: 8,
  space3: 12,
  space4: 16,
  space5: 24,
  space6: 32,
  space8: 48,

  radiusSm: 6,
  radiusMd: 10,
  radiusLg: 16,
  radiusFull: 999,

  shadowSm: '0 1px 2px rgba(0,0,0,0.4)',
  shadowMd: '0 6px 18px -6px rgba(0,0,0,0.55)',
  shadowLg: '0 18px 44px -16px rgba(0,0,0,0.7)',
  shadowGlow: '0 6px 22px -8px rgba(91, 140, 255, 0.55)',

  motionFast: 110,
  motionBase: 180,
  motionSlow: 280,
  ease: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
}

const DAYLIGHT: Theme = {
  ...BASE,
  name: 'daylight',
  textPrimary: '#10141c',
  textSecondary: '#414b5e',
  textMuted: '#5b6577',
  accent: '#2f5fe0',
  accentHover: '#1f4bc4',
  textOnAccent: '#ffffff',
  colorScheme: 'light',
  bg: '#f6f7f9',
  surface: '#ffffff',
  surfaceGlass: 'rgba(255, 255, 255, 0.78)',
  border: 'rgba(16, 20, 28, 0.10)',
  borderStrong: 'rgba(16, 20, 28, 0.18)',
  shadowSm: '0 1px 2px rgba(16,20,28,0.06)',
  shadowMd: '0 6px 18px -8px rgba(16,20,28,0.14)',
  shadowLg: '0 20px 44px -18px rgba(16,20,28,0.20)',
  shadowGlow: '0 6px 20px -10px rgba(47, 95, 224, 0.45)',
}

const CONTRAST: Theme = {
  ...BASE,
  name: 'contrast',
  textPrimary: '#ffffff',
  textSecondary: '#d7dced',
  textMuted: '#b3bdd2',
  accent: '#7ea6ff',
  accentHover: '#9dbcff',
  textOnAccent: '#0a0f1c',
  bg: '#000000',
  surface: '#0d1017',
  surfaceGlass: 'rgba(18, 22, 32, 0.9)',
  border: 'rgba(255, 255, 255, 0.22)',
  borderStrong: 'rgba(255, 255, 255, 0.38)',
  shadowGlow: '0 6px 24px -8px rgba(126, 166, 255, 0.7)',
}

const THEMES: Record<ThemeName, Theme> = {
  midnight: BASE,
  daylight: DAYLIGHT,
  contrast: CONTRAST,
}

export function getTheme(name: string | undefined): Theme {
  if (name && name in THEMES) return THEMES[name as ThemeName]
  return BASE
}

/** Deep-ish merge of user overrides onto a base theme. */
export function resolveTheme(name: string | undefined, overrides?: Partial<Theme>): Theme {
  const base = getTheme(name)
  return overrides ? { ...base, ...overrides, name: base.name } : base
}

/** Scale step name -> value, so props can say `size="md"` not `size={15}`. */
export function typeStep(t: Theme, step: string): number {
  switch (step) {
    case 'xs':
      return t.textXs
    case 'sm':
      return t.textSm
    case 'md':
      return t.textMd
    case 'lg':
      return t.textLg
    case 'xl':
      return t.textXl
    case 'xxl':
      return t.textXxl
    default:
      return t.textMd
  }
}

export function weightStep(t: Theme, w: string): number {
  const n = Number(w)
  if (!Number.isNaN(n) && n >= 100 && n <= 900) return n
  switch (String(w)) {
    case 'normal':
      return t.weightNormal
    case 'medium':
      return t.weightMedium
    case 'semibold':
      return t.weightSemibold
    case 'bold':
      return t.weightBold
    default:
      return t.weightMedium
  }
}
