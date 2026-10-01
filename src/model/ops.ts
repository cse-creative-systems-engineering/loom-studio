/**
 * Pure document operations.
 *
 * Every function here is pure: it takes a Document and returns a NEW Document.
 * Nothing mutates in place. That is what makes undo trivially correct — the
 * history just keeps old documents around — and it is what lets the same
 * operation set be driven by a human drag or by an AI assistant.
 */

import { cleanLight, cleanLookSet, cleanStyles, cloneLookSet } from './look'
import { cleanActions } from './actions'
import type { Document, Node, NodeId, Op, PropValue } from './types'
import { cleanPage } from './page'
import { acceptsChild, getComponent, normalizeProps } from './registry'
// Effects are a pure data module (values in, style out) with no model
// dependency, so importing it here does NOT invert the model->render
// layering. Keeping the normaliser in one place is worth more than the
// nominal purity of not importing it.
import { normalizeEffects } from '../render/effects'
import { cleanStateStyle } from '../render/states'
import { cleanPartStyle, partsOf } from '../render/parts'
import { cleanList, itemsOf, normalizeLists } from './lists'

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
 * you cannot reparent a node into its own descendant. Rootless documents are
 * handled here rather than in the UI: an `insert` with `parent: null` makes
 * its node the root, and removing the root empties the workspace.
 */
