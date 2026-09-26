/**
 * Pure document operations.
 *
 * Every function here is pure: it takes a Document and returns a NEW Document.
 * Nothing mutates in place. That is what makes undo trivially correct — the
 * history just keeps old documents around — and it is what lets the same
 * operation set be driven by a human drag or by an AI assistant.
 */

import type { Document, Node, NodeId, Op, PropValue } from './types'
import { normalizeProps } from './registry'

let counter = 0

export function newId(prefix = 'n'): NodeId {
  counter += 1
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** All descendants of `id`, depth-first, excluding `id` itself. */
export function descendants(doc: Document, id: NodeId): NodeId[] {
  const out: NodeId[] = []
  const seen = new Set<NodeId>([id])
  const walk = (cur: NodeId) => {
    const node = doc.nodes[cur]
    if (!node) return
    for (const child of node.children) {
      if (seen.has(child)) continue
      seen.add(child)
      out.push(child)
      walk(child)
    }
  }
  walk(id)
  return out
}

/** The chain from root down to `id`, inclusive. */
export function ancestry(doc: Document, id: NodeId): NodeId[] {
  const chain: NodeId[] = []
  let cur: NodeId | undefined = id
  const guard = new Set<NodeId>()
  while (cur && !guard.has(cur)) {
    guard.add(cur)
    chain.unshift(cur)
    cur = parentOf(doc, cur)
  }
  return chain
}

export function parentOf(doc: Document, id: NodeId): NodeId | undefined {
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return node.id
  }
  return undefined
}

function clone(doc: Document): Document {
  const nodes: Record<NodeId, Node> = {}
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[id] = { ...node, props: { ...node.props }, children: [...node.children] }
  }
  return { ...doc, nodes }
}

function detach(doc: Document, id: NodeId) {
  const parent = parentOf(doc, id)
  if (parent) {
    const p = doc.nodes[parent]
    p.children = p.children.filter((c) => c !== id)
  }
}

/**
 * Apply one operation. Returns a new Document.
 *
 * Rejects structurally invalid operations rather than corrupting the tree:
 * you cannot reparent a node into its own descendant, and you cannot remove
 * the root.
 */
export function apply(doc: Document, op: Op): Document {
  const next = clone(doc)

  switch (op.op) {
    case 'insert': {
      const parent = next.nodes[op.parent]
      if (!parent) return doc
      const node = cloneNode(op.node)
      next.nodes[node.id] = node
      if (op.tree) {
        for (const [id, n] of Object.entries(op.tree)) {
          next.nodes[id] = cloneNode(n)
        }
      }
      const index = op.index ?? parent.children.length
      parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, node.id)
      return next
    }

    case 'remove': {
      if (op.id === next.root) return doc
      if (!next.nodes[op.id]) return doc
      for (const id of [op.id, ...descendants(next, op.id)]) delete next.nodes[id]
      detach(next, op.id)
      return next
    }

    case 'move': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.props.x = op.x
      node.props.y = op.y
      return next
    }

    case 'resize': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.props.w = Math.max(1, Math.round(op.w))
      node.props.h = Math.max(1, Math.round(op.h))
      return next
    }

    case 'setProp': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.props[op.key] = op.value
      return next
    }

    case 'setFlow': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.flow = op.flow
      return next
    }

    case 'setVisible': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.visible = op.visible
      return next
    }

    case 'setLocked': {
      const node = next.nodes[op.id]
      if (!node) return doc
      node.locked = op.locked
      return next
    }

    case 'reparent': {
      const node = next.nodes[op.id]
      const target = next.nodes[op.parent]
      if (!node || !target) return doc
      if (op.id === next.root) return doc
      // Refuse to build a cycle: a node cannot become its own descendant.
      if (op.id === op.parent || descendants(next, op.id).includes(op.parent)) return doc

      detach(next, op.id)
      // `op.index` is a slot in the destination list AFTER the node is removed
      // (post-removal coordinates). That is the natural convention: a drop
      // target the UI computes is a gap in the list the user is looking at,
      // which no longer contains the dragged node.
      const index = op.index === undefined ? target.children.length : op.index
      target.children.splice(Math.max(0, Math.min(index, target.children.length)), 0, op.id)
      return next
    }

    case 'rename': {
      next.meta.name = op.name
      return next
    }
  }
}

function cloneNode(node: Node): Node {
  // Normalising on the way IN is what guarantees a node can never hold a
  // missing default or an undeclared key, regardless of which code path
  // created it (toolbox drop, seeder, undo, or a future AI operation).
  return {
    ...node,
    props: normalizeProps(node.type, node.props),
    children: [...node.children],
  }
}

