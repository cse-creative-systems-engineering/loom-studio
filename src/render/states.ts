/**
 * Interaction states (hover, focus, pressed), as generated CSS.
 *
 * The same discipline as the responsive layer, and the same pipe: one
 * generated stylesheet shared by the editor canvas, the live preview and both
 * exports, addressing nodes through `nodeSelector` (editor id OR output hook)
 * with `!important` because the base look is inline. A state that only worked
 * in the editor would be worse than none.
 *
 * Choices that make this feel right rather than merely work:
 *  - Every field is visual and animatable; none moves layout, so hovering can
 *    never reflow a page. `lift` and `scale` use the independent `translate`
 *    and `scale` properties, which COMPOSE with a node's own `transform`
 *    (rotation, centring) instead of replacing it.
 *  - `brightness` darkens or lightens any surface without knowing its colour,
 *    which is what makes one-click presets possible on any component.
 *  - Hover rules sit behind `(hover: hover)`, so a tap on a phone does not
 *    leave a control stuck in its hover look.
 *  - Focus uses `:focus-visible` (keyboard focus, not every mouse click), and
 *    `:has(:focus-visible)` so a card or field lights up while the control
 *    inside it is focused.
 *  - Transitions respect `prefers-reduced-motion`.
 */

import {
  INTERACTION_STATES,
  type Document,
  type InteractionState,
  type Node,
  type StateStyle,
} from '../model/types'
import { resolveTheme, type Theme } from './theme'
import { nodeSelector } from './responsive'

export interface StateField {
  key: keyof StateStyle
  label: string
  kind: 'color' | 'shadow' | 'number'
  min?: number
  max?: number
  step?: number
  /** Shown to a person as a percentage (0.95 -> 95%). */
  percent?: boolean
  /** Unit shown beside a plain number. */
  unit?: string
}

/** What a state may change, in panel order. The single source for UI and validation. */
export const STATE_FIELDS: readonly StateField[] = [
  { key: 'background', label: 'Background', kind: 'color' },
  { key: 'color', label: 'Text colour', kind: 'color' },
  { key: 'border', label: 'Border colour', kind: 'color' },
  { key: 'shadow', label: 'Shadow', kind: 'shadow' },
  { key: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, step: 0.01, percent: true },
  { key: 'scale', label: 'Scale', kind: 'number', min: 0.5, max: 1.5, step: 0.01, percent: true },
  { key: 'lift', label: 'Lift', kind: 'number', min: -24, max: 24, step: 1, unit: 'px' },
  { key: 'brightness', label: 'Brightness', kind: 'number', min: 0.5, max: 1.5, step: 0.01, percent: true },
]

export const SHADOWS = ['none', 'sm', 'md', 'lg', 'glow'] as const

export const STATE_LABELS: Record<InteractionState, string> = {
  hover: 'Hover',
  focus: 'Focus',
  pressed: 'Pressed',
}

/**
 * A colour, and nothing else.
 *
 * These strings are written into a stylesheet as TEXT, so an unchecked value
 * could close the rule, or the `<style>` element itself in an HTML export, and
 * inject whatever followed. The grammar admits hex, a bare colour keyword, a
 * single rgb/hsl function whose arguments cannot contain a parenthesis, quote,
 * brace, semicolon or angle bracket, and a theme `var(--token)`.
 */
const COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,30}|(?:rgba?|hsla?)\([0-9a-zA-Z.,%\s/+-]{1,80}\)|var\(--[a-zA-Z0-9-]{1,60}\))$/

export function isSafeColor(v: unknown): v is string {
  return typeof v === 'string' && COLOR.test(v.trim())
}

/**
 * Keep only valid fields, clamped into range. Returns what was dropped so a
 * file loader can report it; the op path simply applies the clean result.
 */
export function cleanStateStyle(raw: Record<string, unknown>): { style: StateStyle; dropped: string[] } {
  const style: Record<string, string | number> = {}
  const dropped: string[] = []
  const known = new Map(STATE_FIELDS.map((f) => [f.key as string, f]))
  for (const [key, value] of Object.entries(raw)) {
    const field = known.get(key)
    if (!field) {
      dropped.push(`${key} (unknown)`)
      continue
    }
    if (field.kind === 'color') {
      if (isSafeColor(value)) style[key] = value.trim()
      else dropped.push(`${key} (not a colour)`)
    } else if (field.kind === 'shadow') {
      if (typeof value === 'string' && (SHADOWS as readonly string[]).includes(value)) style[key] = value
      else dropped.push(`${key} (not a shadow)`)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      style[key] = Math.min(field.max ?? value, Math.max(field.min ?? value, value))
    } else {
      dropped.push(`${key} (not a finite number)`)
    }
  }
  return { style: style as StateStyle, dropped }
}

/** True when this node styles any interaction state. */
export function hasStates(node: Node): boolean {
  return node.states !== undefined && Object.keys(node.states).length > 0
}

