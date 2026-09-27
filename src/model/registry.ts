/**
 * Component registry.
 *
 * Every component DECLARES its properties. The inspector panel, the
 * serializer's validation, the drop-time defaults, and the target-capability
 * badge are all derived from these declarations. Nothing is hand-wired per
 * component, which is the only reason "a toolbox with every possible
 * component" is reachable — adding one is a single file.
 */

import type { NodeId, PropValue } from './types'
import { positionProps, STYLING_KEYS, universalStyleProps } from './prop-vocab'

export type PropKind = 'string' | 'number' | 'boolean' | 'enum' | 'color' | 'delimiter'

/**
 * The characters a `delimiter` prop can name.
 *
 * A list-valued property used to hardcode its separator, which is a quiet lie:
 * the moment real data contains a comma INSIDE an item, the list silently splits
 * in the wrong place and the designer has no way to say so. The separator is
 * therefore a property, visible in the inspector and changeable, like any other.
 */
export const DELIMITERS = {
  comma: ',',
  pipe: '|',
  semicolon: ';',
  newline: '\n',
  tab: '\t',
  space: ' ',
} as const

export type DelimiterName = keyof typeof DELIMITERS

/** The character a delimiter prop names, defaulting to comma. */
export function delimiterChar(value: unknown): string {
  const name = typeof value === 'string' && value in DELIMITERS ? (value as DelimiterName) : 'comma'
  return DELIMITERS[name]
}

/** Friendly label for the inspector, showing the character AND its name. */
export function delimiterLabel(value: unknown): string {
  const name = typeof value === 'string' && value in DELIMITERS ? (value as DelimiterName) : 'comma'
  const shown = name === 'newline' ? '\\n' : name === 'tab' ? '\\t' : DELIMITERS[name]
  return `${name}  "${shown}"`
}

export interface PropSpec {
  type: PropKind
  default: PropValue
  label?: string
  group?: string
  min?: number
  max?: number
  step?: number
  options?: string[]
  /** May be wired to a data source rather than holding a constant. */
  bindable?: boolean
  /**
   * Capability tags this property needs. A property whose required capability
   * is missing from a target's capability set cannot be represented there, and
   * the inspector badges it. This is how the designer stays honest about
   * web-only features while a desktop target is selected.
   */
  requires?: Capability[]
  /**
   * Shown behind "More properties" rather than up front. The component's own
   * options come first; universal styling is one click away. A changed
   * advanced property is always shown, so a value can never hide.
   */
  advanced?: boolean
}

export type Capability =
  | 'webview'
  | 'webgl'
  | 'css-filter'
  | 'css-grid'
  | 'css-backdrop-filter'
  | 'native-widget'
  | 'native-canvas'

export interface ComponentSpec {
  name: string
  category: string
  /** Containers accept children; leaves do not. */
  container?: boolean
  /** Free positioning is the default for leaves. */
  defaultFlow?: boolean
  icon: string
  description: string
  props: Record<string, PropSpec>
  /**
   * False for a component with no text anywhere in it (a loading skeleton):
   * it gets the universal box styling but not the type properties, which
   * would be controls that change nothing a person can see.
   */
  rendersText?: boolean
}

const registry = new Map<string, ComponentSpec>()

/**
 * Properties every component carries, injected rather than repeated.
 *
 * Positioning, docking and box styling are not a category concern: anything
 * you can place can be anchored, padded, filled or re-typed. Declaring them 120
 * times is how you end up with 20 components that quietly cannot dock and 50
 * that cannot take a background, so the registry adds them once, here (see
 * `universalStyleProps` for why that is safe). The component's own declaration
 * of a key always wins. A component that genuinely cannot take any of them
 * opts out with `universal: false`, which no component currently needs.
 */
