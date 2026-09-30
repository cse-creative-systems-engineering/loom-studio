/**
 * The output-quality audit scene: one document holding EVERY toolbox tool, in
 * context, built the way a person builds — through `store.dropComponent`, the
 * toolbox's own drop path, so seeds and drop sizes are exactly what a drag
 * produces. Nothing is restyled: defaults are what people get, so defaults are
 * what is audited.
 *
 * Two layouts:
 *  - 'free' (Loom's default, absolute-first): each category is a Card on a
 *    flow page; its tools are dropped FREE inside it. `packFree` then places
 *    them in rows by their MEASURED boxes, so no tool covers another.
 *  - 'flow': each category Card is a flow row that wraps (pass 1, see
 *    notes-flow-pass.md).
 *
 * Run through `harness.html`, or in the editor's console:
 *   const m = await import('/docs/reviews/output-quality/build-scene.ts')
 *   m.buildAuditScene(window.__loomStore)
 */

import { emptyDocument, type EditorStore as Store } from '../../../src/state/store'
import { addedTypes, componentsByCategory, getComponent } from '../../../src/model/registry'

/** Containers the toolbox drops empty: give each one child so it is judged with content. */
const FILL = 'Label'
export const PAGE_W = 1264
const PAD = 20
const GAP = 20
/** Below a Card's title, where a free child is not covering it. */
const TOP = 52

export type Layout = 'free' | 'flow'

export function buildAuditScene(store: Store, layout: Layout = 'free'): { root: string; placed: Record<string, string>; sections: string[] } {
  store.loadDocument(emptyDocument())
  const root = store.dropComponent('Panel', null, 0, 0)!
  store.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
  const set = (id: string, props: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(props)) store.setProp(id, k, v as never)
  }
  set(root, { title: 'Harbor — every tool', w: PAGE_W, gap: 24, padding: 24 })
  // The root lands with the Panel's 240px drop height and never grows, so a
  // flow column shrinks every section to fit it (findings 1 and 1b).
  store.setProp(root, 'h', null as never)

  const added = addedTypes()
  const placed: Record<string, string> = {}
  const sections: string[] = []
  for (const [category, specs] of componentsByCategory()) {
    const section = store.dropComponent('Card', root, 0, 0)!
    sections.push(section)
    set(section, { title: category })
    if (layout === 'flow') {
      store.commit({ op: 'setFlow', id: section, flow: true }, 'flow')
      set(section, { direction: 'row', wrap: true, gap: 16 })
      // Finding 1: a container dropped into flow keeps a fixed 200px height
      // and its content spills over its siblings. Unset it so it grows.
      store.setProp(section, 'h', null as never)
    }
    for (const spec of specs) {
      if (added.has(spec.name)) continue // added from its owner's panel, not the toolbox
      const id = store.dropComponent(spec.name, section, 0, 0)
      if (!id) throw new Error(`drop refused: ${spec.name}`)
      placed[spec.name] = id
      const node = store.doc.nodes[id]
      if (getComponent(spec.name)?.container && node.children.length === 0) {
        const kid = store.dropComponent(FILL, id, 16, layout === 'free' ? 40 : 16)
        if (kid) set(kid, { text: `Inside ${spec.name}` })
      }
    }
  }
  store.select([])
  return { root, placed, sections }
}

/**
 * Place each section's free tools in rows by their measured size (what the
 * export actually drew), then size the section to hold them.
 */
export function packFree(store: Store, sections: string[], size: (id: string) => { w: number; h: number }) {
  const inner = PAGE_W - 48 - 2 * PAD
  for (const section of sections) {
    let x = PAD, y = TOP, rowH = 0
    for (const id of store.doc.nodes[section].children) {
      const { w, h } = size(id)
      if (x > PAD && x + w > PAD + inner) { x = PAD; y += rowH + GAP; rowH = 0 }
      store.setProp(id, 'x', x)
      store.setProp(id, 'y', y)
      x += Math.max(w, 24) + GAP
      rowH = Math.max(rowH, h)
    }
    store.setProp(section, 'w', PAGE_W - 48)
    store.setProp(section, 'h', y + rowH + PAD)
  }
}
