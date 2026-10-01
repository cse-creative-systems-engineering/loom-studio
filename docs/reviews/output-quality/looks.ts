/**
 * Every built-in look on real components, in the real export, under the
 * scene light: the review sheet for the appearance system.
 *   looks.html?theme=daylight&light=315,40
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
set(root, { w: 1200, h: null, padding: 32, gap: 28, background: params.get('ground') ?? '' })
store.setTheme(params.get('theme') ?? 'midnight')
const sun = params.get('light')?.split(',').map(Number)
if (sun?.length === 2) store.commit({ op: 'setLight', light: { angle: sun[0]!, height: sun[1]!, softness: 0.55, strength: 0.6 } }, 'light')

const row = (title: string, gap = 22) => {
  const r = store.dropComponent('Panel', root, 0, 0)!
  store.commit({ op: 'setFlow', id: r, flow: true }, 'flow')
  set(r, { title, direction: 'row', wrap: true, gap, h: null, align: 'center', padding: 28 })
  return r
}
const look = (id: string, styleId: string) => {
  const st = BUILTIN_STYLES.find((s) => s.id === styleId)!
  store.commit({ op: 'setLook', id, target: '', set: st.set }, 'look')
}
const only = params.get('styles')?.split(',')
for (const st of BUILTIN_STYLES) {
  if (only && !only.includes(st.id)) continue
  const r = row(`${st.label} — ${st.hint}`)
  const a = store.dropComponent('Button', r, 0, 0)!
  set(a, { label: 'Continue', variant: 'primary' })
  look(a, st.id)
  const b = store.dropComponent('Button', r, 0, 0)!
  set(b, { label: 'Cancel', variant: 'secondary' })
  look(b, st.id)
  const c = store.dropComponent('Card', r, 0, 0)!
  set(c, { title: 'Weekly revenue', w: 240, h: 110 })
  look(c, st.id)
  const i = store.dropComponent('Input', r, 0, 0)!
  set(i, { placeholder: 'Search projects', width: 200 })
  look(i, st.id)
  const k = store.dropComponent('Badge', r, 0, 0)!
  set(k, { text: 'New', tone: 'accent' })
  look(k, st.id)
}
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
