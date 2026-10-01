/**
 * LOOK: how anything in Loom is made physical.
 *
 * A component (or any one of its named parts) carries a look: a stack of
 * fills, strokes and glows, a height above the page (z), a bevel, a sheen, a
 * texture, how it moves between states, and what it does when clicked. The
 * shadows, bevels and sheen are not drawn by hand: they are DERIVED from one
 * scene light (see `render/light.ts`), so moving the light moves every shadow
 * in the design, and a raised button, a pressed-in well and a floating card
 * all agree on where the light is.
 *
 * Every field is optional: an absent field means "the component's own look".
 * A state (hover, pressed...) is a patch over the base look, so a pressed
 * button that only sinks names only its new height.
 *
 * Values come from files, the panel and the assistant, and become stylesheet
 * TEXT, so everything is checked here: colours by the same grammar as the
 * interaction states, choices against fixed lists, numbers clamped to range.
 */

import { isSafeColor } from '../render/states'

export const LOOK_STATES = ['hover', 'focus', 'pressed', 'selected', 'disabled'] as const
export type LookState = (typeof LOOK_STATES)[number]

export const FILL_KINDS = ['solid', 'linear', 'radial', 'conic'] as const
export const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'color-dodge', 'plus-lighter'] as const
export const STROKE_POSITIONS = ['inside', 'center', 'outside'] as const
export const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const
export const BEVEL_STYLES = ['raised', 'sunken', 'pillow'] as const
export const EASINGS = ['smooth', 'snappy', 'spring', 'bouncy', 'linear'] as const
export const CLICK_EFFECTS = ['ripple', 'sweep', 'pulse', 'sink'] as const

export interface LookFill {
  kind: (typeof FILL_KINDS)[number]
  /** 1 colour for solid; 2-4 stops for a gradient. */
  colors: string[]
  /** Gradient direction in degrees (CSS: 0 = to top, 90 = to right). */
  angle: number
  opacity: number
  blend: (typeof BLENDS)[number]
}

export interface LookStroke {
  color: string
  /** A second colour makes the stroke a gradient running around the edge. */
  color2?: string
  width: number
  position: (typeof STROKE_POSITIONS)[number]
  style: (typeof STROKE_STYLES)[number]
  opacity: number
}

export interface LookGlow {
  color: string
  size: number
  strength: number
  /** Inside the edge instead of around it. */
  inner: boolean
}

export interface LookBevel {
  size: number
  strength: number
  style: (typeof BEVEL_STYLES)[number]
}

/** A light that runs around the edge: the "tracing" outline. */
export interface LookTrace {
  color: string
  width: number
  /** Seconds per lap. */
  speed: number
  /** How much of the edge is lit at once, 0..1. */
  arc: number
}

export interface Look {
  /** Height above the surface it sits on, in px. Shadows follow from the light. */
  z?: number
  fills?: LookFill[]
  strokes?: LookStroke[]
  glows?: LookGlow[]
  bevel?: LookBevel
  /** Pressed INTO the surface: an inner shadow from the light, in px. */
  inset?: number
  /** A gloss highlight on the side facing the light, 0..1. */
  sheen?: number
  /** Film grain, 0..1. */
  noise?: number
  /** Blurs the element itself, px. */
  blur?: number
  /** Blurs what is behind it (frosted glass), px. */
  backdrop?: number
  /** Makes the component's own surface see-through, 0..1 (the component itself only). */
  translucency?: number
  /** One radius for every corner, px. */
  radius?: number
  /** Per corner, px: top-left, top-right, bottom-right, bottom-left. Wins over `radius`. */
  corners?: [number, number, number, number]
  trace?: LookTrace
  opacity?: number
  scale?: number
  /** Moves it up (positive) or down on screen, px. */
  lift?: number
  brightness?: number
  /** Text colour. */
  ink?: string
  /** Recolours the component's own border. */
  edge?: string
}

export interface LookMotion {
  /** Milliseconds for a change of state. */
  duration: number
  easing: (typeof EASINGS)[number]
}

export interface LookSet {
  base: Look
  states?: Partial<Record<LookState, Look>>
  motion?: LookMotion
  /** What a click plays, in order (the component itself only). */
  click?: Array<(typeof CLICK_EFFECTS)[number]>
  /** The colour a click effect uses; the accent when absent. */
  clickColor?: string
}

/** The scene light: one sun for the whole design. */
export interface SceneLight {
  /** The direction the light comes FROM, degrees clockwise from the top. */
  angle: number
  /** How high the light stands above the page, degrees (90 = overhead: no offset). */
  height: number
  /** 0 = crisp shadows, 1 = very soft. */
  softness: number
  /** 0 = no shadows, 1 = strong. */
  strength: number
}