/* ------------------------------------------------------------------ *
 * Inverse ops — required for exact undo.
 * ------------------------------------------------------------------ */

/** Build the inverse of `op` against the document it is about to be applied to. */
export function invert(doc: Document, op: Op): Op | undefined {
  switch (op.op) {
    case 'insert': {
      // Inverse of an insert is a remove of the inserted subtree.
      return { op: 'remove', id: op.node.id }
    }
    case 'remove': {
      // Inverse of a remove is re-inserting the whole captured subtree, with
      // every descendant re-materialised so the tree is fully restored.
      const node = doc.nodes[op.id]
      if (!node) return undefined
      const parent = parentOf(doc, op.id)
      if (!parent) return undefined
      const index = doc.nodes[parent].children.indexOf(op.id)
      const tree: Record<NodeId, Node> = {}
      for (const id of [op.id, ...descendants(doc, op.id)]) {
        const n = doc.nodes[id]
        if (n) tree[id] = cloneNode(n)
      }
      return { op: 'insert', parent, index, node: cloneNode(node), tree }
    }
    case 'move': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'move', id: op.id, x: num(node.props.x), y: num(node.props.y) }
    }
    case 'resize': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'resize', id: op.id, w: num(node.props.w) || 1, h: num(node.props.h) || 1 }
    }
    case 'setProp': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      const had = Object.prototype.hasOwnProperty.call(node.props, op.key)
      return had
        ? { op: 'setProp', id: op.id, key: op.key, value: node.props[op.key] }
        : { op: 'setProp', id: op.id, key: op.key, value: null }
    }
    case 'setFlow': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setFlow', id: op.id, flow: node.flow }
    }
    case 'setVisible': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setVisible', id: op.id, visible: node.visible }
    }
    case 'setLocked': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setLocked', id: op.id, locked: node.locked }
    }
    case 'reparent': {
      const from = parentOf(doc, op.id)
      if (!from) return undefined
      // The node's slot in the list BEFORE the move.
      //
      // `apply` consumes post-removal indices, and inserting a node at its own
      // original slot is exactly the inverse operation: detach shifts
      // everything after it up by one, so re-inserting at the original slot
      // restores the list byte-for-byte. This holds for both same-parent and
      // cross-parent moves, and is why the inverse must be computed from the
      // PRE-move document rather than from the result of the move.
      const index = doc.nodes[from].children.indexOf(op.id)
      if (index < 0) return undefined
      return { op: 'reparent', id: op.id, parent: from, index }
    }
    case 'rename': {
      return { op: 'rename', name: doc.meta.name }
    }
  }
}

/** Deep copy of a node and all its descendants, preserving child order. */
export function captureSubtree(doc: Document, id: NodeId): Record<NodeId, Node> {
  const out: Record<NodeId, Node> = {}
  const walk = (nid: NodeId) => {
    const n = doc.nodes[nid]
    if (!n) return
    out[nid] = cloneNode(n)
    for (const childId of n.children) walk(childId)
  }
  walk(id)
  return out
}

/**
 * Duplicate a subtree with FRESH ids throughout, offsetting the copy's root
 * so it does not land pixel-on-pixel with the original. Returns the new root
 * plus a materialisation tree for an `insert` op, or undefined when `id` is
 * missing (the root cannot be duplicated — it has no parent to land in).
 */
export function duplicateSubtree(
  doc: Document,
  id: NodeId,
  dx = 12,
  dy = 12,
): { node: Node; tree: Record<NodeId, Node> } | undefined {
  const src = doc.nodes[id]
  if (!src || id === doc.root) return undefined
  const captured = captureSubtree(doc, id)
  if (!captured[id]) return undefined
  const remap = new Map<NodeId, NodeId>()
  for (const old of Object.keys(captured)) remap.set(old, newId())
  const tree: Record<NodeId, Node> = {}
  for (const [old, n] of Object.entries(captured)) {
    const nid = remap.get(old)
    if (!nid) return undefined
    const isRoot = old === id
    tree[nid] = {
      ...n,
      id: nid,
      props: {
        ...n.props,
        x: (typeof n.props.x === 'number' ? n.props.x : 0) + (isRoot ? dx : 0),
        y: (typeof n.props.y === 'number' ? n.props.y : 0) + (isRoot ? dy : 0),
      },
      children: n.children.map((c) => remap.get(c) ?? c),
    }
  }
  const rootId = remap.get(id)
  const node = rootId ? tree[rootId] : undefined
  if (!node) return undefined
  return { node, tree }
}

function num(v: PropValue | undefined): number {
  return typeof v === 'number' ? v : 0
}
