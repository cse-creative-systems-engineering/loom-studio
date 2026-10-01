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
import { BUILTIN_STYLES } from '../../../src/model/look'

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
// &look=gloss applies a built-in style; &light=angle,height moves the sun.
const style = BUILTIN_STYLES.find((x) => x.id === params.get('look'))
if (style) store.commit({ op: 'setLook', id, target: '', set: style.set }, 'look')
const sun = params.get('light')?.split(',').map(Number)
if (sun?.length === 2) store.commit({ op: 'setLight', light: { angle: sun[0]!, height: sun[1]!, softness: 0.55, strength: 0.6 } }, 'light')
for (const [k, v] of params) {
  if (['tool', 'theme', 'w', 'look', 'light'].includes(k)) continue
  store.setProp(id, k, (v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v) as never)
}
Object.assign(window, { __benchStore: store, __benchId: id })
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
