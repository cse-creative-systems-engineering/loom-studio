import React from 'react'
import { EditorStore } from './state/store'
import type { Document, Node, NodeId, PropValue } from './model/types'
import { ancestry, parentOf } from './model/ops'
import { snapMove as snapTo, artboardAnchors, type SnapBox } from './model/snap'
import { componentsByCategory, getComponent, propSupported, unsupportedProps } from './model/registry'
import { renderNode, isFlowChild, zoomed, type Corner } from './render/web'
import { EffectsPanel } from './effects-inspector'
import { normalizeEffects } from './render/effects'
import { Toggle } from './ui-primitives'
import { ContextMenu, type MenuState } from './context-menu'
import { THEME_NAMES, getTheme } from './render/theme'
import './ui.css'

interface PreviewApi {
  open: (doc: unknown) => Promise<boolean>
  update?: (doc: unknown) => Promise<boolean>
  close: () => Promise<boolean>
  setAlwaysOnTop: (on: boolean) => Promise<boolean>
  onDocument: (cb: (doc: unknown) => void) => () => void
  onClosed: (cb: () => void) => () => void
}

/* ------------------------------------------------------------------ *
 * Store singleton
 * ------------------------------------------------------------------ */

const store = new EditorStore()
export { store }

declare global {
  interface Window {
    __loomStore: EditorStore
  }
}
if (typeof window !== 'undefined') window.__loomStore = store

function useStore(): EditorStore {
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => store.subscribe(force), [])
  return store
}

/* ------------------------------------------------------------------ *
 * App shell
 * ------------------------------------------------------------------ */

