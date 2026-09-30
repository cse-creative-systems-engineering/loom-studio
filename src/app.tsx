import React from 'react'
import { createPortal } from 'react-dom'
import { EditorStore, emptyDocument } from './state/store'
import type { Breakpoint, Document, InteractionState, Node, NodeId, PageBackground, PropValue } from './model/types'
import { ancestry, descendants, parentOf } from './model/ops'
import { snapMove as snapTo, artboardAnchors, type SnapBox } from './model/snap'
import {
  componentsByCategory,
  getComponent,
  propSupported,
  unsupportedProps,
  DELIMITERS,
  delimiterLabel,
  acceptsChild,
  addedTypes,
} from './model/registry'
import { tooltipText } from './model/tooltip'
import { inspectorView, propLabel } from './model/inspector-view'
import { GROUP_ORDER } from './model/prop-groups'
import { pageFill, MAX_PAGE_BLUR } from './model/page'
import { AuroraBackdrop } from './render/aurora'
import type { RunTarget } from './model/desktop-run'
import { renderNode, isFlowChild, zoomed, CORNERS, type Corner } from './render/web'
import { EffectsPanel } from './effects-inspector'
import { STARTERS, getStarter } from './model/starters'
import { starterGlyph, toolGlyph } from './tool-icons'
import { PreviewStage } from './preview'
import { ToolCard, type CardTarget } from './tool-card'
import { StatesPanel, ColorInput } from './states-inspector'
import { PartsPanel } from './parts-inspector'
import { AddsPanel, ListsPanel } from './list-inspector'
import { partStyled } from './render/parts'
import { normalizeEffects } from './render/effects'
import { Toggle, Glyph, Ico } from './ui-primitives'
import { VIEWPORTS, fitZoom, nodeBreakpoints } from './render/responsive'
import { installBehaviourStyles, installDocumentCss, CONTAINER_CLASS } from './render/behaviour-mount'
import { ContextMenu, type MenuState } from './context-menu'
import { THEME_NAMES, getTheme } from './render/theme'
// The Studio's own typeface, bundled (73KB latin, OFL). Optical sizing keeps
// 11px labels open and 14px titles tight. The TOOL only: see --font.
import '@fontsource-variable/inter/opsz.css'
import './ui.css'
import './chrome.css'

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

/**
 * Replace the document with a fresh empty workspace. Returns false when the
 * user backs out of the unsaved-changes confirmation. Shared by the New
 * button and Ctrl+N so the two can never disagree.
 */
function confirmNewWorkspace(s: EditorStore): boolean {
  if (s.dirty && !window.confirm('Start a new empty workspace? Unsaved changes will be lost.')) {
    return false
  }
  s.loadDocument(emptyDocument())
  return true
}
/**
 * Open a document, asking first when that would throw away unsaved work
 * (New always asked; Open replaced the document without a word).
 */
function openDocument(s: EditorStore): void {
  if (s.dirty && !window.confirm('Open another document? Unsaved changes will be lost.')) return
  void s.open()
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
  // The viewport the artboard is authoring at. It lives up here, not in the
  // Canvas, because the Inspector writes overrides for it: narrowing the
  // artboard and editing what that narrowing revealed are one action.
  const [viewport, setViewport] = React.useState<Breakpoint>('lg')
  // The interaction state being edited. Lifted for the same reason as the
  // viewport: editing a hover and SEEING the hover on the canvas are one action.
  const [editState, setEditState] = React.useState<InteractionState | null>(null)
  const [menu, setMenu] = React.useState<MenuState | null>(null)
  // Canvas zoom is view state, not document state: it never touches the
  // doc, the history, or the output. 1 = 100%.
  // 'fit' (the default) scales the viewport's true width into the room the
  // canvas has; a number is a zoom the designer chose.
  const [zoomPref, setZoomPref] = React.useState<number | 'fit'>('fit')
  const [room, setRoom] = React.useState(0)
  // Design or preview, IN PLACE: the canvas becomes the running artifact at
  // the same viewport and zoom, and the panels step aside. A separate window
  // made you look away from where you were working; it is still one click
  // away ("Pop out") for a second screen.
  const [mode, setMode] = React.useState<'design' | 'preview'>('design')
  const zoom = zoomPref === 'fit' ? fitZoom(room, VIEWPORTS.find((v) => v.id === viewport)?.width ?? 1280) : zoomPref
  const modeRef = React.useRef(mode)
  modeRef.current = mode

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

  // Run on desktop. While on, every change re-places and redraws the running
  // window (debounced like the preview); the window closing turns it off.
  const [running, setRunning] = React.useState(false)
  React.useEffect(() => {
    const api = (window as unknown as { loomDesktop?: DesktopRunApi }).loomDesktop
    if (!api) return
    if (!running) {
      void api.stop()
      return
    }
    const id = window.setTimeout(() => {
      const target = runTarget(s.doc)
      if (target) void api.run(s.doc, target)
    }, 60)
    return () => window.clearTimeout(id)
  }, [running, s.doc])
  React.useEffect(() => {
    const api = (window as unknown as { loomDesktop?: DesktopRunApi }).loomDesktop
    return api?.onClosed(() => setRunning(false))
  }, [])

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
          // Duplicate, as in every design tool. (It once deleted: a designer
          // reaching for "duplicate" lost what they had selected.)
          e.preventDefault()
          s.duplicateAll(s.selection)
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
          setMode((m) => (m === 'design' ? 'preview' : 'design'))
        } else if (e.key === 'r') {
          e.preventDefault()
          void s.exportReactFile()
        } else if (e.key === 'n') {
          e.preventDefault()
          confirmNewWorkspace(s)
        } else if (e.key === 'o') {
          e.preventDefault()
          openDocument(s)
        }
        return
      }

      if (typing) return

      // Previewing is using the artifact, not editing it: Esc returns to the
      // design, and no editing key reaches a document you cannot see.
      if (modeRef.current === 'preview') {
        if (e.key === 'Escape') setMode('design')
        return
      }

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
    <div className={`loom ${mode === 'preview' ? 'previewing' : ''}`}>
      <TitleBar s={s} mode={mode} onMode={setMode} previewOpen={previewOpen} onTogglePreview={togglePreview} running={running} onToggleRun={() => setRunning((r) => !r)} />
      <div className="body">
        {mode === 'design' && <Toolbox s={s} onDragChange={setDragging} zoom={zoom} />}
        <Canvas
          viewport={viewport}
          editState={editState}
          onViewport={setViewport}
          s={s}
          dragging={dragging}
          onMenu={setMenu}
          zoom={zoom}
          fit={zoomPref === 'fit'}
          onZoom={(z) => setZoomPref(z === 'fit' ? 'fit' : Math.min(2, Math.max(0.25, Math.round(z * 100) / 100)))}
          onRoom={setRoom}
          mode={mode}
          onMode={setMode}
        />
        {mode === 'design' && <Inspector s={s} viewport={viewport} editState={editState} onEditState={setEditState} />}
      </div>
      {menu && <ContextMenu s={s} state={menu} onClose={() => setMenu(null)} />}
      <Toast s={s} />
    </div>
  )
}

/**
 * The selected nodes' resize handles, in one layer over the whole design.
 *
 * They used to be drawn inside each node, where they were positioned against
 * its padding box and clipped by its own overflow: a flow child's landed on
 * whichever ancestor was positioned, a scrolling list's sat a scrollbar in, a
 * clipped card's were cut off. Here each selected node is measured and its
 * handles are placed on its border box, above everything, in design units
 * (the layer is inside the zoomed surface, like the design).
 */
