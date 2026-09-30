/**
 * The render window: the design drawn exactly as it ships, for an AI agent
 * to LOOK at and MEASURE.
 *
 * A hidden, offscreen window (main.ts) sized to a viewport's screen. It draws
 * the document the way Preview and the exports do (same renderer, same page
 * background, same generated CSS, same container queries) with every node
 * carrying its output hook, so a node can be found and measured. Main takes
 * the picture (`render`); `check_layout` is measured here, on the real boxes.
 */

import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { renderNode } from './render/web'
import { resolveTheme } from './render/theme'
import type { Document } from './model/types'
import { pageFill } from './model/page'
import { installDocumentCss, CONTAINER_CLASS } from './render/behaviour-mount'
import { measureLayout } from './ai/measure'
import './render/output-base.css'
import './model/toolbox'

interface Job {
  id: string
  doc: Document
  width: number
  height: number
  viewport: 'sm' | 'md' | 'lg'
  want: 'image' | 'measure'
  nodeId?: string
}

interface RenderApi {
  onJob: (cb: (job: Job) => void) => () => void
  done: (id: string, result: unknown) => Promise<unknown>
}
const api = (window as unknown as { loomRender?: RenderApi }).loomRender

const host = document.getElementById('root')!
const root = createRoot(host)

const frames = (n: number) => new Promise<void>((r) => {
  const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)))
  step(n)
})

api?.onJob(async (job) => {
  try {
    const t = resolveTheme(job.doc.meta.theme)
    installDocumentCss(job.doc, t)
    document.body.style.background = pageFill(job.doc.meta.page, t.bg) ?? 'transparent'
    flushSync(() =>
      root.render(
        <div
          className={`rw-stage ${CONTAINER_CLASS}`}
          style={{ position: 'relative', width: job.width, minHeight: job.height, color: t.textPrimary, fontFamily: t.fontFamily }}
        >
          {job.doc.root === null ? null : renderNode({ doc: job.doc, selected: new Set(), mode: 'preview', theme: t, hookAll: true }, job.doc.root)}
        </div>,
      ),
    )
    await document.fonts.ready
    await frames(3)
    const stage = host.firstElementChild as HTMLElement
    if (job.want === 'measure') {
      await api.done(job.id, { ok: true, result: measureLayout(stage, job.doc, { width: job.width, height: job.height, viewport: job.viewport }) })
      return
    }
    // For a picture: the region to capture (a node, or the whole screen,
    // taller if the page is).
    let clip = { x: 0, y: 0, width: job.width, height: Math.max(job.height, Math.ceil(stage.getBoundingClientRect().height)) }
    if (job.nodeId) {
      const el = stage.querySelector<HTMLElement>(`[data-loom-node="${CSS.escape(job.nodeId)}"]`)
      if (!el) {
        await api.done(job.id, { ok: false, error: `no node "${job.nodeId}" is drawn` })
        return
      }
      const r = el.getBoundingClientRect()
      const pad = 16
      clip = { x: Math.max(0, Math.floor(r.left - pad)), y: Math.max(0, Math.floor(r.top - pad)), width: Math.ceil(r.width + pad * 2), height: Math.ceil(r.height + pad * 2) }
    }
    await api.done(job.id, { ok: true, clip })
  } catch (e) {
    await api?.done(job.id, { ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
