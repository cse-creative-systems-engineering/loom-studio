/**
 * Every data-bearing tool in each content state (ready, loading, empty,
 * error), side by side, in the real export: the review sheet for the shared
 * states piece.   states.html?theme=daylight
 */

import { emptyDocument, EditorStore } from '../../../src/state/store'
import { emitHtml } from '../../../src/export/html'
import { CONTENT_STATE_TOOLS } from '../../../src/model/prop-vocab'

const params = new URLSearchParams(location.search)
const only = params.get('tools')?.split(',')
const store = new EditorStore()
store.loadDocument(emptyDocument())
const root = store.dropComponent('Panel', null, 0, 0)!
store.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
store.setProp(root, 'w', 1240 as never)
store.setProp(root, 'h', null as never)
store.setProp(root, 'padding', 24 as never)
store.setProp(root, 'gap', 28 as never)
store.setTheme(params.get('theme') ?? 'midnight')
for (const tool of Object.keys(CONTENT_STATE_TOOLS)) {
  if (only && !only.includes(tool)) continue
  const row = store.dropComponent('Panel', root, 0, 0)!
  store.commit({ op: 'setFlow', id: row, flow: true }, 'flow')
  store.setProp(row, 'title', tool as never)
  store.setProp(row, 'direction', 'row' as never)
  store.setProp(row, 'gap', 16 as never)
  store.setProp(row, 'h', null as never)
  store.setProp(row, 'align', 'start' as never)
  for (const state of ['ready', 'loading', 'empty', 'error']) {
    const id = store.dropComponent(tool, row, 0, 0)!
    store.setProp(id, 'loadState', state as never)
  }
}
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