export const DEFAULT_LIGHT: SceneLight = { angle: 345, height: 55, softness: 0.55, strength: 0.6 }

/** Ranges, in one table: the panel's sliders and the sanitiser read the same numbers. */
export const RANGES = {
  z: [0, 64],
  inset: [0, 24],
  sheen: [0, 1],
  noise: [0, 1],
  blur: [0, 40],
  backdrop: [0, 60],
  radius: [0, 999],
  opacity: [0, 1],
  scale: [0.5, 1.5],
  lift: [-24, 24],
  brightness: [0.5, 1.5],
  fillOpacity: [0, 1],
  angle: [0, 360],
  strokeWidth: [0, 16],
  glowSize: [0, 80],
  glowStrength: [0, 1],
  bevelSize: [0, 24],
  bevelStrength: [0, 1],
  traceWidth: [1, 8],
  traceSpeed: [0.4, 20],
  traceArc: [0.05, 0.9],
  duration: [0, 2000],
  lightAngle: [0, 360],
  lightHeight: [5, 90],
  unit: [0, 1],
} as const

type RangeKey = keyof typeof RANGES

const num = (v: unknown, r: RangeKey): number | undefined => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined
  const [lo, hi] = RANGES[r]
  return Math.min(hi, Math.max(lo, v))
}
const pick = <T extends string>(v: unknown, options: readonly T[], d: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : d)
const color = (v: unknown): string | undefined => (isSafeColor(v) ? (v as string).trim() : undefined)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

function cleanFill(raw: unknown, where: string, dropped: string[]): LookFill | null {
  const o = obj(raw)
  if (!o) return (dropped.push(`${where} (not a fill)`), null)
  const colors = (Array.isArray(o.colors) ? o.colors : []).map(color).filter((c): c is string => !!c).slice(0, 4)
  if (!colors.length) return (dropped.push(`${where} (no valid colour)`), null)
  return {
    kind: pick(o.kind, FILL_KINDS, colors.length > 1 ? 'linear' : 'solid'),
    colors,
    angle: num(o.angle, 'angle') ?? 180,
    opacity: num(o.opacity, 'fillOpacity') ?? 1,
    blend: pick(o.blend, BLENDS, 'normal'),
  }
}

function cleanStroke(raw: unknown, where: string, dropped: string[]): LookStroke | null {
  const o = obj(raw)
  const c = color(o?.color)
  if (!o || !c) return (dropped.push(`${where} (needs a valid colour)`), null)
  const c2 = color(o.color2)
  return {
    color: c,
    ...(c2 ? { color2: c2 } : {}),
    width: num(o.width, 'strokeWidth') ?? 1,
    position: pick(o.position, STROKE_POSITIONS, 'inside'),
    style: pick(o.style, STROKE_STYLES, 'solid'),
    opacity: num(o.opacity, 'unit') ?? 1,
  }
}

function cleanGlow(raw: unknown, where: string, dropped: string[]): LookGlow | null {
  const o = obj(raw)
  const c = color(o?.color)
  if (!o || !c) return (dropped.push(`${where} (needs a valid colour)`), null)
  return { color: c, size: num(o.size, 'glowSize') ?? 16, strength: num(o.strength, 'glowStrength') ?? 0.6, inner: o.inner === true }
}

