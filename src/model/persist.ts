/**
 * Document persistence.
 *
 * The document is a plain JSON scene tree, so saving is serialisation and
 * loading is validation. Two rules make this safe:
 *
 *  1. NEVER trust a file. An unknown component type, a dangling child id, or
 *     a node that is its own ancestor would corrupt the tree. `validate()`
 *     rejects those before anything reaches the store.
 *  2. Version the format. A future migration hooks in here rather than at
 *     every call site.
 */

import { BREAKPOINTS, INTERACTION_STATES, type Breakpoint, type DocMeta, type Document, type InteractionState, type InteractionStyles, type Node, type NodeId } from './types'
import { getComponent, validateProps } from './registry'
import { clampZ } from './ops'
import { normalizeEffects } from '../render/effects'
import { cleanStateStyle } from '../render/states'
import './toolbox'

/**
 * Tools that were REPLACED rather than kept alongside.
 *
 * A rename is a removal, and removals break files. When a tool is folded into
 * a better one, old documents have to keep opening — a designer who comes back
 * to a six-month-old file must not be told their work is corrupt because a tool
 * was renamed. The node is migrated to its replacement and the substitution is
 * REPORTED, so the change is visible rather than silent.
 */
const RENAMED: Record<string, string> = {
  // Folded into a real container field; the old one drew its own text input.
  FormField: 'Field',
  // Replaced by the grid; the old one was a div schematic.
  Table: 'DataGrid',
}

/** The only keys a responsive override may carry. */
const RESPONSIVE_KEYS = new Set(['x', 'y', 'w', 'h', 'flow', 'visible', 'opacity'])

export const FORMAT_VERSION = 1

/**
 * Maximum tree depth accepted from a file. Real documents nest dozens deep
 * at most; beyond this the renderer's recursion would overflow the stack, so
 * the loader truncates with an issue rather than handing the renderer a bomb.
 */
export const MAX_TREE_DEPTH = 512

export interface ValidationIssue {
  path: string
  message: string
}

export interface Validated {
  doc: Document | null
  issues: ValidationIssue[]
}

/**
 * Validate an untrusted document.
 *
 * Returns a repaired-where-safe document, or null if the tree is structurally
 * unusable. Individual bad nodes are DROPPED with an issue rather than
 * failing the whole load — losing one component is better than losing the
 * user's work.
 */
