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

import type { Document, Node, NodeId } from './types'
import { getComponent, validateProps } from './registry'
import './toolbox'

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
    if (typeof node.type !== 'string' || !getComponent(node.type)) {
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
    nodes[id] = {
      id,
      type: node.type,
      props: checked.props,
      children: Array.isArray(node.children) ? node.children.filter((c) => typeof c === 'string') : [],
      flow: node.flow === true,
      visible: node.visible !== false,
      locked: node.locked === true,
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
      meta: {
        name: typeof raw.meta?.name === 'string' ? raw.meta.name : 'Untitled',
        targets: Array.isArray(raw.meta?.targets) ? (raw.meta.targets as never) : ['web'],
        theme: typeof raw.meta?.theme === 'string' ? raw.meta.theme : 'midnight',
        created: typeof raw.meta?.created === 'number' ? raw.meta.created : Date.now(),
      },
      root: raw.root,
      nodes,
    },
    issues,
  }
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
