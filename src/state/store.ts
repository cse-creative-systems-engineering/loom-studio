/**
 * Editor store.
 *
 * Holds the document, selection, and undo/redo history. Undo snapshots
 * documents, which is exact and cheap at this scale — inverse-op replay is
 * where GUI designers usually grow bugs.
 *
 * The store is the seam the future AI assistant will drive: it emits the SAME
 * Op values a human drag produces, so "add a gauge bound to cpu" is an op,
 * not a code path.
 */

import { takeShorthand } from '../model/grid'
import { buildStarter, getStarter } from '../model/starters'
import { dropSize } from '../model/drop-size'
import { apply, captureSubtree, duplicateSubtree, parentOf, reidentify } from '../model/ops'
import { acceptsChild, getComponent, instantiate, type SeedSpec } from '../model/registry'
import type { Document, Node, NodeId, Op, PropValue, TargetId } from '../model/types'
import { serialize, validate, filenameFor } from '../model/persist'
import { emitHtml, exportFilenameFor } from '../export/html'
import { emitReact, reactFilenameFor } from '../export/react'
import '../model/toolbox'

export interface LoomHost {
  save: (name: string, contents: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
  open: () => Promise<{ ok: boolean; path?: string; contents?: string; error?: string; canceled?: boolean }>
  autosave: (name: string, contents: string) => Promise<{ ok: boolean; path?: string }>
  readAutosave: (name: string) => Promise<{ ok: boolean; path?: string; contents?: string }>
  /** The newest autosave of any document (current hosts only). */
  latestAutosave?: () => Promise<{ ok: boolean; name?: string; mtime?: number; contents?: string }>
  /** Present on current hosts; older hosts fall back to `save`. */
  exportHtml?: (name: string, contents: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
  exportReact?: (name: string, contents: string) => Promise<{ ok: boolean; path?: string; error?: string; canceled?: boolean }>
}

export interface HistoryEntry {
  label: string
  before: Document
  after: Document
  /**
   * Commits that share a group and follow each other are ONE entry: an AI
   * agent's turn is many writes and one undo step. A person's own edit in
   * the middle of a turn is its own entry, so the agent's work on either
   * side of it stays undoable (and theirs is never folded into the agent's).
   */
  group?: string
}

const HISTORY_LIMIT = 200

/**
 * Structural equality over the document's JSON-shaped data.
 *
 * `apply()` is pure and returns a NEW document every time, so reference
 * equality can never detect a no-op. This compares the substance instead —
 * ALL of it. An earlier version compared a hand-picked list of node fields
 * and silently missed opacity, effects and responsive overrides, so those
 * gestures never reached history or the dirty flag. Being generic is the
 * point: a field added to `Node` later is compared without anyone having to
 * remember this function exists. A key holding `undefined` counts as absent,
 * matching what serialisation would write.
 */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => sameData(v, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined)
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => sameData(ra[k], rb[k]))
}

export class EditorStore {
  doc: Document
  selection: NodeId[] = []
  // Desktop-first: Loom produces desktop apps first, so gating badges
  // flag web-only properties from the start rather than after a switch.
  target: TargetId = 'desktop'
  history: HistoryEntry[] = []
  future: HistoryEntry[] = []
  /** Unsaved changes exist. */
  dirty = false
  lastSavedPath: string | null = null

  /**
   * The outcome of the last file action (save, open, export), for the Studio
   * to show. Every such action used to finish silently: a failed save, or an
   * opened file that was not a Loom document, looked exactly like success. A
   * cancelled dialog is not an outcome and leaves no notice.
   */
  notice: { id: number; tone: 'ok' | 'error'; text: string } | null = null
  private noticeSeq = 0

  notify(tone: 'ok' | 'error', text: string) {
    this.notice = { id: ++this.noticeSeq, tone, text }
    this.emit()
  }

  dismissNotice(id: number) {
    if (this.notice?.id !== id) return
    this.notice = null
    this.emit()
  }

  /** Report a host file action: success names the file, failure says why. */
  private report(res: { ok: boolean; path?: string; error?: string; canceled?: boolean }, done: string, failed: string) {
    if (res.canceled) return
    const file = res.path ? res.path.split(/[\\/]/).pop() : undefined
    if (res.ok) this.notify('ok', file ? `${done} ${file}` : done)
    else this.notify('error', `${failed}${res.error ? `: ${res.error}` : ''}`)
  }

