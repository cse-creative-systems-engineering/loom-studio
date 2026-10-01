/**
 * Loom's building tools, for an AI agent.
 *
 * The agent builds the way a person does: it reads the document and the
 * component catalogue, then adds components, sets their properties, docks
 * them, moves them into containers, sets the page. Every write is an ordinary
 * op on the ordinary store, so it renders live, and it is VALIDATED here first
 * (a model's guess at a property name or value must never reach the document:
 * `setProp` itself accepts any key, which is fine for the panel and not for
 * this). One agent turn is one undo step: its writes are commits in one
 * history group (see `AiTurn`).
 *
 * Pure over an EditorStore, so the selftest drives it without Electron, and
 * the same definitions are what the MCP bridge lists.
 */

import { renamedValue } from '../model/migrate'
import { LIST_SHORTHAND, takeShorthand } from '../model/grid'
import type { EditorStore } from '../state/store'
import type { Node, NodeId, Op, PropValue } from '../model/types'
import { allComponents, addedTypes, acceptsChild, getComponent, instantiate, valueMatches, type PropSpec } from '../model/registry'
import { STARTERS, buildStarter, getStarter } from '../model/starters'
import { dropSize } from '../model/drop-size'
import { ANCHORS } from '../model/prop-vocab'
import { cleanPage } from '../model/page'
import { THEME_NAMES } from '../render/theme'
import { descendants, parentOf, remapRefs } from '../model/ops'
import { itemsOf } from '../model/lists'
import { cleanPartStyle } from '../render/parts'
import { cleanStateStyle, isSafeColor } from '../render/states'
import { DEFAULT_EFFECTS, normalizeEffects } from '../render/effects'
import { INTERACTION_STATES, type InteractionState } from '../model/types'
import { cleanActions } from '../model/actions'

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
        w: { type: ['number', 'string'], description: 'Width in px, or "auto".' },
        h: { type: ['number', 'string'], description: 'Height in px, or "auto".' },
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
    name: 'build',
    description:
      'Build a whole subtree in ONE call: a component with its props and children, nested as deep as you need (e.g. a card with its heading, text and buttons, or a list of rows). Far faster than add_component one by one. Each node: {type, props?, flow?, x?, y?, w?, h?, name?, ref?, children?}. "ref" names a node so the reply maps it to its new id. Validated like add_component; the reply lists anything refused. Max 300 nodes per call.',
    inputSchema: obj(
      {
        parent_id: { type: ['string', 'null'], description: 'Container to build into; null only when the document is empty (the tree becomes the root).' },
        tree: { type: 'object', description: '{type, props?, flow?, x?, y?, w?, h? (px or "auto"), name?, ref?, children?: [same shape]}. A node given no children arrives as the toolbox drops it (Tabs with its panels, Accordion with its items).' },
      },
      ['parent_id', 'tree'],
    ),
  },
  {
    name: 'style_part',
    description:
      'Style one PART of a component (describe_component -> parts lists them, with the fields each accepts): e.g. a DataGrid\'s header, rows or cells, a KpiCard\'s value, a Field\'s label. Fields: fontSize, fontWeight, color, lineHeight, letterSpacing, textTransform, align, fontFamily (sans|mono), decoration, background, paddingX, paddingY, radius, border, borderWidth, shadow, gap. null clears a field.',
    inputSchema: obj({ id: str('Node id.'), part: str('Part name.'), style: { type: 'object', description: 'field -> value (null clears)' } }, ['id', 'part', 'style']),
  },
  {
    name: 'set_states',
    description:
      'How a node looks while hovered, focused or pressed (the same interaction states as the Properties panel). Fields: background, color, border (colours), shadow (none|sm|md|lg|glow), opacity 0-1, scale 0.5-1.5, lift -24..24 px, brightness 0.5-1.5. null clears a field.',
    inputSchema: obj({ id: str('Node id.'), state: { type: 'string', enum: ['hover', 'focus', 'pressed'] }, style: { type: 'object' } }, ['id', 'state', 'style']),
  },
  {
    name: 'set_responsive',
    description:
      'Override a node at a narrower screen: "sm" (phone, up to 639px) or "md" (tablet, 640-1023px). The base design is desktop. Fields: x, y, w, h (px), flow (boolean), visible (boolean), opacity 0-1. null removes that override.',
    inputSchema: obj({ id: str('Node id.'), breakpoint: { type: 'string', enum: ['sm', 'md'] }, override: { type: 'object' } }, ['id', 'breakpoint', 'override']),
  },
  {
    name: 'set_display',
    description: 'A node\'s display basics, as in the Properties panel\'s Display section and Layers: opacity (0-1), visible (hidden nodes stay in the design but do not ship), locked (cannot be moved or deleted), name (its layer name).',
    inputSchema: obj({ id: str('Node id.'), opacity: num('0-1'), visible: { type: 'boolean' }, locked: { type: 'boolean' }, name: str('Layer name; "" clears it.') }, ['id']),
  },
  {
    name: 'set_effects',
    description:
      'Visual effects on a node (the Effects section): grain, glass, aurora, spotlight, shimmer, glow, tilt, chromatic (booleans) and their settings (e.g. glowColor, glowSpread, auroraFrom/Via/To, motion none|fade|scale|blur, hoverScale). Unknown keys are refused.',
    inputSchema: obj({ id: str('Node id.'), effects: { type: 'object' } }, ['id', 'effects']),
  },
  {
    name: 'duplicate',
    description: 'Copy a node and everything inside it, next to the original (offset 12px in a free parent, after it in a flow parent). Returns the copy\'s id. Handy for repeated rows or cards: build one, duplicate, then set_props on the copies.',
    inputSchema: obj({ id: str('Node id.'), count: num('How many copies (default 1, max 50).') }, ['id']),
  },
  {
    name: 'arrange',
    description: 'Paint order among free siblings: "front" draws it above the others, "back" below.',
    inputSchema: obj({ id: str('Node id.'), to: { type: 'string', enum: ['front', 'back'] } }, ['id', 'to']),
  },
  {
    name: 'set_actions',
    description:
      'Make controls DO things to other components (standing rule: whatever a UI can do, it does). On a Button, IconButton, Link or BackButton: `click`, a list of {verb, target} run in order — verb show | hide | toggle | open | close (open/close also drive a Modal or Drawer). On a choice control (Segmented, TabBar, RadioGroup, Select, Checkbox, Switch, ToggleButton): `views`, choice -> node id; choosing one shows its node and hides the others\' (a real List/Table switch; on/off controls use the keys "on" and "off"). `starts_hidden`: node ids that start hidden until a control shows them (a filter panel a Filters button toggles). Replaces the control\'s actions; pass {} to clear. The reply lists anything refused.',
    inputSchema: obj(
      {
        id: str('The control.'),
        click: { type: 'array', items: { type: 'object', properties: { verb: { type: 'string', enum: ['show', 'hide', 'toggle', 'open', 'close'] }, target: { type: 'string' } }, required: ['verb', 'target'] } },
        views: { type: 'object', description: 'choice -> node id' },
        starts_hidden: { type: 'array', items: { type: 'string' }, description: 'Node ids that start hidden.' },
      },
      ['id'],
    ),
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
 * One agent turn = one undo step. A turn's writes are real commits in one
 * history GROUP, so consecutive ones merge into a single entry under the
 * turn's label (live on the canvas as they land). A person keeps building
 * while the agent works: their own edit mid-turn is its own entry, and the
 * agent's work before and after it stays undoable. Undo or redo during a
 * turn stops the agent first (`onInterrupt`, wired by the Assistant).
 */
export class AiTurn {
  private open: string | null = null
  private group = ''
  private count = 0
  /** Called when the person undoes/redoes mid-turn: stop the agent. */
  onInterrupt: (() => void) | null = null
  constructor(private store: EditorStore) {}
  begin(label: string) {
    if (this.open !== null) this.end()
    // A gesture in progress is the person's, not the agent's.
    this.store.seal('Edit')
    this.open = label
    this.group = `ai-${Date.now().toString(36)}-${++this.count}`
    this.store.interruptTurn = () => {
      const stop = this.onInterrupt
      this.end()
      stop?.()
    }
  }
  end() {
    if (this.open === null) return
    this.open = null
    this.store.interruptTurn = null
  }
  get active(): boolean {
    return this.open !== null
  }
  /** Apply an op; true when it changed the document. */
  write(op: Op, label: string): boolean {
    if (this.open === null) return this.store.commit(op, label)
    return this.store.commit(op, this.open, this.group)
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
    // Shorthand for a list ("columns": "Name,Role,Amount"), turned into the
    // list when the node is made.
    if (!ps && LIST_SHORTHAND[type]?.includes(k) && typeof v === 'string') {
      ok[k] = v
      continue
    }
    if (!ps) {
      rejected.push(`${k}: not a property of ${type}`)
      continue
    }
    // A word from before the vocabulary was unified still means what it meant.
    const value = coerce(ps, renamedValue(type, k, v))
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
    ...(n.actions ? { actions: n.actions } : {}),
    ...(n.startsHidden ? { startsHidden: true } : {}),
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
    sizeInto(made, a)
    const tree: Record<NodeId, Node> = {}
    seedInto(made, tree)
    if (!t.write({ op: 'insert', parent, node: made, ...(Object.keys(tree).length ? { tree } : {}) }, `Add ${type}`)) throw new Error(`could not add ${type} there`)
    return { id, ...(made.children.length ? { children: made.children.map((c) => ({ id: c, type: tree[c]!.type })) } : {}), ...(rejected.length ? { rejected } : {}) }
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
    // Only the axes given: a width alone used to also pin the height to 40px
    // (resize writes both), which an agent then had to set back to auto.
    if (w !== undefined && h !== undefined) t.write({ op: 'resize', id, w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) }, 'Resize')
    else if (w !== undefined) t.write({ op: 'setProp', id, key: 'w', value: Math.max(1, Math.round(w)) }, 'Width')
    else if (h !== undefined) t.write({ op: 'setProp', id, key: 'h', value: Math.max(1, Math.round(h)) }, 'Height')
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

  build: (s, t, a) => {
    const parent = a.parent_id === null || a.parent_id === undefined ? null : String(a.parent_id)
    if (parent === null && s.doc.root !== null) throw new Error('the document already has a root; pass its id (or another container) as parent_id')
    if (parent !== null) nodeOf(s, parent)
    const rejected: string[] = []
    const refs: Record<string, string> = {}
    const tree: Record<NodeId, Node> = {}
    let count = 0
    const make = (raw: unknown, hostType: string | null, hostFlow: boolean, path: string, depth: number): Node | null => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${path}: a node must be an object {type, props?, children?}`)
      const src = raw as Record<string, unknown>
      const type = typeof src.type === 'string' ? src.type : ''
      if (!getComponent(type)) throw new Error(`${path}: unknown component "${type}" (list_components has the names)`)
      if (hostType !== null) {
        if (!getComponent(hostType)?.container) throw new Error(`${path}: ${hostType} is not a container, so it cannot hold ${type}`)
        if (!acceptsChild(hostType, type)) throw new Error(`${path}: ${hostType} only accepts ${getComponent(hostType)?.childTypes?.join(', ')}`)
      }
      if (depth > 24) throw new Error(`${path}: nested too deep`)
      if (++count > 300) throw new Error('more than 300 nodes in one build; split it')
      const { ok, rejected: bad } = validProps(type, src.props)
      for (const r of bad) rejected.push(`${path} ${type}: ${r}`)
      const id = `n${Math.random().toString(36).slice(2, 9)}`
      const x = hostFlow ? 0 : finite(src.x) ?? 0
      const y = hostFlow ? 0 : finite(src.y) ?? 0
      const node = instantiateFor(type, ok, x, y, id, hostFlow)
      if (typeof src.flow === 'boolean' && getComponent(type)?.container) node.flow = src.flow
      if (typeof src.name === 'string' && src.name) node.name = src.name.slice(0, 80)
      if (typeof src.ref === 'string' && src.ref) refs[src.ref] = id
      sizeInto(node, src)
      const kids = Array.isArray(src.children) ? src.children : []
      if (kids.length && !getComponent(type)?.container) throw new Error(`${path}: ${type} is not a container, so it cannot have children`)
      node.children = kids.map((c, i) => {
        const k = make(c, type, node.flow, `${path}.children[${i}]`, depth + 1)!
        tree[k.id] = k
        return k.id
      })
      // No children given: it arrives the way the toolbox drops it.
      if (!kids.length) {
        const before = Object.keys(tree).length
        seedInto(node, tree)
        count += Object.keys(tree).length - before
      }
      return node
    }
    const hostType = parent === null ? null : s.doc.nodes[parent]!.type
    const hostFlow = parent !== null && s.doc.nodes[parent]!.flow === true
    const root = make(a.tree, hostType, hostFlow, 'tree', 0)!
    const spec = getComponent(root.type)!
    if (parent === null && spec.container && root.props.anchor === 'none' && !['x', 'y', 'w', 'h'].some((k) => (a.tree as Record<string, unknown>)[k] !== undefined || ((a.tree as { props?: Record<string, unknown> }).props ?? {})[k] !== undefined)) {
      root.props.anchor = 'fill'
    }
    if (!t.write({ op: 'insert', parent, node: root, tree }, `Build ${root.type}`)) throw new Error('could not build it there')
    return { id: root.id, created: count, ...(Object.keys(refs).length ? { refs } : {}), ...(rejected.length ? { rejected } : {}) }
  },

  style_part: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    const part = need(a, 'part')
    const parts = getComponent(n.type)?.parts
    if (!parts?.[part]) throw new Error(`${n.type} has no part "${part}"${parts ? ` (parts: ${Object.keys(parts).join(', ')})` : ' (it declares no parts)'}`)
    const raw = (a.style && typeof a.style === 'object' && !Array.isArray(a.style) ? a.style : null) as Record<string, unknown> | null
    if (!raw) throw new Error('"style" must be an object')
    const clears = Object.keys(raw).filter((k) => raw[k] === null)
    const { style, dropped } = cleanPartStyle(n.type, part, Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)))
    const patch: Record<string, string | number | null> = { ...style }
    for (const k of clears) patch[k] = null
    if (Object.keys(patch).length) t.write({ op: 'setPartStyle', id, part, patch }, `Style ${part}`)
    return { part, style: s.doc.nodes[id]?.parts?.[part] ?? {}, ...(dropped.length ? { rejected: dropped } : {}) }
  },

  set_states: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const state = need(a, 'state') as InteractionState
    if (!INTERACTION_STATES.includes(state)) throw new Error('state must be hover, focus or pressed')
    const raw = (a.style && typeof a.style === 'object' && !Array.isArray(a.style) ? a.style : null) as Record<string, unknown> | null
    if (!raw) throw new Error('"style" must be an object')
    const clears = Object.keys(raw).filter((k) => raw[k] === null)
    const { style, dropped } = cleanStateStyle(Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== null)))
    const patch: Record<string, string | number | null> = { ...style }
    for (const k of clears) patch[k] = null
    if (Object.keys(patch).length) t.write({ op: 'setStateStyle', id, state, patch }, `${state} style`)
    return { state, style: s.doc.nodes[id]?.states?.[state] ?? {}, ...(dropped.length ? { rejected: dropped } : {}) }
  },

  set_responsive: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const bp = need(a, 'breakpoint')
    if (bp !== 'sm' && bp !== 'md') throw new Error('breakpoint must be sm (phone) or md (tablet); the base design is desktop')
    const raw = (a.override && typeof a.override === 'object' && !Array.isArray(a.override) ? a.override : null) as Record<string, unknown> | null
    if (!raw) throw new Error('"override" must be an object')
    const patch: Record<string, number | boolean | null> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(raw)) {
      if (v === null && ['x', 'y', 'w', 'h', 'flow', 'visible', 'opacity'].includes(k)) patch[k] = null
      else if (['x', 'y', 'w', 'h'].includes(k) && finite(v) !== undefined) patch[k] = Math.round(finite(v)!)
      else if (k === 'opacity' && finite(v) !== undefined) patch[k] = Math.min(1, Math.max(0, finite(v)!))
      else if ((k === 'flow' || k === 'visible') && typeof v === 'boolean') patch[k] = v
      else rejected.push(`${k} (${['x', 'y', 'w', 'h', 'opacity'].includes(k) ? 'not a finite number' : k === 'flow' || k === 'visible' ? 'not a boolean' : 'unknown: x, y, w, h, flow, visible, opacity'})`)
    }
    if (Object.keys(patch).length) t.write({ op: 'setResponsive', id, breakpoint: bp, patch }, `${bp === 'sm' ? 'Phone' : 'Tablet'} layout`)
    return { breakpoint: bp, override: s.doc.nodes[id]?.responsive?.[bp] ?? {}, ...(rejected.length ? { rejected } : {}) }
  },

  set_display: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const done: Record<string, unknown> = {}
    if (a.opacity !== undefined) {
      const o = finite(a.opacity)
      if (o === undefined) throw new Error('opacity must be a number 0-1')
      t.write({ op: 'setOpacity', id, opacity: Math.min(1, Math.max(0, o)) }, 'Opacity')
      done.opacity = s.doc.nodes[id]!.opacity
    }
    if (a.visible !== undefined) {
      if (typeof a.visible !== 'boolean') throw new Error('visible must be true or false')
      t.write({ op: 'setVisible', id, visible: a.visible }, a.visible ? 'Show' : 'Hide')
      done.visible = a.visible
    }
    if (a.locked !== undefined) {
      if (typeof a.locked !== 'boolean') throw new Error('locked must be true or false')
      t.write({ op: 'setLocked', id, locked: a.locked }, a.locked ? 'Lock' : 'Unlock')
      done.locked = a.locked
    }
    if (a.name !== undefined) {
      if (typeof a.name !== 'string') throw new Error('name must be a string')
      t.write({ op: 'setName', id, name: a.name.slice(0, 80) }, 'Rename layer')
      done.name = a.name.slice(0, 80)
    }
    return done
  },

  set_effects: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const raw = (a.effects && typeof a.effects === 'object' && !Array.isArray(a.effects) ? a.effects : null) as Record<string, unknown> | null
    if (!raw) throw new Error('"effects" must be an object')
    const known = new Set(Object.keys(DEFAULT_EFFECTS))
    const patch: Record<string, unknown> = {}
    const rejected: string[] = []
    for (const [k, v] of Object.entries(raw)) {
      if (!known.has(k)) { rejected.push(`${k} (unknown effect setting)`); continue }
      const d = (DEFAULT_EFFECTS as unknown as Record<string, unknown>)[k]
      if (typeof d !== typeof v) { rejected.push(`${k} (expected a ${typeof d})`); continue }
      if (typeof v === 'string' && typeof d === 'string' && d.startsWith('#') || /Color|From|Via|To$/.test(k)) {
        if (typeof v === 'string' && !isSafeColor(v)) { rejected.push(`${k} (not a colour)`); continue }
      }
      patch[k] = v
    }
    if (Object.keys(patch).length) t.write({ op: 'setEffects', id, patch }, 'Effects')
    const after = normalizeEffects(s.doc.nodes[id]?.effects)
    for (const k of Object.keys(patch)) if ((after as unknown as Record<string, unknown>)[k] !== patch[k]) rejected.push(`${k} (out of range; now ${JSON.stringify((after as unknown as Record<string, unknown>)[k])})`)
    return { applied: Object.keys(patch).length, ...(rejected.length ? { rejected } : {}) }
  },

  duplicate: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    if (id === s.doc.root) throw new Error('the root cannot be duplicated (no parent could hold the copy)')
    const parent = parentOf(s.doc, id)!
    const count = Math.max(1, Math.min(50, Math.round(finite(a.count) ?? 1)))
    const ids: string[] = []
    const inFlow = s.doc.nodes[parent]?.flow === true
    for (let i = 1; i <= count; i++) {
      const { root, tree } = copySubtree(s.doc, id)
      if (!inFlow) root.props = { ...root.props, x: (Number(n.props.x) || 0) + 12 * i, y: (Number(n.props.y) || 0) + 12 * i }
      const at = s.doc.nodes[parent]!.children.indexOf(ids.length ? ids[ids.length - 1]! : id) + 1
      if (!t.write({ op: 'insert', parent, node: root, tree, index: at }, `Duplicate ${n.type}`)) throw new Error('could not duplicate it')
      ids.push(root.id)
    }
    return { ids }
  },

  arrange: (s, t, a) => {
    const id = need(a, 'id')
    nodeOf(s, id)
    const to = need(a, 'to')
    if (to !== 'front' && to !== 'back') throw new Error('to must be front or back')
    const parent = parentOf(s.doc, id)
    if (!parent) throw new Error('the root has no siblings to arrange among')
    const index = to === 'front' ? s.doc.nodes[parent]!.children.length - 1 : 0
    t.write({ op: 'reparent', id, parent, index }, to === 'front' ? 'Bring to front' : 'Send to back')
    return { index: s.doc.nodes[parent]!.children.indexOf(id) }
  },

  set_actions: (s, t, a) => {
    const id = need(a, 'id')
    const n = nodeOf(s, id)
    const raw: Record<string, unknown> = {}
    if (a.click !== undefined) raw.click = a.click
    if (a.views !== undefined) raw.views = a.views
    const { actions, issues } = cleanActions(n, raw, s.doc)
    const missing = [...(actions?.click ?? []).map((x) => x.target), ...Object.values(actions?.views ?? {})].filter((x) => !s.doc.nodes[x])
    if (missing.length) throw new Error(`no node ${missing.map((m) => `"${m}"`).join(', ')} (get_document lists the ids)`)
    t.write({ op: 'setActions', id, actions: actions ?? null }, 'Wire actions')
    const hidden: string[] = []
    for (const h of Array.isArray(a.starts_hidden) ? a.starts_hidden : []) {
      if (typeof h !== 'string' || !s.doc.nodes[h]) {
        issues.push(`starts_hidden: no node "${String(h)}"`)
        continue
      }
      t.write({ op: 'setStartsHidden', id: h, on: true }, 'Starts hidden')
      hidden.push(h)
    }
    return { actions: s.doc.nodes[id]?.actions ?? {}, ...(hidden.length ? { starts_hidden: hidden } : {}), ...(issues.length ? { rejected: issues } : {}) }
  },

  select: (s, _t, a) => {
    const ids = Array.isArray(a.ids) ? a.ids.filter((x): x is string => typeof x === 'string' && !!s.doc.nodes[x]) : []
    s.select(ids)
    return { selected: ids }
  },
}

/**
 * What a toolbox drop brings with it (`store.dropComponent`): a Tabs arrives
 * with its panels, an Accordion with its items, a SettingsSection with its
 * rows, arranged in flow. Code-built nodes arrived bare, so an agent's Tabs had
 * no tabs at all.
 */
function seedInto(node: Node, tree: Record<NodeId, Node>): void {
  const seed = getComponent(node.type)?.seed
  if (!seed?.length || node.children.length) return
  node.flow = true
  const make = (under: Node, list: NonNullable<typeof seed>) => {
    for (const c of list) {
      const kid = instantiateFor(c.type, (c.props ?? {}) as Record<string, PropValue>, 0, 0, `n${Math.random().toString(36).slice(2, 9)}`, true)
      if (c.seed?.length) kid.flow = true
      tree[kid.id] = kid
      under.children.push(kid.id)
      if (c.seed?.length) make(kid, c.seed)
    }
  }
  make(node, seed)
}

/** A node's own size, given as w/h beside x/y: px, or "auto" to hug content. */
function sizeInto(node: Node, src: Record<string, unknown>): void {
  for (const k of ['w', 'h'] as const) {
    const v = src[k]
    if (v === 'auto') delete node.props[k]
    else if (finite(v) !== undefined) node.props[k] = Math.max(1, Math.round(finite(v)!))
  }
}

/** A deep copy of a subtree with fresh ids (as duplicate in the Studio). */
function copySubtree(doc: EditorStore['doc'], id: NodeId): { root: Node; tree: Record<NodeId, Node> } {
  const tree: Record<NodeId, Node> = {}
  const copy = (src: Node): Node => {
    const next: Node = JSON.parse(JSON.stringify(src))
    next.id = `n${Math.random().toString(36).slice(2, 9)}`
    next.locked = false
    next.children = src.children.map((c) => {
      const k = copy(doc.nodes[c]!)
      tree[k.id] = k
      return k.id
    })
    return next
  }
  const root = copy(doc.nodes[id]!)
  // Wiring inside the copy follows the copy (see ops.remapRefs).
  const remap = new Map<NodeId, NodeId>()
  const pair = (orig: Node, dup: Node) => {
    remap.set(orig.id, dup.id)
    orig.children.forEach((c, i) => pair(doc.nodes[c]!, tree[dup.children[i]!]!))
  }
  pair(doc.nodes[id]!, root)
  for (const n of [root, ...Object.values(tree)]) remapRefs(n, remap)
  return { root, tree }
}

/** A node as a toolbox drop makes it (defaults, drop size), with these props. */
function instantiateFor(type: string, props: Record<string, PropValue>, x: number, y: number, id: string, intoFlow: boolean): Node {
  const made = instantiate(type)
  const all: Record<string, PropValue> = { ...made.props, ...dropSize(type, intoFlow), ...props, x, y }
  const lists = takeShorthand(type, all)
  return {
    id,
    type,
    props: all,
    ...(lists ? { lists } : {}),
    children: [],
    flow: made.flow,
    visible: true,
    locked: false,
    opacity: 1,
  }
}
