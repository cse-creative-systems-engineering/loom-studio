/**
 * Loom's building tools, for an AI agent.
 *
 * The agent builds the way a person does: it reads the document and the
 * component catalogue, then adds components, sets their properties, docks
 * them, moves them into containers, sets the page. Every write is an ordinary
 * op on the ordinary store, so it renders live, and it is VALIDATED here first
 * (a model's guess at a property name or value must never reach the document:
 * `setProp` itself accepts any key, which is fine for the panel and not for
 * this). One agent turn is one undo step: during a turn writes are held
 * provisionally and sealed together (see `AiTurn`).
 *
 * Pure over an EditorStore, so the selftest drives it without Electron, and
 * the same definitions are what the MCP bridge lists.
 */

import type { EditorStore } from '../state/store'
import type { Node, NodeId, Op, PropValue } from '../model/types'
import { allComponents, addedTypes, acceptsChild, getComponent, instantiate, valueMatches, type PropSpec } from '../model/registry'
import { STARTERS, buildStarter, getStarter } from '../model/starters'
import { dropSize } from '../model/drop-size'
import { ANCHORS } from '../model/prop-vocab'
import { cleanPage } from '../model/page'
import { THEME_NAMES } from '../render/theme'
import { descendants, parentOf } from '../model/ops'
import { itemsOf } from '../model/lists'

/** A JSON-schema'd tool, in the shape MCP `tools/list` returns. */
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ToolResult = { ok: true; result: unknown } | { ok: false; error: string }

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false })
const str = (description: string) => ({ type: 'string', description })
const num = (description: string) => ({ type: 'number', description })

