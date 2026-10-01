/**
 * Looks, compiled: one generated stylesheet for every look in a document,
 * shared by the canvas, the live preview and both exports (`document-css.ts`),
 * like the responsive, part and state layers before it.
 *
 * A look is DECLARED (fills, strokes, glows, z, bevel, sheen...) and this
 * turns it into CSS against the scene light (`light.ts`):
 *
 *  - Everything that is a shadow (elevation, bevel, wells, solid strokes,
 *    glows) becomes ONE `box-shadow` list, so they stack in a fixed order and
 *    never fight over the property.
 *  - Fills, sheen, grain and the dark-theme lift tint become background
 *    layers; with no fills of its own the component keeps its own colour and
 *    the light's layers sit on top of it.
 *  - A dashed stroke is the outline; a gradient stroke is a masked ring
 *    (`::after`), and a travelling light is a masked, rotating conic ring
 *    (`::before`).
 *  - A state is a patch over the base, behind the real interaction (`:hover`,
 *    `:active`, `[aria-selected]`...) or the editor's forced attribute, with a
 *    transition in the look's own easing (springs as `linear()` curves).
 *  - A PART's states follow its COMPONENT's: hovering a card can light its
 *    title.
 *
 * Every value was sanitised by `cleanLook`, and is sanitised again here, as
 * the one place values become stylesheet text.
 */

import type { Document, Node } from '../model/types'
import { cleanLookSet, mergeLook, type Look, type LookSet, type LookState, type LookStroke, type SceneLight } from '../model/look'
import { resolveTheme, type Theme } from './theme'
import { OUTPUT_HOOK, cssString } from './responsive'
import { partSelector } from './parts'
import { FORCE_ATTR } from './states'
import { bevelShadows, elevationShadows, insetShadows, lightOf, liftTint, shadeFor, sheenLayer, type Shade } from './light'

/** True when a node carries any look. */
export function hasLook(node: Node): boolean {
  return !!node.looks && Object.keys(node.looks).length > 0
}

/** True when this node's own element (not a part) carries a look. */
export function hasRootLook(node: Node): boolean {
  return !!node.looks?.['']
}

/** The attribute the canvas puts on a form control drawn inside its editor box. */
export const CHILDLESS_ATTR = 'data-loom-childless'

/**
 * The selector for a node's own element: the editor box on the canvas, or
 * the control inside it when the box is only a frame for an <input>; the
 * output hook in Preview and the exports.
 */
export function lookRootSelector(id: string): string {
  const q = cssString(id)
  return `:is([data-loom-id=${q}]:not(:has(> [${CHILDLESS_ATTR}])),[data-loom-id=${q}] > [${CHILDLESS_ATTR}],[${OUTPUT_HOOK}=${q}])`
}

/* --------------------------------------------------------------- easing -- */

/** A damped spring as a CSS `linear()` curve: what makes a press feel physical. */
function springCurve(zeta: number, omega: number): string {
  const pts: string[] = []
  const n = 28
  const wd = omega * Math.sqrt(Math.max(0.0001, 1 - zeta * zeta))
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = i === n ? 1 : 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t))
    pts.push(String(Math.round(x * 1000) / 1000))
  }
  return `linear(${pts.join(',')})`
}

export function easingCss(easing: string | undefined): string {
  switch (easing) {
    case 'snappy':
      return 'cubic-bezier(.3,0,.1,1)'
    case 'linear':
      return 'linear'
    case 'spring':
      return springCurve(0.72, 11)
    case 'bouncy':
      return springCurve(0.42, 13)
    default:
      return 'cubic-bezier(.2,.8,.3,1)'
  }
}

/* --------------------------------------------------------------- pieces -- */

const pct = (n: number) => `${Math.round(n * 100)}%`
const withAlpha = (color: string, a: number) => (a >= 1 ? color : `color-mix(in srgb, ${color} ${pct(a)}, transparent)`)

function fillImage(f: NonNullable<Look['fills']>[number]): string {
  const cs = f.colors.map((c) => withAlpha(c, f.opacity))
  switch (f.kind) {
    case 'solid':
      return `linear-gradient(${cs[0]}, ${cs[0]})`
    case 'radial':
      return `radial-gradient(circle at 50% 35%, ${(cs.length > 1 ? cs : [cs[0], cs[0]]).join(', ')})`
    case 'conic':
      return `conic-gradient(from ${Math.round(f.angle)}deg, ${[...cs, cs[0]].join(', ')})`
    default:
      return `linear-gradient(${Math.round(f.angle)}deg, ${(cs.length > 1 ? cs : [cs[0], cs[0]]).join(', ')})`
  }
}

