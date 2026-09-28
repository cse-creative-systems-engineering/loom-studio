/**
 * Component registry.
 *
 * Every component DECLARES its properties. The inspector panel, the
 * serializer's validation, the drop-time defaults, and the target-capability
 * badge are all derived from these declarations. Nothing is hand-wired per
 * component, which is the only reason "a toolbox with every possible
 * component" is reachable — adding one is a single file.
 */

import type { ListItem, NodeId, PropValue } from './types'
import { GROUP_ORDER, groupFor, relatedOrder } from './prop-groups'
import { positionProps, STYLING_KEYS, universalStyleProps } from './prop-vocab'

export type PropKind = 'string' | 'number' | 'boolean' | 'enum' | 'color' | 'delimiter' | 'node'

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
  /**
   * For a `node` property: the component types it may point at. A reference
   * is a node id, picked from the document in the inspector, never typed: a
   * Composer's "Sends to" names a real MessageList or nothing.
   */
  accepts?: string[]
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
  /**
   * The named inner parts a designer can style, in panel order. Declared here
   * like props, so the inspector, the op, the file loader and the audit all
   * read one list: a part that is declared must exist in the output, and every
   * field it accepts must change what that part looks like.
   */
  parts?: Record<string, PartSpec>
  /**
   * Item lists this component draws from data (see `Node.lists`), edited in
   * its own panel. Each list declares its fields like props, so an item is
   * validated exactly as a property is.
   */
  lists?: Record<string, ListSpec>
  /**
   * Children this component creates from its OWN panel ("Add tab"). A type
   * named here is not a separate tool: it leaves the toolbox, because on its
   * own it means nothing.
   */
  adds?: AddSpec[]
  /**
   * When set, the only child types this container accepts. A tab set holds
   * tabs; a button dropped on it belongs in the tab, not beside it.
   */
  childTypes?: string[]
}


export interface ListSpec {
  /** The list's name in the panel ("Events"). */
  label: string
  /** One item's name ("Event"), for "Add event". */
  itemLabel: string
  /** The field shown as each row's title in the panel. */
  titleField: string
  fields: Record<string, PropSpec>
  /** What a new component starts with. */
  default: ListItem[]
  /** A cap, so a file cannot make a component draw a million rows. */
  max: number
}

export interface AddSpec {
  type: string
  /** The button's words ("Add tab"). */
  label: string
  /** Props the new child starts with, beyond its own defaults. */
  props?: Record<string, PropValue>
}

/** The field groups a part can accept (see `render/parts.ts`). */
export type PartFieldGroup = 'text' | 'box' | 'surface' | 'layout'

export interface PartSpec {
  label: string
  /** One line on what this part is, for the panel. */
  hint: string
  /**
   * Which fields apply. `text` is type; `box` is background, padding, radius
   * and border; `surface` is background alone, for a part (a table row) that
   * has no box of its own to pad or round; `layout` is the spacing between
   * the items a part holds, for a part that lays out a row or column.
   */
  fields: PartFieldGroup[]
  /**
   * The part already draws rule lines of its own (a grid cell's row rule). A
   * border colour then RECOLOURS those lines; on any other part it draws a
   * 1px border, because a colour for a border that does not exist would be a
   * control that changes nothing.
   */
  lines?: boolean
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
  if ((spec as { universal?: boolean }).universal === false) return { ...spec, props: grouped(spec.props, spec) }
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
  return { ...spec, props: grouped(props, spec) }
}

/**
 * Every property filed by what it means (`prop-groups.ts`), groups in the
 * shared order, related keys side by side. Declaration order still decides
 * the order inside a group, which is how a component puts its most important
 * option first.
 */
function grouped(props: Record<string, PropSpec>, spec: ComponentSpec): Record<string, PropSpec> {
  const byGroup = new Map<string, string[]>()
  const filed: Record<string, PropSpec> = {}
  for (const [key, ps] of Object.entries(props)) {
    // A separator belongs wherever its list is filed, and a "show X" switch
    // wherever X is.
    const shown = /^show[A-Z]/.test(key) ? key.charAt(4).toLowerCase() + key.slice(5) : ''
    const subject = /Sep$/.test(key) && props[key.slice(0, -3)] ? key.slice(0, -3) : shown && props[shown] ? shown : ''
    const group = subject ? groupFor(subject, props[subject]!, spec) : groupFor(key, ps, spec)
    filed[key] = group === ps.group ? ps : { ...ps, group }
    const list = byGroup.get(group) ?? []
    list.push(key)
    byGroup.set(group, list)
  }
  const out: Record<string, PropSpec> = {}
  for (const g of GROUP_ORDER) {
    for (const key of relatedOrder(byGroup.get(g) ?? [])) out[key] = filed[key]!
  }
  return out
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

/** True when `v` is a legal value for `ps`: the one check props and list items share. */
export function valueMatches(ps: PropSpec, v: unknown): boolean {
  return propValueMatches(ps, v)
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
    case 'node':
      // Shape only; whether the node exists and is an accepted type is a
      // document-level question, answered by the file loader's second pass.
      return typeof v === 'string'
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
    case 'node':
      return `a reference to ${(ps.accepts ?? ['a node']).join(' or ')}`
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

/** Types some other component creates from its own panel: not toolbox tools. */
export function addedTypes(): Set<string> {
  const out = new Set<string>()
  for (const spec of registry.values()) for (const a of spec.adds ?? []) out.add(a.type)
  return out
}

/** Whether `parentType` accepts a child of `childType`. */
export function acceptsChild(parentType: string, childType: string): boolean {
  const spec = registry.get(parentType)
  if (!spec?.container) return false
  return !spec.childTypes || spec.childTypes.includes(childType)
}

/** A fresh copy of each list's declared default. */
export function defaultLists(name: string): Record<string, ListItem[]> | undefined {
  const spec = registry.get(name)
  if (!spec?.lists) return undefined
  const out: Record<string, ListItem[]> = {}
  for (const [key, ls] of Object.entries(spec.lists)) out[key] = ls.default.map((it) => ({ ...it }))
  return out
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
  lists?: Record<string, ListItem[]>
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
    ...(spec.lists ? { lists: defaultLists(name) } : {}),
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