/** Keep what is valid in a look, clamped; report the rest. */
export function cleanLook(raw: unknown, where = 'look'): { look: Look; dropped: string[] } {
  const dropped: string[] = []
  const o = obj(raw)
  if (!o) return { look: {}, dropped: raw === undefined ? [] : [`${where} (not an object)`] }
  const look: Look = {}
  const known = new Set(['translucency', 'z', 'fills', 'strokes', 'glows', 'bevel', 'inset', 'sheen', 'noise', 'blur', 'backdrop', 'radius', 'corners', 'trace', 'opacity', 'scale', 'lift', 'brightness', 'ink', 'edge'])
  for (const k of Object.keys(o)) if (!known.has(k)) dropped.push(`${where}.${k} (unknown)`)
  const scalar: Array<[keyof Look, RangeKey]> = [
    ['translucency', 'unit'], ['z', 'z'], ['inset', 'inset'], ['sheen', 'sheen'], ['noise', 'noise'], ['blur', 'blur'], ['backdrop', 'backdrop'],
    ['radius', 'radius'], ['opacity', 'opacity'], ['scale', 'scale'], ['lift', 'lift'], ['brightness', 'brightness'],
  ]
  for (const [k, r] of scalar) {
    if (o[k] === undefined) continue
    const v = num(o[k], r)
    if (v === undefined) dropped.push(`${where}.${k} (not a number)`)
    else (look as Record<string, unknown>)[k] = v
  }
  for (const k of ['ink', 'edge'] as const) {
    if (o[k] === undefined) continue
    const c = color(o[k])
    if (c) look[k] = c
    else dropped.push(`${where}.${k} (not a colour)`)
  }
  if (Array.isArray(o.corners)) {
    const c = o.corners.slice(0, 4).map((v) => num(v, 'radius') ?? 0)
    if (c.length === 4) look.corners = c as [number, number, number, number]
    else dropped.push(`${where}.corners (needs four numbers)`)
  }
  const list = <T,>(key: 'fills' | 'strokes' | 'glows', max: number, clean: (r: unknown, w: string, d: string[]) => T | null): T[] | undefined => {
    if (o[key] === undefined) return undefined
    if (!Array.isArray(o[key])) return (dropped.push(`${where}.${key} (not a list)`), undefined)
    const arr = o[key] as unknown[]
    if (arr.length > max) dropped.push(`${where}.${key} (more than ${max}; the rest dropped)`)
    return arr.slice(0, max).map((r, i) => clean(r, `${where}.${key}[${i}]`, dropped)).filter((x): x is T => x !== null)
  }
  const fills = list('fills', 6, cleanFill)
  if (fills) look.fills = fills
  const strokes = list('strokes', 4, cleanStroke)
  if (strokes) look.strokes = strokes
  const glows = list('glows', 4, cleanGlow)
  if (glows) look.glows = glows
  const b = obj(o.bevel)
  if (b) look.bevel = { size: num(b.size, 'bevelSize') ?? 2, strength: num(b.strength, 'bevelStrength') ?? 0.5, style: pick(b.style, BEVEL_STYLES, 'raised') }
  const tr = obj(o.trace)
  if (tr) {
    const c = color(tr.color)
    if (c) look.trace = { color: c, width: num(tr.width, 'traceWidth') ?? 2, speed: num(tr.speed, 'traceSpeed') ?? 3, arc: num(tr.arc, 'traceArc') ?? 0.25 }
    else dropped.push(`${where}.trace (needs a valid colour)`)
  }
  return { look, dropped }
}

export function cleanLookSet(raw: unknown, where = 'look'): { set: LookSet | null; dropped: string[] } {
  const o = obj(raw)
  if (!o) return { set: null, dropped: raw === null || raw === undefined ? [] : [`${where} (not an object)`] }
  const dropped: string[] = []
  const base = cleanLook(o.base ?? {}, `${where}.base`)
  dropped.push(...base.dropped)
  const set: LookSet = { base: base.look }
  const st = obj(o.states)
  if (st) {
    const states: Partial<Record<LookState, Look>> = {}
    for (const [k, v] of Object.entries(st)) {
      if (!(LOOK_STATES as readonly string[]).includes(k)) {
        dropped.push(`${where}.states.${k} (not a state)`)
        continue
      }
      const c = cleanLook(v, `${where}.states.${k}`)
      dropped.push(...c.dropped)
      if (Object.keys(c.look).length) states[k as LookState] = c.look
    }
    if (Object.keys(states).length) set.states = states
  }
  const m = obj(o.motion)
  if (m) set.motion = { duration: num(m.duration, 'duration') ?? 180, easing: pick(m.easing, EASINGS, 'smooth') }
  if (Array.isArray(o.click)) {
    const click = o.click.filter((c): c is (typeof CLICK_EFFECTS)[number] => (CLICK_EFFECTS as readonly string[]).includes(c as string))
    if (click.length) set.click = [...new Set(click)]
  }
  const cc = color(o.clickColor)
  if (cc) set.clickColor = cc
  return { set: isEmptySet(set) ? null : set, dropped }
}

export function cleanLight(raw: unknown): SceneLight | null {
  const o = obj(raw)
  if (!o) return null
  return {
    angle: num(o.angle, 'lightAngle') ?? DEFAULT_LIGHT.angle,
    height: num(o.height, 'lightHeight') ?? DEFAULT_LIGHT.height,
    softness: num(o.softness, 'unit') ?? DEFAULT_LIGHT.softness,
    strength: num(o.strength, 'unit') ?? DEFAULT_LIGHT.strength,
  }
}

export function isEmptySet(set: LookSet | null | undefined): boolean {
  return !set || (Object.keys(set.base).length === 0 && !set.states && !set.click?.length && !set.motion)
}