function SelectionLayer({
  s,
  surface,
  zoom,
  viewport,
  onPointerDownNode,
}: {
  s: EditorStore
  surface: React.RefObject<HTMLDivElement | null>
  zoom: number
  viewport: Breakpoint
  onPointerDownNode: (id: NodeId, e: React.PointerEvent) => void
}) {
  const [boxes, setBoxes] = React.useState<Array<{ id: NodeId; x: number; y: number; w: number; h: number }>>([])
  const ids = s.selection.filter((id) => s.doc.nodes[id] && !s.doc.nodes[id].locked)
  const key = ids.join(' ')
  const measure = React.useCallback(() => {
    const host = surface.current
    if (!host) return
    const sr = host.getBoundingClientRect()
    // Rects are on screen (zoomed); the layer is in design units.
    const z = zoom || 1
    const next = key === '' ? [] : key.split(' ').flatMap((id) => {
      const el = host.querySelector<HTMLElement>(`[data-loom-id="${CSS.escape(id)}"]`)
      if (!el) return []
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) return []
      return [{ id, x: (r.left - sr.left) / z - host.clientLeft, y: (r.top - sr.top) / z - host.clientTop, w: r.width / z, h: r.height / z }]
    })
    setBoxes((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [surface, zoom, key])
  // Whatever moves a node moves its handles: an edit, a zoom, a width, a
  // font arriving, an inner scroll.
  React.useLayoutEffect(measure, [measure, s.doc, viewport])
  React.useEffect(() => {
    const host = surface.current
    if (!host) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(host)
    for (const id of key === '' ? [] : key.split(' ')) {
      const el = host.querySelector(`[data-loom-id="${CSS.escape(id)}"]`)
      if (el) ro.observe(el)
    }
    host.addEventListener('scroll', measure, true)
    return () => {
      ro.disconnect()
      host.removeEventListener('scroll', measure, true)
    }
  }, [surface, key, measure, s.doc])
  if (boxes.length === 0) return null
  return (
    <div className="sel-layer" aria-hidden="true">
      {boxes.map((b) => (
        <div key={b.id} className="sel-box" data-for={b.id} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
          {CORNERS.map((corner) => (
            <span
              key={corner}
              className="loom-handle"
              data-corner={corner}
              data-loom-handle={corner}
              onPointerDown={(e) => onPointerDownNode(b.id, e)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * The outcome of the last file action (see `EditorStore.notice`). A status
 * region, so a screen reader announces it too; errors stay until dismissed,
 * success fades on its own.
 */
function Toast({ s }: { s: EditorStore }) {
  const n = s.notice
  React.useEffect(() => {
    if (!n || n.tone === 'error') return
    const t = window.setTimeout(() => s.dismissNotice(n.id), 3200)
    return () => window.clearTimeout(t)
  }, [n, s])
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {n && (
        <div className={`toast ${n.tone}`} key={n.id}>
          <Ico name={n.tone === 'ok' ? 'check' : 'info'} size={14} />
          <span>{n.text}</span>
          <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => s.dismissNotice(n.id)}>
            <Ico name="x" size={12} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The one bar above the work. Compact on purpose: every pixel here is a pixel
 * the canvas does not get. File actions are icons (their shortcuts are in the
 * tooltips), the output actions live under one Export menu, and the mode
 * switch sits in the middle because it is the question the bar answers:
 * are you designing, or looking at what you built?
 */
function TitleBar({
  s,
  mode,
  onMode,
  previewOpen,
  onTogglePreview,
  running,
  onToggleRun,
}: {
  s: EditorStore
  mode: 'design' | 'preview'
  onMode: (m: 'design' | 'preview') => void
  previewOpen: boolean
  onTogglePreview: () => void
  running: boolean
  onToggleRun: () => void
}) {
  const [exportOpen, setExportOpen] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const exportRef = React.useRef<HTMLDivElement | null>(null)
  React.useEffect(() => {
    if (!exportOpen) return
    const close = (e: PointerEvent) => {
      if (!exportRef.current?.contains(e.target as HTMLElement | null)) setExportOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setExportOpen(false)
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [exportOpen])
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
  const last = s.history[s.history.length - 1]
  const next = s.future[s.future.length - 1]
  const gated = [...componentsByCategory().values()].flat().filter((c) => unsupportedProps(c, s.target).length > 0)
  const act = (f: () => void) => () => {
    f()
    setExportOpen(false)
  }
  return (
    <header className="titlebar">
      <div className="tb-left">
        <span className="mark" aria-hidden="true" />
        <div className="doc-name" title={s.dirty ? 'Unsaved changes' : 'Saved'}>
          <span className="doc-title">{s.doc.meta.name}</span>
          {s.dirty && <span className="dirty-dot" aria-label="Unsaved changes" />}
        </div>
        <div className="tb-group" role="group" aria-label="File">
          <button className="tb-btn" onClick={() => confirmNewWorkspace(s)} title="New empty workspace (Ctrl+N)" aria-label="New">
            <Ico name="file" />
          </button>
          <button className="tb-btn" onClick={() => openDocument(s)} title="Open a document (Ctrl+O)" aria-label="Open">
            <Ico name="folder" />
          </button>
          <button className="tb-btn" onClick={() => void s.save()} title="Save (Ctrl+S)" aria-label="Save">
            <Ico name="save" />
          </button>
        </div>
        <div className="tb-group" role="group" aria-label="History">
          <button className="tb-btn" disabled={!last} onClick={() => s.undo()} title={last ? `Undo ${last.label} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo">
            <Ico name="undo" />
          </button>
          <button className="tb-btn" disabled={!next} onClick={() => s.redo()} title={next ? `Redo ${next.label} (Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label="Redo">
            <Ico name="redo" />
          </button>
        </div>
      </div>

      <div className="tb-center">
      <div className="mode-switch pv-toggle" role="tablist" aria-label="Mode">
        {(['design', 'preview'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={mode === m ? 'on' : ''}
            onClick={() => onMode(m)}
            title={m === 'design' ? 'Edit the design (Esc)' : 'Use what you built, in place (Ctrl+P)'}
          >
            {m === 'design' ? 'Design' : 'Preview'}
          </button>
        ))}
      </div>
        {/* Run on desktop: the design as a real window, placed on the real
            screen by its dock (a sidebar docked left runs on the left). */}
        <button
          type="button"
          className={`tb-run ${running ? 'on' : ''}`}
          onClick={onToggleRun}
          disabled={s.doc.root === null}
          aria-pressed={running}
          title={running ? 'Stop running on the desktop' : 'Run on your desktop: placed where its dock says, no window around it'}
        >
          <Ico name={running ? 'x' : 'monitor'} size={13} />
          {running ? 'Stop' : 'Run'}
        </button>
      </div>

      <div className="tb-right">
        <div className="seg" role="group" aria-label="Output theme">
          {THEME_NAMES.map((n) => (
            <button
              key={n}
              className={(s.doc.meta.theme ?? 'midnight') === n ? 'on' : ''}
              onClick={() => s.setTheme(n)}
              title={`Apply the ${n} theme to the whole document`}
              aria-label={`${n} theme`}
              aria-pressed={(s.doc.meta.theme ?? 'midnight') === n}
            >
              <span className="theme-swatch" style={{ background: getTheme(n).accent }} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Export target">
          {(['web', 'desktop'] as const).map((t) => (
            <button key={t} className={s.target === t ? 'on' : ''} aria-pressed={s.target === t} onClick={() => s.setTarget(t)}>
              {t === 'web' ? 'Web' : 'Desktop'}
            </button>
          ))}
        </div>
        {gated.length > 0 && (
          <span
            className="gate-note"
            title={`${gated.length} components have properties the ${s.target === 'web' ? 'desktop' : 'web'} target cannot represent: ${gated.map((c) => c.name).join(', ')}`}
          >
            {gated.length} web-only
          </span>
        )}
        <div className="export" ref={exportRef}>
          <button className="tb-primary" aria-haspopup="menu" aria-expanded={exportOpen} onClick={() => setExportOpen((o) => !o)}>
            Export <Ico name="chevron-down" size={12} />
          </button>
          {exportOpen && (
            <div className="export-menu" role="menu">
              <button role="menuitem" onClick={act(() => void s.exportHtmlFile())}>
                HTML file <kbd>Ctrl E</kbd>
              </button>
              <button role="menuitem" onClick={act(() => void s.exportReactFile())}>
                React component <kbd>Ctrl R</kbd>
              </button>
              <button role="menuitem" onClick={act(copyHtml)}>
                {copied ? 'Copied' : 'Copy HTML'}
              </button>
              <span className="menu-rule" />
              <button role="menuitem" onClick={act(onTogglePreview)}>
                {previewOpen ? 'Close preview window' : 'Pop out preview window'}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ *
 * Toolbox
 * ------------------------------------------------------------------ */

/** Drag payloads that name a starter rather than a component. */
const STARTER_PREFIX = 'starter:'

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
  const added = addedTypes()
  const [filter, setFilter] = React.useState('')
  const [tab, setTab] = React.useState<'components' | 'layers'>('components')
  // The hover card: a moment's pause on a tool shows what it looks like.
  const [card, setCard] = React.useState<CardTarget | null>(null)
  const cardTimer = React.useRef<number | null>(null)
  const hideCard = () => {
    if (cardTimer.current !== null) window.clearTimeout(cardTimer.current)
    cardTimer.current = null
    setCard(null)
  }
  const cardOn = (tool: CardTarget['tool'], name: string, text: string) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => {
      const row = e.currentTarget.getBoundingClientRect()
      const box = e.currentTarget.closest('.toolbox')?.getBoundingClientRect()
      if (cardTimer.current !== null) window.clearTimeout(cardTimer.current)
      // Instant once a card is up (moving down the list), a pause before the first.
      const delay = card ? 0 : 280
      cardTimer.current = window.setTimeout(() => setCard({ tool, name, text, top: row.top, left: (box?.right ?? row.right) + 8 }), delay)
    },
    onPointerLeave: hideCard,
    'aria-description': text,
  })
  const draggedType = React.useRef<string | null>(null)

  const startDrag = (e: React.PointerEvent, type: string) => {
    e.preventDefault()
    draggedType.current = type
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
      // A null parent means "no root yet": the node being dropped IS the
      // root, so it is free-positioned (a flow root would ignore x/y).
      const flowParent = hit.parent !== null && s.doc.nodes[hit.parent]?.flow === true
      const { x, y } = snapTo(hit.host, ev)
      if (type.startsWith(STARTER_PREFIX)) s.addStarter(type.slice(STARTER_PREFIX.length), hit.parent, flowParent ? 0 : x, flowParent ? 0 : y)
      else s.dropComponent(type, hit.parent, x, y)
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
  const dropTarget = (x: number, y: number): { host: HTMLElement; parent: NodeId | null } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el) return null

    // The deepest container under the pointer that ACCEPTS this type: a
    // button dropped on a tab set's strip belongs in a tab, not beside it.
    const dragged = draggedType.current
    let container = el.closest('[data-loom-container="true"]') as HTMLElement | null
    while (container?.dataset.loomId) {
      const parentType = s.doc.nodes[container.dataset.loomId]?.type
      const childType = dragged && dragged.startsWith(STARTER_PREFIX) ? getStarter(dragged.slice(STARTER_PREFIX.length))?.tree.type : dragged
      if (!parentType || !childType || !getComponent(parentType)?.childTypes || acceptsChild(parentType, childType)) break
      container = container.parentElement?.closest('[data-loom-container="true"]') as HTMLElement | null
    }
    if (container?.dataset.loomId) {
      return { host: container, parent: container.dataset.loomId }
    }
    const surface = el.closest('[data-loom-surface]') as HTMLElement | null
    if (surface) {
      // `data-loom-surface="empty"` means the workspace has NO root yet, so a
      // drop here creates one: the parent is null and the new node becomes the
      // root. This is how the user brings a workspace into existence.
      const id = surface.dataset.loomSurface
      return { host: surface, parent: id && id !== 'empty' ? id : null }
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
    const name = type.startsWith(STARTER_PREFIX) ? getStarter(type.slice(STARTER_PREFIX.length))?.label ?? type : type
    g.innerHTML = `<span class="ghost-name">${name}</span>${
      at ? `<span class="ghost-coord">x ${at.x} · y ${at.y}</span>` : '<span class="ghost-coord">drop on the canvas</span>'
    }`
  }

  // Everything but the root; an empty workspace has no root and no layers.
  const elementCount = Math.max(0, Object.keys(s.doc.nodes).length - 1)

  return (
    <aside className="toolbox" onPointerLeave={hideCard}>
      {/* Portaled: a glass panel (backdrop-filter) is the containing block of
          any fixed-position child, so inside the toolbox the card was placed
          against the panel and clipped by it: present, and invisible. */}
      {card && createPortal(<ToolCard target={card} theme={s.doc.meta.theme} />, document.body)}
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
          {/* The key to the tool dots, only while some tool carries one: with
              desktop rendered by Chromium nothing does, and a key to nothing
              is noise. */}
          {[...componentsByCategory().values()].flat().some((c) => unsupportedProps(c, s.target).length > 0) && (
            <div className="legend">
              <span className="tool-gate" aria-hidden="true" />
              limited on {s.target === 'web' ? 'Desktop' : 'Web'}
            </div>
          )}
          <div className="scroll">
            {/* Starters first: a finished arrangement of real tools is the
                fastest way in, and everything it drops stays editable. */}
            {STARTERS.some((st) => st.label.toLowerCase().includes(filter.toLowerCase())) && (
              <section data-cat="Starters">
                <h3>Starters</h3>
                {STARTERS.filter((st) => st.label.toLowerCase().includes(filter.toLowerCase())).map((st) => (
                  <button
                    key={st.id}
                    className="tool"
                    {...cardOn({ starter: st.id }, st.label, st.description)}
                    onPointerDown={(e) => {
                      hideCard()
                      startDrag(e, STARTER_PREFIX + st.id)
                    }}
                  >
                    <span className="tool-icon"><Glyph markup={starterGlyph(st.id)} /></span>
                    <span className="tool-name">{st.label}</span>
                  </button>
                ))}
              </section>
            )}
            {[...cats.entries()].map(([cat, list]) => {
              // A type another component creates from its own panel (a tab, a
              // message) is not a tool: on its own it means nothing.
              const items = list.filter((c) => !added.has(c.name) && c.name.toLowerCase().includes(filter.toLowerCase()))
              if (items.length === 0) return null
              return (
                <section key={cat} data-cat={cat}>
                  <h3>{cat}</h3>
                  {items.map((c) => {
                    const gated = unsupportedProps(c, s.target)
                    return (
                      <button
                        key={c.name}
                        className="tool"
                        {...cardOn({ type: c.name }, c.name, tooltipText(c, s.target))}
                        onPointerDown={(e) => {
                          hideCard()
                          startDrag(e, c.name)
                        }}
                      >
                        <span className="tool-icon"><Glyph markup={toolGlyph(c.name, c.category)} /></span>
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
  const root = s.doc.root === null ? undefined : s.doc.nodes[s.doc.root]
  if (!root) {
    return (
      <div className="scroll layers">
        <div className="legend">0 elements · drop a component to start</div>
      </div>
    )
  }
  const count = Object.keys(s.doc.nodes).length - 1
  return (
    <div className="scroll layers">
      <div className="legend">
        {count} element{count === 1 ? '' : 's'} · top is front
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
        <span className="tool-icon"><Glyph markup={toolGlyph(node.type, spec?.category)} size={13} /></span>
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

/** Insertion indicator box in doc units, or null when it cannot compute. */
type DropSlotDisplay = {
  /**
   * Slot as a POST-REMOVAL index (what the reparent op consumes): the
   * dragged node ends up with exactly `index` siblings before it. No
   * origin adjustment needed — counting rendered kids (which exclude the
   * dragged node) already yields post-removal coordinates.
   */
  index: number
  x: number
  y: number
  w: number
  h: number
  horizontal: boolean
} | null

/**
 * Compute the reorder drop slot for a flow child from the RENDERED siblings.
 *
 * The axis is measured, not assumed: whichever axis the sibling centers
 * spread along most is the ordering axis (a column of stretched children
 * spreads vertically; a single row spreads horizontally). That keeps this
 * free of schema knowledge — Grid, row Panels, and columns all work.
 * Coordinates come back in doc units for indicator placement; screen pixels
 * are only ever compared against screen pixels.
 */
function dropSlot(
  doc: Document,
  parent: NodeId,
  exclude: NodeId,
  clientX: number,
  clientY: number,
  zoom: number,
): DropSlotDisplay {
  const parentEl = document.querySelector(`[data-loom-id="${parent}"]`)
  const surfaceEl = document.querySelector('[data-loom-surface]')
  if (!(parentEl instanceof HTMLElement) || !(surfaceEl instanceof HTMLElement)) return null
  const kids = Array.from(parentEl.querySelectorAll(':scope > [data-loom-id]'))
    .map((el) => ({
      id: (el as HTMLElement).dataset.loomId ?? '',
      rect: el.getBoundingClientRect(),
    }))
    .filter((k) => k.id !== '' && k.id !== exclude && doc.nodes[k.id])
  if (kids.length === 0) return null
  const cxs = kids.map((k) => k.rect.left + k.rect.width / 2)
  const cys = kids.map((k) => k.rect.top + k.rect.height / 2)
  const horizontal = Math.max(...cxs) - Math.min(...cxs) > Math.max(...cys) - Math.min(...cys)
  const centers = horizontal ? cxs : cys
  const point = horizontal ? clientX : clientY
  let index = 0
  while (index < centers.length && point >= centers[index]) index += 1

  const sr = surfaceEl.getBoundingClientRect()
  const pr = parentEl.getBoundingClientRect()
  const px = zoomed(pr.left - sr.left, zoom)
  const py = zoomed(pr.top - sr.top, zoom)
  const pw = zoomed(pr.width, zoom)
  const ph = zoomed(pr.height, zoom)
  if (horizontal) {
    const edges = kids.map((k) => k.rect.left)
    const ends = kids.map((k) => k.rect.right)
    const x =
      index === 0
        ? zoomed(edges[0] - sr.left, zoom)
        : index >= kids.length
          ? zoomed(ends[kids.length - 1] - sr.left, zoom)
          : zoomed((ends[index - 1] + edges[index]) / 2 - sr.left, zoom)
    return { index, x, y: py, w: 0, h: ph, horizontal }
  }
  const tops = kids.map((k) => k.rect.top)
  const bottoms = kids.map((k) => k.rect.bottom)
  const y =
    index === 0
      ? zoomed(tops[0] - sr.top, zoom)
      : index >= kids.length
        ? zoomed(bottoms[kids.length - 1] - sr.top, zoom)
        : zoomed((bottoms[index - 1] + tops[index]) / 2 - sr.top, zoom)
  return { index, x: px, y, w: pw, h: 0, horizontal }
}

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
  fit,
  onZoom,
  onRoom,
  viewport,
  onViewport,
  editState,
  mode,
  onMode,
}: {
  s: EditorStore
  editState: InteractionState | null
  dragging: string | null
  onMenu: (m: MenuState | null) => void
  zoom: number
  fit: boolean
  onZoom: (z: number | 'fit') => void
  /** The width the canvas has for the viewport, for the Fit zoom. */
  onRoom: (px: number) => void
  viewport: Breakpoint
  onViewport: (b: Breakpoint) => void
  mode: 'design' | 'preview'
  onMode: (m: 'design' | 'preview') => void
}) {
  const dragRef = React.useRef<DragState | null>(null)
  const [rulers, setRulers] = React.useState(false)
  // Authoring happens at Desktop by default (the canvas you can see is the
  // widest case) and narrows on demand, which is the only honest direction for
  // a tool whose base layout IS the desktop layout.
  const viewportWidth = VIEWPORTS.find((v) => v.id === viewport)?.width ?? 1280
  const viewportHeight = VIEWPORTS.find((v) => v.id === viewport)?.height ?? 800
  // Snap guides (doc-unit coordinates) + live drag readout, both transient.
  const [guides, setGuides] = React.useState<{ x: number | null; y: number | null }>({ x: null, y: null })
  const [readout, setReadout] = React.useState<{ x: number; y: number; cx: number; cy: number } | null>(null)
  // Reorder insertion indicator (doc-unit box), transient like the guides.
  const [slot, setSlot] = React.useState<DropSlotDisplay>(null)

  // The layout rules are generated from the document, so they have to be
  // re-derived whenever it changes.
  React.useEffect(() => {
    installDocumentCss(s.doc)
  }, [s.doc])
  // The canvas draws the OUTPUT, so it needs the output's state stylesheet
  // (switch tracks, ticks, which tab panel shows) from the first frame. It
  // used to arrive only when the docked preview first opened, so the same
  // design looked different before and after one visit to Preview. Styles
  // only: the canvas is edited, not operated, so the runtime stays out.
  React.useEffect(() => {
    installBehaviourStyles()
  }, [])

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
    if (!free) {
      // Flow children carry no meaningful x/y, so dragging reorders them
      // among their siblings instead of refusing the gesture.
      startReorder(e, target)
      return
    }

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
      // Show where a release would put it: the container it would join.
      markDropHost(ev.shiftKey ? null : hostUnder(ev.clientX, ev.clientY, d.id))
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const d = dragRef.current
      dragRef.current = null
      setGuides({ x: null, y: null })
      setReadout(null)
      markDropHost(null)
      if (!d?.moved) return
      // Released over a container: it goes IN, keeping its place on screen.
      // Holding Shift keeps it where it was in the tree, floating above.
      const host = ev.shiftKey ? null : hostUnder(ev.clientX, ev.clientY, d.id)
      if (host && host !== parentOf(s.doc, d.id)) {
        const was = document.querySelector<HTMLElement>(`.surface [data-loom-id="${d.id}"]`)?.getBoundingClientRect()
        const into = moveInto(d.id, host)
        // Measure where it actually landed and take out any difference (a
        // fieldset's legend, a header, a border the estimate cannot know),
        // then seal: the whole drag is still one undo step.
        requestAnimationFrame(() => {
          const now = document.querySelector<HTMLElement>(`.surface [data-loom-id="${d.id}"]`)?.getBoundingClientRect()
          const n = s.doc.nodes[d.id]
          if (into && was && now && n && s.doc.nodes[host]?.flow !== true) {
            const dx = Math.round(zoomed(was.left - now.left, zoom))
            const dy = Math.round(zoomed(was.top - now.top, zoom))
            if (dx !== 0 || dy !== 0) s.poke({ op: 'move', id: d.id, x: (Number(n.props.x) || 0) + dx, y: (Number(n.props.y) || 0) + dy })
          }
          s.seal(into ? `Move into ${s.doc.nodes[host]?.type ?? 'container'}` : 'Move')
        })
        return
      }
      s.seal('Move')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  /**
   * The container a dragged node would join if released here: the deepest
   * one under the pointer that is not the node itself or inside it, and that
   * accepts it (a Tabs only takes tabs). Null over empty canvas.
   */
  const hostUnder = (x: number, y: number, dragged: NodeId): NodeId | null => {
    const node = s.doc.nodes[dragged]
    if (!node) return null
    const own = new Set([dragged, ...descendants(s.doc, dragged)])
    const draggedEl = document.querySelector(`.surface [data-loom-id="${dragged}"]`)
    for (const el of document.elementsFromPoint(x, y)) {
      // The node itself is under the pointer; look through it. (Its DOM
      // ancestors are its CURRENT parents, wherever the pointer now is.)
      if (draggedEl?.contains(el)) continue
      const c = (el as HTMLElement).closest?.('.surface [data-loom-container="true"]') as HTMLElement | null
      const id = c?.dataset.loomId
      if (!id || own.has(id)) continue
      const host = s.doc.nodes[id]
      if (!host) continue
      if (getComponent(host.type)?.childTypes && !acceptsChild(host.type, node.type)) {
        // A tab set takes tabs, not buttons: a button dropped on it belongs in
        // the tab you are looking at (the first shown section that takes it).
        const shown = host.children.find((cid) => {
          const kid = s.doc.nodes[cid]
          const kel = document.querySelector<HTMLElement>(`.surface [data-loom-id="${cid}"]`)
          return !!kid && !own.has(cid) && getComponent(kid.type)?.container === true && acceptsChild(kid.type, node.type) && !!kel && kel.getClientRects().length > 0
        })
        if (shown) return shown
        continue
      }
      return id
    }
    return null
  }

  /** Mark the would-be container on the canvas (editor chrome, never output). */
  const markDropHost = (id: NodeId | null) => {
    for (const el of document.querySelectorAll('[data-drop-host]')) el.removeAttribute('data-drop-host')
    if (id) document.querySelector(`.surface [data-loom-id="${id}"]`)?.setAttribute('data-drop-host', 'true')
  }

  /**
   * Re-parent a free node into `host` without it jumping: its new x/y are
   * where it already is, measured from the host's inner edge. In a flow host
   * it joins the end of the flow. Poked, so the caller seals ONE undo step
   * for the whole drag.
   */
  const moveInto = (id: NodeId, host: NodeId): boolean => {
    const el = document.querySelector<HTMLElement>(`.surface [data-loom-id="${id}"]`)
    const hostEl = document.querySelector<HTMLElement>(`.surface [data-loom-id="${host}"]`)
    const before = parentOf(s.doc, id)
    if (!el || !hostEl) return false
    const r = el.getBoundingClientRect()
    const hr = hostEl.getBoundingClientRect()
    s.poke({ op: 'reparent', id, parent: host, index: s.doc.nodes[host]?.children.length ?? 0 })
    if (parentOf(s.doc, id) === before) return false
    if (s.doc.nodes[host]?.flow !== true) {
      s.poke({
        op: 'move',
        id,
        x: Math.round(zoomed(r.left - hr.left, zoom) - hostEl.clientLeft),
        y: Math.round(zoomed(r.top - hr.top, zoom) - hostEl.clientTop),
      })
    }
    return true
  }

  /** Corner-handle resize. Same transient contract as move: poke, then seal. */
  const startResize = (e: React.PointerEvent, id: NodeId, corner: Corner) => {
    e.stopPropagation()
    if (s.doc.nodes[id]?.locked) return
    // The node's own box (the handle is in the selection layer, not in it).
    // An Alt-drag copy is not drawn yet: its source has the same size.
    const byId = (n: string) => surfaceRef.current?.querySelector<HTMLElement>(`[data-loom-id="${CSS.escape(n)}"]`)
    const el = byId(id) ?? byId((e.target as HTMLElement).closest('.sel-box')?.getAttribute('data-for') ?? '')
    if (!el) return
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

  /**
   * Reorder drag for flow children. A flow child has no meaningful x/y, so
   * the gesture reorders it among its siblings instead of moving it. Nothing
   * is poked during the gesture: the drop slot is computed live from the
   * rendered siblings, and the document changes exactly once on release
   * (one undoable `reparent`), or not at all when the slot is unchanged —
   * never a phantom entry.
   */
  const startReorder = (e: React.PointerEvent, id: NodeId) => {
    e.stopPropagation()
    const parent = parentOf(s.doc, id)
    if (!parent) return
    const siblings = s.doc.nodes[parent]?.children ?? []
    if (siblings.length < 2) return
    const origin = siblings.indexOf(id)
    if (origin < 0) return

    const onMove = (ev: PointerEvent) => {
      setSlot(dropSlot(s.doc, parent, id, ev.clientX, ev.clientY, zoom))
    }
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      const slot = dropSlot(s.doc, parent, id, ev.clientX, ev.clientY, zoom)
      setSlot(null)
      if (!slot) return
      if (slot.index !== origin) {
        s.commit({ op: 'reparent', id, parent, index: slot.index }, 'Reorder')
      }
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const selected = new Set(s.selection)

  // The room the viewport has: the canvas minus its gutters (and the rulers'
  // strip), re-measured whenever the window or the panels change.
  const wrapRef = React.useRef<HTMLElement | null>(null)
  const gutter = mode === 'preview' ? 42 : 58 + (rulers ? 22 : 0)
  React.useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => onRoom(el.clientWidth - gutter)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [gutter, onRoom])

  // Design and Preview draw the same screen: the viewport's height, or as
  // far down as the root reaches if that is further (the root is positioned
  // absolutely, so it cannot stretch the screen by itself). Measured on
  // whichever surface is showing.
  const surfaceRef = React.useRef<HTMLDivElement | null>(null)
  const stageRef = React.useRef<HTMLDivElement | null>(null)
  const [reach, setReach] = React.useState(0)
  React.useLayoutEffect(() => {
    const el =
      mode === 'preview'
        ? stageRef.current?.querySelector<HTMLElement>('.preview-stage > *')
        : surfaceRef.current?.querySelector<HTMLElement>(':scope > [data-loom-id]')
    const next = el ? el.offsetTop + el.offsetHeight : 0
    if (next !== reach) setReach(next)
  })
  const screenHeight = Math.max(viewportHeight, reach)
  // What is behind the UI (Page, in the inspector with nothing selected).
  const fill = pageFill(s.doc.meta.page, getTheme(s.doc.meta.theme).bg)
  const blur = s.doc.meta.page?.blur ?? 0
  const aurora = s.doc.meta.page?.background === 'aurora'

  return (
    <main className="canvas-wrap" ref={wrapRef}>
      {mode === 'preview' && (
        <div className="canvas previewing">
          {/* The artifact, running: same viewport, same zoom, real behaviour. */}
          {/* It is a SCREEN: the page's own background, edge to edge at the
              viewport's width, so where the artifact sits on it is visible. */}
          {/* The page is drawn only if the document has one: with no
              background the UI stands alone, no screen, no frame, no grid. */}
          <div
            className={`stage ${CONTAINER_CLASS} ${fill === undefined ? 'bare' : ''}`}
            ref={stageRef}
            data-page={s.doc.meta.page?.background ?? 'none'}
            style={{
              zoom,
              width: viewportWidth,
              height: screenHeight,
              ['--screen-h' as string]: `${screenHeight}px`,
              background: fill,
              backdropFilter: blur ? `blur(${blur}px)` : undefined,
              color: getTheme(s.doc.meta.theme).textPrimary,
              fontFamily: getTheme(s.doc.meta.theme).fontFamily,
              isolation: 'isolate',
            }}
            data-viewport={viewport}
          >
            <PreviewStage s={s} />
            {aurora && <AuroraBackdrop theme={getTheme(s.doc.meta.theme)} />}
          </div>
        </div>
      )}
      <div className={`canvas ${rulers ? 'rulers' : ''} ${dragging ? 'drop-active' : ''}`} hidden={mode === 'preview'}>
        {/* The frame's name above it, as in any design tool: which screen this
            is and how wide, at a glance. */}
        <div className="frame">
        <div className="frame-label" aria-hidden="true">
          <strong>{VIEWPORTS.find((v) => v.id === viewport)?.label ?? 'Desktop'}</strong>
          <span>{viewportWidth}</span>
        </div>
        <div
          className={`surface ${CONTAINER_CLASS}`}
          data-loom-surface={s.doc.root ?? 'empty'}
          data-zoom={Math.round(zoom * 100)}
          data-viewport={viewport}
          onPointerDown={() => s.select([])}
          // The design's type, not the Studio's: what the export's body sets.
          // Exactly the viewport's width, never squeezed to the canvas: the
          // zoom fits it instead, so positions match the preview.
          ref={surfaceRef}
          style={{ zoom, ['--loom-zoom' as string]: zoom, width: viewportWidth, height: screenHeight, fontFamily: getTheme(s.doc.meta.theme).fontFamily, isolation: 'isolate', ...(fill ? { backgroundColor: fill } : {}) }}
        >
          {s.doc.root !== null && (
            renderNode(
              {
                doc: s.doc,
                onPointerDownNode,
                onContextMenuNode,
                selected,
                forceState:
                  editState && s.selection.length === 1 ? { id: s.selection[0], state: editState } : undefined,
              },
              s.doc.root,
            )
          )}
          <SelectionLayer s={s} surface={surfaceRef} zoom={zoom} viewport={viewport} onPointerDownNode={onPointerDownNode} />
          {s.doc.root === null && (
            <div className="empty-hint">
              {/* A card, not a caption: the first thing a new document shows.
                  The workspace stays genuinely empty; a starter is placed only
                  when the person asks for one. */}
              <div className="empty-card">
                <span className="mark empty-mark" aria-hidden="true" />
                <div className="empty-hint-title">Start with a blank canvas</div>
                <div className="empty-hint-body">
                  Drag any tool from the left onto the canvas. The first one becomes the root of this
                  document.
                </div>
                <div className="empty-starts">
                  {STARTERS.map((st) => (
                    <button
                      key={st.id}
                      type="button"
                      className="empty-start"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => s.addStarter(st.id, null, 0, 0)}
                    >
                      <Glyph markup={starterGlyph(st.id)} /> Start from {st.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {aurora && <AuroraBackdrop theme={getTheme(s.doc.meta.theme)} />}
          {guides.x !== null && <div className="snap-guide-v" style={{ left: guides.x }} aria-hidden="true" />}
          {guides.y !== null && <div className="snap-guide-h" style={{ top: guides.y }} aria-hidden="true" />}
          {slot &&
            (slot.horizontal ? (
              <div className="snap-guide-v" style={{ left: slot.x, top: slot.y, height: slot.h }} aria-hidden="true" />
            ) : (
              <div className="snap-guide-h" style={{ top: slot.y, left: slot.x, width: slot.w }} aria-hidden="true" />
            ))}
        </div>
        </div>
      </div>
      {readout && (
        <div className="drag-readout" style={{ left: readout.cx + 14, top: readout.cy + 16 }} aria-hidden="true">
          x {readout.x} · y {readout.y}
        </div>
      )}
      {/* The dock: what you look AT the canvas through (width, zoom, rulers),
          floating over it instead of taking a row away from it. */}
      <div className="dock" role="toolbar" aria-label="View">
        <div className="dock-group" role="group" aria-label="Viewport">
          {VIEWPORTS.map((v) => (
            <button
              key={v.id}
              className={viewport === v.id ? 'on' : ''}
              onClick={() => onViewport(v.id)}
              title={`${v.label} · ${v.width}px`}
              aria-label={v.label}
              aria-pressed={viewport === v.id}
            >
              <Ico name={v.id === 'sm' ? 'smartphone' : v.id === 'md' ? 'tablet' : 'monitor'} />
            </button>
          ))}
        </div>
        <span className="dock-rule" />
        <div className="dock-group" role="group" aria-label="Zoom">
          <button onClick={() => onZoom(zoom / 1.25)} title="Zoom out" aria-label="Zoom out">
            <Ico name="minus" size={12} />
          </button>
          <button
            className={`dock-zoom ${fit ? 'fit' : ''}`}
            onClick={() => onZoom(fit ? 1 : 'fit')}
            title={fit ? 'Fitting the whole viewport. Click for 100%' : 'Fit the whole viewport'}
            aria-label={`Zoom ${Math.round(zoom * 100)} percent${fit ? ', fitted' : ''}`}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => onZoom(zoom * 1.25)} title="Zoom in" aria-label="Zoom in">
            <Ico name="plus" size={12} />
          </button>
        </div>
        {mode === 'design' ? (
          <>
            <span className="dock-rule" />
            <button className={rulers ? 'on' : ''} onClick={() => setRulers((r) => !r)} title="Rulers and grid" aria-label="Rulers" aria-pressed={rulers}>
              <Ico name="ruler" />
            </button>
          </>
        ) : (
          <>
            <span className="dock-rule" />
            <button className="dock-text" onClick={() => onMode('design')} title="Back to the design (Esc)">
              Done
            </button>
          </>
        )}
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ *
 * Inspector — generated from the component schema
 * ------------------------------------------------------------------ */

/** Per-viewer preference; storage can be unavailable, and the panel must still work. */
const ADVANCED_KEY = 'loom.inspector.showAdvanced'

function readShowAdvanced(): boolean {
  try {
    return window.localStorage.getItem(ADVANCED_KEY) === '1'
  } catch {
    return false
  }
}

function Inspector({
  s,
  viewport,
  editState,
  onEditState,
}: {
  s: EditorStore
  viewport: Breakpoint
  editState: InteractionState | null
  onEditState: (state: InteractionState | null) => void
}) {
  // Hooks sit above the early returns: the panel keeps its search and toggle
  // across selections, which is what a person scanning several nodes wants.
  const [query, setQuery] = React.useState('')
  const [showAdvanced, setShowAdvancedState] = React.useState(readShowAdvanced)
  const setShowAdvanced = (on: boolean) => {
    setShowAdvancedState(on)
    try {
      window.localStorage.setItem(ADVANCED_KEY, on ? '1' : '0')
    } catch {
      // Not persisted; the toggle still works for this session.
    }
  }
  const id = s.selection[0]
  const node = id ? s.doc.nodes[id] : undefined
  // Narrowing the artboard and editing what it revealed are the same action, so
  // the Position fields write to the ACTIVE breakpoint's overrides. At Desktop
  // they write the base every other breakpoint inherits from.
  const bp = viewport
  const narrow = bp !== 'lg'
  const over = node?.responsive?.[bp] ?? {}
  const label = VIEWPORTS.find((v) => v.id === bp)?.label ?? bp

  if (!node) {
    return (
      <aside className="inspector">
        <div className="insp-scroll">
          <PagePanel s={s} />
          <div className="empty compact">
            <p>Nothing selected</p>
            <p className="dim">Drag a component onto the canvas, or click one to edit its properties.</p>
          </div>
        </div>
      </aside>
    )
  }

  const spec = getComponent(node.type)
  if (!spec) return <aside className="inspector" />

  const view = inspectorView(spec, node.props, { query, showAdvanced })
  const fieldFor = (row: (typeof view.groups)[number]['rows'][number]) => (
    <Field
      key={row.key}
      name={row.key}
      ps={row.spec}
      value={row.value}
      modified={row.modified}
      onChange={(v) => s.commit({ op: 'setProp', id: node.id, key: row.key, value: v }, `Set ${row.key}`)}
      onReset={() => s.commit({ op: 'setProp', id: node.id, key: row.key, value: row.spec.default }, `Reset ${row.key}`)}
      badge={supportedIn(spec, row.key, s.target) ? undefined : s.target}
      refs={row.spec.type === 'node' ? nodeRefs(s.doc, row.spec.accepts) : undefined}
    />
  )
  const flowRow = spec.container ? (
    <div className="field" key="flow">
      <label title="Off: children position freely. On: this container arranges them in order.">Flow layout</label>
      <Toggle label="Flow layout" checked={node.flow} onChange={(v) => s.commit({ op: 'setFlow', id: node.id, flow: v }, v ? 'Flow on' : 'Flow off')} />
    </div>
  ) : null
  // A free node's Position section holds its rotate/sticky rows too, so there
  // is one "Position", not a picker section and a property group of that name.
  const free = !isFlowChild(s.doc, node.id)
  const positionGroup = view.groups.find((g) => g.name === 'Position')
  const positionRows = free && positionGroup ? positionGroup.rows.map(fieldFor) : null
  const hasLayout = view.groups.some((g) => g.name === 'Layout')
  const shownGroups = [
    ...view.groups.filter((g) => !(free && g.name === 'Position')),
    // A container always has its Flow switch, even when every other layout
    // property is behind "more properties" (and not while searching for
    // something else).
    ...(spec.container && !hasLayout && query.trim() === '' ? [{ name: 'Layout', rows: [] }] : []),
  ].sort((a, b) => GROUP_ORDER.indexOf(a.name as never) - GROUP_ORDER.indexOf(b.name as never))

  const chain = ancestry(s.doc, node.id)
  const parent = parentOf(s.doc, node.id)

  return (
    <aside className="inspector">
      <div className="insp-head">
        <span className="insp-icon"><Glyph markup={toolGlyph(spec.name, spec.category)} size={16} /></span>
        <div>
          <div className="insp-name">{spec.name}</div>
          <div className="insp-path">
            {chain.length > 1 ? `${chain.length} deep` : 'root'}
            {parent ? ` · parent ${s.doc.nodes[parent]?.type ?? '?'}` : ''}
          </div>
        </div>
      </div>

      <div className="insp-scroll">
        <section>
          <h3>Display</h3>
          <div className="field">
            <label>Opacity</label>
            <div className="range-row">
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round((node.opacity ?? 1) * 100)}
              onChange={(e) => {
                const v = Number(e.target.value)
                if (Number.isFinite(v)) s.poke({ op: 'setOpacity', id: node.id, opacity: v / 100 })
              }}
              onBlur={() => s.seal('Opacity')}
              onMouseUp={() => s.seal('Opacity')}
              aria-label="Opacity percent"
            />
            <span className="range-value">{Math.round((node.opacity ?? 1) * 100)}%</span>
            </div>
          </div>
          <div className="field">
            <label title="Visible in output">Visible</label>
            <Toggle
              label="Visible"
              checked={node.visible !== false}
              onChange={(v) => s.commit({ op: 'setVisible', id: node.id, visible: v }, v ? 'Show' : 'Hide')}
            />
          </div>
          <div className="field">
            <label title="Locked: no drag, resize, or delete">Locked</label>
            <Toggle
              label="Locked"
              checked={node.locked === true}
              onChange={(v) => s.commit({ op: 'setLocked', id: node.id, locked: v }, v ? 'Lock' : 'Unlock')}
            />
          </div>
        </section>
        {!isFlowChild(s.doc, node.id) && (
          <PositionSection s={s} node={node} viewport={viewport} narrow={narrow} label={label} over={over}>
            {positionRows}
          </PositionSection>
        )}

        {/* What this node does at other widths, and how to get rid of it. */}
        {nodeBreakpoints(node).length > 0 && (
          <section>
            <h3>Responsive</h3>
            {nodeBreakpoints(node).map((b) => {
              const keys = Object.keys(node.responsive?.[b] ?? {})
              const bLabel = VIEWPORTS.find((v) => v.id === b)?.label ?? b
              return (
                <div key={b} className="row between">
                  <span className="dim">
                    {bLabel}: {keys.join(', ')}
                    {b === viewport ? ' · editing' : ''}
                  </span>
                  <button
                    className="mini"
                    onClick={() =>
                      s.commit(
                        { op: 'setResponsive', id: node.id, breakpoint: b, patch: Object.fromEntries(keys.map((k) => [k, null])) },
                        `Reset ${bLabel}`,
                      )
                    }
                    title={`Drop every ${bLabel} override and fall back to the base layout`}
                  >
                    Reset
                  </button>
                </div>
              )
            })}
          </section>
        )}

        {/* What the component is made of comes first: its tabs, its events. */}
        <AddsPanel s={s} node={node} />
        <ListsPanel
          s={s}
          node={node}
          renderField={(key, ps, value, onChange) => <Field name={key} ps={ps} value={value} onChange={onChange} />}
        />

        <StatesPanel s={s} node={node} editing={editState} onEditing={onEditState} />

        <div className="props-bar">
          <input
            type="search"
            className="props-search"
            placeholder="Search properties"
            aria-label="Search properties"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
            }}
          />
          <button
            type="button"
            className={`props-more ${showAdvanced ? 'on' : ''}`}
            aria-pressed={showAdvanced}
            onClick={() => setShowAdvanced(!showAdvanced)}
            title={showAdvanced ? 'Show only the essentials' : 'Show spacing, surface and type for this component'}
          >
            {showAdvanced
              ? 'Show essentials only'
              : view.hiddenAdvanced > 0
                ? `Show ${view.hiddenAdvanced} more ${view.hiddenAdvanced === 1 ? 'property' : 'properties'}`
                : 'Show all properties'}
          </button>
        </div>

        {view.groups.length === 0 && query.trim() !== '' && (
          <p className="props-empty">No properties match “{query.trim()}”.</p>
        )}

        {shownGroups.map((group) => (
          <section key={group.name}>
            <h3>{group.name}</h3>
            {/* Flow is how a container arranges its children: the first
                question of Layout, not a section of its own. */}
            {group.name === 'Layout' && flowRow}
            {group.rows.map(fieldFor)}
          </section>
        ))}

        {/* Inner parts are styling, so they sit behind "more properties" with
            the rest of it; a styled part is never hidden. */}
        {spec.parts && (showAdvanced || Object.keys(spec.parts).some((n) => partStyled(node, n))) && (
          <PartsPanel s={s} node={node} parts={spec.parts} />
        )}

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

/**
 * The nodes a reference property may point at, labelled the way the Layers
 * panel labels them, numbered when two would read the same.
 */
function nodeRefs(doc: EditorStore['doc'], accepts: string[] | undefined): Array<{ id: NodeId; label: string }> {
  const out: Array<{ id: NodeId; label: string }> = []
  const seen = new Map<string, number>()
  for (const n of Object.values(doc.nodes)) {
    if (accepts && !accepts.includes(n.type)) continue
    const base = [n.type, layerDetail(n) || (typeof n.props.ariaLabel === 'string' ? n.props.ariaLabel : '')].filter(Boolean).join(' · ')
    const k = (seen.get(base) ?? 0) + 1
    seen.set(base, k)
    out.push({ id: n.id, label: k > 1 ? `${base} (${k})` : base })
  }
  return out
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
  /** The value differs from the schema default; shows a marker and a reset. */
  modified?: boolean
  onReset?: () => void
  /** For a `node` property: the nodes it may point at. */
  refs?: Array<{ id: NodeId; label: string }>
}

function Field({ name, ps, value, onChange, badge, modified, onReset, refs }: FieldProps) {
  const label = propLabel(name, ps)
  // -1 is the shared vocabulary's "the designer did not set this". Showing it
  // as a number reads as a real value of minus one, so it shows as empty.
  const unset = ps.type === 'number' && ps.default === -1
  return (
    <div className={`field ${badge ? 'gated' : ''} ${modified ? 'modified' : ''}`}>
      {/* The reset button sits OUTSIDE the label: a button is a labelable
          element, so inside a <label> a click on the label text would reset. */}
      <div className="field-head">
        <label title={name}>
          {modified && <span className="mod-dot" aria-label="Changed from default" title="Changed from default" />}
          {label}
          {ps.bindable && <span className="bind" title="Can be bound to a data source">◈</span>}
          {badge && <span className="gate-badge" title={`${badge} only`}>{badge} only</span>}
        </label>
        {modified && onReset && (
          <button
            type="button"
            className="prop-reset"
            onClick={onReset}
            aria-label={`Reset ${label} to default`}
            title="Reset to default"
          >
            ↺
          </button>
        )}
      </div>
      {ps.type === 'boolean' && (
        <Toggle label={label} checked={value === true} onChange={(v) => onChange(v)} />
      )}
      {ps.type === 'enum' && (
        <div className="select-wrap">
          <select aria-label={label} value={String(value ?? ps.default)} onChange={(e) => onChange(e.target.value)}>
            {(ps.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {ps.type === 'delimiter' && (
        <div className="select-wrap">
          <select aria-label={label} value={String(value ?? ps.default)} onChange={(e) => onChange(e.target.value)}>
            {Object.keys(DELIMITERS).map((d) => (
              <option key={d} value={d}>
                {delimiterLabel(d)}
              </option>
            ))}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {ps.type === 'string' && (
        <input
          type="text"
          aria-label={label}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {ps.type === 'color' && <ColorField label={label} value={String(value ?? '')} onChange={onChange} />}
      {ps.type === 'node' && (
        <div className="select-wrap">
          <select aria-label={label} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
            <option value="">nothing</option>
            {(refs ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
            {/* A reference to a node that is gone stays visible as exactly that. */}
            {typeof value === 'string' && value !== '' && !(refs ?? []).some((r) => r.id === value) && (
              <option value={value}>missing node</option>
            )}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {ps.type === 'number' && (
        <NumField
          ariaLabel={label}
          value={Number(value) || 0}
          min={ps.min}
          max={ps.max}
          step={ps.step ?? 1}
          unset={unset}
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
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
  // An empty colour means "the component's own colour", not white; the swatch
  // must not claim a colour that will not render.
  const none = value === ''
  return (
    <div className="color-field">
      <span className={`swatch ${none ? 'none' : ''}`} style={none ? undefined : { background: hex }} aria-hidden="true">
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
        aria-label={`${label} (hex)`}
        value={value}
        placeholder="default"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

interface DesktopRunApi {
  run: (doc: unknown, target: RunTarget) => Promise<unknown>
  stop: () => Promise<boolean>
  onClosed: (cb: () => void) => () => void
}

/**
 * What the running window needs to know about the top-level node: its dock,
 * its drawn size (measured on the canvas, in design pixels; the props when
 * the canvas is not showing it) and its own position.
 */
function runTarget(doc: Document): RunTarget | null {
  const root = doc.root ? doc.nodes[doc.root] : undefined
  if (!root) return null
  const el = document.querySelector<HTMLElement>(`.surface [data-loom-id="${root.id}"]`)
  const surf = document.querySelector<HTMLElement>('.surface')
  const z = surf ? Number(surf.dataset.zoom) / 100 || 1 : 1
  const r = el?.getBoundingClientRect()
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d)
  const w = r && r.width > 0 ? r.width / z : num(root.props.w, num(root.props.width, 360))
  const h = r && r.height > 0 ? r.height / z : num(root.props.h, 400)
  return { anchor: String(root.props.anchor ?? 'none'), w, h, x: Number(root.props.x) || 0, y: Number(root.props.y) || 0 }
}

/**
 * What is behind the UI. Nothing, unless the designer picks something: a
 * sidebar meant to float over a desktop has to be seen floating. A colour
 * can be see-through, and blur softens whatever shows through it.
 */
function PagePanel({ s }: { s: EditorStore }) {
  const page = s.doc.meta.page
  const mode = page?.background ?? 'none'
  const { hex, alpha } = splitColour(page?.color ?? '#101218')
  const set = (next: PageBackground | null, label: string) => s.commit({ op: 'setPage', page: next }, label)
  const blurNative = !/Linux/i.test(navigator.userAgent)
  return (
    <section className="page-panel">
      <h3>Page</h3>
      <div className="field stack">
        <label title="What is drawn behind the UI">Background</label>
        <div className="seg page-seg" role="group" aria-label="Page background">
          {(['none', 'theme', 'aurora', 'color'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={mode === m ? 'on' : ''}
              aria-pressed={mode === m}
              onClick={() =>
                set(m === 'none' ? (page?.blur ? { background: 'none', blur: page.blur } : null) : { background: m, color: m === 'color' ? joinColour(hex, alpha) : page?.color, blur: page?.blur }, `Page: ${m}`)
              }
            >
              {m === 'none' ? 'None' : m === 'theme' ? 'Theme' : m === 'aurora' ? 'Aurora' : 'Colour'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'color' && (
        <>
          <div className="field">
            <label>Colour</label>
            <ColorInput value={hex} label="Page colour" onChange={(v) => typeof v === 'string' && set({ ...page!, color: joinColour(v, alpha) }, 'Page colour')} />
          </div>
          <SlideField label="α" value={Math.round(alpha * 100)} max={100} onChange={(v) => s.poke({ op: 'setPage', page: { ...page!, color: joinColour(hex, v / 100) } })} onCommit={() => s.seal('Page opacity')} />
        </>
      )}
      {mode !== 'none' && (
        <SlideField
          label="⌾"
          value={page?.blur ?? 0}
          max={MAX_PAGE_BLUR}
          onChange={(v) => s.poke({ op: 'setPage', page: { ...page!, blur: v } })}
          onCommit={() => s.seal('Page blur')}
        />
      )}
      <p className="dock-note">
        {mode === 'none'
          ? 'No background: the UI is drawn on whatever is behind it. Pop out the preview (Export menu) to see it float on your desktop.'
          : mode === 'color' && alpha < 1
            ? blurNative
              ? 'See-through. Blur softens what shows behind it, including your desktop in the popped-out preview.'
              : 'See-through. Your desktop shows behind it in the popped-out preview; blurring the desktop needs Windows or macOS.'
            : mode === 'aurora'
              ? "The theme's colours drift slowly behind the UI. Glass surfaces show them through. Still for anyone who asks their system for less motion."
              : 'Painted behind the whole UI, in exports too.'}
      </p>
    </section>
  )
}

/** `#rrggbb` + alpha <-> the stored colour (`rgba(...)` when see-through). */
function splitColour(c: string): { hex: string; alpha: number } {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/.exec(c.trim())
  if (m) {
    const h = (n: string) => Number(n).toString(16).padStart(2, '0')
    return { hex: `#${h(m[1]!)}${h(m[2]!)}${h(m[3]!)}`, alpha: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) }
  }
  return { hex: /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#101218', alpha: 1 }
}

function joinColour(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `rgba(${n(1)}, ${n(3)}, ${n(5)}, ${Math.round(alpha * 100) / 100})`
}

/**
 * Where a free node sits: docked to its parent, or placed by X/Y, and how big.
 *
 * Docking was every component's `anchor` property, behind "more properties"
 * as a dropdown: it existed and nobody could find it. It is the first thing
 * here, as a picture of the parent you click where the node should go. Each
 * number has a slider beside it, scaled to the screen.
 */
function PositionSection({
  s,
  node,
  viewport,
  narrow,
  label,
  over,
  children,
}: {
  s: EditorStore
  node: Node
  viewport: Breakpoint
  narrow: boolean
  label: string
  over: { x?: number; y?: number; w?: number; h?: number }
  /** The rest of Position (rotate, sticky), as property rows. */
  children?: React.ReactNode
}) {
  const screen = VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[VIEWPORTS.length - 1]!
  const anchor = String(node.props.anchor ?? 'none')
  const docked = anchor !== 'none' && anchor !== ''
  const spansX = anchor === 'top' || anchor === 'bottom' || anchor === 'fill'
  const spansY = anchor === 'left' || anchor === 'right' || anchor === 'fill'

  // A content-sized node has no w/h of its own; its size is what it draws.
  // Shown (and kept) as that, so typing a width no longer sets the height to
  // 1px, which is what the resize op did with an unset height.
  const [drawn, setDrawn] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 })
  React.useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`.surface [data-loom-id="${node.id}"]`)
    const surf = document.querySelector<HTMLElement>('.surface')
    if (!el || !surf) return
    const z = Number(surf.dataset.zoom) / 100 || 1
    const r = el.getBoundingClientRect()
    const next = { w: Math.round(r.width / z), h: Math.round(r.height / z) }
    if (next.w !== drawn.w || next.h !== drawn.h) setDrawn(next)
  })

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
  const x = narrow ? over.x ?? num(node.props.x) ?? 0 : num(node.props.x) ?? 0
  const y = narrow ? over.y ?? num(node.props.y) ?? 0 : num(node.props.y) ?? 0
  const w = (narrow ? over.w : undefined) ?? num(node.props.w) ?? drawn.w
  const h = (narrow ? over.h : undefined) ?? num(node.props.h) ?? drawn.h

  const move = (patch: { x?: number; y?: number }) => {
    if (narrow) s.poke({ op: 'setResponsive', id: node.id, breakpoint: viewport, patch })
    else s.poke({ op: 'move', id: node.id, x: patch.x ?? x, y: patch.y ?? y })
  }
  const size = (patch: { w?: number; h?: number }) => {
    const next = { w: Math.max(1, patch.w ?? w), h: Math.max(1, patch.h ?? h) }
    if (narrow) s.poke({ op: 'setResponsive', id: node.id, breakpoint: viewport, patch: patch.w !== undefined ? { w: next.w } : { h: next.h } })
    else s.poke({ op: 'resize', id: node.id, w: next.w, h: next.h })
  }
  const sealMove = () => s.seal(narrow ? `Position at ${label}` : 'Move')
  const sealSize = () => s.seal(narrow ? `Size at ${label}` : 'Resize')

  return (
    <section className="position">
      <h3>
        Position
        {narrow && <span className="dim"> — at {label} only</span>}
      </h3>
      <div className="dock-row">
        <DockPicker
          value={anchor}
          onChange={(a) => s.commit({ op: 'setProp', id: node.id, key: 'anchor', value: a }, a === 'none' ? 'Undock' : `Dock ${a}`)}
        />
        <p className="dock-note">
          {docked ? (
            <>
              Docked <strong>{DOCK_WORDS[anchor] ?? anchor}</strong>. It stays there when its parent resizes.
            </>
          ) : (
            'Free: placed at X and Y. Pick an edge, a corner or the centre to dock it.'
          )}
        </p>
      </div>
      <SlideField label="X" value={x} max={screen.width} disabled={docked} onChange={(v) => move({ x: v })} onCommit={sealMove} why="Docked: the dock places it" />
      <SlideField label="Y" value={y} max={screen.height} disabled={docked} onChange={(v) => move({ y: v })} onCommit={sealMove} why="Docked: the dock places it" />
      <SlideField label="W" value={w} min={1} max={screen.width} disabled={spansX} onChange={(v) => size({ w: v })} onCommit={sealSize} why="Docked across: it spans its parent" />
      <SlideField label="H" value={h} min={1} max={screen.height} disabled={spansY} onChange={(v) => size({ h: v })} onCommit={sealSize} why="Docked down: it spans its parent" />
      {children}
    </section>
  )
}

const DOCK_WORDS: Record<string, string> = {
  'top-left': 'to the top-left corner',
  top: 'to the top edge',
  'top-right': 'to the top-right corner',
  left: 'to the left edge',
  center: 'in the centre',
  right: 'to the right edge',
  'bottom-left': 'to the bottom-left corner',
  bottom: 'to the bottom edge',
  'bottom-right': 'to the bottom-right corner',
  fill: 'to fill its parent',
}

const DOCK_CELLS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const

/** A picture of the parent: click where the node should stay. Click again to free it. */
function DockPicker({ value, onChange }: { value: string; onChange: (a: string) => void }) {
  return (
    <div className="dock-picker" role="group" aria-label="Dock">
      <div className="dock-frame" data-dock={value}>
        <span className="dock-mark" aria-hidden="true" />
        {DOCK_CELLS.map((a) => (
          <button
            key={a}
            type="button"
            className={`dock-cell ${value === a ? 'on' : ''}`}
            data-cell={a}
            aria-pressed={value === a}
            aria-label={`Dock ${DOCK_WORDS[a]}`}
            title={value === a ? 'Undock' : `Dock ${DOCK_WORDS[a]}`}
            onClick={() => onChange(value === a ? 'none' : a)}
          />
        ))}
      </div>
      <div className="dock-extra">
        <button type="button" className={`mini ${value === 'fill' ? 'on' : ''}`} aria-pressed={value === 'fill'} onClick={() => onChange(value === 'fill' ? 'none' : 'fill')} title="Fill its parent">
          Fill
        </button>
        <button type="button" className="mini" disabled={value === 'none' || value === ''} onClick={() => onChange('none')} title="Place it freely at X and Y">
          Free
        </button>
      </div>
    </div>
  )
}

/** A number with a slider beside it: type an exact value or scrub to it. */
function SlideField({
  label,
  value,
  min = 0,
  max,
  disabled,
  why,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  min?: number
  max: number
  disabled?: boolean
  why?: string
  onChange: (v: number) => void
  onCommit: () => void
}) {
  // The slider never clips a real value: past the screen, its end moves out.
  const top = Math.max(max, Math.ceil(value))
  return (
    <div className={`slide-field ${disabled ? 'off' : ''}`} title={disabled ? why : undefined}>
      <span className="slide-label">{label}</span>
      <input
        type="number"
        aria-label={label}
        value={Math.round(value)}
        min={min}
        disabled={disabled}
        onChange={(e) => {
          const v = Number(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(min, v))
        }}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit()
        }}
      />
      <input
        type="range"
        aria-label={`${label} slider`}
        min={min}
        max={top}
        step={1}
        value={Math.round(value)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  )
}

function NumField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  unset = false,
  onChange,
  onCommit,
}: {
  /** Visible inline label. Omit where a label is already shown above the field. */
  label?: string
  /** Accessible name when there is no visible inline label. */
  ariaLabel?: string
  value: number
  min?: number
  max?: number
  step?: number
  /** -1 means "not set": shown empty with an `auto` hint, and clearing writes -1. */
  unset?: boolean
  onChange: (v: number) => void
  onCommit: () => void
}) {
  const shown = unset && value === -1 ? '' : Number.isFinite(value) ? value : 0
  return (
    <div className="num">
      {label !== undefined && <span className="num-label">{label}</span>}
      <input
        type="number"
        aria-label={label === undefined ? ariaLabel : undefined}
        value={shown}
        placeholder={unset ? 'auto' : undefined}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          if (unset && e.target.value === '') {
            onChange(-1)
            return
          }
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

