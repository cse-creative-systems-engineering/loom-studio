/**
 * A starter, as dropped, in the real export, with a theme and a scene light:
 *   starter.html?id=light-study&theme=midnight&light=315,35
 * The capture page for review shots and the "drag the sun" animation.
 */

import { emptyDocument, EditorStore } from '../../../src/state/store'
import { emitHtml } from '../../../src/export/html'

const params = new URLSearchParams(location.search)
const store = new EditorStore()
store.loadDocument(emptyDocument())
store.addStarter(params.get('id') ?? 'light-study', null, 0, 0)
store.setTheme(params.get('theme') ?? 'midnight')
const sun = params.get('light')?.split(',').map(Number)
if (sun && sun.length >= 2) store.commit({ op: 'setLight', light: { angle: sun[0]!, height: sun[1]!, softness: sun[2] ?? 0.55, strength: sun[3] ?? 0.6 } }, 'light')
if (params.get('page')) store.commit({ op: 'setPage', page: { background: 'theme' } }, 'page')
delete (window as unknown as { __loomBehaviour?: boolean }).__loomBehaviour
document.open()
document.write(emitHtml(store.doc))
document.close()