function withUniversalProps(spec: ComponentSpec): ComponentSpec {
  if ((spec as { universal?: boolean }).universal === false) return spec
  // The component's own properties come FIRST (declaration order is panel
  // order, so a newcomer meets Content before Position), and an injected key
  // is only added where the component did not declare its own.
  const props: Record<string, PropSpec> = {}
  for (const [key, ps] of Object.entries(spec.props)) {
    // A styling key is advanced wherever it is declared, unless the component
    // says otherwise with an explicit `advanced: false`.
    props[key] = STYLING_KEYS.has(key) && ps.advanced === undefined ? { ...ps, advanced: true } : ps
  }
  const injected = { ...positionProps(), ...universalStyleProps(spec.rendersText !== false) }
  for (const [key, ps] of Object.entries(injected)) {
    if (!(key in props)) props[key] = ps
  }
  return { ...spec, props }
}

export function defineComponent(spec: ComponentSpec): ComponentSpec {
  const full = withUniversalProps(spec)
  registry.set(full.name, full)
  return full
}

export function getComponent(name: string): ComponentSpec | undefined {
  return registry.get(name)
}

export function allComponents(): ComponentSpec[] {
  return [...registry.values()]
}

export function componentsByCategory(): Map<string, ComponentSpec[]> {
  const out = new Map<string, ComponentSpec[]>()
  for (const spec of registry.values()) {
    const list = out.get(spec.category) ?? []
    list.push(spec)
    out.set(spec.category, list)
  }
  return out
}

/**
 * Resolve a raw props object against a component's schema.
 *
 * Every node entering the document goes through this, so a node can never hold
 * a missing default or an undeclared key. Declared props always get a value
 * (the supplied one, else the schema default); undeclared keys are dropped
 * rather than silently stored, because a stray key is a document that will not
 * round-trip to the desktop backend.
 */
export function normalizeProps(
  type: string,
  raw: Record<string, PropValue> = {},
): Record<string, PropValue> {
  const spec = registry.get(type)
  if (!spec) throw new Error(`unknown component: ${type}`)
  const out: Record<string, PropValue> = {}
  for (const [key, ps] of Object.entries(spec.props)) {
    out[key] = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : ps.default
  }
  // Layout geometry is not schema props; every node carries it. x/y are
  // coordinates, w/h the explicit size an author dragged to.
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (Object.prototype.hasOwnProperty.call(raw, k)) out[k] = raw[k]
  }
  return out
}

export interface PropIssue {
  key: string
  message: string
}

/**
 * Strict prop validation for UNTRUSTED input (file loading).
 *
 * `normalizeProps` is the lenient in-memory path (UI controls already produce
 * correctly-typed values); this is the trust boundary. For each declared
 * prop: missing → schema default (silent, same as normalizeProps);
 * present-but-wrongly-typed → schema default + issue; undeclared keys
 * (except layout geometry x/y/w/h, kept only when finite numbers) are
 * dropped + issue. Geometry with non-finite values is dropped.
 *
 * Throws on unknown component — callers must filter those first (persist
 * drops the whole node instead, which is the file loader's repair policy).
 */
export function validateProps(
  type: string,
  raw: Record<string, unknown> = {},
): { props: Record<string, PropValue>; issues: PropIssue[] } {
  const spec = registry.get(type)
  if (!spec) throw new Error(`unknown component: ${type}`)
  const props: Record<string, PropValue> = {}
  const issues: PropIssue[] = []
  for (const [key, ps] of Object.entries(spec.props)) {
    if (!Object.prototype.hasOwnProperty.call(raw, key)) {
      props[key] = ps.default
      continue
    }
    const v = raw[key]
    if (propValueMatches(ps, v)) {
      props[key] = v as PropValue
    } else {
      props[key] = ps.default
      issues.push({ key, message: `expected ${describeProp(ps)}, got ${previewValue(v)}` })
    }
  }
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue
    const v = raw[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      props[k] = v
    } else {
      issues.push({ key: k, message: `expected finite number, got ${previewValue(v)}` })
    }
  }
  for (const key of Object.keys(raw)) {
    if (key in spec.props || key === 'x' || key === 'y' || key === 'w' || key === 'h') continue
    issues.push({ key, message: 'undeclared prop (dropped)' })
  }
  return { props, issues }
}