/** Film grain as a tiny tiled SVG: no request, no script. */
function noiseImage(amount: number): string {
  const a = Math.round(Math.min(1, amount) * 55) / 100
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .5 0 0 0 0 .5 0 0 0 0 .5 0 0 0 ${a} 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>`
  return `url("data:image/svg+xml,${svg.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'")}")`
}

function strokeShadows(s: LookStroke): string[] {
  if (s.style !== 'solid' || s.color2 || !(s.width > 0)) return []
  const c = withAlpha(s.color, s.opacity)
  if (s.position === 'outside') return [`0 0 0 ${s.width}px ${c}`]
  if (s.position === 'inside') return [`inset 0 0 0 ${s.width}px ${c}`]
  return [`inset 0 0 0 ${s.width / 2}px ${c}`, `0 0 0 ${s.width / 2}px ${c}`]
}

function radiusCss(l: Look): string | null {
  if (l.corners) return l.corners.map((r) => `${r}px`).join(' ')
  if (l.radius !== undefined) return `${l.radius}px`
  return null
}

/** A masked ring around the edge (a gradient stroke, a travelling light). */
function ring(width: number, position: LookStroke['position']): string[] {
  const out = position === 'outside' ? width : position === 'center' ? width / 2 : 0
  return [
    "content:''",
    'position:absolute',
    `inset:${-out}px`,
    `padding:${width}px`,
    'border-radius:inherit',
    'pointer-events:none',
    '-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0)',
    '-webkit-mask-composite:xor',
    'mask:linear-gradient(#000 0 0) content-box exclude,linear-gradient(#000 0 0)',
  ]
}

interface Compiled {
  decls: string[]
  before: string[] | null
  after: string[] | null
}

