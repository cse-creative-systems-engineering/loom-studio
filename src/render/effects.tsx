/**
 * Effects — the atmosphere layer.
 *
 * Ported from Atelier's `Y1()` default bag, which is a better model than what
 * Loom had: effects are DECLARED here once, on the theme, rather than being
 * sprinkled through the component switch as hard-coded CSS. A component opts in
 * with `effects: ['aurora', 'grain']`, the inspector generates controls from
 * the same declaration, and the desktop backend can gate the ones it cannot
 * represent.
 *
 * Every effect is a pure function from (props, theme, interaction state) to
 * React CSS + optional decoration nodes. That keeps them testable and keeps
 * the renderer a compiler rather than a pile of conditionals.
 */

import type { CSSProperties, ReactNode } from 'react'
import type { Theme } from './theme'

export type EffectName =
  | 'grain'
  | 'glass'
  | 'aurora'
  | 'spotlight'
  | 'shimmer'
  | 'glow'
  | 'tilt'
  | 'chromatic'

export interface EffectValues {
  /* grain */
  grain: boolean
  grainIntensity: number
  /* glass */
  glass: boolean
  glassBlur: number
  glassSaturation: number
  innerGlowColor: string
  /* aurora */
  aurora: boolean
  auroraFrom: string
  auroraVia: string
  auroraTo: string
  auroraSpeed: number
  auroraBlur: number
  /* spotlight */
  spotlight: boolean
  spotlightColor: string
  spotlightSize: number
  /* shimmer */
  shimmer: boolean
  shimmerSpeed: number
  shimmerBorderWidth: number
  /* glow */
  glow: boolean
  glowColor: string
  glowSpread: number
  /* tilt */
  tilt: boolean
  tiltMax: number
  /* chromatic */
  chromatic: boolean
  /* motion */
  motion: 'none' | 'fade' | 'scale' | 'blur'
  hoverScale: number
}

/**
 * Defaults ported from Atelier. These are the values its components ship with,
 * so a Loom component with the same effects looks like Atelier's.
 */
export const DEFAULT_EFFECTS: EffectValues = {
  grain: false,
  grainIntensity: 0.15,
  glass: false,
  glassBlur: 24,
  glassSaturation: 150,
  innerGlowColor: 'rgba(255,255,255,0.8)',
  aurora: false,
  auroraFrom: '#6366f1',
  auroraVia: '#8b5cf6',
  auroraTo: '#ec4899',
  auroraSpeed: 6,
  auroraBlur: 40,
  spotlight: false,
  spotlightColor: 'rgba(255,255,255,0.15)',
  spotlightSize: 320,
  shimmer: false,
  shimmerSpeed: 2,
  shimmerBorderWidth: 1,
  glow: false,
  glowColor: '#7c3aed',
  glowSpread: 24,
  tilt: false,
  tiltMax: 12,
  chromatic: false,
  motion: 'none',
  hoverScale: 1.02,
}

/**
 * Coerce an untrusted partial bag into a full, correctly-typed one.
 *
 * The parameter is deliberately loose (`object`-shaped) rather than
 * `Record<string, unknown>`: a typed `EffectValues` has no index signature, so
 * requiring one forces every caller into a cast. Accepting the wider shape and
 * reading through a widened view keeps callers cast-free.
 */
export function normalizeEffects(raw?: object): EffectValues {
  const out: EffectValues = { ...DEFAULT_EFFECTS }
  const w = out as unknown as Record<string, boolean | number | string>
  const src = (raw ?? {}) as Record<string, unknown>

  for (const k of Object.keys(w)) {
    const v = src[k]
    if (v === undefined) continue
    // An explicit null means "unset this key", which is how an inverse
    // expresses "it was not there before". Deleting beats defaulting: leaving
    // the default in place would make undo of a first-write indistinguishable
    // from a deliberate reset.
    if (v === null) {
      delete w[k]
      continue
    }
    const cur = w[k]
    if (typeof cur === 'boolean') {
      w[k] = v === true || v === 'true'
    } else if (typeof cur === 'number') {
      const n = Number(v)
      if (Number.isFinite(n)) w[k] = n
    } else if (typeof cur === 'string') {
      w[k] = String(v)
    }
  }
  return out
}

/**
 * Pointer state an effect may react to. Supplied by the canvas each frame.
 *
 * `magnetX`/`magnetY` are DISPLACEMENT, not an on/off: the canvas decides
 * whether a magnet pull applies and passes the resolved offset. There is
 * deliberately no `magnet` boolean in `EffectValues` — a half-wired flag that
 * nothing can turn on is a prop that lies, and a prop that lies is a bug.
 */
export interface EffectInput {
  /** Pointer position relative to the element, or null when not hovering. */
  localX?: number
  localY?: number
  hovered?: boolean
  /** Magnetic displacement already computed by the canvas. */
  magnetX?: number
  magnetY?: number
}

export interface EffectOutput {
  style: CSSProperties
  /** Decoration layers to render INSIDE the element, beneath its content. */
  layers: ReactNode[]
  /** Extra CSS the element needs (keyframes, custom properties). */
  className?: string
}

