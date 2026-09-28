/**
 * Detached preview window.
 *
 * A separate renderer that receives the document over IPC and renders it in
 * `preview` mode — the output artifact, with no editor chrome. It has no store,
 * no ops, and no privileged API beyond `onDocument`; it cannot mutate the
 * document, which is the right asymmetry for a read-only surface.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { renderNode } from './render/web'
import { resolveTheme, THEME_NAMES, type ThemeName } from './render/theme'
import { emptyDocument } from './state/store'
import type { Document } from './model/types'
import { pageFill } from './model/page'
import { installBehaviourRuntime, installDocumentCss, CONTAINER_CLASS } from './render/behaviour-mount'
import './preview-window.css'
import './model/toolbox'

const ARTBOARD_W = 720
const ARTBOARD_H = 460

function App() {
  const [doc, setDoc] = React.useState<Document>(() => emptyDocument())
  // Review-time theme, NOT the document's theme: switching it changes what you
  // are looking at, not what you built.
  const [themeName, setThemeName] = React.useState<ThemeName>('midnight')
  const [zoom, setZoom] = React.useState<number | 'fit'>('fit')
  const [pinned, setPinned] = React.useState(true)
  const [dragging, setDragging] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const wrapRef = React.useRef<HTMLDivElement>(null)

  // The preview is the artifact: it carries the same behaviour layer the
  // export does, so what works here works there.
  React.useEffect(() => {
    installBehaviourRuntime()
  }, [])
  // The preview is the artifact at the width it is being viewed at, so it
  // carries the same generated rules (layout + interaction states) the export
  // does, resolved against the theme being reviewed.
  React.useEffect(() => {
    installDocumentCss(doc, resolveTheme(themeName))
  }, [doc, themeName])

  React.useEffect(() => {
    const api = (window as unknown as { loomPreview?: PreviewApi }).loomPreview
    if (!api) return
    return api.onDocument((d) => {
      if (d && typeof d === 'object' && 'nodes' in d) setDoc(d as Document)
    })
  }, [])

  // Fit-to-window: scale so the whole artboard is visible, never magnified.
  React.useEffect(() => {
    if (zoom !== 'fit') return
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const pad = 32
      const w = el.clientWidth - pad
      const h = el.clientHeight - pad
      if (w < 40 || h < 40) return
      setZoom(Math.min(1.6, w / ARTBOARD_W, h / ARTBOARD_H))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [zoom, doc])

  const scale = zoom === 'fit' ? (wrapRef.current?.dataset.fitScale ?? '0.5') : zoom
  const effective = zoom === 'fit' ? undefined : zoom

  const t = resolveTheme(doc.meta.theme)

  const close = () => {
    void (window as unknown as { loomPreview?: PreviewApi }).loomPreview?.close()
  }

  return (
    <div className="pvwin">
      <div
        className={`pvwin-body ${dragging ? 'panning' : ''}`}
        ref={wrapRef}
        onPointerDown={(e) => {
          if (e.button !== 0 || zoom === 'fit') return
          setDragging(true)
          const startX = e.clientX
          const startY = e.clientY
          const el = wrapRef.current
          const sl = el?.scrollLeft ?? 0
          const st = el?.scrollTop ?? 0
          const onMove = (ev: PointerEvent) => {
            if (!el) return
            el.scrollLeft = sl - (ev.clientX - startX)
            el.scrollTop = st - (ev.clientY - startY)
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            setDragging(false)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        }}
      >
        <div
          className={`pvwin-stage ${CONTAINER_CLASS}`}
          ref={stageRef}
          data-page={doc.meta.page?.background ?? 'none'}
          style={{
            ...(effective !== undefined ? { transform: `scale(${effective})`, transformOrigin: 'top left' } : {}),
            // The page, only if the document has one; a translucent page
            // shows the desktop through it.
            background: pageFill(doc.meta.page, resolveTheme(themeName).bg),
          }}
        >
          {doc.root === null
            ? null
            : renderNode({ doc, selected: new Set(), mode: 'preview', theme: resolveTheme(themeName) }, doc.root)}
        </div>
      </div>
      {/* Floating controls: the only chrome. The pill is the window's drag
          handle (frameless windows have no OS region to grab); buttons opt
          back out. It fades until hovered so the artifact reads clean. */}
      <div className="pvwin-float" title={`${doc.meta.name} · ${t.name}`}>
        <div className="pvwin-themes" role="group" aria-label="Review in theme">
          {THEME_NAMES.map((n) => (
            <button
              key={n}
              className={`pvwin-btn${themeName === n ? ' on' : ''}`}
              aria-pressed={themeName === n}
              onClick={() => setThemeName(n)}
              title={`Review in the ${n} theme`}
            >
              {n === 'midnight' ? '◐' : n === 'daylight' ? '◑' : '◉'}
            </button>
          ))}
        </div>
        <button
          className="pvwin-btn"
          onClick={() => setZoom((z) => Math.max(0.1, (z === 'fit' ? 0.5 : z) - 0.1))}
          title="Zoom out"
        >
          −
        </button>
        <button
          className="pvwin-btn wide"
          onClick={() => setZoom('fit')}
          title="Fit to window"
        >
          {zoom === 'fit' ? 'fit' : `${Math.round((zoom as number) * 100)}%`}
        </button>
        <button
          className="pvwin-btn"
          onClick={() => setZoom((z) => Math.min(2, (z === 'fit' ? 0.5 : z) + 0.1))}
          title="Zoom in"
        >
          +
        </button>
        <button
          className={`pvwin-btn ${pinned ? 'on' : ''}`}
          onClick={() => {
            const next = !pinned
            setPinned(next)
            void (window as unknown as { loomPreview?: PreviewApi }).loomPreview?.setAlwaysOnTop(next)
          }}
          title={pinned ? 'Unpin from top' : 'Keep above the editor'}
        >
          pin
        </button>
        <button className="pvwin-btn" onClick={close} title="Close preview">
          ✕
        </button>
      </div>
      {void scale}
    </div>
  )
}

interface PreviewApi {
  isPreviewWindow: boolean
  open: (doc: unknown) => Promise<boolean>
  close: () => Promise<boolean>
  setAlwaysOnTop: (on: boolean) => Promise<boolean>
  onDocument: (cb: (doc: unknown) => void) => () => void
  onClosed: (cb: () => void) => () => void
}

declare global {
  interface Window {
    loomPreview?: PreviewApi
  }
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
