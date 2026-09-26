/**
 * Token bundles — a theme as DATA, not a hard-coded name.
 *
 * Loom originally had three themes compiled into `theme.ts`. Atelier's bundle
 * ships `tokens/colors.json`, `spacing.json`, `typography.json`, `effects.json`
 * and a `css-variables.css`, which is strictly better: a theme becomes a file
 * you can import, diff, and share, and the renderer needs no change to support
 * a new one.
 *
 * A bundle is partial by design — any field it omits falls back to the base
 * theme — so a two-line colors-only bundle is a valid theme.
 */

import { getTheme, type Theme, type ThemeName } from './theme'
import { normalizeEffects, type EffectValues } from './effects'

export interface TokenBundle {
  name?: string
  colors?: Partial<{
    bg: string
    surface: string
    surfaceGlass: string
    border: string
    borderStrong: string
    textPrimary: string
    textSecondary: string
    textMuted: string
    accent: string
    accentHover: string
    danger: string
    success: string
    warning: string
  }>
  spacing?: { scale?: number[]; base?: number }
  typography?: {
    fontFamily?: string
    fontMono?: string
    sizes?: { xs?: number; sm?: number; md?: number; lg?: number; xl?: number; xxl?: number }
  }
  radius?: { sm?: number; md?: number; lg?: number }
  elevation?: { sm?: string; md?: string; lg?: string; glow?: string }
  motion?: { fast?: number; base?: number; slow?: number; ease?: string }
  effects?: Record<string, unknown>
}

/**
 * Resolve a bundle onto a base theme.
 *
 * Never mutates the base: a caller can resolve many bundles from one theme
 * without them bleeding into each other.
 */
export function resolveBundle(
  base: ThemeName | string | undefined,
  bundle: TokenBundle = {},
): Theme {
  const t = { ...getTheme(base) }
  const c = bundle.colors
  if (c) {
    if (c.bg !== undefined) t.bg = c.bg
    if (c.surface !== undefined) t.surface = c.surface
    if (c.surfaceGlass !== undefined) t.surfaceGlass = c.surfaceGlass
    if (c.border !== undefined) t.border = c.border
    if (c.borderStrong !== undefined) t.borderStrong = c.borderStrong
    if (c.textPrimary !== undefined) t.textPrimary = c.textPrimary
    if (c.textSecondary !== undefined) t.textSecondary = c.textSecondary
    if (c.textMuted !== undefined) t.textMuted = c.textMuted
    if (c.accent !== undefined) t.accent = c.accent
    if (c.accentHover !== undefined) t.accentHover = c.accentHover
    if (c.danger !== undefined) t.danger = c.danger
    if (c.success !== undefined) t.success = c.success
    if (c.warning !== undefined) t.warning = c.warning
  }

  const sp = bundle.spacing
  if (sp?.scale && sp.scale.length) {
    // Map a 6-8 step scale onto Loom's named steps, in order.
    const keys = ['space1', 'space2', 'space3', 'space4', 'space5', 'space6', 'space8'] as const
    const n = Math.min(keys.length, sp.scale.length)
    for (let i = 0; i < n; i++) {
      t[keys[i]] = Number(sp.scale[i]) || t[keys[i]]
    }
  }

  const ty = bundle.typography
  if (ty) {
    if (ty.fontFamily) t.fontFamily = ty.fontFamily
    if (ty.fontMono) t.fontMono = ty.fontMono
    const s = ty.sizes
    if (s) {
      if (s.xs !== undefined) t.textXs = s.xs
      if (s.sm !== undefined) t.textSm = s.sm
      if (s.md !== undefined) t.textMd = s.md
      if (s.lg !== undefined) t.textLg = s.lg
      if (s.xl !== undefined) t.textXl = s.xl
      if (s.xxl !== undefined) t.textXxl = s.xxl
    }
  }

  const r = bundle.radius
  if (r) {
    if (r.sm !== undefined) t.radiusSm = r.sm
    if (r.md !== undefined) t.radiusMd = r.md
    if (r.lg !== undefined) t.radiusLg = r.lg
  }

  const e = bundle.elevation
  if (e) {
    if (e.sm !== undefined) t.shadowSm = e.sm
    if (e.md !== undefined) t.shadowMd = e.md
    if (e.lg !== undefined) t.shadowLg = e.lg
    if (e.glow !== undefined) t.shadowGlow = e.glow
  }

  const m = bundle.motion
  if (m) {
    if (m.fast !== undefined) t.motionFast = m.fast
    if (m.base !== undefined) t.motionBase = m.base
    if (m.slow !== undefined) t.motionSlow = m.slow
    if (m.ease !== undefined) t.ease = m.ease
  }

  if (bundle.name) t.name = bundle.name
  return t
}