function propValueMatches(ps: PropSpec, v: unknown): boolean {
  switch (ps.type) {
    case 'string':
    case 'color':
      // Any string is legitimate (named CSS colors, URLs, csv lists); the
      // renderer coerces or falls back per use-site.
      return typeof v === 'string'
    case 'number':
      return typeof v === 'number' && Number.isFinite(v)
    case 'boolean':
      return typeof v === 'boolean'
    case 'enum':
      return typeof v === 'string' && (ps.options ?? []).includes(v)
    case 'delimiter':
      return typeof v === 'string' && v in DELIMITERS
  }
}

function describeProp(ps: PropSpec): string {
  switch (ps.type) {
    case 'string':
      return 'string'
    case 'color':
      return 'color string'
    case 'number':
      return 'finite number'
    case 'boolean':
      return 'boolean'
    case 'enum':
      return `one of ${(ps.options ?? []).join('|')}`
    case 'delimiter':
      return 'a list separator name'
  }
}

function previewValue(v: unknown): string {
  if (v === null) return 'null'
  if (Array.isArray(v)) return `array[${v.length}]`
  switch (typeof v) {
    case 'string':
      return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`
    case 'object':
      return 'object'
    case 'undefined':
      return 'missing'
    default:
      return String(v)
  }
}

/** A fresh node with every declared default applied. */
export function instantiate(name: string): {
  type: string
  props: Record<string, PropValue>
  children: NodeId[]
  flow: boolean
  visible: boolean
  locked: boolean
  opacity: number
} {
  const spec = registry.get(name)
  if (!spec) throw new Error(`unknown component: ${name}`)
  const props: Record<string, PropValue> = {}
  for (const [key, ps] of Object.entries(spec.props)) {
    props[key] = ps.default
  }
  return {
    type: name,
    props,
    children: [],
    // Positioning is absolute (free) unless the schema opts in: no
    // component currently does — flow is an explicit per-container choice
    // via the `setFlow` op (Inspector toggle, demo seeder).
    flow: spec.defaultFlow ?? false,
    visible: true,
    locked: false,
    opacity: 1,
  }
}

/* ------------------------------------------------------------------ *
 * Target capabilities.
 *
 * The web backend can express everything. The desktop backend is a
 * documented subset; anything outside it is surfaced in the inspector
 * rather than silently dropped at export time.
 * ------------------------------------------------------------------ */

export const WEB_CAPABILITIES: Capability[] = [
  'webview',
  'webgl',
  'css-filter',
  'css-grid',
  'css-backdrop-filter',
]

/**
 * Conservative: what a GTK/Qt widget tree can faithfully represent. CSS
 * layout mechanisms are NOT native capabilities — `css-grid` used to be
 * listed here, which would have let Grid pass desktop gating without a real
 * native equivalent.
 */
export const DESKTOP_CAPABILITIES: Capability[] = [
  'native-widget',
  'native-canvas',
]

export function targetCapabilities(target: 'web' | 'desktop'): Capability[] {
  return target === 'web' ? WEB_CAPABILITIES : DESKTOP_CAPABILITIES
}

/** True when `key` on `spec` can be represented for the active target. */
export function propSupported(
  spec: ComponentSpec,
  key: string,
  target: 'web' | 'desktop',
): boolean {
  const needs = spec.props[key]?.requires
  if (!needs || needs.length === 0) return true
  const caps = targetCapabilities(target)
  return needs.every((c) => caps.includes(c))
}

/** Properties of `spec` that the active target cannot represent. */
export function unsupportedProps(spec: ComponentSpec, target: 'web' | 'desktop'): string[] {
  return Object.keys(spec.props).filter((k) => !propSupported(spec, k, target))
}