export function App() {
  const s = useStore()
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [menu, setMenu] = React.useState<MenuState | null>(null)
  // Canvas zoom is view state, not document state: it never touches the
  // doc, the history, or the output. 1 = 100%.
  const [zoom, setZoom] = React.useState(1)

  /**
   * The preview is a DETACHED window, on demand.
   *
   * A docked column shrank the artifact to a ~110px miniature and stole canvas
   * width from the thing being designed. A separate always-on-top window is
   * what design tools do: the user chooses when to see the output, and the OS
   * resizes it however they like.
   */
  // Ref mirror: the keyboard effect below subscribes once (the store
  // singleton never changes), so a closure over `previewOpen` would go stale
  // after the first toggle. The ref keeps the shortcut honest forever.
  const previewOpenRef = React.useRef(previewOpen)
  previewOpenRef.current = previewOpen

  const setPreviewTo = React.useCallback(
    (open: boolean) => {
      const api = (window as unknown as { loomPreview?: PreviewApi }).loomPreview
      if (!api) return
      if (open) {
        void api.open(s.doc)
        setPreviewOpen(true)
      } else {
        void api.close()
        setPreviewOpen(false)
      }
    },
    [s],
  )

  const togglePreview = React.useCallback(() => {
    setPreviewTo(!previewOpenRef.current)
  }, [setPreviewTo])

  // Keep the detached window live: push the document whenever it changes.
  // Updates go through `update`, never `open` — opening focuses the window,
  // which would steal keyboard focus out of the editor mid-gesture.
  React.useEffect(() => {
    if (!previewOpen) return
    const api = (window as unknown as { loomPreview?: PreviewApi }).loomPreview
    if (!api) return
    // Debounced: a drag fires this on every frame, and IPC per frame is waste.
    const id = window.setTimeout(
      () => void (api.update ? api.update(s.doc) : api.open(s.doc)),
      60,
    )
    return () => window.clearTimeout(id)
  }, [previewOpen, s.doc])

  // The user may close the preview window directly; reflect that in the UI.
  React.useEffect(() => {
    const api = (window as unknown as { loomPreview?: PreviewApi }).loomPreview
    if (!api) return
    return api.onClosed(() => setPreviewOpen(false))
  }, [])

  // Autosave: a crash should cost the user nothing.
  React.useEffect(() => {
    const id = window.setInterval(() => void s.autosave(), 5000)
    return () => window.clearInterval(id)
  }, [s])

  // Warn on close while there are unsaved changes.
  React.useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!s.dirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [s])

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey

      // Never steal keys from a field the user is typing in. Without this,
      // pressing Delete while editing a Label's text would delete the
      // component instead of the character.
      const t = e.target as HTMLElement | null
      const typing =
        !!t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)

      if (mod) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault()
          s.undo()
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault()
          s.redo()
        } else if (e.key === 'd') {
          e.preventDefault()
          s.remove(s.selection)
        } else if (e.key === 'a') {
          e.preventDefault()
          s.select(Object.keys(s.doc.nodes).filter((id) => id !== s.doc.root))
        } else if (e.key === 's') {
          e.preventDefault()
          void s.save()
        } else if (e.key === 'e') {
          e.preventDefault()
          void s.exportHtmlFile()
        } else if (e.key === 'p') {
          e.preventDefault()
          togglePreview()
        } else if (e.key === 'o') {
          e.preventDefault()
          void s.open()
        }
        return
      }

      if (typing) return

      // Bare-key shortcuts: the obvious ones a designer reaches for.
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.selection.length === 0) return
        e.preventDefault()
        s.remove(s.selection)
      } else if (e.key === 'Escape') {
        s.select([])
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Nudge the selection. Free children move; flow children are
        // repositioned by their parent, so nudge is a no-op for them.
        if (s.selection.length !== 1) return
        const id = s.selection[0]
        const node = s.doc.nodes[id]
        if (!node || isFlowChild(s.doc, id)) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dy = e.key === 'ArrowUp' ? -step : step
        s.commit(
          { op: 'move', id, x: Number(node.props.x) || 0, y: (Number(node.props.y) || 0) + dy },
          'Nudge',
        )
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (s.selection.length !== 1) return
        const id = s.selection[0]
        const node = s.doc.nodes[id]
        if (!node || isFlowChild(s.doc, id)) return
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : step
        s.commit(
          { op: 'move', id, x: (Number(node.props.x) || 0) + dx, y: Number(node.props.y) || 0 },
          'Nudge',
        )
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [s])

  return (
    <div className="loom">
      <TitleBar s={s} previewOpen={previewOpen} onTogglePreview={togglePreview} />
      <div className="body">
        <Toolbox s={s} onDragChange={setDragging} zoom={zoom} />
        <Canvas
          s={s}
          dragging={dragging}
          onMenu={setMenu}
          zoom={zoom}
          onZoom={(z) => setZoom(Math.min(2, Math.max(0.25, Math.round(z * 100) / 100)))}
        />
        <Inspector s={s} />
      </div>
      <StatusBar s={s} previewOpen={previewOpen} onTogglePreview={togglePreview} />
      {menu && <ContextMenu s={s} state={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

function TitleBar({ s, previewOpen, onTogglePreview }: { s: EditorStore; previewOpen: boolean; onTogglePreview: () => void }) {
  // Copy confirmation is local view state: it reports a clipboard write,
  // never document state, so it stays out of the store.
  const [copied, setCopied] = React.useState(false)
  const copyHtml = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    let html: string
    try {
      html = s.emitHtml()
    } catch {
      return
    }
    void navigator.clipboard.writeText(html).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <header className="titlebar">
      <div className="brand">
        <span className="mark" />
        <span className="wordmark">Loom</span>
      </div>
      <div className="doc-name">
        {s.doc.meta.name}
        {s.dirty && <span className="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes" />}
      </div>
      <div className="file-actions">
        <button className="file-btn" onClick={() => void s.open()} title="Open a document (Ctrl+O)">
          Open
        </button>
        <button className="file-btn primary" onClick={() => void s.save()} title="Save (Ctrl+S)">
          Save
        </button>
        <button className="file-btn" onClick={() => void s.exportHtmlFile()} title="Export standalone HTML (Ctrl+E)">
          Export
        </button>
        <button
          className={`file-btn${previewOpen ? ' primary' : ''}`}
          onClick={onTogglePreview}
          title={previewOpen ? 'Hide the live preview (Ctrl+P)' : 'Show a live preview of what is built (Ctrl+P)'}
          aria-pressed={previewOpen}
        >
          {previewOpen ? '◉ Preview' : '○ Preview'}
        </button>
        <button className="file-btn" onClick={copyHtml} title="Copy the standalone HTML output to the clipboard">
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <span className="spacer" />
      <div className="theme-picker" role="group" aria-label="Output theme">
        {THEME_NAMES.map((n) => (
          <button
            key={n}
            className={`theme-chip ${(s.doc.meta.theme ?? 'midnight') === n ? 'on' : ''}`}
            onClick={() => s.setTheme(n)}
            title={`Apply the ${n} theme to the whole document`}
          >
            <span
              className="theme-swatch"
              style={{ background: getTheme(n).accent }}
              aria-hidden="true"
            />
            {n}
          </button>
        ))}
      </div>
      <div className="targets" role="group" aria-label="Export target">
        {(['web', 'desktop'] as const).map((t) => (
          <button
            key={t}
            className={`target ${s.target === t ? 'on' : ''}`}
            onClick={() => s.setTarget(t)}
          >
            {t === 'web' ? 'Web' : 'Desktop'}
          </button>
        ))}
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Toolbox
 * ------------------------------------------------------------------ */

function Toolbox({
  s,
  onDragChange,
  zoom,
}: {
  s: EditorStore
  onDragChange: (type: string | null) => void
  zoom: number
}) {
  const cats = componentsByCategory()
  const [filter, setFilter] = React.useState('')
  const [tab, setTab] = React.useState<'components' | 'layers'>('components')

  const startDrag = (e: React.PointerEvent, type: string) => {
    e.preventDefault()
    const ghost = document.createElement('div')
    ghost.className = 'drag-ghost'
    document.body.appendChild(ghost)
    onDragChange(type)
    moveGhost(e.clientX, e.clientY, type, null)

    const onMove = (ev: PointerEvent) => {
      const hit = dropTarget(ev.clientX, ev.clientY)
      moveGhost(ev.clientX, ev.clientY, type, hit ? snapTo(hit.host, ev) : null)
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      ghost.remove()
      onDragChange(null)
      const hit = dropTarget(ev.clientX, ev.clientY)
      if (!hit) return
      // A flow parent places its children, so coordinates are meaningless
      // there; a free parent needs them. The child's own `flow` flag (how
      // ITS children layout) comes from the component schema, not the parent.
      const flowParent = s.doc.nodes[hit.parent]?.flow === true
      const { x, y } = snapTo(hit.host, ev)
      s.addComponent(type, hit.parent, flowParent ? 0 : x, flowParent ? 0 : y)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * The element a drop coordinates against, and the parent id it lands in.
   *
   * The old code always targeted `[data-loom-surface]`, so a component could
   * never be dropped INTO a panel — the most natural gesture in a designer.
   * `closest` walks ancestors, so the nearest container ancestor under the
   * cursor wins: the deepest one.
   */
  const dropTarget = (x: number, y: number): { host: HTMLElement; parent: NodeId } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null

    const container = el.closest('[data-loom-container="true"]') as HTMLElement | null
    if (container?.dataset.loomId) {
      return { host: container, parent: container.dataset.loomId }
    }
    const surface = el.closest('[data-loom-surface]') as HTMLElement | null
    if (surface?.dataset.loomSurface) {
      return { host: surface, parent: surface.dataset.loomSurface }
    }
    return null
  }

  const snapTo = (host: HTMLElement, ev: PointerEvent) => {
    // getBoundingClientRect speaks screen pixels; the document speaks doc
    // units. At any zoom other than 100% the two differ by exactly `zoom`.
    const r = host.getBoundingClientRect()
    return { x: Math.round(zoomed(ev.clientX - r.left, zoom)), y: Math.round(zoomed(ev.clientY - r.top, zoom)) }
  }

  /**
   * The ghost shows the component AND the coordinates it will land at, so the
   * drop is never a guess. Off-surface it dims and says so.
   */
  const moveGhost = (x: number, y: number, type: string, at: { x: number; y: number } | null) => {
    const g = document.querySelector<HTMLElement>('.drag-ghost')
    if (!g) return
    g.style.transform = `translate(${x + 14}px, ${y + 14}px)`
    g.dataset.valid = at ? 'yes' : 'no'
    g.innerHTML = `<span class="ghost-name">${type}</span>${
      at ? `<span class="ghost-coord">x ${at.x} · y ${at.y}</span>` : '<span class="ghost-coord">drop on the canvas</span>'
    }`
  }

  const elementCount = Object.keys(s.doc.nodes).length - 1

  return (
    <aside className="toolbox">
      {tab === 'components' && (
        <input
          className="search"
          placeholder="Search components"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="tabbar" role="tablist" aria-label="Toolbox tabs">
        <button
          className={`tab ${tab === 'components' ? 'on' : ''}`}
          role="tab"
          aria-selected={tab === 'components'}
          onClick={() => setTab('components')}
        >
          Components
        </button>
        <button
          className={`tab ${tab === 'layers' ? 'on' : ''}`}
          role="tab"
          aria-selected={tab === 'layers'}
          onClick={() => setTab('layers')}
          title="Every element in stacking order — select, hide, lock, reorder"
        >
          Layers · {elementCount}
        </button>
      </div>
      {tab === 'components' ? (
        <>
          <div className="legend">
            <span className="tool-gate" aria-hidden="true" />
            limited on {s.target === 'web' ? 'Desktop' : 'Web'}
          </div>
          <div className="scroll">
            {[...cats.entries()].map(([cat, list]) => {
              const items = list.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
              if (items.length === 0) return null
              return (
                <section key={cat}>
                  <h3>{cat}</h3>
                  {items.map((c) => {
                    const gated = unsupportedProps(c, s.target)
                    return (
                      <button
                        key={c.name}
                        className="tool"
                        title={`${c.description}${gated.length ? `\n\nNot portable to ${s.target}: ${gated.join(', ')}` : ''}`}
                        onPointerDown={(e) => startDrag(e, c.name)}
                      >
                        <span className="tool-icon">{c.icon}</span>
                        <span className="tool-name">{c.name}</span>
                        {gated.length > 0 && <span className="tool-gate" aria-label="not portable" />}
                      </button>
                    )
                  })}
                </section>
              )
            })}
          </div>
        </>
      ) : (
        <Layers s={s} />
      )}
    </aside>
  )
}

/** One-line distinguishing detail for a layer row (label text, if any). */
function layerDetail(node: { props: Record<string, PropValue> }): string {
  const raw = node.props.text ?? node.props.label ?? node.props.title ?? node.props.message ?? ''
  const text = String(raw ?? '').trim()
  return text ? (text.length > 20 ? `${text.slice(0, 20)}…` : text) : ''
}

/**
 * Layers: the document tree in stacking order with visibility, lock, and
 * z-order controls. The canvas shows spatial truth; this shows structural
 * truth — including hidden nodes, which the canvas only ghosts.
 */
function Layers({ s }: { s: EditorStore }) {
  const root = s.doc.nodes[s.doc.root]
  if (!root) return null
  return (
    <div className="scroll layers">
      <div className="legend">
        {Object.keys(s.doc.nodes).length - 1} element{Object.keys(s.doc.nodes).length === 2 ? '' : 's'} · top is front
      </div>
      {root.children.map((id) => (
        <LayerRow key={id} s={s} id={id} depth={0} />
      ))}
    </div>
  )
}

function LayerRow({ s, id, depth }: { s: EditorStore; id: NodeId; depth: number }) {
  const node = s.doc.nodes[id]
  if (!node) return null
  const spec = getComponent(node.type)
  const selected = s.selection.includes(id)
  const parent = parentOf(s.doc, id)
  const siblings = parent ? (s.doc.nodes[parent]?.children ?? []) : []
  const index = siblings.indexOf(id)

  const reorder = (dir: -1 | 1) => {
    if (!parent) return
    // Same-parent reparent uses post-removal indexes: i-1 lifts one slot,
    // i+1 drops one slot. Buttons only render where the move is legal.
    s.commit({ op: 'reparent', id, parent, index: index + dir }, dir < 0 ? 'Move forward' : 'Move back')
  }

  const detail = layerDetail(node)

  return (
    <div>
      <div
        className={`layer-row${selected ? ' selected' : ''}${node.visible === false ? ' is-hidden' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onPointerDown={(e) => {
          e.stopPropagation()
          if (e.shiftKey) {
            s.select(selected ? s.selection.filter((x) => x !== id) : [...s.selection, id])
          } else {
            s.select([id])
          }
        }}
        title={`${node.type}${detail ? ` — ${detail}` : ''}`}
      >
        <span className="tool-icon">{spec?.icon ?? '?'}</span>
        <span className="tool-name">
          {node.type}
          {detail && <span className="layer-detail"> · {detail}</span>}
        </span>
        {node.locked === true && (
          <span className="layer-locked" title="Locked — unlock to drag, resize, or delete" aria-label="locked">
            ⚿
          </span>
        )}
        {siblings.length > 1 && index > 0 && (
          <button className="layer-btn" title="Move forward (toward front)" onClick={() => reorder(-1)}>
            ↑
          </button>
        )}
        {siblings.length > 1 && index >= 0 && index < siblings.length - 1 && (
          <button className="layer-btn" title="Move back (toward back)" onClick={() => reorder(1)}>
            ↓
          </button>
        )}
        <button
          className={`layer-btn${node.visible === false ? ' off' : ''}`}
          title={node.visible === false ? 'Show in output' : 'Hide from output'}
          onClick={() => s.commit({ op: 'setVisible', id, visible: node.visible === false }, node.visible === false ? 'Show' : 'Hide')}
        >
          {node.visible === false ? '○' : '●'}
        </button>
        <button
          className={`layer-btn${node.locked === true ? ' on' : ''}`}
          title={node.locked === true ? 'Unlock' : 'Lock against drag, resize, and delete'}
          onClick={() => s.commit({ op: 'setLocked', id, locked: !node.locked }, node.locked ? 'Unlock' : 'Lock')}
        >
          ⚿
        </button>
      </div>
      {node.children.map((c) => (
        <LayerRow key={c} s={s} id={c} depth={depth + 1} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Canvas — transient manipulation lives here
 * ------------------------------------------------------------------ */

interface DragState {
  id: NodeId
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

/** Snap threshold in doc units. */
const SNAP_WITHIN = 6

/**
 * Snap a dragged position to nearby sibling edges (left/top) and the parent
 * origin. Each axis snaps independently to the nearest candidate within
 * threshold. Returns the snapped point plus guide coordinates for display.
 *
 * Delegates to the shared engine in model/snap.ts, which does the real work:
 * all nine line pairs (left/centre/right x top/middle/bottom) against every
 * sibling AND their descendants, gated on 2D proximity. The version this
 * replaced only matched a node's ORIGIN against its immediate siblings, so
 * right-edge, centre, and cross-container alignment simply did not work.
 */
function snapMove(
  doc: Document,
  id: NodeId,
  x: number,
  y: number,
): { x: number; y: number; gx: number | null; gy: number | null } {
  const node = doc.nodes[id]
  if (!node) return { x, y, gx: null, gy: null }

  const box = (n: Node): SnapBox => ({
    id: n.id,
    x: Number(n.props.x) || 0,
    y: Number(n.props.y) || 0,
    w: Number(n.props.w) || Number(n.props.width) || 0,
    h: Number(n.props.h) || Number(n.props.height) || 0,
  })

  // Candidates: every other node in the document, not just siblings, so a
  // control can align to a guide inside a panel it is not a child of.
  const others: SnapBox[] = []
  for (const other of Object.values(doc.nodes)) {
    if (other.id === id || other.id === doc.root) continue
    if (other.visible === false) continue
    if (isFlowChild(doc, other.id)) continue // flow children are parent-placed
    others.push(box(other))
  }

  const r = snapTo(
    { id, x, y, w: box(node).w, h: box(node).h },
    others,
    {
      grid: doc.meta.snapGrid ?? 0,
      threshold: SNAP_WITHIN,
      anchors: artboardAnchors(doc.meta.artboard?.w ?? 0, doc.meta.artboard?.h ?? 0),
    },
  )

  return {
    x: r.x,
    y: r.y,
    gx: r.guides.find((g) => g.axis === 'x')?.at ?? null,
    gy: r.guides.find((g) => g.axis === 'y')?.at ?? null,
  }
}

function Canvas({
  s,
  dragging,
  onMenu,
  zoom,
  onZoom,
}: {
  s: EditorStore
  dragging: string | null
  onMenu: (m: MenuState | null) => void
  zoom: number
  onZoom: (z: number) => void
}) {
  const dragRef = React.useRef<DragState | null>(null)
  const [rulers, setRulers] = React.useState(false)
  // Snap guides (doc-unit coordinates) + live drag readout, both transient.
  const [guides, setGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [readout, setReadout] = React.useState<{ x: number; y: number; cx: number; cy: number } | null>(null)

  const onContextMenuNode = (id: NodeId, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!s.selection.includes(id)) s.select([id])
    onMenu({ x: e.clientX, y: e.clientY, targetId: id })
  }

  const onPointerDownNode = (id: NodeId, e: React.PointerEvent) => {
    e.stopPropagation()
    const node = s.doc.nodes[id]
    if (!node) return
    if (e.shiftKey) {
      s.select(
        s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
      )
    } else if (!s.selection.includes(id)) {
      s.select([id])
    }
    if (id === s.doc.root) return
    // Locked nodes select (above) but never manipulate — unlock in Layers.
    if (node.locked) return

    // Alt-drag duplicates, then drags the copy (Atelier's best gesture).
    // The duplicate commits first; the move below seals separately, so
    // undo peels the move before the duplication. Exactly like doing both
    // steps by hand, just in one gesture.
    let target = id
    let targetNode = node
    if (e.altKey) {
      const copy = s.duplicate(id)
      if (!copy) return
      const fresh = s.doc.nodes[copy]
      if (!fresh) return
      target = copy
      targetNode = fresh
    }

    // A handle drag resizes; a body drag moves. Both are transient: poke
    // during, seal once on release.
    const handle = (e.target as HTMLElement).dataset?.loomHandle as Corner | undefined
    if (handle) {
      startResize(e, target, handle)
      return
    }

    const free = !isFlowChild(s.doc, target)
    if (!free) return

    dragRef.current = {
      id: target,
      startX: e.clientX,
      startY: e.clientY,
      originX: Number(targetNode.props.x) || 0,
      originY: Number(targetNode.props.y) || 0,
      moved: false,
    }
    setGuides({ x: null, y: null })

    const onMove = (ev: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = zoomed(ev.clientX - d.startX, zoom)
      const dy = zoomed(ev.clientY - d.startY, zoom)
      if (!d.moved && Math.hypot(dx, dy) < 2) return
      d.moved = true
      const snapped = snapMove(s.doc, d.id, Math.round(d.originX + dx), Math.round(d.originY + dy))
      setGuides({ x: snapped.gx, y: snapped.gy })
      setReadout({ x: snapped.x, y: snapped.y, cx: ev.clientX, cy: ev.clientY })
      s.poke({ op: 'move', id: d.id, x: snapped.x, y: snapped.y })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = dragRef.current
      dragRef.current = null
      setGuides({ x: null, y: null })
      setReadout(null)
      if (d?.moved) s.seal('Move')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /** Corner-handle resize. Same transient contract as move: poke, then seal. */
  const startResize = (e: React.PointerEvent, id: NodeId, corner: Corner) => {
    e.stopPropagation()
    if (s.doc.nodes[id]?.locked) return
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    // Screen rects are zoomed pixels; the resize op speaks doc units.
    const originW = zoomed(rect.width, zoom)
    const originH = zoomed(rect.height, zoom)
    const startX = e.clientX
    const startY = e.clientY
    let moved = false

    const onMove = (ev: PointerEvent) => {
      const dx = zoomed(ev.clientX - startX, zoom)
      const dy = zoomed(ev.clientY - startY, zoom)
      if (!moved && Math.hypot(dx, dy) < 2) return
      moved = true
      const west = corner === 'nw' || corner === 'sw'
      const north = corner === 'nw' || corner === 'ne'
      const w = Math.max(8, Math.round(originW + (west ? -dx : dx)))
      const h = Math.max(8, Math.round(originH + (north ? -dy : dy)))
      s.poke({ op: 'resize', id, w, h })
      // Resizing from a west/north edge must also move the origin, or the
      // element drifts away from the corner the user is holding.
      if (west) {
        s.poke({
          op: 'move',
          id,
          x: Math.round((Number(s.doc.nodes[id]?.props.x) || 0) + (originW - w)),
          y: Number(s.doc.nodes[id]?.props.y) || 0,
        })
      }
      if (north) {
        s.poke({
          op: 'move',
          id,
          x: Number(s.doc.nodes[id]?.props.x) || 0,
          y: Math.round((Number(s.doc.nodes[id]?.props.y) || 0) + (originH - h)),
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      if (moved) s.seal('Resize')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const selected = new Set(s.selection)

  return (
    <main className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className="chip" onClick={() => setRulers((r) => !r)}>
          {rulers ? 'Rulers on' : 'Rulers off'}
        </button>
        <div className="zoom-group" role="group" aria-label="Canvas zoom">
          <button className="chip" onClick={() => onZoom(zoom / 1.25)} title="Zoom out" aria-label="Zoom out">
            −
          </button>
          <button
            className="chip zoom-readout"
            onClick={() => onZoom(1)}
            title="Reset to 100%"
            aria-label={`Zoom ${Math.round(zoom * 100)} percent, activate to reset`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button className="chip" onClick={() => onZoom(zoom * 1.25)} title="Zoom in" aria-label="Zoom in">
            +
          </button>
        </div>
        <span className="spacer" />
        <span className="hint">Del delete · ⌘Z undo · ↑↓ nudge · Esc deselect</span>
      </div>
      <div className={`canvas ${rulers ? 'rulers' : ''} ${dragging ? 'drop-active' : ''}`}>
        <div
          className="surface"
          data-loom-surface={s.doc.root}
          data-zoom={Math.round(zoom * 100)}
          onPointerDown={() => s.select([])}
          style={{ zoom }}
        >
          {renderNode(
            { doc: s.doc, onPointerDownNode, onContextMenuNode, selected },
            s.doc.root,
          )}
          {guides.x !== null && <div className="snap-guide-v" style={{ left: guides.x }} aria-hidden="true" />}
          {guides.y !== null && <div className="snap-guide-h" style={{ top: guides.y }} aria-hidden="true" />}
        </div>
      </div>
      {readout && (
        <div className="drag-readout" style={{ left: readout.cx + 14, top: readout.cy + 16 }} aria-hidden="true">
          x {readout.x} · y {readout.y}
        </div>
      )}
    </main>
  )
}

/* ------------------------------------------------------------------ *
 * Inspector — generated from the component schema
 * ------------------------------------------------------------------ */

function Inspector({ s }: { s: EditorStore }) {
  const id = s.selection[0]
  const node = id ? s.doc.nodes[id] : undefined

  if (!node) {
    return (
      <aside className="inspector">
        <div className="empty">
          <p>Nothing selected</p>
          <p className="dim">Drag a component onto the canvas, or click one to edit its properties.</p>
        </div>
      </aside>
    )
  }

  const spec = getComponent(node.type)
  if (!spec) return <aside className="inspector" />

  const groups = new Map<string, Array<[string, (typeof spec)['props'][string]]>>()
  for (const [key, ps] of Object.entries(spec.props)) {
    const g = ps.group ?? 'General'
    const list = groups.get(g) ?? []
    list.push([key, ps])
    groups.set(g, list)
  }

  const chain = ancestry(s.doc, node.id)
  const parent = parentOf(s.doc, node.id)

  return (
    <aside className="inspector">
      <div className="insp-head">
        <span className="insp-icon">{spec.icon}</span>
        <div>
          <div className="insp-name">{spec.name}</div>
          <div className="insp-path">
            {chain.length > 1 ? `${chain.length} deep` : 'root'}
            {parent ? ` · parent ${s.doc.nodes[parent]?.type ?? '?'}` : ''}
          </div>
        </div>
      </div>

      <div className="insp-scroll">
        {spec.container && (
          <section>
            <h3>Layout</h3>
            <div className="field">
              <label>
                Flow layout
                <span className="dim"> — off: children position freely (absolute); on: this container arranges them</span>
              </label>
              <Toggle
                checked={node.flow}
                onChange={(v) => s.commit({ op: 'setFlow', id: node.id, flow: v }, v ? 'Flow on' : 'Flow off')}
              />
            </div>
          </section>
        )}
        {!isFlowChild(s.doc, node.id) && node.id !== s.doc.root && (
          <section>
            <h3>Position</h3>
            <div className="row two">
              <NumField
                label="X"
                value={Number(node.props.x) || 0}
                onChange={(v) => s.poke({ op: 'move', id: node.id, x: v, y: Number(node.props.y) || 0 })}
                onCommit={() => s.seal('Move')}
              />
              <NumField
                label="Y"
                value={Number(node.props.y) || 0}
                onChange={(v) => s.poke({ op: 'move', id: node.id, x: Number(node.props.x) || 0, y: v })}
                onCommit={() => s.seal('Move')}
              />
            </div>
            <div className="row two">
              <NumField
                label="W"
                value={Number(node.props.w) || 0}
                onChange={(v) => s.poke({ op: 'resize', id: node.id, w: Math.max(1, v), h: Number(node.props.h) || 0 || 1 })}
                onCommit={() => s.seal('Resize')}
              />
              <NumField
                label="H"
                value={Number(node.props.h) || 0}
                onChange={(v) => s.poke({ op: 'resize', id: node.id, w: Number(node.props.w) || 0 || 1, h: Math.max(1, v) })}
                onCommit={() => s.seal('Resize')}
              />
            </div>
          </section>
        )}

        {[...groups.entries()].map(([group, props]) => (
          <section key={group}>
            <h3>{group}</h3>
            {props.map(([key, ps]) => {
              const supported = supportedIn(spec, key, s.target)
              // Fall back to the schema default so a missing key renders as
              // its real value instead of a misleading 0/empty.
              const raw = node.props[key]
              const value = Object.prototype.hasOwnProperty.call(node.props, key)
                ? raw
                : ps.default
              return (
                <Field
                  key={key}
                  name={key}
                  ps={ps}
                  value={value}
                  onChange={(v) => s.commit({ op: 'setProp', id: node.id, key, value: v }, `Set ${key}`)}
                  badge={supported ? undefined : s.target}
                />
              )
            })}
          </section>
        ))}

        {/*
          The atmosphere layer. Present but separate from the schema-driven
          property groups because effects are not component props: they are a
          shared vocabulary every component can opt into, so they get their own
          panel generated from `EFFECT_FIELDS` rather than being repeated per
          component definition.
        */}
        <EffectsPanel
          effects={normalizeEffects(node.effects)}
          onChange={(patch) => s.poke({ op: 'setEffects', id: node.id, patch })}
          onCommit={() => s.seal('Effects')}
        />
      </div>
    </aside>
  )
}

function supportedIn(spec: NonNullable<ReturnType<typeof getComponent>>, key: string, t: 'web' | 'desktop') {
  // Single source of truth: registry.propSupported. A hand-copied capability
  // list lived here before and was already diverging from the registry.
  return propSupported(spec, key, t)
}

interface FieldProps {
  name: string
  ps: NonNullable<ReturnType<typeof getComponent>>['props'][string]
  value: PropValue | undefined
  onChange: (v: PropValue) => void
  badge?: string
}

function Field({ name, ps, value, onChange, badge }: FieldProps) {
  return (
    <div className={`field ${badge ? 'gated' : ''}`}>
      <label>
        {ps.label ?? name}
        {ps.bindable && <span className="bind" title="Can be bound to a data source">◈</span>}
        {badge && <span className="gate-badge">{badge} only</span>}
      </label>
      {ps.type === 'boolean' && (
        <Toggle checked={value === true} onChange={(v) => onChange(v)} />
      )}
      {ps.type === 'enum' && (
        <div className="select-wrap">
          <select value={String(value ?? ps.default)} onChange={(e) => onChange(e.target.value)}>
            {(ps.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {ps.type === 'string' && (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {ps.type === 'color' && <ColorField value={String(value ?? '#ffffff')} onChange={onChange} />}
      {ps.type === 'number' && (
        <NumField
          label={ps.label ?? name}
          value={Number(value) || 0}
          min={ps.min}
          max={ps.max}
          step={ps.step ?? 1}
          onChange={onChange}
          onCommit={() => undefined}
        />
      )}
    </div>
  )
}

/**
 * Swatch + hex. A full-width native color well shows no value and reads as a
 * stock control; a design tool needs the hex visible and editable.
 */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
  return (
    <div className="color-field">
      <span className="swatch" style={{ background: hex }} aria-hidden="true">
        <input
          type="color"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          tabIndex={-1}
        />
      </span>
      <input
        type="text"
        className="hex"
        value={value}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function NumField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
  onCommit: () => void
}) {
  return (
    <div className="num">
      <span className="num-label">{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(v)
        }}
        onBlur={onCommit}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Status bar
 * ------------------------------------------------------------------ */

function StatusBar({
  s,
  previewOpen,
  onTogglePreview,
}: {
  s: EditorStore
  previewOpen: boolean
  onTogglePreview: () => void
}) {
  const total = Object.keys(s.doc.nodes).length - 1
  const last = s.history[s.history.length - 1]
  const gatedComponents = [...componentsByCategory().values()]
    .flat()
    .filter((c) => unsupportedProps(c, s.target).length > 0)
  const canUndo = s.history.length > 0
  const canRedo = s.future.length > 0

  return (
    <footer className="statusbar">
      <button
        className="hist-btn"
        disabled={!canUndo}
        onClick={() => s.undo()}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        className="hist-btn"
        disabled={!canRedo}
        onClick={() => s.redo()}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>
      <span className="sep" />
      <span>{total} element{total === 1 ? '' : 's'}</span>
      <span className="sep" />
      <span>{s.selection.length ? `${s.selection.length} selected` : 'no selection'}</span>
      <span className="sep" />
      <span className="dim">{last ? `last: ${last.label}` : 'no edits yet'}</span>
      <span className="spacer" />
      <button
        className="pv-toggle"
        onClick={onTogglePreview}
        title={previewOpen ? 'Hide the live preview' : 'Show the live preview'}
      >
        {previewOpen ? '◉' : '○'} preview
      </button>
      {gatedComponents.length > 0 && (
        <button
          className="warn-btn"
          onClick={() => s.setTarget(s.target === 'web' ? 'desktop' : 'web')}
          title={
            s.target === 'desktop'
              ? `${gatedComponents.length} components have properties the desktop target cannot represent: ${gatedComponents.map((c) => c.name).join(', ')}. Click to switch back to Web.`
              : `${gatedComponents.length} components have web-only properties: ${gatedComponents.map((c) => c.name).join(', ')}. Click to preview the desktop target.`
          }
        >
          {s.target === 'desktop' ? '◈' : '◉'} {gatedComponents.length} web-only
        </button>
      )}
    </footer>
  )
}
