/**
 * Actions: what a control does to OTHER components.
 *
 * Standing rule 8 (ROADMAP.md): whatever a UI alone can do, a Loom UI does.
 * Built-in behaviour already covers what a control does to ITSELF (a tab
 * highlights, a switch flips); this covers the rest, with a fixed vocabulary a
 * person sets in the Properties panel and the agent sets through its tools:
 *
 *  - on a pressable (Button, IconButton, Link, BackButton), a list of
 *    `click` actions, each a verb and a target node;
 *  - on a choice control (Segmented, TabBar, RadioGroup, Select, and the
 *    on/off Checkbox, Switch and ToggleButton), `views`: which node each choice
 *    shows. Choosing one shows its node and hides the others' — a real view
 *    switch, the List/Table case.
 *
 * A target that no longer exists is kept and FLAGGED (standing rule 5): the
 * panel says so and the runtime ignores it, and undoing the deletion brings
 * the wiring back to life.
 */

import type { Document, Node, NodeId, PropValue } from './types'
import { delimiterChar } from './registry'
import { itemsOf } from './lists'

export type ActionVerb = 'show' | 'hide' | 'toggle' | 'open' | 'close'

export const ACTION_VERBS: readonly ActionVerb[] = ['show', 'hide', 'toggle', 'open', 'close'] as const

export const VERB_LABELS: Record<ActionVerb, string> = {
  show: 'Show',
  hide: 'Hide',
  toggle: 'Toggle',
  open: 'Open',
  close: 'Close',
}

export interface Action {
  verb: ActionVerb
  target: NodeId
}

export interface NodeActions {
  /** What pressing it does, in order. */
  click?: Action[]
  /** Choice key -> the node that choice shows (the others' are hidden). */
  views?: Record<string, NodeId>
}

/** Components a person presses. */
export const PRESSABLE = new Set(['Button', 'IconButton', 'Link', 'BackButton'])

/** Components that hold a choice, and so can switch views. */
export const CHOOSER = new Set(['Segmented', 'TabBar', 'RadioGroup', 'Select', 'Checkbox', 'Switch', 'ToggleButton'])

/** On/off controls: their choices are "on" and "off". */
const TWO_STATE = new Set(['Checkbox', 'Switch', 'ToggleButton'])

const split = (value: PropValue | undefined, sep: PropValue | undefined): string[] =>
  typeof value === 'string' ? value.split(delimiterChar(sep)).map((s) => s.trim()).filter((s) => s !== '') : []

/**
 * The choice keys a control offers, in order, or null when it is not a choice
 * control. A key is what the runtime reads back from the rendered control.
 */
export function choicesOf(node: Node): string[] | null {
  switch (node.type) {
    case 'Segmented':
    case 'Select':
      return split(node.props.options, node.props.optionsSep)
    case 'TabBar':
      return split(node.props.tabs, node.props.tabsSep)
    case 'RadioGroup':
      return itemsOf(node, 'options').map((row) => String(row.value || row.label)).filter((k) => k !== '')
    default:
      return TWO_STATE.has(node.type) ? ['on', 'off'] : null
  }
}

/** The choice a control starts on, as authored. */
export function initialChoice(node: Node): string | null {
  switch (node.type) {
    case 'Segmented':
    case 'Select':
    case 'RadioGroup':
      return typeof node.props.value === 'string' ? node.props.value : null
    case 'TabBar': {
      const i = typeof node.props.active === 'number' ? node.props.active : 0
      return choicesOf(node)?.[i] ?? null
    }
    case 'Checkbox':
      return node.props.checked === true ? 'on' : 'off'
    case 'Switch':
      return node.props.on === true ? 'on' : 'off'
    case 'ToggleButton':
      return node.props.pressed === true ? 'on' : 'off'
    default:
      return null
  }
}

/** Can this node carry `click` actions / `views`? */
export const canClick = (type: string): boolean => PRESSABLE.has(type)
export const canSwitch = (type: string): boolean => CHOOSER.has(type)