export function applyEffects(
  e: EffectValues,
  t: Theme,
  input: EffectInput = {},
  id: string,
): EffectOutput {
  const style: CSSProperties = {}
  const layers: ReactNode[] = []
  let className: string | undefined

  /* ---- glass ---------------------------------------------------- */
  if (e.glass) {
    style.backdropFilter = `blur(${e.glassBlur}px) saturate(${e.glassSaturation}%)`
    style.WebkitBackdropFilter = `blur(${e.glassBlur}px) saturate(${e.glassSaturation}%)`
    // Inner highlight: the single detail that makes glass read as glass.
    style.boxShadow = `inset 0 1px 0 0 ${e.innerGlowColor}`
    if (e.glow) {
      style.boxShadow += `, 0 0 ${e.glowSpread}px ${e.glowColor}`
    }
  } else if (e.glow) {
    style.boxShadow = `0 0 ${e.glowSpread}px ${e.glowColor}`
  }

  /* ---- aurora ---------------------------------------------------- */
  if (e.aurora) {
    const orb = (key: string, color: string, pct: number, blur: number, dur: number, pos: React.CSSProperties) => (
      <div
        key={key}
        aria-hidden="true"
        style={{
          position: 'absolute',
          pointerEvents: 'none',
          borderRadius: '50%',
          mixBlendMode: 'screen',
          opacity: 0.55,
          ...pos,
          width: pct + '%',
          height: pct + '%',
          filter: `blur(${blur}px)`,
          background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
          animation: `loom-float ${dur}s ease-in-out infinite`,
        }}
      />
    )
    layers.push(
      orb('a', e.auroraFrom, 60, e.auroraBlur / 2, e.auroraSpeed, { left: '8%', top: '6%' }),
      orb('b', e.auroraVia, 52, e.auroraBlur, e.auroraSpeed + 1, { right: '4%', top: '28%' }),
      orb('c', e.auroraTo, 56, e.auroraBlur * 1.2, e.auroraSpeed + 2, { left: '28%', bottom: '-4%' }),
    )
    className = 'loom-aurora'
  }

  /* ---- grain ----------------------------------------------------- */
  if (e.grain && e.grainIntensity > 0) {
    layers.push(
      <div
        key="grain"
        aria-hidden="true"
        className="loom-grain"
        style={{ opacity: e.grainIntensity, ['--grain-op' as string]: e.grainIntensity }}
      />,
    )
  }

  /* ---- spotlight -------------------------------------------------- */
  if (e.spotlight) {
    const x = input.localX ?? 0
    const y = input.localY ?? 0
    layers.push(
      <div
        key="spot"
        aria-hidden="true"
        className="loom-spotlight"
        style={{
          background: `radial-gradient(${e.spotlightSize}px circle at ${x}px ${y}px, ${e.spotlightColor}, transparent 70%)`,
          opacity: input.hovered === false ? 0 : 1,
          transition: 'opacity 220ms cubic-bezier(0.2,0.8,0.3,1)',
        }}
      />,
    )
  }

  /* ---- shimmer ---------------------------------------------------- */
  if (e.shimmer) {
    layers.push(
      <span key="shim" aria-hidden="true" className="loom-shimmer" style={{ ['--shimmer-dur' as string]: `${e.shimmerSpeed}s` }}>
        <span
          style={{
            position: 'absolute',
            inset: -1,
            borderRadius: 'inherit',
            padding: e.shimmerBorderWidth,
            background: 'linear-gradient(110deg, transparent 20%, #fff 40%, transparent 60%)',
            WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
          }}
        >
          <span
            style={{
              position: 'absolute',
              inset: 0,
              width: '200%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent)',
              animation: `loom-shimmer-sweep ${e.shimmerSpeed}s linear infinite`,
            }}
          />
        </span>
      </span>,
    )
  }

  /* ---- tilt + magnet --------------------------------------------- */
  if (e.tilt && input.localX !== undefined && input.localY !== undefined) {
    const max = e.tiltMax
    style.transform = `perspective(800px) rotateY(${(input.localX / 20) * (max / 12)}deg) rotateX(${(-input.localY / 20) * (max / 12)}deg)`
    style.transformStyle = 'preserve-3d'
  } else if (input.magnetX !== undefined || input.magnetY !== undefined) {
    style.transform = `translate(${input.magnetX ?? 0}px, ${input.magnetY ?? 0}px)`
  }

  /* ---- hover motion ------------------------------------------------ */
  if (e.hoverScale !== 1 && e.motion !== 'none') {
    style.transition = 'transform 200ms cubic-bezier(0.2,0.8,0.3,1)'
  }

  /* ---- chromatic --------------------------------------------------- */
  if (e.chromatic) {
    style.textShadow = '1px 0 rgba(255,0,255,0.55), -1px 0 rgba(0,255,255,0.55)'
  }

  void t
  void id
  return { style, layers, className }
}

/**
 * Keyframes the effect layers reference. Injected once by the renderer.
 * Ported from Atelier's <style> block.
 */
export const EFFECT_KEYFRAMES = `
@keyframes loom-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(8px, -12px) scale(1.05); }
}
@keyframes loom-shimmer-sweep {
  0% { transform: translateX(-150%); }
  100% { transform: translateX(150%); }
}
.loom-grain {
  position: absolute; inset: 0; pointer-events: none; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E");
}
.loom-spotlight {
  position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
}
.loom-shimmer {
  position: absolute; inset: 0; border-radius: inherit; pointer-events: none; overflow: hidden;
}
`

/**
 * Which effects a target can represent. The desktop backend has no WebGL
 * compositor behind it, so atmosphere degrades to a flat approximation.
 */
export const DESKTOP_UNSUPPORTED: EffectName[] = [
  'aurora',
  'spotlight',
  'shimmer',
  'tilt',
  'chromatic',
  'grain',
]

export function effectSupported(e: EffectName, target: 'web' | 'desktop'): boolean {
  return target === 'web' || !DESKTOP_UNSUPPORTED.includes(e)
}