export function apply(doc: Document, op: Op): Document {
  const next = clone(doc)

  switch (op.op) {
    case 'insert': {
      const node = cloneNode(op.node)
      next.nodes[node.id] = node
      if (op.tree) {
        for (const [id, n] of Object.entries(op.tree)) {
          next.nodes[id] = cloneNode(n)
        }
      }
      // Rootless: the user's FIRST drop has no parent to land in, so it
      // becomes the root. This is how a workspace comes into existence.
      if (op.parent === null) {
        if (next.root !== null && next.nodes[next.root]) return doc
        return { ...next, root: node.id }
      }
      const parent = next.nodes[op.parent]
      if (!parent) return doc
      // A container that names its children (a tab set holds tabs) refuses
      // anything else, whoever sends the op.
      if (getComponent(parent.type)?.childTypes && !acceptsChild(parent.type, node.type)) return doc
      const index = op.index ?? parent.children.length
      parent.children.splice(Math.max(0, Math.min(index, parent.children.length)), 0, node.id)
      return next
    }

    case 'setRoot': {
      if (op.id === null) {
        if (next.root === null) return doc
        return { ...next, root: null, nodes: {} }
      }
      if (!next.nodes[op.id]) return doc
      return { ...next, root: op.id }
    }

    case 'remove': {
      if (!next.nodes[op.id]) return doc
      // Removing the root empties the workspace: the user's last node is
      // theirs to delete, and an empty workspace is a valid document.
      if (op.id === next.root) {
        return { ...next, root: null, nodes: {} }
      }
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

    case 'setResponsive': {
      const node = next.nodes[op.id]
      if (!node) return doc
      const bag = node.responsive ?? {}
      const current = bag[op.breakpoint] ?? {}
      const merged: Record<string, number | boolean> = { ...current }
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      const nextBag = { ...bag }
      if (Object.keys(merged).length === 0) delete nextBag[op.breakpoint]
      else nextBag[op.breakpoint] = merged
      if (Object.keys(nextBag).length === 0) node.responsive = undefined
      else node.responsive = nextBag
      return next
    }

    case 'setStateStyle': {
      const node = next.nodes[op.id]
      if (!node) return doc
      const bag = node.states ?? {}
      const merged: Record<string, unknown> = { ...(bag[op.state] ?? {}) }
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      // Sanitised here, so no path (UI, file, AI op) can put anything but a
      // valid value into the generated stylesheet.
      const clean = cleanStateStyle(merged).style
      const nextBag = { ...bag }
      if (Object.keys(clean).length === 0) delete nextBag[op.state]
      else nextBag[op.state] = clean
      node.states = Object.keys(nextBag).length === 0 ? undefined : nextBag
      return next
    }

    case 'setList': {
      const node = next.nodes[op.id]
      if (!node || !getComponent(node.type)?.lists?.[op.key]) return doc
      node.lists = { ...(node.lists ?? {}), [op.key]: cleanList(node.type, op.key, op.items).items }
      return next
    }

    case 'setActions': {
      const node = next.nodes[op.id]
      if (!node) return doc
      // Cleaned against the document it lands in: nothing malformed can be
      // stored, and a missing target is kept (flagged elsewhere) so undoing
      // its deletion brings the wiring back.
      const { actions } = cleanActions(node, op.actions)
      if (actions) node.actions = actions
      else delete node.actions
      return next
    }

    case 'setStartsHidden': {
      const node = next.nodes[op.id]
      if (!node) return doc
      if (op.on) node.startsHidden = true
      else delete node.startsHidden
      return next
    }

    case 'setLook': {
      const node = next.nodes[op.id]
      if (!node) return doc
      // Only a part the component declares (or the node itself) takes a look,
      // and only what survives the sanitiser lands, whoever sent the op.
      if (op.target !== '' && !partsOf(node.type)?.[op.target]) return doc
      const clean = op.set === null ? null : cleanLookSet(op.set).set
      const looks = { ...(node.looks ?? {}) }
      if (clean === null) delete looks[op.target]
      else looks[op.target] = clean
      if (Object.keys(looks).length) node.looks = looks
      else delete node.looks
      return next
    }

    case 'setStyles': {
      const meta = { ...next.meta }
      const styles = op.styles === null ? [] : cleanStyles(op.styles).styles
      if (styles.length) meta.styles = styles
      else delete meta.styles
      return { ...next, meta }
    }

    case 'setLight': {
      const meta = { ...next.meta }
      const light = op.light === null ? null : cleanLight(op.light)
      if (light === null) delete meta.light
      else meta.light = light
      return { ...next, meta }
    }

    case 'setPartStyle': {
      const node = next.nodes[op.id]
      if (!node) return doc
      const bag = node.parts ?? {}
      const merged: Record<string, unknown> = { ...(bag[op.part] ?? {}) }
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      // Sanitised against the component's declaration: an undeclared part or
      // a field the part does not accept never lands, whoever sent the op.
      const clean = cleanPartStyle(node.type, op.part, merged).style
      const nextBag = { ...bag }
      if (Object.keys(clean).length === 0) delete nextBag[op.part]
      else nextBag[op.part] = clean
      node.parts = Object.keys(nextBag).length === 0 ? undefined : nextBag
      return next
    }

    case 'setEffects': {
      const node = next.nodes[op.id]
      if (!node) return doc
      // Merge over the existing bag so a one-field toggle does not wipe the
      // rest. Normalising here means a document can never hold a malformed
      // bag, however it was written.
      //
      // A `null` in the patch means "this key did not exist before"; the
      // normaliser must DELETE it rather than coerce it, otherwise an undo of
      // the first-ever effect write leaves the key present-but-absent and the
      // inverse no longer round-trips.
      const merged: Record<string, unknown> = { ...(node.effects ?? {}) }
      for (const [k, v] of Object.entries(op.patch)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      node.effects = normalizeEffects(merged)
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

    case 'setName': {
      const node = next.nodes[op.id]
      if (!node) return doc
      const name = op.name.trim().slice(0, 80)
      if (name === '') delete node.name
      else node.name = name
      return next
    }

    case 'setOpacity': {
      const node = next.nodes[op.id]
      if (!node) return doc
      // Clamp into range; non-finite input preserves the current value
      // rather than poisoning the stylesheet.
      if (Number.isFinite(op.opacity)) node.opacity = Math.min(1, Math.max(0, op.opacity))
      return next
    }

    case 'reparent': {
      const node = next.nodes[op.id]
      const target = next.nodes[op.parent]
      if (!node || !target) return doc
      if (op.id === next.root) return doc
      // Refuse to build a cycle: a node cannot become its own descendant.
      if (op.id === op.parent || descendants(next, op.id).includes(op.parent)) return doc
      if (getComponent(target.type)?.childTypes && !acceptsChild(target.type, node.type)) return doc

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

    case 'setTheme': {
      const current = doc.meta.theme ?? null
      if (current === op.theme) return doc
      const meta = { ...next.meta }
      if (op.theme === null) delete meta.theme
      else meta.theme = op.theme
      return { ...next, meta }
    }

    case 'setPage': {
      // Only a valid page lands: an unsafe colour or a nonsense blur is refused
      // here as well as in the loader, since ops are the other way in.
      const page = op.page === null ? null : cleanPage(op.page)
      if (op.page !== null && page === null) return doc
      const meta = { ...next.meta }
      if (page === null) delete meta.page
      else meta.page = page
      return { ...next, meta }
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
    ...(getComponent(node.type)?.lists ? { lists: normalizeLists(node) } : {}),
    // Its own copy: a duplicate's wiring is remapped in place (remapRefs).
    ...(node.actions ? { actions: JSON.parse(JSON.stringify(node.actions)) } : {}),
    ...(node.looks ? { looks: JSON.parse(JSON.stringify(node.looks)) } : {}),
    z: clampZ(node.z ?? 0),
  }
}

/**
 * Keep z within a sane integer range.
 *
 * A naive "bring to front = max + 1" walks toward MAX_SAFE_INTEGER over a few
 * hundred operations and the order silently breaks. Renormalising to 0..N-1 on
 * every write makes that impossible.
 */
export function clampZ(z: number, count?: number): number {
  if (!Number.isFinite(z)) return 0
  const MAX = 1_000_000
  let v = Math.round(z)
  if (v < 0) v = 0
  if (v > MAX) v = MAX
  if (count !== undefined && v > count - 1) v = Math.max(0, count - 1)
  return v
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
    case 'setResponsive': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      // Restore the whole breakpoint bag, including its absence: an undo of
      // the FIRST responsive write must leave no empty bag behind.
      const before = node.responsive?.[op.breakpoint]
      const inverse: Record<string, number | boolean | null> = {}
      for (const k of Object.keys(op.patch)) inverse[k] = before?.[k as keyof typeof before] ?? null
      return { op: 'setResponsive', id: op.id, breakpoint: op.breakpoint, patch: inverse }
    }

    case 'setStateStyle': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      // Restore exactly the keys the patch touched, including their absence.
      const before = (node.states?.[op.state] ?? {}) as Record<string, string | number | undefined>
      const inverse: Record<string, string | number | null> = {}
      for (const k of Object.keys(op.patch)) inverse[k] = before[k] ?? null
      return { op: 'setStateStyle', id: op.id, state: op.state, patch: inverse }
    }

    case 'setList': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setList', id: op.id, key: op.key, items: itemsOf(node, op.key).map((it) => ({ ...it })) }
    }

    case 'setActions': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setActions', id: op.id, actions: node.actions ? JSON.parse(JSON.stringify(node.actions)) : null }
    }

    case 'setStartsHidden': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setStartsHidden', id: op.id, on: node.startsHidden === true }
    }

    case 'setLook': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      const before = node.looks?.[op.target]
      return { op: 'setLook', id: op.id, target: op.target, set: before ? cloneLookSet(before) : null }
    }

    case 'setLight': {
      return { op: 'setLight', light: doc.meta.light ? { ...doc.meta.light } : null }
    }

    case 'setStyles': {
      return { op: 'setStyles', styles: doc.meta.styles ? (JSON.parse(JSON.stringify(doc.meta.styles)) as typeof doc.meta.styles) : null }
    }

    case 'setPartStyle': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      const before = (node.parts?.[op.part] ?? {}) as Record<string, string | number | undefined>
      const inverse: Record<string, string | number | null> = {}
      for (const k of Object.keys(op.patch)) inverse[k] = before[k] ?? null
      return { op: 'setPartStyle', id: op.id, part: op.part, patch: inverse }
    }

    case 'setEffects': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      // The inverse restores the PRE-patch values for exactly the keys the
      // patch touched, which is why the patch is merged rather than replacing.
      const before: Record<string, unknown> = {}
      const prev = (node.effects ?? {}) as unknown as Record<string, unknown>
      for (const k of Object.keys(op.patch)) {
        const v = prev[k]
        before[k] = v === undefined ? null : v
      }
      return { op: 'setEffects', id: op.id, patch: before }
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
    case 'setName': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setName', id: op.id, name: node.name ?? '' }
    }
    case 'setOpacity': {
      const node = doc.nodes[op.id]
      if (!node) return undefined
      return { op: 'setOpacity', id: op.id, opacity: node.opacity }
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
    case 'setPage': {
      return { op: 'setPage', page: doc.meta.page ? { ...doc.meta.page } : null }
    }
    case 'setTheme': {
      return { op: 'setTheme', theme: doc.meta.theme ?? null }
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
  return reidentify(captured, id, dx, dy)
}

/**
 * A captured subtree with FRESH ids throughout, its root offset by dx/dy:
 * what duplicate and paste insert. The capture is untouched, so a clipboard
 * can paste the same subtree any number of times, even after a cut removed
 * the original.
 */
export function reidentify(
  captured: Record<NodeId, Node>,
  id: NodeId,
  dx = 0,
  dy = 0,
): { node: Node; tree: Record<NodeId, Node> } | undefined {
  if (!captured[id]) return undefined
  const remap = new Map<NodeId, NodeId>()
  for (const old of Object.keys(captured)) remap.set(old, newId())
  const tree: Record<NodeId, Node> = {}
  for (const [old, n] of Object.entries(captured)) {
    const nid = remap.get(old)
    if (!nid) return undefined
    const isRoot = old === id
    tree[nid] = {
      ...cloneNode(n),
      id: nid,
      props: {
        ...n.props,
        x: (typeof n.props.x === 'number' ? n.props.x : 0) + (isRoot ? dx : 0),
        y: (typeof n.props.y === 'number' ? n.props.y : 0) + (isRoot ? dy : 0),
      },
      children: n.children.map((c) => remap.get(c) ?? c),
    }
  }
  // A reference inside the copied subtree follows the copy: a duplicated chat
  // panel's Composer sends to the DUPLICATED list, not the original. A
  // reference outside the subtree keeps pointing where it did.
  for (const n of Object.values(tree)) remapRefs(n, remap)
  const rootId = remap.get(id)
  const node = rootId ? tree[rootId] : undefined
  if (!node) return undefined
  return { node, tree }
}

function num(v: PropValue | undefined): number {
  return typeof v === 'number' ? v : 0
}

/** Rewrite a node's `node`-kind props through `remap`, in place. */
export function remapRefs(node: Node, remap: Map<NodeId, NodeId>): void {
  const spec = getComponent(node.type)
  if (!spec) return
  for (const [key, ps] of Object.entries(spec.props)) {
    if (ps.type !== 'node') continue
    const ref = node.props[key]
    if (typeof ref === 'string' && remap.has(ref)) node.props[key] = remap.get(ref) as string
  }
  // Actions follow the copy the same way: a duplicated List/Table switch
  // switches the DUPLICATED views; a target outside the copy stays put.
  for (const a of node.actions?.click ?? []) if (remap.has(a.target)) a.target = remap.get(a.target) as NodeId
  const views = node.actions?.views
  if (views) for (const k of Object.keys(views)) if (remap.has(views[k]!)) views[k] = remap.get(views[k]!) as NodeId
}