export const TOOLS: ToolDef[] = [
  {
    name: 'get_document',
    description:
      'The whole document as a tree: every node with its id, type, the properties that differ from their defaults, whether it lays its children out in flow, and its children. Also the page background, theme, and target. Call this first, and again after a batch of changes, to see what you built.',
    inputSchema: obj({}),
  },
  {
    name: 'list_components',
    description:
      'The component catalogue: every component you can add, with its category, what it is for, whether it is a container (can hold children), and which children it accepts. Use describe_component for a component\'s properties.',
    inputSchema: obj({ category: str('Only this category (Containers, Controls, Text, Data, Conversation, Navigation, Feedback). Omit for all.') }),
  },
  {
    name: 'describe_component',
    description:
      'One component in full: every property with its type, allowed values, default and group; its styleable parts; its item lists (e.g. a Timeline\'s events); and the children it can create. Read this before setting properties on a component you have not used yet.',
    inputSchema: obj({ type: str('Component name, e.g. "Card", "Button", "SidebarPanel".') }, ['type']),
  },
  {
    name: 'add_component',
    description:
      'Add a component inside a parent, as dropping it from the toolbox does (containers arrive at a usable size). In a free (non-flow) parent it is placed at x/y; in a flow parent it joins the end of the flow. With no document yet, pass parent_id null and it becomes the page root. Returns the new node id.',
    inputSchema: obj(
      {
        type: str('Component name from list_components.'),
        parent_id: { type: ['string', 'null'], description: 'The container to add it to; null only when the document is empty.' },
        x: num('Left, in px, inside a free parent.'),
        y: num('Top, in px, inside a free parent.'),
        props: { type: 'object', description: 'Initial property values (validated like set_props).' },
      },
      ['type', 'parent_id'],
    ),
  },
  {
    name: 'add_starter',
    description: 'Add a ready-made arrangement of real components (see list_components -> starters), wired up. Returns the new root id.',
    inputSchema: obj({ starter: str('Starter id.'), parent_id: { type: ['string', 'null'] }, x: num('x'), y: num('y') }, ['starter', 'parent_id']),
  },
  {
    name: 'set_props',
    description:
      'Set properties on a node. Each key must be a property of that component and each value of its type (enum values from its options). Invalid entries are rejected and reported; valid ones are applied.',
    inputSchema: obj({ id: str('Node id.'), props: { type: 'object', description: 'key -> value' } }, ['id', 'props']),
  },
  {
    name: 'set_flow',
    description: 'Whether a container lays its children out in flow (true: stacked/arranged by direction, gap, align) or positions them freely by x/y (false).',
    inputSchema: obj({ id: str('Container node id.'), flow: { type: 'boolean' } }, ['id', 'flow']),
  },
  {
    name: 'place',
    description: 'Position and/or size a node, in px relative to its parent. Omitted values stay as they are. w or h "auto" removes a fixed size, so the node is as big as its content (or, in a flow parent, as the layout makes it).',
    inputSchema: obj({ id: str('Node id.'), x: num('x'), y: num('y'), w: { type: ['number', 'string'], description: 'width in px, or "auto"' }, h: { type: ['number', 'string'], description: 'height in px, or "auto"' } }, ['id']),
  },
  {
    name: 'dock',
    description: `Dock a free node to an edge, corner, the centre, or fill its parent, so it stays there when the parent resizes (a left-docked sidebar spans the full height). "none" undocks. One of: none, ${ANCHORS.join(', ')}.`,
    inputSchema: obj({ id: str('Node id.'), anchor: { type: 'string', enum: ['none', ...ANCHORS] } }, ['id', 'anchor']),
  },
  {
    name: 'move_into',
    description: 'Move a node (and everything in it) into another container, at an index among its children (default: last).',
    inputSchema: obj({ id: str('Node to move.'), parent_id: str('Destination container.'), index: num('Position among the children.') }, ['id', 'parent_id']),
  },
  {
    name: 'remove',
    description: 'Delete nodes and everything inside them.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  },
  {
    name: 'set_list',
    description: 'Replace one of a component\'s item lists (e.g. a Timeline\'s events, a Menu\'s items, a NavBar\'s links) with these rows. Each row\'s fields come from describe_component -> lists.',
    inputSchema: obj({ id: str('Node id.'), list: str('List key.'), items: { type: 'array', items: { type: 'object' } } }, ['id', 'list', 'items']),
  },
  {
    name: 'set_page',
    description: 'What is behind the whole UI: "none" (transparent), "theme" (the theme\'s page colour), or "color" with a colour (alpha allowed, e.g. rgba(10,12,20,0.6)) and an optional blur in px.',
    inputSchema: obj({ background: { type: 'string', enum: ['none', 'theme', 'color'] }, color: str('Colour when background is "color".'), blur: num('0-60 px') }, ['background']),
  },
  {
    name: 'set_theme',
    description: `The document's theme, which restyles everything: ${THEME_NAMES.join(', ')}.`,
    inputSchema: obj({ theme: { type: 'string', enum: [...THEME_NAMES] } }, ['theme']),
  },
  {
    name: 'render',
    description:
      'LOOK at what you built: an image of the design exactly as it ships (no editor chrome), at a viewport. Use it after building or changing something, judge it like a demanding senior designer (hierarchy, spacing, alignment, balance, polish), and fix what you see. Optionally crop to one node.',
    inputSchema: obj({ viewport: { type: 'string', enum: ['desktop', 'tablet', 'phone'], description: 'Screen size: desktop 1280x800 (default), tablet 834x1194, phone 390x844.' }, node_id: str('Crop the image to this node.') }),
  },
  {
    name: 'check_layout',
    description:
      'MEASURE the design as it ships, at a viewport: every node\'s real box, and problems found: text cut off, a node outside its container or off the screen, free nodes overlapping, tap targets under 44px on a phone, low text contrast. Run it after changes and fix every issue it reports.',
    inputSchema: obj({ viewport: { type: 'string', enum: ['desktop', 'tablet', 'phone'] } }),
  },
  {
    name: 'select',
    description: 'Select nodes in the editor so the user sees what you are talking about.',
    inputSchema: obj({ ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  },
]

/**
 * One agent turn = one undo step. While a turn is open, writes are applied
 * provisionally (live on the canvas) and sealed together at the end under the
 * turn's label; outside a turn each write is its own step.
 */
export class AiTurn {
  private open: string | null = null
  constructor(private store: EditorStore) {}
  begin(label: string) {
    if (this.open !== null) this.end()
    this.store.seal('Before AI')
    this.open = label
  }
  end() {
    if (this.open === null) return
    this.store.seal(this.open)
    this.open = null
  }
  get active(): boolean {
    return this.open !== null
  }
  /** Apply an op; true when it changed the document. */
  write(op: Op, label: string): boolean {
    if (this.open === null) return this.store.commit(op, label)
    const before = this.store.doc
    this.store.poke(op)
    return this.store.doc !== before && JSON.stringify(this.store.doc) !== JSON.stringify(before)
  }
}

/** Run one tool against the store. Never throws: errors are results. */
export function runTool(store: EditorStore, turn: AiTurn, name: string, args: Record<string, unknown>): ToolResult {
  try {
    const fn = HANDLERS[name]
    if (!fn) return { ok: false, error: `unknown tool: ${name}` }
    return { ok: true, result: fn(store, turn, args ?? {}) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

type Handler = (s: EditorStore, t: AiTurn, a: Record<string, unknown>) => unknown

const need = (a: Record<string, unknown>, k: string): string => {
  const v = a[k]
  if (typeof v !== 'string' || v === '') throw new Error(`"${k}" is required`)
  return v
}
const nodeOf = (s: EditorStore, id: string): Node => {
  const n = s.doc.nodes[id]
  if (!n) throw new Error(`no node "${id}" (get_document lists the ids)`)
  return n
}
const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/** Validate props against a component: the valid ones, and why the rest were refused. */
function validProps(type: string, raw: unknown): { ok: Record<string, PropValue>; rejected: string[] } {
  const spec = getComponent(type)
  if (!spec) throw new Error(`unknown component: ${type}`)
  const ok: Record<string, PropValue> = {}
  const rejected: string[] = []
  if (raw === undefined) return { ok, rejected }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('"props" must be an object')
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const ps = spec.props[k]
    if (!ps) {
      rejected.push(`${k}: not a property of ${type}`)
      continue
    }
    const value = coerce(ps, v)
    if (!valueMatches(ps, value)) {
      rejected.push(`${k}: expected ${describeType(ps)}, got ${JSON.stringify(v)}`)
      continue
    }
    ok[k] = clamp(ps, value as PropValue)
  }
  return { ok, rejected }
}

/** Models send "12" for 12 and "true" for true; accept the obvious ones. */
function coerce(ps: PropSpec, v: unknown): unknown {
  if (ps.type === 'number' && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  if (ps.type === 'boolean' && (v === 'true' || v === 'false')) return v === 'true'
  return v
}

function clamp(ps: PropSpec, v: PropValue): PropValue {
  if (ps.type !== 'number' || typeof v !== 'number') return v
  let n = v
  if (typeof ps.min === 'number') n = Math.max(ps.min, n)
  if (typeof ps.max === 'number') n = Math.min(ps.max, n)
  return n
}

function describeType(ps: PropSpec): string {
  if (ps.type === 'enum') return `one of ${(ps.options ?? []).join(' | ')}`
  if (ps.type === 'number') return `a number${ps.min !== undefined ? ` ${ps.min}..${ps.max ?? ''}` : ''}`
  return ps.type
}

/**
 * The props that differ from their defaults: what makes this node this node.
 * Geometry the dock overrides is reported as what it IS: a docked node's x/y
 * do nothing, and a dimension it spans is its parent's (an agent that read
 * "w: 360" on a fill-docked page concluded the dock had not worked).
 */
function ownProps(n: Node): Record<string, PropValue> {
  const spec = getComponent(n.type)
  const out: Record<string, PropValue> = {}
  const anchor = typeof n.props.anchor === 'string' ? n.props.anchor : 'none'
  const docked = anchor !== 'none'
  const spansW = anchor === 'top' || anchor === 'bottom' || anchor === 'fill'
  const spansH = anchor === 'left' || anchor === 'right' || anchor === 'fill'
  for (const [k, v] of Object.entries(n.props)) {
    if (k === 'x' || k === 'y' || k === 'w' || k === 'h') {
      if (v === undefined) continue
      if (docked && (k === 'x' || k === 'y')) continue
      if ((k === 'w' && spansW) || (k === 'h' && spansH)) out[k] = 'spans its parent (docked)'
      else out[k] = v
      continue
    }
    const ps = spec?.props[k]
    if (!ps || v !== ps.default) out[k] = v
  }
  return out
}

function tree(s: EditorStore, id: NodeId): unknown {
  const n = s.doc.nodes[id]
  if (!n) return null
  const spec = getComponent(n.type)
  const lists = spec?.lists ? Object.fromEntries(Object.keys(spec.lists).map((k) => [k, itemsOf(n, k)])) : undefined
  return {
    id: n.id,
    type: n.type,
    props: ownProps(n),
    ...(spec?.container ? { flow: n.flow } : {}),
    ...(lists ? { lists } : {}),
    ...(n.visible === false ? { visible: false } : {}),
    ...(n.children.length ? { children: n.children.map((c) => tree(s, c)) } : {}),
  }
}

/** Answered by Loom's main process (they draw the document); never here. */
export const MAIN_TOOLS = new Set(['render', 'check_layout'])

const HANDLERS: Record<string, Handler> = {
  get_document: (s) => ({
    name: s.doc.meta.name,
    theme: s.doc.meta.theme ?? 'midnight',
    page: s.doc.meta.page ?? { background: 'none' },
    target: s.target,
    root: s.doc.root ? tree(s, s.doc.root) : null,
    selection: s.selection,
  }),

  list_components: (_s, _t, a) => {
    const added = addedTypes()
    const cat = typeof a.category === 'string' ? a.category : undefined
    return {
      components: allComponents()
        .filter((c) => !added.has(c.name) && (!cat || c.category === cat))
        .map((c) => ({
          name: c.name,
          category: c.category,
          description: c.description,
          ...(c.container ? { container: true } : {}),
          ...(c.childTypes ? { accepts: c.childTypes } : {}),
          ...(c.defaultFlow ? { flowByDefault: true } : {}),
        })),
      starters: STARTERS.map((st) => ({ id: st.id, label: st.label, description: st.description })),
    }
  },

  describe_component: (_s, _t, a) => {
    const type = need(a, 'type')
    const spec = getComponent(type)
    if (!spec) throw new Error(`unknown component: ${type} (list_components has the names)`)
    return {
      name: spec.name,
      category: spec.category,
      description: spec.description,
      container: Boolean(spec.container),
      ...(spec.childTypes ? { accepts: spec.childTypes } : {}),
      props: Object.fromEntries(
        Object.entries(spec.props).map(([k, ps]) => [
          k,
          { type: ps.type, default: ps.default, group: ps.group, ...(ps.options ? { options: ps.options } : {}), ...(ps.min !== undefined ? { min: ps.min, max: ps.max } : {}), ...(ps.advanced ? { advanced: true } : {}) },
        ]),
      ),
      ...(spec.parts ? { parts: Object.fromEntries(Object.entries(spec.parts).map(([k, p]) => [k, { label: p.label, hint: p.hint }])) } : {}),
      ...(spec.lists ? { lists: Object.fromEntries(Object.entries(spec.lists).map(([k, l]) => [k, { label: l.label, fields: Object.keys(l.fields), max: l.max }])) } : {}),
      ...(spec.adds ? { adds: spec.adds.map((x) => ({ type: x.type, label: x.label })) } : {}),
    }
  },

  add_component: (s, t, a) => {
    const type = need(a, 'type')
    if (!getComponent(type)) throw new Error(`unknown component: ${type} (list_components has the names)`)
    const parent = a.parent_id === null || a.parent_id === undefined ? null : String(a.parent_id)
    if (parent === null && s.doc.root !== null) throw new Error('the document already has a root; pass its id (or another container) as parent_id')
    if (parent !== null) {
      const p = nodeOf(s, parent)
      if (!getComponent(p.type)?.container) throw new Error(`${p.type} "${parent}" is not a container`)
      if (!acceptsChild(p.type, type)) throw new Error(`${p.type} only accepts ${getComponent(p.type)?.childTypes?.join(', ')}`)
    }
    const { ok, rejected } = validProps(type, a.props)
    const id = `n${Math.random().toString(36).slice(2, 9)}`
    // As the toolbox drops it (store.dropComponent): a usable size, and in a
    // flow parent no coordinates. Built as one op so a turn can hold it.
    const intoFlow = parent !== null && s.doc.nodes[parent]?.flow === true
    const x = intoFlow ? 0 : finite(a.x) ?? 0
    const y = intoFlow ? 0 : finite(a.y) ?? 0
    const made = instantiateFor(type, ok, x, y, id, intoFlow)
    // A container that becomes the document's root IS the page: it fills the
    // screen unless the agent placed or sized it (or it docks itself, like a
    // sidebar). A 360x240 "page" in a 1280x800 screen was never what was meant.
    const spec = getComponent(type)!
    if (parent === null && spec.container && made.props.anchor === 'none' && !['x', 'y', 'w', 'h'].some((k) => finite(a[k]) !== undefined || (ok as Record<string, unknown>)[k] !== undefined)) {
      made.props.anchor = 'fill'
    }
    if (!t.write({ op: 'insert', parent, node: made }, `Add ${type}`)) throw new Error(`could not add ${type} there`)
    return { id, ...(rejected.length ? { rejected } : {}) }
  },

  add_starter: (s, t, a) => {
    const id = need(a, 'starter')
    const st = getStarter(id)
    if (!st) throw new Error(`unknown starter: ${id} (list_components -> starters)`)
    const parent = a.parent_id === null || a.parent_id === undefined ? null : String(a.parent_id)
    if (parent !== null) nodeOf(s, parent)
    if (parent === null && s.doc.root !== null) throw new Error('the document already has a root; pass a container as parent_id')
    const { root, tree } = buildStarter(st, () => `n${Math.random().toString(36).slice(2, 9)}`)
    root.props = { ...root.props, x: finite(a.x) ?? 0, y: finite(a.y) ?? 0 }
    if (!t.write({ op: 'insert', parent, node: root, tree }, `Add ${st.label}`)) throw new Error(`could not add ${st.label} there`)
    return { id: root.id, nodes: Object.keys(tree).length + 1 }
  },

  set_props: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    const { ok, rejected } = validProps(n.type, a.props)
    let applied = 0
    for (const [k, v] of Object.entries(ok)) if (t.write({ op: 'setProp', id, key: k, value: v }, `Set ${k}`)) applied++
    return { applied, ...(rejected.length ? { rejected } : {}) }
  },

  set_flow: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    if (!getComponent(n.type)?.container) throw new Error(`${n.type} is not a container`)
    if (typeof a.flow !== 'boolean') throw new Error('"flow" must be true or false')
    t.write({ op: 'setFlow', id, flow: a.flow }, a.flow ? 'Flow on' : 'Flow off')
    return { flow: a.flow }
  },

  place: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    const x = finite(a.x)
    const y = finite(a.y)
    const w = finite(a.w)
    const h = finite(a.h)
    if (x !== undefined || y !== undefined) t.write({ op: 'move', id, x: Math.round(x ?? (Number(n.props.x) || 0)), y: Math.round(y ?? (Number(n.props.y) || 0)) }, 'Move')
    // "auto": no fixed size on that axis (the prop is removed; the op's
    // inverse restores the old number).
    for (const k of ['w', 'h'] as const) {
      if (a[k] === 'auto') t.write({ op: 'setProp', id, key: k, value: undefined as unknown as PropValue }, `Auto ${k === 'w' ? 'width' : 'height'}`)
    }
    if (w !== undefined || h !== undefined) {
      const cur = s.doc.nodes[id]!
      t.write({ op: 'resize', id, w: Math.max(1, Math.round(w ?? (Number(cur.props.w) || 100))), h: Math.max(1, Math.round(h ?? (Number(cur.props.h) || 40))) }, 'Resize')
    }
    const after = s.doc.nodes[id]!.props
    return { x: after.x, y: after.y, w: after.w, h: after.h }
  },

  dock: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const anchor = need(a, 'anchor')
    if (anchor !== 'none' && !(ANCHORS as readonly string[]).includes(anchor)) throw new Error(`anchor must be none or one of ${ANCHORS.join(', ')}`)
    t.write({ op: 'setProp', id, key: 'anchor', value: anchor }, `Dock ${anchor}`)
    return { anchor }
  },

  move_into: (s, t, a) => {
    const id = need(a, 'id')
    const parent = need(a, 'parent_id')
    const n = nodeOf(s, id)
    const p = nodeOf(s, parent)
    if (id === s.doc.root) throw new Error('the root cannot move into another node')
    if (!getComponent(p.type)?.container) throw new Error(`${p.type} is not a container`)
    if (id === parent || descendants(s.doc, id).includes(parent)) throw new Error('a node cannot move inside itself')
    if (!acceptsChild(p.type, n.type)) throw new Error(`${p.type} only accepts ${getComponent(p.type)?.childTypes?.join(', ')}`)
    const index = finite(a.index)
    if (!t.write({ op: 'reparent', id, parent, index: index === undefined ? undefined : Math.max(0, Math.round(index)) }, `Move into ${p.type}`) && parentOf(s.doc, id) !== parent) {
      throw new Error('could not move it there')
    }
    return { parent: parentOf(s.doc, id) }
  },

  remove: (s, t, a) => {
    const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string') : []
    if (ids.length === 0) throw new Error('"ids" must list node ids')
    let removed = 0
    for (const id of ids) {
      if (!s.doc.nodes[id]) continue
      if (s.doc.nodes[id]!.locked) continue
      if (t.write({ op: 'remove', id }, 'Delete')) removed++
    }
    return { removed }
  },

  set_list: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    const key = need(a, 'list')
    const ls = getComponent(n.type)?.lists?.[key]
    if (!ls) throw new Error(`${n.type} has no list "${key}"`)
    if (!Array.isArray(a.items)) throw new Error('"items" must be an array of rows')
    const items = a.items.slice(0, ls.max).map((row) => {
      const out: Record<string, string | number | boolean> = {}
      for (const [f, ps] of Object.entries(ls.fields)) {
        const v = coerce(ps, (row as Record<string, unknown>)?.[f])
        out[f] = valueMatches(ps, v) ? (v as string | number | boolean) : (ps.default as string | number | boolean)
      }
      return out
    })
    t.write({ op: 'setList', id, key, items }, `Set ${key}`)
    return { rows: items.length }
  },

  set_page: (_s, t, a) => {
    const page = a.background === 'none' && a.blur === undefined ? null : cleanPage({ background: a.background, ...(a.color !== undefined ? { color: a.color } : {}), ...(a.blur !== undefined ? { blur: a.blur } : {}) })
    if (a.background !== 'none' && page === null) throw new Error('background must be none, theme, or color with a valid colour')
    t.write({ op: 'setPage', page }, 'Page')
    return { page: page ?? { background: 'none' } }
  },

  set_theme: (_s, t, a) => {
    const theme = need(a, 'theme')
    if (!(THEME_NAMES as readonly string[]).includes(theme)) throw new Error(`theme must be one of ${THEME_NAMES.join(', ')}`)
    t.write({ op: 'setTheme', theme }, `Theme: ${theme}`)
    return { theme }
  },

  select: (s, _t, a) => {
    const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string' && !!s.doc.nodes[x]) : []
    s.select(ids)
    return { selected: ids }
  },
}

/** A node as a toolbox drop makes it (defaults, drop size), with these props. */
function instantiateFor(type: string, props: Record<string, PropValue>, x: number, y: number, id: string, intoFlow: boolean): Node {
  const made = instantiate(type)
  return {
    id,
    type,
    props: { ...made.props, ...dropSize(type, intoFlow), ...props, x, y },
    children: [],
    flow: made.flow,
    visible: true,
    locked: false,
    opacity: 1,
  }
}
