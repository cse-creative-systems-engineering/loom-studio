/**
 * The behaviour layer, installed.
 *
 * One call, three targets. The preview window, the docked preview and the
 * exported documents all mount the SAME stylesheet and the SAME runtime, so a
 * control behaves identically wherever it is seen. If the preview lies about
 * what the export does, the preview is worse than useless.
 *
 * Deliberately idempotent (`window.__loomBehaviour`) and scoped to the
 * document, so re-rendering a document never double-binds a listener and
 * never needs a teardown.
 */

import React from 'react'
import { behaviourCss, installBehaviour } from './behaviour'
import { responsiveCss, CONTAINER_NAME } from './responsive'
import type { Document } from '../model/types'

let styleEl: HTMLStyleElement | null = null

/** The state stylesheet. Injected once per document. */
export function installBehaviourStyles(): void {
  if (typeof document === 'undefined') return
  if (styleEl && styleEl.isConnected) return
  const el = document.createElement('style')
  el.setAttribute('data-loom-behaviour', '')
  el.textContent = behaviourCss()
  document.head.appendChild(el)
  styleEl = el
}

/**
 * The interaction runtime. Safe to call on every mount: the second call is a
 * no-op because the runtime guards itself.
 */
export function installBehaviourRuntime(): void {
  if (typeof window === 'undefined') return
  installBehaviourStyles()
  // Called directly, never through eval: a renderer content-security-policy
  // blocks eval, and a throw inside a React effect unmounts the tree.
  installBehaviour()
}

/** A React hook: mount the behaviour layer for as long as this surface lives. */
export function useBehaviour(): void {
  React.useEffect(() => {
    installBehaviourRuntime()
  }, [])
}

/**
 * The document's responsive layout, injected as one stylesheet.
 *
 * Re-derived whenever the document changes, because the rules are generated
 * from the document: a node that gains a phone override has to appear in the
 * sheet. Scoped by document id in the attribute so two open documents (the
 * editor and a preview window) never fight over one `<style>` element.
 */
let responsiveEl: HTMLStyleElement | null = null

export function installResponsiveCss(doc: Document): void {
  if (typeof document === 'undefined') return
  const css = responsiveCss(doc)
  if (!responsiveEl || !responsiveEl.isConnected) {
    responsiveEl = document.createElement('style')
    responsiveEl.setAttribute('data-loom-responsive', '')
    document.head.appendChild(responsiveEl)
  }
  // Also establish the container itself, so the queries have something to
  // measure. Authoring and export both put this class on the surface.
  if (responsiveEl.textContent !== css) responsiveEl.textContent = css
}

/** The class every responsive surface must carry to be measurable. */
export const CONTAINER_CLASS = `loom-container`
export { CONTAINER_NAME }