/** One look as declarations (all !important: the base look is inline). */
export function compileLook(l: Look, light: SceneLight, shade: Shade): Compiled {
  const d: string[] = []
  // --- every shadow, in one list, in a fixed stacking order -------------
  const touchesShadow = l.z !== undefined || l.strokes !== undefined || l.glows !== undefined || l.bevel !== undefined || l.inset !== undefined
  if (touchesShadow) {
    const strokes = (l.strokes ?? []).flatMap(strokeShadows)
    const glowsOut = (l.glows ?? []).filter((g) => !g.inner).flatMap((g) => [`0 0 ${Math.round(g.size * 0.35)}px ${withAlpha(g.color, g.strength)}`, `0 0 ${g.size}px ${withAlpha(g.color, g.strength * 0.7)}`])
    const glowsIn = (l.glows ?? []).filter((g) => g.inner).map((g) => `inset 0 0 ${g.size}px ${withAlpha(g.color, g.strength)}`)
    const bevel = l.bevel ? bevelShadows(l.bevel.size, l.bevel.strength, l.bevel.style, light, shade) : []
    const well = insetShadows(l.inset ?? 0, light, shade)
    const lift = elevationShadows(l.z ?? 0, light, shade)
    const all = [...strokes, ...bevel, ...well, ...glowsIn, ...glowsOut, ...lift]
    d.push(`box-shadow:${all.length ? all.join(',') : 'none'}`)
  }
  // --- surface layers -----------------------------------------------------
  const images: string[] = []
  const sizes: string[] = []
  const blends: string[] = []
  const sheen = sheenLayer(l.sheen ?? 0, light)
  if (sheen) (images.push(sheen), sizes.push('auto'), blends.push('normal'))
  if ((l.noise ?? 0) > 0) (images.push(noiseImage(l.noise!)), sizes.push('160px 160px'), blends.push('overlay'))
  const tint = liftTint(l.z ?? 0, shade)
  if (tint > 0) (images.push(`linear-gradient(rgb(255 255 255 / ${tint}), rgb(255 255 255 / ${tint}))`), sizes.push('auto'), blends.push('normal'))
  for (const f of l.fills ?? []) (images.push(fillImage(f)), sizes.push('auto'), blends.push(f.blend))
  if (l.fills !== undefined) d.push('background-color:transparent')
  if (images.length) {
    d.push(`background-image:${images.join(',')}`, `background-size:${sizes.join(',')}`, 'background-repeat:repeat', `background-blend-mode:${blends.join(',')}`)
  } else if (l.fills !== undefined) {
    d.push('background-image:none')
  }
  // --- shape, tone and transform -------------------------------------------
  const r = radiusCss(l)
  if (r) d.push(`border-radius:${r}`)
  if (l.ink) d.push(`color:${l.ink}`)
  if (l.edge) d.push(`border-color:${l.edge}`)
  if (l.opacity !== undefined) d.push(`opacity:${l.opacity}`)
  if (l.scale !== undefined) d.push(`scale:${l.scale}`)
  if (l.lift !== undefined) d.push(`translate:0 ${-l.lift}px`)
  const filters = [l.brightness !== undefined ? `brightness(${l.brightness})` : '', (l.blur ?? 0) > 0 ? `blur(${l.blur}px)` : ''].filter(Boolean)
  if (l.brightness !== undefined || l.blur !== undefined) d.push(`filter:${filters.length ? filters.join(' ') : 'none'}`)
  if (l.backdrop !== undefined) {
    const b = l.backdrop > 0 ? `blur(${l.backdrop}px) saturate(1.4)` : 'none'
    d.push(`backdrop-filter:${b}`, `-webkit-backdrop-filter:${b}`)
  }
  // --- the one dashed/dotted stroke is the outline ------------------------
  const dashed = (l.strokes ?? []).find((s) => s.style !== 'solid' && !s.color2)
  if (dashed) d.push(`outline:${dashed.width}px ${dashed.style} ${withAlpha(dashed.color, dashed.opacity)}`, `outline-offset:${dashed.position === 'inside' ? -dashed.width : dashed.position === 'center' ? -dashed.width / 2 : 0}px`)
  // --- rings: a gradient stroke (::after), a travelling light (::before) ---
  const grad = (l.strokes ?? []).find((s) => s.color2)
  const after = grad
    ? [...ring(grad.width, grad.position), `background:linear-gradient(${Math.round((light.angle + 180) % 360)}deg, ${withAlpha(grad.color, grad.opacity)}, ${withAlpha(grad.color2!, grad.opacity)})`]
    : null
  const before = l.trace
    ? [
        ...ring(l.trace.width, 'inside'),
        `background:conic-gradient(from var(--loom-trace), transparent 0turn, ${l.trace.color} ${Math.round(l.trace.arc * 1000) / 1000}turn, transparent ${Math.min(1, Math.round((l.trace.arc + 0.02) * 1000) / 1000)}turn)`,
        `animation:loom-trace ${l.trace.speed}s linear infinite`,
      ]
    : null
  return { decls: d.map((x) => `${x} !important`), before: before?.map((x) => `${x} !important`) ?? null, after: after?.map((x) => `${x} !important`) ?? null }
}

/* ------------------------------------------------------------- selectors -- */

const SELECTED = '[aria-selected="true"],[aria-pressed="true"],[aria-current="page"],[aria-current="true"],[aria-checked="true"],[data-loom-on="1"],[data-loom-open="1"]'
const DISABLED = ':disabled,[aria-disabled="true"]'

/** How `sel` reads in `state`: the real interaction, or the editor forcing it. */
function stateOf(sel: string, state: LookState): string[] {
  const forced = `${sel}[${FORCE_ATTR}="${state}"]`
  switch (state) {
    case 'hover':
      return [`${sel}:hover`, forced]
    case 'focus':
      return [`${sel}:focus-visible`, `${sel}:has(:focus-visible)`, forced]
    case 'pressed':
      return [`${sel}:active`, forced]
    case 'selected':
      return [`${sel}:is(${SELECTED})`, forced]
    case 'disabled':
      return [`${sel}:is(${DISABLED})`, forced]
  }
}

const TRANSITIONED = ['box-shadow', 'background-color', 'color', 'border-color', 'outline-color', 'opacity', 'scale', 'translate', 'filter', 'backdrop-filter', 'border-radius']

/* ------------------------------------------------------------- the sheet -- */

