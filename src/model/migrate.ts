/**
 * Migrations of an UNTRUSTED file, run before it is validated.
 *
 * Tools that were separate nodes and are now rows of their parent (a
 * TimelineItem is an event in its Timeline's list) must not vanish from an old
 * file. Each is folded into the parent's list, in order; one found anywhere
 * else becomes a one-row parent of its own; and every change is reported, the
 * same way the loader reports every repair. Nothing here trusts the file: every
 * field read is type-checked, and the validator runs on the result anyway.
 */

import type { ListItem, NodeId } from './types'
import { getComponent } from './registry'

type RawNode = { id?: unknown; type?: unknown; props?: unknown; children?: unknown; lists?: unknown; [k: string]: unknown }
export interface MigrationIssue {
  path: string
  message: string
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const text = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d)
const kids = (n: RawNode): string[] => (Array.isArray(n.children) ? (n.children.filter((c) => typeof c === 'string') as string[]) : [])

interface Fold {
  /** Parent types it folds into. */
  into: string[]
  /** The list it becomes a row of. */
  list: string
  item: (props: Record<string, unknown>) => ListItem
  /** Props the first folded child hands up to its parent, where the parent has none. */
  hoist?: (props: Record<string, unknown>) => Record<string, unknown>
  /** What it becomes when it is NOT inside one of its parents. */
  orphan: (props: Record<string, unknown>, item: ListItem) => { type: string; props: Record<string, unknown>; lists?: Record<string, ListItem[]> }
}

const keepGeometry = (p: Record<string, unknown>) =>
  Object.fromEntries(['x', 'y', 'w', 'h'].filter((k) => typeof p[k] === 'number').map((k) => [k, p[k]]))

export const FOLDS: Record<string, Fold> = {
  TimelineItem: {
    into: ['Timeline'],
    list: 'events',
    item: (p) => ({
      title: text(p.title, 'Event'),
      time: text(p.time),
      description: text(p.description),
      tone: text(p.tone, 'accent'),
      markerStyle: text(p.markerStyle, 'dot'),
    }),
    hoist: (p) => ({ ...(typeof p.size === 'string' ? { size: p.size } : {}), ...(typeof p.markerSize === 'number' ? { markerSize: p.markerSize } : {}) }),
    orphan: (p, item) => ({ type: 'Timeline', props: { ...keepGeometry(p) }, lists: { events: [item] } }),
  },
  MenuItem: {
    into: ['Menu'],
    list: 'items',
    item: (p) => ({
      label: text(p.label, 'Command'),
      icon: text(p.icon),
      shortcut: text(p.shortcut),
      active: p.active === true,
      danger: p.danger === true,
      disabled: p.disabled === true,
    }),
    hoist: (p) => (typeof p.size === 'string' ? { size: p.size } : {}),
    orphan: (p, item) => ({ type: 'Menu', props: { ...keepGeometry(p), ...(typeof p.size === 'string' ? { size: p.size } : {}) }, lists: { items: [item] } }),
  },
  NavLink: {
    into: ['NavBar', 'SideNav'],
    list: 'links',
    item: (p) => ({
      label: text(p.label, 'Link'),
      href: text(p.href, '#'),
      icon: text(p.icon),
      active: p.active === true,
      disabled: p.disabled === true,
    }),
    hoist: (p) => ({
      ...(typeof p.size === 'string' ? { size: p.size } : {}),
      ...(typeof p.iconPosition === 'string' ? { iconPosition: p.iconPosition } : {}),
      ...(p.underline === true ? { underline: true } : {}),
      ...(p.truncate === true ? { truncate: true } : {}),
    }),
    // A nav link on its own is a link.
    orphan: (p) => ({ type: 'Link', props: { ...keepGeometry(p), text: text(p.label, 'Link'), href: text(p.href, '#') } }),
  },
  Radio: {
    into: ['RadioGroup'],
    list: 'options',
    item: (p) => ({ label: text(p.label, 'Option'), value: text(p.label, 'Option'), disabled: p.disabled === true }),
    // Radios sharing a group name under one parent become ONE group (see
    // step 2): a set of single-option groups would not be a choice at all.
    orphan: (p, item) => ({
      type: 'RadioGroup',
      props: { ...keepGeometry(p), value: p.checked === true ? item.value : '' },
      lists: { options: [item] },
    }),
  },
}

/** Radios that were one choice (same parent, same group name) migrate as one group. */
const GROUP_KEY: Record<string, (p: Record<string, unknown>) => string> = {
  Radio: (p) => text(p.group, 'g1'),
}

