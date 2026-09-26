import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { runSelfTest } from '../electron/selftest'
import { reparentProbe } from '../electron/reparent-probe'
import { layoutProbe } from '../electron/layout-probe-renderer'
import type { EditorStore } from './state/store'
import { store } from './app'
import { seedDemo } from './demo'

// `?demo=1` seeds a representative scene. Used by the screenshot harness so
// reviews (human or agent) look at a real document instead of an empty canvas.
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1') {
  seedDemo(store)
}

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

declare global {
  interface Window {
    __runSelfTest?: () => Promise<string>
    __loomProbe?: () => unknown[]
    __loomLayoutProbe?: () => unknown[]
    __loomStore: EditorStore
  }
}
if (typeof window !== 'undefined') {
  window.__runSelfTest = runSelfTest
  window.__loomProbe = reparentProbe
  window.__loomLayoutProbe = layoutProbe
}
