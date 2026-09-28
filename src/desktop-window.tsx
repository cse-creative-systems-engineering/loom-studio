/**
 * The design, running on the desktop.
 *
 * This window IS the top-level node: main.ts sized and placed it from the
 * node's dock, so the node fills it. Nothing else is drawn, no frame, no
 * page unless the document has one, so a sidebar docked left is simply a
 * sidebar on the left of the screen. A small control appears on hover; Esc
 * stops it too.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'
import { renderNode } from './render/web'
import { resolveTheme } from './render/theme'
import { emptyDocument } from './state/store'
import type { Document } from './model/types'
import { pageFill } from './model/page'
import { installBehaviourRuntime, installDocumentCss } from './render/behaviour-mount'
import './render/output-base.css'
import './desktop-window.css'
import './model/toolbox'

interface DesktopApi {
  stop: () => Promise<boolean>
  ignoreMouse: (ignore: boolean) => Promise<boolean>
  onDocument: (cb: (doc: unknown) => void) => () => void
}
const api = (window as unknown as { loomDesktop?: DesktopApi }).loomDesktop

/**
 * The top-level node as the window's content: whatever its dock or position
 * in the design, here it is the whole window (the window already sits where
 * the dock put it), so its own offsets are cleared and it fills.
 */
export function asWindowContent(doc: Document): Document {
  const root = doc.root ? doc.nodes[doc.root] : undefined
  if (!root) return doc
  const docked = typeof root.props.anchor === 'string' && root.props.anchor !== 'none'
  return {
    ...doc,
    nodes: {
      ...doc.nodes,
      [root.id]: { ...root, props: { ...root.props, x: 0, y: 0, ...(docked ? {} : { anchor: 'fill' }) } },
    },
  }
}

function App() {
  const [doc, setDoc] = React.useState<Document>(() => emptyDocument())
  React.useEffect(() => {
    installBehaviourRuntime()
  }, [])
  React.useEffect(() => {
    installDocumentCss(doc, resolveTheme(doc.meta.theme))
  }, [doc])
  React.useEffect(
    () =>
      api?.onDocument((d) => {
        if (d && typeof d === 'object' && 'nodes' in d) setDoc(asWindowContent(d as Document))
      }),
    [],
  )
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void api?.stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // Clicks on the empty (transparent) parts go to whatever is behind: the
  // window asks to ignore the pointer over nothing and takes it back over
  // the design. (Windows and macOS forward the pointer while ignoring; on
  // Linux the window is the design's own size, so there is little to pass.)
  React.useEffect(() => {
    let ignoring = false
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY)
      const empty = !el || el === document.body || el.classList.contains('dw-stage') || el.id === 'root'
      if (empty !== ignoring) {
        ignoring = empty
        void api?.ignoreMouse(empty)
      }
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  const t = resolveTheme(doc.meta.theme)
  return (
    <div className="dw-stage" style={{ background: pageFill(doc.meta.page, t.bg), color: t.textPrimary, fontFamily: t.fontFamily }}>
      {doc.root === null ? null : renderNode({ doc, selected: new Set(), mode: 'preview', theme: t }, doc.root)}
      <button type="button" className="dw-stop" onClick={() => void api?.stop()} title="Stop running on the desktop (Esc)">
        Stop
      </button>
    </div>
  )
}

const el = document.getElementById('root')
if (el) createRoot(el).render(<App />)