/**
 * Types that held their rows as CHILDREN and now hold them as a list, with the
 * list's name. An old file's node of one of these has no `lists` at all, and
 * its list must start empty (its rows were its children, folded in above),
 * not with the component's sample rows.
 */
const LISTED_FROM_CHILDREN: Record<string, string> = {
  Timeline: 'events',
  Menu: 'items',
  NavBar: 'links',
  SideNav: 'links',
  RadioGroup: 'options',
}

/** Of those, the ones that no longer hold children at all. */
const FORMER_CONTAINERS = new Set(['Timeline', 'RadioGroup'])

/**
 * Apply every migration to `nodes` in place. Returns the issues to report.
 * `nodes` is the raw file's node table; the validator runs afterwards.
 */
export function migrateNodes(nodes: Record<string, unknown>): MigrationIssue[] {
  const issues: MigrationIssue[] = []
  const raw = nodes as Record<string, RawNode>

  // 0. RadioGroup kept its options as a delimited string; they become rows
  //    first, so radios folded in below come after them, in drawn order.
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object' || text(node.type) !== 'RadioGroup') continue
    const props = obj(node.props)
    if (typeof props.options !== 'string') continue
    const seps: Record<string, string> = { comma: ',', pipe: '|', semicolon: ';', newline: '\n', tab: '\t', space: ' ' }
    const sep = seps[text(props.optionsSep, 'comma')] ?? ','
    const opts = props.options.split(sep).map((o) => o.trim()).filter((o) => o !== '')
    const lists = obj(node.lists)
    if (!Array.isArray(lists.options)) node.lists = { ...lists, options: opts.map((o) => ({ label: o, value: o, disabled: false })) }
    const { options: _o, optionsSep: _s, ...rest } = props
    node.props = rest
    issues.push({ path: `$.nodes.${id}.props.options`, message: `options are now rows of the RadioGroup (${opts.length} converted)` })
  }

  // 0b. Tabs kept a separate list of labels beside its panels, and the two
  //     could disagree. The strip now reads each panel's title, so the old
  //     labels BECOME the titles (the strip looks as it did), and a label with
  //     no panel yet gets an empty one.
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object' || text(node.type) !== 'Tabs') continue
    const props = obj(node.props)
    if (typeof props.tabs !== 'string') continue
    const seps: Record<string, string> = { comma: ',', pipe: '|', semicolon: ';', newline: '\n', tab: '\t', space: ' ' }
    const names = props.tabs.split(seps[text(props.tabsSep, 'comma')] ?? ',').map((n) => n.trim()).filter((n) => n !== '')
    const panels = kids(node).filter((c) => text(raw[c]?.type) === 'TabPanel')
    names.forEach((name, i) => {
      const existing = panels[i] ? raw[panels[i]] : undefined
      if (existing) {
        existing.props = { ...obj(existing.props), title: name }
        return
      }
      let nid = `${id}-tab${i + 1}`
      while (raw[nid]) nid += 'x'
      raw[nid] = { id: nid, type: 'TabPanel', props: { title: name }, children: [], flow: false, visible: true, locked: false, opacity: 1 }
      node.children = [...kids(node), nid]
    })
    const { tabs: _t, tabsSep: _ts, ...rest } = props
    node.props = rest
    issues.push({ path: `$.nodes.${id}.props.tabs`, message: `tab labels are now the tabs' own titles (${names.length} applied)` })
  }

  // 0c. The typing indicator is an option of the message list now.
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object' || text(node.type) !== 'TypingIndicator') continue
    const holderId = Object.keys(raw).find((k) => kids(raw[k] ?? {}).includes(id))
    const holder = holderId ? raw[holderId] : undefined
    const props = obj(node.props)
    if (holder && text(holder.type) === 'MessageList') {
      holder.props = { ...obj(holder.props), showTyping: true, typingLabel: text(props.label, 'Someone is typing') }
      issues.push({ path: `$.nodes.${id}`, message: 'TypingIndicator is now the message list\'s "Show typing" option' })
    } else {
      issues.push({ path: `$.nodes.${id}`, message: 'TypingIndicator outside a message list has nothing to indicate (dropped)' })
    }
    if (holder) holder.children = kids(holder).filter((c) => c !== id)
    delete raw[id]
  }

  // 1. Fold children into their parent's list, in the parent's child order.
  for (const parent of Object.values(raw)) {
    if (!parent || typeof parent !== 'object') continue
    const ptype = text(parent.type)
    const keep: string[] = []
    let hoisted = false
    for (const cid of kids(parent)) {
      const child = raw[cid]
      const fold = child && typeof child === 'object' ? FOLDS[text(child.type)] : undefined
      if (!fold || !fold.into.includes(ptype)) {
        keep.push(cid)
        continue
      }
      const props = obj(child.props)
      const lists = obj(parent.lists)
      const current = Array.isArray(lists[fold.list]) ? (lists[fold.list] as ListItem[]) : []
      // The parent's list starts EMPTY when the file never had one: the rows
      // are the file's own children, not the component's sample content.
      parent.lists = { ...lists, [fold.list]: [...current, fold.item(props)] }
      if (!hoisted && fold.hoist) {
        const pprops = obj(parent.props)
        const up = fold.hoist(props)
        parent.props = { ...up, ...pprops }
        hoisted = true
      }
      delete raw[cid]
      issues.push({ path: `$.nodes.${cid}`, message: `${text(child.type)} is now a row of its ${ptype} (folded into "${fold.list}")` })
    }
    if (keep.length !== kids(parent).length) parent.children = keep
  }

  // 2. Any left over were not inside a parent: each becomes a parent of one
  //    row, except that siblings sharing a GROUP_KEY become one parent.
  const parentOfNode = new Map<string, string>()
  for (const [pid, n] of Object.entries(raw)) if (n && typeof n === 'object') for (const c of kids(n)) parentOfNode.set(c, pid)
  const leaders = new Map<string, RawNode>()
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object') continue
    const type = text(node.type)
    const fold = FOLDS[type]
    if (!fold) continue
    const props = obj(node.props)
    const item = fold.item(props)
    const groupOf = GROUP_KEY[type]
    const gkey = groupOf ? `${parentOfNode.get(id) ?? ''}|${groupOf(props)}` : ''
    const leader = gkey ? leaders.get(gkey) : undefined
    if (leader) {
      // Join the group's first member: one more row, and gone as a node.
      const lists = obj(leader.lists)
      const rows = Array.isArray(lists[fold.list]) ? (lists[fold.list] as ListItem[]) : []
      leader.lists = { ...lists, [fold.list]: [...rows, item] }
      if (type === 'Radio' && props.checked === true) leader.props = { ...obj(leader.props), value: item.value }
      const holder = raw[parentOfNode.get(id) ?? '']
      if (holder) holder.children = kids(holder).filter((c) => c !== id)
      delete raw[id]
      issues.push({ path: `$.nodes.${id}`, message: `${type} joined the others in its group as one ${text(leader.type)}` })
      continue
    }
    const next = fold.orphan(props, item)
    issues.push({ path: `$.nodes.${id}`, message: `${type} on its own became a ${next.type}${next.lists ? ' with one row' : ''}` })
    node.type = next.type
    node.props = next.props
    if (next.lists) node.lists = next.lists
    if (gkey) leaders.set(gkey, node)
  }

  // 3. An old-format former container starts with an empty list: its rows
  //    were its children, and step 1 already folded those in.
  for (const node of Object.values(raw)) {
    if (!node || typeof node !== 'object') continue
    const key = LISTED_FROM_CHILDREN[text(node.type)]
    if (!key) continue
    const lists = obj(node.lists)
    if (!Array.isArray(lists[key])) node.lists = { ...lists, [key]: [] }
  }

  // 4. A former container no longer holds children: anything else it held
  //    moves to its own parent, right after it, rather than being hidden.
  const parentOf = new Map<string, string>()
  for (const [pid, n] of Object.entries(raw)) if (n && typeof n === 'object') for (const c of kids(n)) parentOf.set(c, pid)
  for (const [id, node] of Object.entries(raw)) {
    if (!node || typeof node !== 'object') continue
    const spec = getComponent(text(node.type))
    const children = kids(node)
    if (!spec || !FORMER_CONTAINERS.has(spec.name) || spec.container || children.length === 0) continue
    const up = parentOf.get(id)
    const holder = up ? raw[up] : undefined
    node.children = []
    if (!holder) {
      issues.push({ path: `$.nodes.${id}.children`, message: `${spec.name} no longer holds children, and has no parent to hand them to (dropped)` })
      continue
    }
    const siblings = kids(holder)
    const at = siblings.indexOf(id)
    holder.children = [...siblings.slice(0, at + 1), ...children, ...siblings.slice(at + 1)]
    issues.push({ path: `$.nodes.${id}.children`, message: `${spec.name} no longer holds children; ${children.length} moved next to it` })
  }
  return issues
}

export type { NodeId }
