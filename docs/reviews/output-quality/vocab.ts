/**
 * The shared vocabulary, side by side in the real export: every emphasis on
 * the pressables, every field style on the text fields, every tone and fill
 * on the chips and alerts.   vocab.html?theme=daylight
 */

import { emptyDocument, EditorStore } from '../../../src/state/store'
import { emitHtml } from '../../../src/export/html'
import { EMPHASES, FIELD_STYLES, FILLS, TONES } from '../../../src/model/prop-vocab'

const params = new URLSearchParams(location.search)
const store = new EditorStore()
store.loadDocument(emptyDocument())
const root = store.dropComponent('Panel', null, 0, 0)!
store.commit({ op: 'setFlow', id: root, flow: true }, 'flow')
const set = (id: string, props: Record<string, unknown>) => Object.entries(props).forEach(([k, v]) => store.setProp(id, k, v as never))
set(root, { w: 1180, h: null, padding: 24, gap: 24 })
store.setTheme(params.get('theme') ?? 'midnight')
const row = (title: string) => {
  const r = store.dropComponent('Panel', root, 0, 0)!
  store.commit({ op: 'setFlow', id: r, flow: true }, 'flow')
  set(r, { title, direction: 'row', wrap: true, gap: 14, h: null, align: 'center' })
  return r
}
const add = (parent: string, type: string, props: Record<string, unknown>) => {
  const id = store.dropComponent(type, parent, 0, 0)!
  set(id, props)
  return id
}
for (const tool of ['Button', 'IconButton', 'DropdownButton']) {
  const r = row(`${tool} · emphasis`)
  for (const v of EMPHASES) add(r, tool, { variant: v, ...(tool === 'Button' ? { label: v[0]!.toUpperCase() + v.slice(1) } : tool === 'DropdownButton' ? { label: v } : {}) })
}
for (const tool of ['Input', 'Select']) {
  const r = row(`${tool} · field style`)
  for (const v of FIELD_STYLES) add(r, tool, { variant: v, ...(tool === 'Input' ? { placeholder: v } : {}), width: 180 })
}
for (const fill of FILLS) {
  const r = row(`Badge · ${fill} · every tone`)
  for (const tone of TONES) add(r, 'Badge', { variant: fill, tone, text: tone })
}
const a = row('Alert · soft · every tone')
for (const tone of TONES) add(a, 'Alert', { tone, title: tone[0]!.toUpperCase() + tone.slice(1), body: 'The same six words on every tool.', w: 360 })
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
