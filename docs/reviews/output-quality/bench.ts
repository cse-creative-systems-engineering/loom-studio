/**
 * One tool, exactly as a drop makes it, in the REAL export: the bench the
 * component-depth pass judges each control on (and the before/after shots).
 *
 *   bench.html?tool=DataGrid&theme=daylight&w=760
 *
 * Extra query params are set as props (`&density=compact`), so a variant is a
 * URL rather than a code change.
 */

import { emptyDocument, EditorStore } from '../../../src/state/store'
import { emitHtml } from '../../../src/export/html'

const params = new URLSearchParams(location.search)
const store = new EditorStore()
store.loadDocument(emptyDocument())
const root = store.dropComponent('Panel', null, 0, 0)!
store.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
store.setProp(root, 'w', Number(params.get('w') ?? 800) as never)
store.setProp(root, 'h', null as never)
store.setProp(root, 'padding', 32 as never)
store.setTheme(params.get('theme') ?? 'midnight')
const id = store.dropComponent(params.get('tool') ?? 'DataGrid', root, 0, 0)!
for (const [k, v] of params) {
  if (['tool', 'theme', 'w'].includes(k)) continue
  store.setProp(id, k, (v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v) as never)
}
Object.assign(window, { __benchStore: store, __benchId: id })
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