export function validate(input: unknown): Validated {
  const issues: ValidationIssue[] = []

  // Callers hold file CONTENTS (a string), not a parsed object. Parse here so
  // a malformed file is reported as a parse failure rather than "not an
  // object", which is what a caller that already parsed would pass.
  let source: unknown = input
  if (typeof input === 'string') {
    try {
      source = JSON.parse(input)
    } catch (e) {
      return { doc: null, issues: [{ path: '$', message: `invalid JSON: ${String(e)}` }] }
    }
  }

  if (!source || typeof source !== 'object') {
    return { doc: null, issues: [{ path: '$', message: 'not an object' }] }
  }
  const raw = source as Partial<Document>

  if (raw.version !== FORMAT_VERSION) {
    issues.push({
      path: '$.version',
      message: `expected version ${FORMAT_VERSION}, got ${String(raw.version)}`,
    })
    return { doc: null, issues }
  }
  if (!raw.nodes || typeof raw.nodes !== 'object') {
    return { doc: null, issues: [{ path: '$.nodes', message: 'missing' }] }
  }
  // `null` root is the EMPTY workspace and always valid — nothing is auto
  // created, so a brand-new or just-emptied document is a first-class file.
  if (raw.root === null) {
    const strays = Object.keys(raw.nodes).length
    if (strays > 0) {
      issues.push({ path: '$.nodes', message: `${strays} node(s) with no root (dropped)` })
    }
    return {
      doc: {
        version: FORMAT_VERSION,
        meta: validateMeta(raw.meta, issues),
        root: null,
        nodes: {},
      },
      issues,
    }
  }
  if (typeof raw.root !== 'string' || !raw.nodes[raw.root]) {
    return { doc: null, issues: [{ path: '$.root', message: 'root does not exist' }] }
  }

  // Copy nodes, dropping anything structurally invalid.
  const nodes: Record<NodeId, Node> = {}
  for (const [id, n] of Object.entries(raw.nodes)) {
    if (!n || typeof n !== 'object') {
      issues.push({ path: `$.nodes.${id}`, message: 'not a node' })
      continue
    }
    const node = n as Node
    if (typeof node.type !== 'string') {
      issues.push({ path: `$.nodes.${id}.type`, message: 'missing type' })
      continue
    }
    // A renamed tool migrates instead of vanishing: the file opens, and the
    // substitution is reported so nobody wonders where the node went.
    if (!getComponent(node.type) && RENAMED[node.type] && getComponent(RENAMED[node.type])) {
      issues.push({
        path: `$.nodes.${id}.type`,
        message: `"${node.type}" was replaced by "${RENAMED[node.type]}" (migrated)`,
      })
      node.type = RENAMED[node.type]
    }
    if (!getComponent(node.type)) {
      issues.push({ path: `$.nodes.${id}.type`, message: `unknown component "${node.type}"` })
      continue
    }
    // Props go through the strict trust-boundary check: missing keys get
    // defaults, undeclared keys are dropped, and wrong-typed values reset to
    // defaults — each repair recorded. A node can never load incomplete.
    const rawProps =
      node.props && typeof node.props === 'object'
        ? (node.props as Record<string, unknown>)
        : {}
    const checked = validateProps(node.type, rawProps)
    for (const pi of checked.issues) {
      issues.push({ path: `$.nodes.${id}.props.${pi.key}`, message: pi.message })
    }
    // Node flags repair toward their defaults, reporting present-but-wrong
    // types. `visible` defaults true (hidden is an explicit author choice),
    // `locked` defaults false.
    if ('visible' in node && typeof node.visible !== 'boolean') {
      issues.push({ path: `$.nodes.${id}.visible`, message: `expected boolean, got ${typeof node.visible}` })
    }
    if ('locked' in node && typeof node.locked !== 'boolean') {
      issues.push({ path: `$.nodes.${id}.locked`, message: `expected boolean, got ${typeof node.locked}` })
    }
    // Atmosphere + paint order survive the round trip: effects are
    // re-normalized (renderer would anyway), z is clamped to range.
    // Without this, styling work silently vanishes on every save/load.
    let effects: Node['effects']
    if (node.effects === undefined) {
      effects = undefined
    } else if (node.effects && typeof node.effects === 'object' && !Array.isArray(node.effects)) {
      effects = normalizeEffects(node.effects)
    } else {
      issues.push({ path: `$.nodes.${id}.effects`, message: 'not an object (dropped)' })
      effects = undefined
    }
    let z: number | undefined
    if (node.z === undefined) {
      z = undefined
    } else if (typeof node.z === 'number' && Number.isFinite(node.z)) {
      z = clampZ(node.z)
    } else {
      issues.push({ path: `$.nodes.${id}.z`, message: `expected finite number, got ${String(node.z)}` })
      z = undefined
    }
    // Responsive overrides are a TRUST BOUNDARY like any other: a hand-written
    // file must not be able to smuggle in a non-finite width, a NaN coordinate
    // or an unknown breakpoint. Unknown keys are dropped and reported; numbers
    // are clamped to the same ranges the op uses.
    let responsive: Node['responsive']
    if (node.responsive === undefined) {
      responsive = undefined
    } else if (node.responsive && typeof node.responsive === 'object' && !Array.isArray(node.responsive)) {
      const bag: Record<string, Record<string, number | boolean>> = {}
      for (const [bpRaw, overRaw] of Object.entries(node.responsive as Record<string, unknown>)) {
        if (!BREAKPOINTS.includes(bpRaw as Breakpoint)) {
          issues.push({ path: `$.nodes.${id}.responsive.${bpRaw}`, message: `unknown breakpoint (dropped)` })
          continue
        }
        if (!overRaw || typeof overRaw !== 'object' || Array.isArray(overRaw)) {
          issues.push({ path: `$.nodes.${id}.responsive.${bpRaw}`, message: 'not an object (dropped)' })
          continue
        }
        const clean: Record<string, number | boolean> = {}
        for (const [k, v] of Object.entries(overRaw as Record<string, unknown>)) {
          if (!RESPONSIVE_KEYS.has(k)) {
            issues.push({ path: `$.nodes.${id}.responsive.${bpRaw}.${k}`, message: 'unknown key (dropped)' })
            continue
          }
          if (typeof v === 'boolean') {
            clean[k] = v
            continue
          }
          if (typeof v === 'number' && Number.isFinite(v)) {
            clean[k] = k === 'opacity' ? Math.min(1, Math.max(0, v)) : k === 'w' || k === 'h' ? Math.max(1, Math.round(v)) : Math.round(v)
            continue
          }
          issues.push({ path: `$.nodes.${id}.responsive.${bpRaw}.${k}`, message: `expected finite number or boolean, got ${typeof v}` })
        }
        if (Object.keys(clean).length > 0) bag[bpRaw] = clean
      }
      responsive = Object.keys(bag).length > 0 ? (bag as Node['responsive']) : undefined
    } else {
      issues.push({ path: `$.nodes.${id}.responsive`, message: 'not an object (dropped)' })
      responsive = undefined
    }
    // Interaction states are written into a generated stylesheet as TEXT, so
    // this is a real trust boundary: an unknown state, an unknown key, an
    // out-of-range number or a "colour" that is not a colour is dropped and
    // reported — the same sanitiser the op uses, so no path differs.
    let states: Node['states']
    if (node.states === undefined) {
      states = undefined
    } else if (node.states && typeof node.states === 'object' && !Array.isArray(node.states)) {
      const bag: InteractionStyles = {}
      for (const [stateRaw, styleRaw] of Object.entries(node.states as Record<string, unknown>)) {
        if (!INTERACTION_STATES.includes(stateRaw as InteractionState)) {
          issues.push({ path: `$.nodes.${id}.states.${stateRaw}`, message: 'unknown state (dropped)' })
          continue
        }
        if (!styleRaw || typeof styleRaw !== 'object' || Array.isArray(styleRaw)) {
          issues.push({ path: `$.nodes.${id}.states.${stateRaw}`, message: 'not an object (dropped)' })
          continue
        }
        const { style, dropped } = cleanStateStyle(styleRaw as Record<string, unknown>)
        for (const d of dropped) issues.push({ path: `$.nodes.${id}.states.${stateRaw}`, message: `${d} (dropped)` })
        if (Object.keys(style).length > 0) bag[stateRaw as InteractionState] = style
      }
      states = Object.keys(bag).length > 0 ? bag : undefined
    } else {
      issues.push({ path: `$.nodes.${id}.states`, message: 'not an object (dropped)' })
      states = undefined
    }
    // Opacity repairs toward 1, clamped into range like the op does.
    let opacity = 1
    if (node.opacity !== undefined) {
      if (typeof node.opacity === 'number' && Number.isFinite(node.opacity)) {
        opacity = Math.min(1, Math.max(0, node.opacity))
      } else {
        issues.push({ path: `$.nodes.${id}.opacity`, message: `expected finite number, got ${String(node.opacity)}` })
      }
    }
    nodes[id] = {
      id,
      type: node.type,
      props: checked.props,
      children: Array.isArray(node.children) ? node.children.filter((c) => typeof c === 'string') : [],
      flow: node.flow === true,
      visible: node.visible !== false,
      locked: node.locked === true,
      opacity,
      effects,
      z,
      responsive,
      states,
    }
  }

  // Drop dangling child references, self-references, and duplicates.
  for (const node of Object.values(nodes)) {
    const seen = new Set<NodeId>()
    const kept: NodeId[] = []
    for (const c of node.children) {
      if (c === node.id) continue
      if (seen.has(c)) continue
      if (!nodes[c]) {
        issues.push({ path: `$.nodes.${node.id}.children`, message: `dangling reference "${c}" (dropped)` })
        continue
      }
      seen.add(c)
      kept.push(c)
    }
    node.children = kept
  }

  // Enforce a tree: each child has exactly one parent (first claimant in
  // file order wins). The model is a scene TREE, and without this a diamond
  // DAG renders exponentially (measured: 49 shared nodes -> 126MB of HTML).
  // The root can never be anyone's child — it is claimed upfront.
  {
    const claimed = new Set<NodeId>([raw.root])
    for (const node of Object.values(nodes)) {
      const kept: NodeId[] = []
      for (const c of node.children) {
        if (claimed.has(c)) {
          issues.push({
            path: `$.nodes.${node.id}.children`,
            message: `"${c}" already has a parent (dropped)`,
          })
          continue
        }
        claimed.add(c)
        kept.push(c)
      }
      node.children = kept
    }
  }

  // One iterative DFS from the root: truncates beyond MAX_TREE_DEPTH and
  // marks reachability. Everything here is O(n); the previous per-node
  // ancestry walk was superlinear (measured: 600 chained nodes took 16s —
  // an open-file freeze from a crafted file).
  //
  // Cycles need no separate pass: single-parent enforcement above gives every
  // node at most one in-edge, so a reachable cycle is impossible (its entry
  // edge always loses to the outside claimant and is reported as such), and
  // an unreachable cycle falls out in the orphan sweep below. Either way the
  // rendered graph is a finite tree and the renderer cannot recurse forever.
  {
    const visited = new Set<NodeId>([raw.root])
    const stack: Array<{ id: NodeId; i: number; depth: number }> = [{ id: raw.root, i: 0, depth: 0 }]
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      const node = nodes[top.id]
      if (!node || top.i >= node.children.length) {
        stack.pop()
        continue
      }
      const c = node.children[top.i]
      top.i += 1
      if (visited.has(c)) continue
      visited.add(c)
      if (top.depth + 1 > MAX_TREE_DEPTH) {
        // Too deep to render safely: remove the edge and delete the whole
        // detached subtree now, so the orphan sweep below stays quiet.
        node.children.splice(top.i - 1, 1)
        top.i -= 1
        issues.push({ path: `$.nodes.${c}`, message: `deeper than ${MAX_TREE_DEPTH} levels (truncated)` })
        const drop: NodeId[] = [c]
        while (drop.length > 0) {
          const d = drop.pop()
          if (d === undefined) continue
          const n = nodes[d]
          if (!n) continue
          delete nodes[d]
          visited.delete(d)
          for (const k of n.children) drop.push(k)
        }
        continue
      }
      stack.push({ id: c, i: 0, depth: top.depth + 1 })
    }

    // Finally: every surviving node must be reachable from the root.
    for (const id of Object.keys(nodes)) {
      if (!visited.has(id)) {
        issues.push({ path: `$.nodes.${id}`, message: 'orphaned (unreachable from root)' })
        delete nodes[id]
      }
    }
  }

  if (!nodes[raw.root]) {
    return { doc: null, issues: [...issues, { path: '$.root', message: 'root was removed' }] }
  }

  return {
    doc: {
      version: FORMAT_VERSION,
      meta: validateMeta(raw.meta, issues),
      root: raw.root,
      nodes,
    },
    issues,
  }
}

