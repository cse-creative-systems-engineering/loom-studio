/**
 * Every built-in style in each of its states, side by side, in the real
 * export: Normal, Hover, Pressed (forced, as the editor forces them).
 *   materials.html?theme=daylight&light=330,45
 */

import { emptyDocument, EditorStore } from '../../../src/state/store'
import { emitHtml } from '../../../src/export/html'
import { BUILTIN_STYLES } from '../../../src/model/look'

const params = new URLSearchParams(location.search)
const store = new EditorStore()
store.loadDocument(emptyDocument())
const set = (id: string, props: Record<string, unknown>) => Object.entries(props).forEach(([k, v]) => store.setProp(id, k, v as never))
const root = store.dropComponent('Panel', null, 0, 0)!
store.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
set(root, { w: 860, h: null, padding: 28, gap: 6 })
store.setTheme(params.get('theme') ?? 'midnight')
const sun = params.get('light')?.split(',').map(Number)
if (sun?.length === 2) store.commit({ op: 'setLight', light: { angle: sun[0]!, height: sun[1]!, softness: 0.55, strength: 0.6 } }, 'light')
const force: Array<[string, string]> = []
const only = params.get('styles')?.split(',')
for (const st of BUILTIN_STYLES) {
  if (only && !only.includes(st.id)) continue
  const r = store.dropComponent('Stack', root, 0, 0)!
  store.commit({ op: 'setFlow', id: r, flow: true }, 'flow')
  set(r, { direction: 'row', gap: 26, align: 'center', padding: 14, h: null })
  const name = store.dropComponent('Label', r, 0, 0)!
  set(name, { text: st.label, w: 90 })
  for (const state of ['', 'hover', 'pressed']) {
    const b = store.dropComponent('Button', r, 0, 0)!
    set(b, { label: state || 'Normal' })
    store.commit({ op: 'setLook', id: b, target: '', set: st.set }, 'look')
    if (state) force.push([b, state])
  }
  const c = store.dropComponent('Card', r, 0, 0)!
  set(c, { title: 'Card', w: 170, h: 64 })
  store.commit({ op: 'setLook', id: c, target: '', set: st.set }, 'look')
  const i = store.dropComponent('Input', r, 0, 0)!
  set(i, { placeholder: 'Field', width: 140 })
  store.commit({ op: 'setLook', id: i, target: '', set: st.set }, 'look')
}
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
// Show the states the way the editor does: forced, without a pointer.
for (const [id, state] of force) document.querySelector(`[data-loom-node="${id}"]`)?.setAttribute('data-loom-force', state)
