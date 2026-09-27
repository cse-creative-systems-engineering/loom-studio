import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app'
import { runSelfTest } from '../electron/selftest'
import { reparentProbe } from '../electron/reparent-probe'
import { layoutProbe } from '../electron/layout-probe-renderer'
import type { EditorStore } from './state/store'
import { store } from './app'
import { seedDemo } from './demo'

// DEVELOPMENT ONLY. `?demo=1` (set by the E2E probes via LOOM_DEMO=1) seeds a
// fixture document so an automated review has something to click.
//
// This is NOT the first-run experience and must never become one: a person
// opening Loom gets a genuinely EMPTY workspace, because documents are
// rootless and the first node is theirs to place. There is no sample project
// waiting for them, and nothing restores an old one behind their back.
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
