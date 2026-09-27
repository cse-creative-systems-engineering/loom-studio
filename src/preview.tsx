/**
 * Preview surface.
 *
 * Three states, always present:
 *   peek  — a small live thumbnail docked in the shell, never hidden
 *   panel — a large resizable view alongside the canvas
 *   full  — the artifact alone, chrome hidden
 *
 * The point is that the OUTPUT is never more than one glance away. A designer
 * who has to switch modes to see what they built is designing blind.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import { renderNode } from './render/web'
import { resolveTheme } from './render/theme'
import { THEME_NAMES, type ThemeName } from './render/theme'
import { installBehaviourRuntime } from './render/behaviour-mount'


export type PreviewSize = 'peek' | 'panel' | 'full'

/** The artboard's design size. Preview scales this; it never changes it. */
const ARTBOARD_W = 720
const ARTBOARD_H = 460

interface PreviewProps {
  s: EditorStore
  size: PreviewSize
  onSize: (size: PreviewSize) => void
  onClose: () => void
}

const NEXT: Record<PreviewSize, PreviewSize | null> = {
  peek: 'panel',
  panel: 'full',
  full: null,
}

const LABEL: Record<PreviewSize, string> = {
  peek: 'Peek',
  panel: 'Panel',
  full: 'Full',
}

export function Preview({ s, size, onSize, onClose }: PreviewProps) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = React.useState(false)

  // Scale the artifact down to fit the peek thumbnail rather than reflowing
  // it, so the preview is a true miniature of the output.
  const [scale, setScale] = React.useState(0.3)
  const bodyRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const body = bodyRef.current
    if (!body || size !== 'peek') return
    const fit = () => {
      const pad = 12
      const w = body.clientWidth - pad * 2
      const h = body.clientHeight - pad * 2
      if (w < 20 || h < 20) return
      // Never scale UP: a miniature must not magnify a small document.
      setScale(Math.min(1, w / ARTBOARD_W, h / ARTBOARD_H))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(body)
    return () => ro.disconnect()
  }, [size, s.doc])

  const promote = () => {
    const n = NEXT[size]
    if (n) onSize(n)
  }

  // Panel size is user-resizable by dragging its edge.
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    setDragging(true)
    const startX = e.clientX
    const startW = ref.current?.clientWidth ?? 0
    const onMove = (ev: PointerEvent) => {
      if (!ref.current) return
      const w = Math.max(320, Math.min(900, startW + (startX - ev.clientX)))
      ref.current.style.width = `${w}px`
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  if (size === 'full') {
    return (
      <div className="preview-full" data-testid="preview-full">
        <div className="preview-full-bar">
          <span className="preview-title">{s.doc.meta.name}</span>
          <span className="preview-target">
            {s.target === 'web' ? 'Web' : 'Desktop'} preview
          </span>
          <span className="preview-spacer" />
          <button className="pv-btn" onClick={() => onSize('panel')} title="Step down">
            Step down
          </button>
          <button className="pv-btn" onClick={onClose} title="Close preview">
            Close
          </button>
        </div>
        <div className="preview-full-body">
          <PreviewStage s={s} />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className={`preview preview-${size} ${dragging ? 'resizing' : ''}`}
      data-testid={`preview-${size}`}
    >
      {size === 'panel' && <div className="preview-grip" onPointerDown={startResize} />}

      <div className="preview-bar" onDoubleClick={promote}>
        <span className="preview-dot" aria-hidden="true" />
        <span className="preview-title">{s.doc.meta.name}</span>
        <span className="preview-size">{LABEL[size]}</span>
        <span className="preview-spacer" />
        <button
          className="pv-btn"
          onClick={promote}
          disabled={NEXT[size] === null}
          title={NEXT[size] ? `Expand to ${NEXT[size]}` : 'Already full'}
        >
          {size === 'peek' ? '⤢' : '⛶'}
        </button>
        <button className="pv-btn" onClick={onClose} title="Close preview">
          ✕
        </button>
      </div>

      <div className="preview-body" ref={bodyRef}>
        <div
          className="preview-fit"
          style={size === 'peek' ? { transform: `scale(${scale})` } : undefined}
        >
          <PreviewStage s={s} />
        </div>
      </div>
    </div>
  )
}

/**
 * The artifact itself. Rendered in `preview` mode so it carries no editor
 * attributes — this is what the user would actually ship.
 */
/**
 * A theme to REVIEW the artifact in, without editing the document.
 *
 * This is a design-time instrument, and it is deliberately not written into
 * the document: switching a theme changes what you are looking at, not what you
 * built. Shipping both themes is table stakes, and "does this survive daylight?"
 * is a question you have to be able to ask before you ship, not after.
 */
export function PreviewStage({
  s,
  themeName,
  onThemeName,
}: {
  s: EditorStore
  themeName?: ThemeName
  onThemeName?: (n: ThemeName) => void
}) {
  // Same behaviour layer as the export: the docked preview is not a picture
  // of the artifact, it IS the artifact.
  React.useEffect(() => {
    installBehaviourRuntime()
  }, [])
  const root = s.doc.root
  const review = themeName ?? s.doc.meta.theme
  const showSwitch = onThemeName !== undefined
  if (root === null) {
    return (
      <div className="preview-stage" style={{ minHeight: 200, opacity: 0.45 }}>
        {null}
      </div>
    )
  }
  return (
    <div className="preview-stage">
      {renderNode({ doc: s.doc, selected: new Set(), mode: 'preview', theme: resolveTheme(review) }, root)}
      {showSwitch ? (
        <div className="theme-switch" role="group" aria-label="Review in theme">
          {THEME_NAMES.map((n) => (
            <button
              key={n}
              className={`chip${review === n ? ' on' : ''}`}
              aria-pressed={review === n}
              onClick={() => onThemeName?.(n)}
              title={`Review this artifact in the ${n} theme`}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