  /**
   * The document as it exists on disk (last save or open), or null when this
   * work has never been written. Undo/redo compare against it by identity —
   * history holds the exact document objects, so stepping back to the saved
   * state lands on the same reference and reads as clean, and stepping away
   * from it reads as dirty. A never-saved document stays dirty once edited.
   */
  private savedDoc: Document | null = null

  /**
   * The document as of the last committed/sealed state. A drag pokes the live
   * document without touching history; seal() then diffs against this to
   * collapse the whole gesture into one undoable entry.
   */
  private sealed: Document

  private listeners = new Set<() => void>()

  /**
   * The desktop host bridge (file dialogs, autosave), or undefined outside
   * Electron. A field rather than a global lookup at each call site so tests
   * can hand the store a fake host.
   */
  host: LoomHost | undefined = (globalThis as unknown as { loomHost?: LoomHost }).loomHost

  constructor(initial?: Document) {
    this.doc = initial ?? emptyDocument()
    this.sealed = this.doc
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.listeners) fn()
  }

  private pushHistory(label: string, before: Document, after: Document) {
    this.history.push({ label, before, after })
    if (this.history.length > HISTORY_LIMIT) this.history.shift()
    this.future = []
    this.dirty = true
  }

  /** Apply one operation as a single undoable step. */
  commit(op: Op, label: string, group?: string): boolean {
    const before = this.doc
    const after = apply(before, op)
    if (after === before) return false
    this.doc = after
    this.sealed = after
    const top = this.history[this.history.length - 1]
    if (group !== undefined && top?.group === group && this.future.length === 0) {
      top.after = after
      this.dirty = true
    } else {
      this.pushHistory(label, before, after)
      if (group !== undefined) this.history[this.history.length - 1]!.group = group
    }
    this.pruneSelection()
    this.emit()
    return true
  }

  /** Apply several ops as ONE undoable step. */
  commitAll(ops: Op[], label: string): boolean {
    if (ops.length === 0) return false
    const before = this.doc
    let cur = before
    for (const op of ops) cur = apply(cur, op)
    if (cur === before) return false
    this.doc = cur
    this.sealed = cur
    this.pushHistory(label, before, cur)
    this.pruneSelection()
    this.emit()
    return true
  }

  /**
   * Transient update used during a drag or resize.
   *
   * Mutates the document WITHOUT touching history, so a gesture stays at
   * 60fps and collapses into one undoable step on seal. Nothing else may
   * call this.
   */
  poke(op: Op) {
    this.doc = apply(this.doc, op)
    this.emit()
  }

  /**
   * Collapse a transient interaction into one undoable entry.
   *
   * The no-op guard compares the NODE MAPS, not document identity: `apply()`
   * returns a fresh object on every call, so `this.sealed === this.doc` was
   * never true and every seal added a phantom undo entry — including for a
   * gesture that changed nothing. Deep-comparing the whole document is
   * cheap at this size (it runs once per gesture, on release) and is the only
   * correct test.
   */
  seal(label: string) {
    if (sameData(this.sealed, this.doc)) {
      // Nothing actually changed; make sure `sealed` tracks the current
      // object identity so the next comparison is against the right base.
      this.sealed = this.doc
      return
    }
    this.pushHistory(label, this.sealed, this.doc)
    this.sealed = this.doc
    this.emit()
  }

  /**
   * Set while an agent is building (see `ai/tools.ts` AiTurn). Undo or redo
   * mid-turn stops the agent first: rewinding work it is still building on
   * would leave it editing nodes that no longer exist.
   */
  interruptTurn: (() => void) | null = null

  /**
   * Pick mode: while set, the next node clicked on the canvas is handed to
   * this instead of being selected (choosing what a control acts on). Esc
   * or picking clears it.
   */
  picking: { forLabel: string; done: (id: NodeId) => void } | null = null

  startPick(forLabel: string, done: (id: NodeId) => void) {
    this.picking = { forLabel, done }
    this.emit()
  }

  endPick(id?: NodeId) {
    const p = this.picking
    this.picking = null
    this.emit()
    if (p && id) p.done(id)
  }

  undo() {
    this.interruptTurn?.()
    const entry = this.history.pop()
    if (!entry) return
    this.future.push(entry)
    this.doc = entry.before
    this.sealed = this.doc
    this.dirty = this.doc !== this.savedDoc
    this.pruneSelection()
    this.emit()
  }

  redo() {
    this.interruptTurn?.()
    const entry = this.future.pop()
    if (!entry) return
    this.history.push(entry)
    this.doc = entry.after
    this.sealed = this.doc
    this.dirty = this.doc !== this.savedDoc
    this.pruneSelection()
    this.emit()
  }

  select(ids: NodeId[]) {
    this.selection = ids
    this.emit()
  }

  setTarget(t: TargetId) {
    this.target = t
    this.emit()
  }

  /**
   * Change the document's design theme.
   *
   * This is the payoff of the token layer: ONE field re-skins every node.
   * Before tokens existed, re-theming meant editing each node's colours.
   */
  setTheme(name: string) {
    this.commit({ op: 'setTheme', theme: name }, `Theme: ${name}`)
  }

  private pruneSelection() {
    this.selection = this.selection.filter((id) => this.doc.nodes[id])
  }

  /* ---------------- operations the UI calls directly ---------------- */

  /**
   * Create a component under `parent`.
   *
   * This is the ONLY construction path — toolbox drops, the demo seeder, and
   * any future AI operation all funnel here, so schema normalisation and
   * history bookkeeping cannot be bypassed.
   */
  /** A fresh node of `name`, schema defaults applied, not yet in the document. */
  private buildNode(name: string, x: number, y: number, overrides: Record<string, PropValue> = {}, opts: { flow?: boolean } = {}): Node {
    const built = instantiate(name)
    const props: Record<string, PropValue> = { ...built.props, ...overrides, x, y }
    // A grid's columns typed as text ("Name,Role,Amount") are the shorthand
    // for its column definitions: read into the list, typed from the rows.
    const lists = takeShorthand(name, props)
    return {
      id: `n${Math.random().toString(36).slice(2, 9)}`,
      type: name,
      props,
      ...(lists ? { lists } : {}),
      children: [],
      flow: opts.flow ?? built.flow,
      visible: true,
      locked: false,
      opacity: 1,
    }
  }

  addComponent(
    name: string,
    parent: NodeId | null,
    x = 0,
    y = 0,
    overrides: Record<string, PropValue> = {},
    opts: { flow?: boolean } = {},
  ): NodeId | undefined {
    const node = this.buildNode(name, x, y, overrides, opts)
    const id = node.id
    const ok = this.commit({ op: 'insert', parent, node }, `Add ${name}`)
    if (ok) this.select([id])
    return ok ? id : undefined
  }

  /**
   * A component dropped from the toolbox: `addComponent` plus the size it
   * should arrive at (see `model/drop-size.ts`), so an empty container lands
   * as a frame, not a 35px square.
   */
  dropComponent(name: string, parent: NodeId | null, x: number, y: number, room?: { w: number; h: number }): NodeId | undefined {
    const intoFlow = parent !== null && this.doc.nodes[parent]?.flow === true
    const seed = getComponent(name)?.seed
    const size = dropSize(name, intoFlow)
    if (!intoFlow && parent !== null) {
      // Never EXACTLY on top of a sibling: a second drop on the same spot
      // landed under the first, pixel for pixel, and looked like nothing
      // happened. It steps down and right until the spot is free.
      const sibs = (this.doc.nodes[parent]?.children ?? []).map((c) => this.doc.nodes[c]).filter(Boolean)
      for (let i = 0; i < 40 && sibs.some((n) => Math.abs(Number(n!.props.x ?? 0) - x) < 8 && Math.abs(Number(n!.props.y ?? 0) - y) < 8); i++) {
        x += 24
        y += 24
      }
      // And it fits the room it lands in: a 420px tab set dropped into a
      // 300px panel spilled out over its parent's edge.
      if (room) {
        const fit = (key: 'w' | 'h', at: number, max: number) => {
          const want = size[key]
          if (typeof want !== 'number') return
          const free = Math.floor(max - at - 8)
          if (want > free) size[key] = Math.max(40, free)
        }
        if (x > room.w - 64) x = Math.max(0, Math.floor(room.w - 64))
        if (y > room.h - 48) y = Math.max(0, Math.floor(room.h - 48))
        fit('w', x, room.w)
        fit('h', y, room.h)
      }
    }
    if (!seed || seed.length === 0) return this.addComponent(name, parent, intoFlow ? 0 : x, intoFlow ? 0 : y, size)
    // A container that arrives with its first children (Tabs with its tabs):
    // one insert for it and one per child, as ONE undo step, built exactly
    // as its own "Add ..." button builds them.
    // It arrives ARRANGED: its parts flow (a row of buttons, a column of
    // cards). Free-positioned they all sat at 0,0 on top of each other. It
    // stays an ordinary container: the Layout toggle switches it to free.
    const node = this.buildNode(name, intoFlow ? 0 : x, intoFlow ? 0 : y, size, { flow: true })
    // Depth first, parents before children, so every insert has its parent.
    // A seeded child that brings its own children arranges them too.
    const ops: Op[] = [{ op: 'insert', parent, node }]
    const place = (under: NodeId, list: SeedSpec[]) => {
      for (const c of list) {
        const k = this.buildNode(c.type, 0, 0, c.props ?? {}, c.seed?.length ? { flow: true } : {})
        ops.push({ op: 'insert', parent: under, node: k })
        if (c.seed?.length) place(k.id, c.seed)
      }
    }
    place(node.id, seed)
    const ok = this.commitAll(ops, `Add ${name}`)
    if (ok) this.select([node.id])
    return ok ? node.id : undefined
  }

  /**
   * The Studio's clipboard: captured subtrees, so a paste works after a cut
   * removed the originals, and pastes any number of times. In memory, for
   * this window.
   */
  clipboard: Array<{ id: NodeId; tree: Record<NodeId, Node> }> = []
  private pastes = 0

  /** The selection without the nodes already inside another selected node. */
  private topLevel(ids: NodeId[]): NodeId[] {
    const picked = new Set(ids)
    return ids.filter((id) => {
      if (!this.doc.nodes[id]) return false
      for (let p = parentOf(this.doc, id); p; p = parentOf(this.doc, p)) if (picked.has(p)) return false
      return true
    })
  }

  copy(ids: NodeId[] = this.selection): number {
    const top = this.topLevel(ids)
    if (top.length === 0) return 0
    this.clipboard = top.map((id) => ({ id, tree: captureSubtree(this.doc, id) }))
    this.pastes = 0
    return top.length
  }

  cut(ids: NodeId[] = this.selection): number {
    const top = this.topLevel(ids).filter((id) => !this.doc.nodes[id].locked)
    const n = this.copy(top)
    if (n > 0) this.remove(top)
    return n
  }

  /**
   * Paste the clipboard: into the selected container when it takes every
   * item, else beside the selection (just after it), else into the root; as
   * the root of an empty document. One undo step; the pasted nodes selected.
   * In a free-positioned parent each paste lands a step further in.
   */
  paste(): NodeId[] {
    if (this.clipboard.length === 0) return []
    const types = this.clipboard.map((c) => c.tree[c.id]?.type).filter((t): t is string => !!t)
    const takesAll = (id: NodeId) => {
      const n = this.doc.nodes[id]
      const spec = n && getComponent(n.type)
      return !!spec?.container && !n.locked && types.every((t) => !spec.childTypes || acceptsChild(n.type, t))
    }
    this.pastes++
    const shift = 16 * this.pastes
    if (this.doc.root === null) {
      const first = reidentify(this.clipboard[0].tree, this.clipboard[0].id, 0, 0)
      if (!first || !this.commit({ op: 'insert', parent: null, node: first.node, tree: first.tree }, 'Paste')) return []
      this.select([first.node.id])
      return [first.node.id]
    }
    const sel = this.selection[0]
    let parent: NodeId | undefined
    let index: number | undefined
    if (sel && takesAll(sel)) {
      parent = sel
    } else {
      for (let at = sel ? parentOf(this.doc, sel) : this.doc.root; at; at = parentOf(this.doc, at)) {
        if (takesAll(at)) { parent = at; break }
      }
      if (parent && sel && this.doc.nodes[parent].children.includes(sel)) index = this.doc.nodes[parent].children.indexOf(sel) + 1
    }
    if (!parent) return []
    const free = !this.doc.nodes[parent].flow
    const ops: Op[] = []
    const ids: NodeId[] = []
    for (const [k, c] of this.clipboard.entries()) {
      const copy = reidentify(c.tree, c.id, free ? shift : 0, free ? shift : 0)
      if (!copy) continue
      ops.push({ op: 'insert', parent, index: index === undefined ? undefined : index + k, node: copy.node, tree: copy.tree })
      ids.push(copy.node.id)
    }
    if (ops.length === 0 || !this.commitAll(ops, ops.length > 1 ? `Paste ${ops.length} items` : 'Paste')) return []
    this.select(ids)
    return ids
  }

  /** Bring to the front of its siblings (the first child paints on top) or send to the back. */
  arrange(id: NodeId, to: 'front' | 'back'): boolean {
    const parent = parentOf(this.doc, id)
    if (!parent) return false
    const kids = this.doc.nodes[parent].children
    const index = to === 'front' ? 0 : kids.length - 1
    if (kids.indexOf(id) === index) return false
    return this.commit({ op: 'reparent', id, parent, index }, to === 'front' ? 'Bring to front' : 'Send to back')
  }

  /**
   * Wrap nodes that share a parent in a new flowing container, where the
   * first of them was: the everyday way to group things. One undo step; the
   * new container selected.
   */
  wrap(ids: NodeId[], type = 'Stack'): NodeId | undefined {
    const top = this.topLevel(ids).filter((id) => id !== this.doc.root)
    const parent = top.length ? parentOf(this.doc, top[0]) : undefined
    if (!parent || top.some((id) => parentOf(this.doc, id) !== parent)) return undefined
    const kids = this.doc.nodes[parent].children
    const ordered = [...top].sort((a, b) => kids.indexOf(a) - kids.indexOf(b))
    const first = this.doc.nodes[ordered[0]]
    const box = this.buildNode(type, Number(first.props.x) || 0, Number(first.props.y) || 0, {}, { flow: true })
    const ops: Op[] = [{ op: 'insert', parent, index: kids.indexOf(ordered[0]), node: box }]
    for (const [i, id] of ordered.entries()) ops.push({ op: 'reparent', id, parent: box.id, index: i })
    if (!this.commitAll(ops, `Wrap in ${type}`)) return undefined
    this.select([box.id])
    return box.id
  }

  /**
   * Align free-positioned siblings on one edge or centre line, given each
   * one's drawn size in design units (the canvas measures it; a prop may be
   * unset). One undo step. Flow children are placed by their parent and are
   * left alone.
   */
  align(ids: NodeId[], edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom', size: (id: NodeId) => { w: number; h: number }): boolean {
    const boxes = this.freeBoxes(ids, size)
    if (boxes.length < 2) return false
    const horizontal = edge === 'left' || edge === 'center' || edge === 'right'
    const lo = Math.min(...boxes.map((b) => (horizontal ? b.x : b.y)))
    const hi = Math.max(...boxes.map((b) => (horizontal ? b.x + b.w : b.y + b.h)))
    const ops: Op[] = boxes.map((b) => {
      const extent = horizontal ? b.w : b.h
      const at = edge === 'left' || edge === 'top' ? lo : edge === 'right' || edge === 'bottom' ? hi - extent : Math.round((lo + hi) / 2 - extent / 2)
      return { op: 'move', id: b.id, x: horizontal ? at : b.x, y: horizontal ? b.y : at }
    })
    return this.commitAll(ops, `Align ${edge}`)
  }

  /** Space three or more free-positioned siblings evenly between the outer two. One undo step. */
  distribute(ids: NodeId[], axis: 'horizontal' | 'vertical', size: (id: NodeId) => { w: number; h: number }): boolean {
    const h = axis === 'horizontal'
    const boxes = this.freeBoxes(ids, size).sort((a, b) => (h ? a.x - b.x : a.y - b.y))
    if (boxes.length < 3) return false
    const first = boxes[0]
    const last = boxes[boxes.length - 1]
    const span = (h ? last.x + last.w : last.y + last.h) - (h ? first.x : first.y)
    const filled = boxes.reduce((n, b) => n + (h ? b.w : b.h), 0)
    const gap = (span - filled) / (boxes.length - 1)
    let at = h ? first.x : first.y
    const ops: Op[] = []
    for (const b of boxes) {
      ops.push({ op: 'move', id: b.id, x: h ? Math.round(at) : b.x, y: h ? b.y : Math.round(at) })
      at += (h ? b.w : b.h) + gap
    }
    return this.commitAll(ops, `Distribute ${axis}ly`)
  }

  /** The unlocked, free-positioned nodes among `ids` that share one parent, with their boxes. */
  private freeBoxes(ids: NodeId[], size: (id: NodeId) => { w: number; h: number }) {
    const parent = ids.length ? parentOf(this.doc, ids[0]) : undefined
    return ids
      .filter((id) => {
        const n = this.doc.nodes[id]
        return n && !n.locked && parent && parentOf(this.doc, id) === parent && !this.doc.nodes[parent].flow
      })
      .map((id) => {
        const n = this.doc.nodes[id]
        return { id, x: Number(n.props.x) || 0, y: Number(n.props.y) || 0, ...size(id) }
      })
  }

  /**
   * Add a tool without dragging it (a click, or Enter on the toolbox button):
   * into the selected container when it takes this type, else into the
   * nearest container above the selection that does, else into the root; into
   * nothing when there is no document yet (it becomes the root). Adding was
   * drag-only, so the keyboard could not build anything at all.
   *
   * In a free-positioned parent each new child lands a step further in, so
   * several clicks do not stack exactly on top of each other.
   */
  insertTool(type: string, starterId?: string): NodeId | undefined {
    const childType = starterId ? getStarter(starterId)?.tree.type : type
    if (!childType) return undefined
    const place = (parent: NodeId | null, x: number, y: number) =>
      starterId ? this.addStarter(starterId, parent, x, y) : this.dropComponent(type, parent, x, y)
    if (this.doc.root === null) return place(null, 0, 0)
    const takes = (id: NodeId) => {
      const n = this.doc.nodes[id]
      const spec = n && getComponent(n.type)
      return !!spec?.container && !n.locked && (!spec.childTypes || acceptsChild(n.type, childType))
    }
    let parent: NodeId | undefined
    for (let at: NodeId | undefined = this.selection[0] ?? this.doc.root; at; at = parentOf(this.doc, at) ?? undefined) {
      if (takes(at)) { parent = at; break }
    }
    if (!parent) return undefined
    const host = this.doc.nodes[parent]
    const step = host.flow ? 0 : 24 + (host.children.length % 8) * 16
    return place(parent, step, step)
  }

  /**
   * Drop a starter: a ready-made arrangement of real tools, inserted as ONE
   * undoable step and selected as a whole (see `model/starters.ts`).
   */
  addStarter(starterId: string, parent: NodeId | null, x = 0, y = 0): NodeId | undefined {
    const starter = getStarter(starterId)
    if (!starter) throw new Error(`unknown starter: ${starterId}`)
    const { root, tree } = buildStarter(starter, () => `n${Math.random().toString(36).slice(2, 9)}`)
    root.props = { ...root.props, x, y }
    const ok = this.commit({ op: 'insert', parent, node: root, tree }, `Add ${starter.label}`)
    if (ok) this.select([root.id])
    return ok ? root.id : undefined
  }

  /** Create several components as ONE undoable step (fixtures, paste, AI batches). */
  addMany(
    items: Array<{ type: string; parent: NodeId | null; props?: Record<string, PropValue>; flow?: boolean }>,
    label = 'Add components',
  ) {
    const ops: Op[] = []
    const created: NodeId[] = []
    // A `null` parent means "no root yet": the FIRST such item becomes the
    // root, and any later one nests inside it. That is the only way to seed a
    // rootless document in one undoable step.
    let firstNullParent: NodeId | null = null
    for (const it of items) {
      const id = `n${Math.random().toString(36).slice(2, 9)}`
      const built = instantiate(it.type)
      const node: Node = {
        id,
        type: it.type,
        props: { ...built.props, ...(it.props ?? {}), x: 0, y: 0 },
        children: [],
        flow: it.flow ?? built.flow,
        visible: true,
        locked: false,
        opacity: 1,
      }
      const parent = it.parent ?? firstNullParent
      if (parent === null) firstNullParent = id
      ops.push({ op: 'insert', parent, node })
      created.push(id)
    }
    this.commitAll(ops, label)
    return created
  }

  /**
   * Replace the whole document (an OPEN, not an edit).
   *
   * History is reset: undoing back into a document the user never authored in
   * this session is disorienting, and the previous document is unreachable
   * anyway once it is replaced.
   */
  loadDocument(doc: Document) {
    this.doc = doc
    this.sealed = doc
    this.history = []
    this.future = []
    this.selection = []
    this.dirty = false
    this.savedDoc = null
    this.emit()
  }

  /** Autosave target, derived from the document name. */
  autosaveName(): string {
    return `${filenameFor(this.doc.meta.name)}`
  }

  async save() {
    const api = this.host
    if (!api) return { ok: false, error: 'no host bridge' }
    // Capture what is being written: the save dialog is async, and an edit
    // made while it is open is NOT on disk, so it must stay dirty.
    const written = this.doc
    const res = await api.save(this.autosaveName(), serialize(written))
    if (res.ok) {
      this.savedDoc = written
      this.dirty = this.doc !== written
      this.lastSavedPath = res.path ?? null
      this.emit()
    }
    this.report(res, 'Saved', "Couldn't save")
    return res
  }

  /** Standalone HTML filename, derived from the document name. */
  exportFilename(): string {
    return exportFilenameFor(this.doc.meta.name)
  }

  /** Render the document to a standalone HTML page (pure, deterministic). */
  emitHtml(): string {
    return emitHtml(this.doc)
  }

  /**
   * Export via the host save dialog with an HTML filter.
   *
   * The HTML string is generated in the renderer (same preview path the user
   * sees); the main process only writes the bytes. Falls back to `save` on
   * hosts that predate the `doc:export-html` channel.
   */
  async exportHtmlFile() {
    const api = this.host
    if (!api) return { ok: false, error: 'no host bridge' }
    let html: string
    try {
      html = emitHtml(this.doc)
    } catch (e) {
      this.notify('error', `Couldn't export the HTML: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
    const saver = api.exportHtml ?? api.save
    const res = await saver(this.exportFilename(), html)
    this.report(res, 'Exported', "Couldn't export the HTML")
    return res
  }

  /** Standalone React filename, derived from the document name. */
  reactFilename(): string {
    return reactFilenameFor(this.doc.meta.name)
  }

  /** Render the document to a self-contained React module (pure, deterministic). */
  emitReact(): string {
    return emitReact(this.doc)
  }

  /**
   * Export via the host save dialog with a JSX filter. Same trust shape as
   * the HTML export; falls back to `save` on older hosts.
   */
  async exportReactFile() {
    const api = this.host
    if (!api) return { ok: false, error: 'no host bridge' }
    let src: string
    try {
      src = emitReact(this.doc)
    } catch (e) {
      this.notify('error', `Couldn't export the React component: ${String(e)}`)
      return { ok: false, error: String(e) }
    }
    const saver = api.exportReact ?? api.save
    const res = await saver(this.reactFilename(), src)
    this.report(res, 'Exported', "Couldn't export the React component")
    return res
  }

  async open() {
    const api = this.host
    if (!api) return { ok: false as const, error: 'no host bridge' }
    const res = await api.open()
    if (!res.ok) {
      this.report(res, 'Opened', "Couldn't open the file")
      return res
    }
    const parsed = validate(res.contents)
    if (!parsed.doc) {
      const file = res.path?.split(/[\\/]/).pop()
      this.notify('error', `${file ?? 'That file'} isn't a Loom document, so nothing was opened.`)
      return { ok: false as const, error: 'invalid document', issues: parsed.issues }
    }
    this.loadDocument(parsed.doc)
    // An opened file is what is on disk.
    this.savedDoc = parsed.doc
    this.lastSavedPath = res.path ?? null
    this.report(res, 'Opened', "Couldn't open the file")
    return { ok: true as const, issues: parsed.issues }
  }

  /** Silent background save; failure is non-fatal by design. */
  async autosave() {
    const api = this.host
    if (!api || !this.dirty) return
    await api.autosave(this.autosaveName(), serialize(this.doc))
  }

  /**
   * What an earlier session left unsaved, if anything: the newest autosave,
   * validated, for the welcome card to offer. Never loaded here.
   */
  async findRecovery(): Promise<{ doc: Document; name: string; mtime: number } | null> {
    const res = await this.host?.latestAutosave?.()
    if (!res?.ok || !res.contents || !res.mtime) return null
    const parsed = validate(res.contents)
    if (!parsed.doc || parsed.doc.root === null) return null
    return { doc: parsed.doc, name: parsed.doc.meta.name, mtime: res.mtime }
  }

  /** Continue from a recovered document: loaded as unsaved work, one choice by the person. */
  recover(doc: Document) {
    this.loadDocument(doc)
    this.dirty = true
    this.notify('ok', `Recovered "${doc.meta.name}". Save it to keep it.`)
  }

  async restoreAutosave() {
    const api = this.host
    if (!api) return false
    const res = await api.readAutosave(this.autosaveName())
    if (!res.ok) return false
    const parsed = validate(res.contents)
    if (!parsed.doc) return false
    this.loadDocument(parsed.doc)
    // Restored work is unsaved work.
    this.dirty = true
    this.emit()
    return true
  }

  setProp(id: NodeId, key: string, value: PropValue) {
    this.commit({ op: 'setProp', id, key, value }, `Set ${key}`)
  }

  remove(ids: NodeId[]) {
    // Locked nodes refuse deletion (unlock first). Filtering here covers
    // every caller at once: Delete key, context menu, and future AI ops.
    const doomed = ids.filter((id) => {
      const n = this.doc.nodes[id]
      return n && !n.locked
    })
    if (doomed.length === 0) return
    // The root is an ordinary design node now: deleting it takes its subtree
    // and leaves a genuinely EMPTY workspace, which is undoable like any
    // other edit. Locking a child does not protect it from its own root being
    // deleted — that is the trade the user accepted by owning the root.
    const ops: Op[] = doomed.map((id) => ({ op: 'remove', id }))
    const wipesWorkspace = this.doc.root !== null && doomed.includes(this.doc.root)
    const label = wipesWorkspace
      ? doomed.length > 1
        ? `Delete ${doomed.length} items`
        : 'Delete root'
      : doomed.length > 1
        ? `Delete ${doomed.length} items`
        : 'Delete'
    const ok = this.commitAll(ops, label)
    if (ok) this.select([])
  }

  /**
   * Duplicate a node (and its subtree) beside itself, selecting the copy.
   * One undoable step. The copy lands offset so it never hides the source.
   * Used by Alt-drag; locked nodes and the root refuse.
   */
  duplicate(id: NodeId): NodeId | undefined {
    return this.duplicateAll([id])[0]
  }

  /**
   * Duplicate several nodes as ONE undoable step (Ctrl+D, the context menu),
   * each copy just after its source, selecting the copies. A node inside
   * another selected node travels with that one's copy, not twice.
   */
  duplicateAll(ids: NodeId[]): NodeId[] {
    const picked = new Set(ids)
    const within = (id: NodeId): boolean => {
      for (let p = parentOf(this.doc, id); p; p = parentOf(this.doc, p)) if (picked.has(p)) return true
      return false
    }
    const sources = ids
      .filter((id) => {
        const n = this.doc.nodes[id]
        return n && !n.locked && id !== this.doc.root && !within(id)
      })
      .map((id) => {
        const parent = parentOf(this.doc, id)!
        return { id, parent, index: this.doc.nodes[parent].children.indexOf(id) }
      })
      // Later siblings first: inserting after them never shifts an earlier one.
      .sort((a, b) => (a.parent === b.parent ? b.index - a.index : 0))
    const ops: Op[] = []
    const copyOf = new Map<NodeId, NodeId>()
    for (const src of sources) {
      const dup = duplicateSubtree(this.doc, src.id)
      if (!dup) continue
      ops.push({ op: 'insert', parent: src.parent, index: src.index + 1, node: dup.node, tree: dup.tree })
      copyOf.set(src.id, dup.node.id)
    }
    if (ops.length === 0) return []
    const only = sources.length === 1 ? this.doc.nodes[sources[0].id]?.type : undefined
    const ok = this.commitAll(ops, only ? `Duplicate ${only}` : `Duplicate ${ops.length} items`)
    if (!ok) return []
    // In the order they were asked for, not the insertion order.
    const ordered = ids.flatMap((id) => copyOf.get(id) ?? [])
    this.select(ordered)
    return ordered
  }
}

/**
 * A truly EMPTY workspace: zero nodes, no root. Nothing is auto-created —
 * the user's first drop becomes the root (see `apply`'s `insert` with
 * `parent: null`). This is what New/Open-with-no-file give you.
 */
export function emptyDocument(): Document {
  return {
    version: 1,
    meta: { name: 'Untitled', targets: ['web'], created: Date.now() },
    root: null,
    nodes: {},
  }
}