/** A state's look over the base: the state's fields replace the base's. */
export function mergeLook(base: Look, patch: Look | undefined): Look {
  return patch ? { ...base, ...patch } : base
}

/** Deep copy, so an op never shares arrays with the document. */
export function cloneLookSet(set: LookSet): LookSet {
  return JSON.parse(JSON.stringify(set)) as LookSet
}

/* ---------------------------------------------------------------- styles -- */

/**
 * Built-in saved styles: complete looks that work on any component, because
 * none of them needs to know its colours (they use the theme's, through the
 * `var(--loom-*)` tokens every surface carries). The beginner's way in: one
 * click, and the light does the rest.
 */
export interface LookStyle {
  id: string
  label: string
  hint: string
  set: LookSet
}

const ACCENT = 'var(--loom-accent)'

export const BUILTIN_STYLES: readonly LookStyle[] = [
  {
    id: 'raised',
    label: 'Raised',
    hint: 'Sits a little above the page; lifts on hover, sinks when pressed',
    set: { base: { z: 4, bevel: { size: 1, strength: 0.35, style: 'raised' } }, states: { hover: { z: 8 }, pressed: { z: 1, scale: 0.985 } }, motion: { duration: 180, easing: 'spring' } },
  },
  {
    id: 'floating',
    label: 'Floating',
    hint: 'High above the page, with a long soft shadow',
    set: { base: { z: 18 }, states: { hover: { z: 26 } }, motion: { duration: 260, easing: 'smooth' } },
  },
  {
    id: 'pressed-in',
    label: 'Pressed in',
    hint: 'A well pressed into the surface, lit from the scene light',
    set: { base: { z: 0, inset: 4 }, states: { focus: { glows: [{ color: ACCENT, size: 10, strength: 0.5, inner: false }] } } },
  },
  {
    id: 'clay',
    label: 'Clay',
    hint: 'Soft, pillowy and tactile',
    set: { base: { z: 10, radius: 18, bevel: { size: 6, strength: 0.55, style: 'pillow' } }, states: { hover: { z: 14 }, pressed: { z: 2, inset: 3 } }, motion: { duration: 220, easing: 'bouncy' } },
  },
  {
    id: 'gloss',
    label: 'Gloss',
    hint: 'A polished face that catches the light',
    set: { base: { z: 6, sheen: 0.7, bevel: { size: 1, strength: 0.6, style: 'raised' } }, states: { hover: { sheen: 0.95, z: 9 }, pressed: { z: 2, sheen: 0.4 } }, click: ['sweep'], motion: { duration: 180, easing: 'smooth' } },
  },
  {
    id: 'glass',
    label: 'Glass',
    hint: 'Frosted, translucent, with a lit edge',
    set: { base: { z: 12, translucency: 0.5, backdrop: 18, strokes: [{ color: 'rgba(255,255,255,0.45)', color2: 'rgba(255,255,255,0.04)', width: 1, position: 'inside', style: 'solid', opacity: 1 }], sheen: 0.3 }, states: { hover: { z: 16 } }, motion: { duration: 220, easing: 'smooth' } },
  },
  {
    id: 'neon',
    label: 'Neon edge',
    hint: 'A glowing 2px line around the outside',
    set: { base: { strokes: [{ color: ACCENT, width: 2, position: 'outside', style: 'solid', opacity: 1 }], glows: [{ color: ACCENT, size: 18, strength: 0.75, inner: false }] }, states: { hover: { glows: [{ color: ACCENT, size: 28, strength: 0.95, inner: false }] }, pressed: { glows: [{ color: ACCENT, size: 10, strength: 0.6, inner: false }] } }, click: ['pulse'], motion: { duration: 160, easing: 'smooth' } },
  },
  {
    id: 'traced',
    label: 'Traced',
    hint: 'A light that runs around the edge',
    set: { base: { strokes: [{ color: 'var(--loom-border-strong)', width: 1, position: 'inside', style: 'solid', opacity: 1 }], trace: { color: ACCENT, width: 2, speed: 3, arc: 0.22 } }, states: { hover: { trace: { color: ACCENT, width: 2, speed: 1.4, arc: 0.3 } } } },
  },
  {
    id: 'ripple',
    label: 'Ripple',
    hint: 'A ripple spreads from where it is clicked',
    set: { base: { z: 2 }, states: { hover: { z: 5 }, pressed: { z: 1 } }, click: ['ripple'], motion: { duration: 160, easing: 'snappy' } },
  },
  {
    id: 'flat',
    label: 'Flat',
    hint: 'No depth at all: the light is ignored',
    set: { base: { z: 0, sheen: 0, inset: 0 } },
  },
]