/**
 * Keep what is well-formed; report the rest. Targets are checked against the
 * document when one is given: a missing target is KEPT and reported as
 * `broken` (so undo can revive it), a self-target is dropped.
 */
export function cleanActions(node: Node, raw: unknown, doc?: Document): { actions: NodeActions | undefined; issues: string[]; broken: NodeId[] } {
  const issues: string[] = []
  const broken: NodeId[] = []
  if (raw === undefined || raw === null) return { actions: undefined, issues, broken }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { actions: undefined, issues: ['actions must be an object'], broken }
  const src = raw as Record<string, unknown>
  const out: NodeActions = {}
  const target = (t: unknown, where: string): NodeId | null => {
    if (typeof t !== 'string' || t === '') {
      issues.push(`${where}: target must be a node id`)
      return null
    }
    if (t === node.id) {
      issues.push(`${where}: a control cannot target itself`)
      return null
    }
    if (doc && !doc.nodes[t]) broken.push(t)
    return t
  }
  if (src.click !== undefined) {
    if (!canClick(node.type)) issues.push(`${node.type} is not pressed, so it has no click actions`)
    else if (!Array.isArray(src.click)) issues.push('click must be a list of {verb, target}')
    else {
      const list: Action[] = []
      src.click.slice(0, 12).forEach((a, i) => {
        const r = (a ?? {}) as Record<string, unknown>
        if (!ACTION_VERBS.includes(r.verb as ActionVerb)) {
          issues.push(`click[${i}]: verb must be one of ${ACTION_VERBS.join(', ')}`)
          return
        }
        const t = target(r.target, `click[${i}]`)
        if (t) list.push({ verb: r.verb as ActionVerb, target: t })
      })
      if (list.length) out.click = list
    }
  }
  if (src.views !== undefined) {
    const choices = choicesOf(node)
    if (!choices) issues.push(`${node.type} holds no choice, so it cannot switch views`)
    else if (!src.views || typeof src.views !== 'object' || Array.isArray(src.views)) issues.push('views must map a choice to a node id')
    else {
      const views: Record<string, NodeId> = {}
      for (const [k, v] of Object.entries(src.views as Record<string, unknown>)) {
        if (!choices.includes(k)) {
          issues.push(`views: "${k}" is not one of its choices (${choices.join(', ')})`)
          continue
        }
        const t = target(v, `views.${k}`)
        if (t) views[k] = t
      }
      if (Object.keys(views).length) out.views = views
    }
  }
  return { actions: out.click || out.views ? out : undefined, issues, broken }
}

/** Every node some control acts on, with the controls that do. */
export function targetsOf(doc: Document): Map<NodeId, NodeId[]> {
  const by = new Map<NodeId, NodeId[]>()
  const add = (t: NodeId, from: NodeId) => {
    const list = by.get(t) ?? []
    if (!list.includes(from)) list.push(from)
    by.set(t, list)
  }
  for (const n of Object.values(doc.nodes)) {
    for (const a of n.actions?.click ?? []) add(a.target, n.id)
    for (const t of Object.values(n.actions?.views ?? {})) add(t, n.id)
  }
  return by
}

/** The node ids a control's actions point at that are not in the document. */
export function brokenTargets(doc: Document, node: Node): NodeId[] {
  const ids = [...(node.actions?.click ?? []).map((a) => a.target), ...Object.values(node.actions?.views ?? {})]
  return ids.filter((id) => !doc.nodes[id])
}

/**
 * Whether a node starts hidden in output because a view switch owns it and
 * its choice is not the control's starting choice (so the static export and
 * the first paint already show the right view).
 */
export function hiddenAtStart(doc: Document, id: NodeId): boolean {
  for (const n of Object.values(doc.nodes)) {
    const views = n.actions?.views
    if (!views) continue
    const keys = Object.keys(views).filter((k) => views[k] === id)
    if (!keys.length) continue
    const start = initialChoice(n)
    if (start !== null && !keys.includes(start)) return true
  }
  return false
}