/**
 * Rebuild `meta` from an untrusted file.
 *
 * Built field by field on purpose (nothing undeclared rides through), which
 * means every optional field MUST be listed here — an earlier version rebuilt
 * only four fields and silently dropped the artboard and snap grid on every
 * open. Present-but-invalid optional values are dropped and reported.
 */
function validateMeta(input: unknown, issues: ValidationIssue[]): DocMeta {
  const m = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const meta: DocMeta = {
    name: typeof m.name === 'string' ? m.name : 'Untitled',
    targets: Array.isArray(m.targets) ? (m.targets as never) : ['web'],
    theme: typeof m.theme === 'string' ? m.theme : 'midnight',
    created: typeof m.created === 'number' ? m.created : Date.now(),
  }
  if (m.artboard !== undefined) {
    const a = m.artboard as { w?: unknown; h?: unknown } | null
    const ok =
      a !== null &&
      typeof a === 'object' &&
      typeof a.w === 'number' && Number.isFinite(a.w) && a.w > 0 &&
      typeof a.h === 'number' && Number.isFinite(a.h) && a.h > 0
    if (ok) meta.artboard = { w: Math.round(a.w as number), h: Math.round(a.h as number) }
    else issues.push({ path: '$.meta.artboard', message: 'expected { w, h } positive finite numbers (dropped)' })
  }
  if (m.snapGrid !== undefined) {
    if (typeof m.snapGrid === 'number' && Number.isFinite(m.snapGrid) && m.snapGrid >= 0) meta.snapGrid = m.snapGrid
    else issues.push({ path: '$.meta.snapGrid', message: `expected a non-negative finite number, got ${String(m.snapGrid)} (dropped)` })
  }
  return meta
}

/** Serialise for disk. Key order is stable so diffs stay readable. */
export function serialize(doc: Document): string {
  return JSON.stringify(
    { version: FORMAT_VERSION, meta: doc.meta, root: doc.root, nodes: doc.nodes },
    null,
    2,
  )
}

/** A filesystem-safe filename derived from the document name. */
export function filenameFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'untitled'}.loom.json`
}