function shadowValue(name: string, t: Theme): string {
  switch (name) {
    case 'sm':
      return t.shadowSm
    case 'md':
      return t.shadowMd
    case 'lg':
      return t.shadowLg
    case 'glow':
      return t.shadowGlow
    default:
      return 'none'
  }
}

function decls(raw: StateStyle, t: Theme): string[] {
  // Sanitised again at emission, not only on the way in: a document built in
  // code (an importer, a future AI op) never passed through the op or the
  // loader, and this is the one place every value becomes stylesheet text.
  const st = cleanStateStyle(raw as Record<string, unknown>).style
  const out: string[] = []
  if (st.background !== undefined) out.push(`background:${st.background}`)
  if (st.color !== undefined) out.push(`color:${st.color}`)
  if (st.border !== undefined) out.push(`border-color:${st.border}`)
  if (st.shadow !== undefined) out.push(`box-shadow:${shadowValue(st.shadow, t)}`)
  if (st.opacity !== undefined) out.push(`opacity:${st.opacity}`)
  if (st.scale !== undefined) out.push(`scale:${st.scale}`)
  if (st.lift !== undefined) out.push(`translate:0 ${-st.lift}px`)
  if (st.brightness !== undefined) out.push(`filter:brightness(${st.brightness})`)
  return out.map((d) => `${d} !important`)
}

/** The attribute the editor sets to show a state without the pointer. */
export const FORCE_ATTR = 'data-loom-force'

/** Selectors that put `sel` in `state`, by the real interaction or by the editor. */
function stateSelectors(sel: string, state: InteractionState): { live: string; forced: string } {
  const forced = `${sel}[${FORCE_ATTR}="${state}"]`
  switch (state) {
    case 'hover':
      return { live: `${sel}:hover`, forced }
    case 'focus':
      return { live: `${sel}:focus-visible,${sel}:has(:focus-visible)`, forced }
    case 'pressed':
      return { live: `${sel}:active`, forced }
  }
}

/**
 * A SUPERSET of what components transition on their own (a Button animates
 * `background`, `box-shadow` and `border-color` inline). It must be
 * `!important` for the same reason the state values are: the component's
 * inline `transition` would otherwise win, and a lift or scale would snap
 * instead of animating.
 */
const TRANSITION = ['background', 'background-color', 'color', 'border-color', 'box-shadow', 'opacity', 'scale', 'translate', 'filter']
  .map((p) => `${p} 160ms ease`)
  .join(',')

/**
 * The generated stylesheet for one document's interaction states. Empty when
 * no node styles a state, so a plain document ships no rules.
 */
export function stateCss(doc: Document, theme: Theme = resolveTheme(doc.meta.theme)): string {
  const base: string[] = []
  const hover: string[] = []
  const rest: string[] = []
  const selectors: string[] = []
  for (const node of Object.values(doc.nodes)) {
    if (!hasStates(node)) continue
    const sel = nodeSelector(node.id)
    selectors.push(sel)
    base.push(`${sel}{transition:${TRANSITION} !important}`)
    // Cascade order is the state order: pressed after hover, so a press wins
    // while the pointer is also hovering.
    for (const state of INTERACTION_STATES) {
      const st = node.states?.[state]
      if (!st) continue
      const d = decls(st, theme).join(';')
      if (!d) continue
      const { live, forced } = stateSelectors(sel, state)
      if (state === 'hover') {
        hover.push(`${live}{${d}}`)
        rest.push(`${forced}{${d}}`)
      } else {
        rest.push(`${live},${forced}{${d}}`)
      }
    }
  }
  if (base.length === 0) return ''
  // Hover rules must precede focus/pressed in the file, or a hover would beat
  // a press. The media wrapper keeps touch screens out of hover.
  return [
    `/* Generated by Loom: interaction states. Do not edit by hand. */`,
    ...base,
    hover.length > 0 ? `@media (hover:hover){${hover.join('\n')}}` : '',
    ...rest,
    `@media (prefers-reduced-motion:reduce){${selectors.join(',')}{transition:none !important}}`,
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * One-click starting points. Each is a complete, tasteful state set that works
 * on any component, because none of them needs to know its colours.
 */
export const STATE_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string; states: Partial<Record<InteractionState, StateStyle>> }> = [
  {
    id: 'lift',
    label: 'Lift',
    hint: 'Rises with a soft shadow on hover, settles when pressed',
    states: { hover: { lift: 2, shadow: 'md' }, pressed: { lift: 0, scale: 0.98, shadow: 'sm' } },
  },
  {
    id: 'press',
    label: 'Press',
    hint: 'Brightens on hover, darkens and shrinks slightly when pressed',
    states: { hover: { brightness: 1.08 }, pressed: { brightness: 0.92, scale: 0.97 } },
  },
  {
    id: 'glow',
    label: 'Glow',
    hint: 'Accent glow on hover and keyboard focus',
    states: { hover: { shadow: 'glow' }, focus: { shadow: 'glow' } },
  },
  {
    id: 'fade',
    label: 'Fade',
    hint: 'Softens on hover, dims when pressed',
    states: { hover: { opacity: 0.85 }, pressed: { opacity: 0.7 } },
  },
]