/** Effects a bundle specifies, merged over the defaults. */
export function effectsFromBundle(bundle: TokenBundle = {}): EffectValues {
  const raw = (bundle.effects ?? {}) as Record<string, unknown>
  return normalizeEffects(raw)
}

/**
 * Convert Atelier's `tokens/colors.json` shape into a Loom bundle.
 *
 * Atelier's file is `{background, foreground, primary, accent, muted, palette}`;
 * `foreground` in that file is the *ink* colour, not a literal foreground role,
 * and can be darker than the background (it is a design palette, not a theme).
 */
export function fromAtelierColors(raw: unknown): TokenBundle {
  const c = (raw ?? {}) as {
    background?: string
    foreground?: string
    primary?: string
    accent?: string
    muted?: string
  }
  const out: TokenBundle = { colors: {} }
  if (c.background) out.colors!.bg = c.background
  if (c.foreground) out.colors!.textPrimary = c.foreground
  if (c.primary) out.colors!.accent = c.primary
  if (c.accent) out.colors!.accentHover = c.accent
  if (c.muted) out.colors!.textMuted = c.muted
  return out
}

/** Serialise a live theme back into a bundle, so an edit can be saved. */
export function toBundle(t: Theme, name?: string): TokenBundle {
  return {
    name: name ?? t.name,
    colors: {
      bg: t.bg,
      surface: t.surface,
      surfaceGlass: t.surfaceGlass,
      border: t.border,
      borderStrong: t.borderStrong,
      textPrimary: t.textPrimary,
      textSecondary: t.textSecondary,
      textMuted: t.textMuted,
      accent: t.accent,
      accentHover: t.accentHover,
      danger: t.danger,
      success: t.success,
      warning: t.warning,
    },
    spacing: { scale: [t.space1, t.space2, t.space3, t.space4, t.space5, t.space6, t.space8] },
    typography: {
      fontFamily: t.fontFamily,
      fontMono: t.fontMono,
      sizes: {
        xs: t.textXs,
        sm: t.textSm,
        md: t.textMd,
        lg: t.textLg,
        xl: t.textXl,
        xxl: t.textXxl,
      },
    },
    radius: { sm: t.radiusSm, md: t.radiusMd, lg: t.radiusLg },
    elevation: { sm: t.shadowSm, md: t.shadowMd, lg: t.shadowLg, glow: t.shadowGlow },
    motion: { fast: t.motionFast, base: t.motionBase, slow: t.motionSlow, ease: t.ease },
  }
}

/** Emit a bundle as CSS custom properties, matching Atelier's `css-variables.css`. */
export function toCssVariables(t: Theme): string {
  return [
    ':root {',
    `  --loom-bg:${t.bg};`,
    `  --loom-surface:${t.surface};`,
    `  --loom-text-primary:${t.textPrimary};`,
    `  --loom-text-secondary:${t.textSecondary};`,
    `  --loom-text-muted:${t.textMuted};`,
    `  --loom-accent:${t.accent};`,
    `  --loom-accent-hover:${t.accentHover};`,
    `  --loom-danger:${t.danger};`,
    `  --loom-radius-sm:${t.radiusSm}px;`,
    `  --loom-radius-md:${t.radiusMd}px;`,
    `  --loom-radius-lg:${t.radiusLg}px;`,
    `  --loom-font:${t.fontFamily};`,
    `  --loom-mono:${t.fontMono};`,
    `  --loom-text-xs:${t.textXs}px;`,
    `  --loom-text-sm:${t.textSm}px;`,
    `  --loom-text-md:${t.textMd}px;`,
    `  --loom-text-lg:${t.textLg}px;`,
    `  --loom-text-xl:${t.textXl}px;`,
    `  --loom-text-xxl:${t.textXxl}px;`,
    `  --loom-shadow-md:${t.shadowMd};`,
    `  --loom-motion:${t.motionBase}ms;`,
    `  --loom-ease:${t.ease};`,
    '}',
  ].join('\n')
}