/** The generated stylesheet for every look in a document; empty when none. */
export function lookCss(doc: Document, theme: Theme = resolveTheme(doc.meta.theme)): string {
  const light = lightOf(doc.meta)
  const shade = shadeFor(theme.colorScheme)
  const base: string[] = []
  const pos: string[] = []
  const hover: string[] = []
  const rest: string[] = []
  const moving: string[] = []
  let traces = false
  const traced: string[] = []
  for (const node of Object.values(doc.nodes)) {
    if (!node.looks) continue
    const root = lookRootSelector(node.id)
    for (const [target, raw] of Object.entries(node.looks)) {
      // Sanitised again at emission: a document built in code never passed
      // through the op or the loader.
      const set: LookSet | null = cleanLookSet(raw).set
      if (!set) continue
      const sel = target === '' ? root : partSelector(node.id, target)
      const emit = (selectors: string[], look: Look, into: string[]) => {
        const c = compileLook(look, light, shade)
        if (c.decls.length) into.push(`${selectors.join(',')}{${c.decls.join(';')}}`)
        if (c.before) {
          traces = true
          traced.push(...selectors)
          into.push(`${selectors.map((s) => `${s}::before`).join(',')}{${c.before.join(';')}}`)
        }
        if (c.after) into.push(`${selectors.map((s) => `${s}::after`).join(',')}{${c.after.join(';')}}`)
        if (c.before || c.after) pos.push(...selectors)
      }
      emit([sel], set.base, base)
      const states = set.states ?? {}
      const stateList = Object.keys(states) as LookState[]
      if (stateList.length || set.motion) {
        const m = set.motion ?? { duration: 180, easing: 'smooth' as const }
        const e = easingCss(m.easing)
        base.push(`${sel}{transition:${TRANSITIONED.map((p) => `${p} ${m.duration}ms ${e}`).join(',')} !important}`)
        moving.push(sel)
      }
      // Cascade order is the state order: pressed after hover, so a press
      // wins while the pointer still hovers; disabled last of all.
      for (const state of ['hover', 'focus', 'selected', 'pressed', 'disabled'] as LookState[]) {
        const patch = states[state]
        if (!patch) continue
        const merged = mergeLook(set.base, patch)
        // Only what the state changes, plus what it must recompute: a new z
        // rebuilds the whole shadow list from the merged look.
        const look: Look = { ...patch }
        if (patch.z !== undefined || patch.strokes || patch.glows || patch.bevel || patch.inset !== undefined) {
          Object.assign(look, { z: merged.z, strokes: merged.strokes, glows: merged.glows, bevel: merged.bevel, inset: merged.inset })
        }
        if (patch.sheen !== undefined || patch.noise !== undefined || patch.fills || patch.z !== undefined) {
          Object.assign(look, { sheen: merged.sheen, noise: merged.noise, fills: merged.fills })
        }
        const selectors =
          target === ''
            ? stateOf(sel, state)
            : // A part follows its component's state, and its own.
              [...stateOf(root, state).map((s) => `${s} ${sel}`), ...stateOf(sel, state).slice(0, 1)]
        if (state === 'hover') {
          const live = selectors.filter((s) => !s.includes(FORCE_ATTR))
          const forced = selectors.filter((s) => s.includes(FORCE_ATTR))
          emit(live, look, hover)
          if (forced.length) emit(forced, look, rest)
        } else emit(selectors, look, rest)
      }
    }
  }
  if (!base.length && !rest.length && !hover.length) return ''
  return [
    '/* Generated by Loom: looks, lit by the scene light. Do not edit by hand. */',
    // A ring (::before/::after) is placed against its element; inline
    // positioning (a free node is absolute) still wins, which is right.
    pos.length ? `${[...new Set(pos)].join(',')}{position:relative}` : '',
    traces ? '@property --loom-trace{syntax:"<angle>";inherits:false;initial-value:0deg}@keyframes loom-trace{to{--loom-trace:360deg}}' : '',
    ...base,
    hover.length ? `@media (hover:hover){${hover.join('\n')}}` : '',
    ...rest,
    // Still for anyone who asked for less motion: no state transitions, and
    // a travelling light that stays where it is.
    moving.length || traced.length
      ? `@media (prefers-reduced-motion:reduce){${moving.length ? `${moving.join(',')}{transition:none !important}` : ''}${traced.length ? `${traced.map((x) => `${x}::before`).join(',')}{animation:none !important}` : ''}}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
