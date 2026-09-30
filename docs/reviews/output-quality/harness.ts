/**
 * Turns this tab into the audit scene's REAL export: `emitHtml` exactly as
 * Export → HTML writes it, except every node carries `data-loom-node` (the
 * render tooling's `hookAll`) so measurements can name the tool that drew each
 * box. `document.write` runs the export's own inline behaviour runtime, so what
 * is measured here is what a recipient opens.
 *
 *   harness.html?theme=daylight&layout=flow
 *
 * The free layout is written twice: once to measure what each tool actually
 * draws, then packed by those boxes and written again.
 *
 * Afterwards `window.__auditDoc` holds the document, `window.__auditPlaced`
 * maps each tool name to its node id, and `window.__auditStore` is the store.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { EditorStore } from '../../../src/state/store'
import { renderNode } from '../../../src/render/web'
import { resolveTheme } from '../../../src/render/theme'
import { emitHtml } from '../../../src/export/html'
import { buildAuditScene, packFree, type Layout } from './build-scene'

const params = new URLSearchParams(location.search)
const layout = (params.get('layout') ?? 'free') as Layout
const store = new EditorStore()
const { placed, sections } = buildAuditScene(store, layout)
store.setTheme(params.get('theme') ?? 'midnight')

function write() {
  const doc = store.doc
  const theme = resolveTheme(doc.meta.theme)
  const plain = renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode: 'preview', theme }, doc.root!))
  const hooked = renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode: 'preview', theme, hookAll: true }, doc.root!))
  const html = emitHtml(doc)
  if (!html.includes(plain)) throw new Error('export body not found: emitHtml changed shape')
  Object.assign(window, { __auditDoc: doc, __auditPlaced: placed, __auditStore: store, __auditHtml: html })
  // `document.open` drops the runtime's listeners but the window (and the
  // runtime's install-once flag) survives: clear it so the rewrite installs.
  delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
  document.open()
  document.write(html.replace(plain, hooked))
  document.close()
}

write()
if (layout === 'free') {
  const size = (id: string) => {
    const r = document.querySelector(`[data-loom-node="${CSS.escape(id)}"]`)?.getBoundingClientRect()
    // A closed CommandPalette's root is a page-tall fixed layer (pointer-events
    // none); pack it by its trigger, not by that layer.
    const cap = (v: number) => (v > 1200 ? 48 : v)
    return { w: Math.ceil(cap(r?.width ?? 0)), h: Math.ceil(cap(r?.height ?? 0)) }
  }
  packFree(store, sections, size)
  write()
}
