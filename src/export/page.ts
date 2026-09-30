/**
 * The page an export draws its design on, shared by every exporter.
 *
 * What is under the design (the page's fill, the aurora, the typeface the
 * text is set in, and the rule that lets an untouched root BE the page) is
 * decided once, here, so the HTML page and the React component cannot drift
 * apart. They differ only in scope:
 *
 *  - `document`: the export IS the page (HTML): the rules go on `body`, and
 *    box sizing is set for the whole document.
 *  - `component`: the export is a component inside someone else's app
 *    (React): every rule is scoped to its own `.loom-export` wrapper, so
 *    dropping it in never restyles the host page.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { pageFill } from '../model/page'
import { AuroraBackdrop, auroraCss } from '../render/aurora'
import { fontFaceCss } from '../render/fonts'
import type { Theme } from '../render/theme'
import type { Document } from '../model/types'

/**
 * A root the user left untouched (unsized, at the origin) is the canvas, so on
 * a real page it must BE the page. Once sized or moved it is a designed
 * element and is exported exactly as authored.
 */
function rootIsPage(doc: Document): boolean {
  const root = doc.root === null ? undefined : doc.nodes[doc.root]
  if (!root) return false
  return Number(root.props.w ?? 0) <= 0 && Number(root.props.h ?? 0) <= 0 && Number(root.props.x ?? 0) === 0 && Number(root.props.y ?? 0) === 0
}

/** The page's stylesheet: typeface, aurora motion, the page box and its fill. */
export function exportPageCss(doc: Document, theme: Theme, scope: 'document' | 'component'): string {
  const fill = pageFill(doc.meta.page, theme.bg)
  const ink = `${fill ? `background:${fill};` : ''}color:${theme.textPrimary};font-family:${theme.fontFamily}`
  return [
    scope === 'document'
      ? '*,*::before,*::after{box-sizing:border-box}\nhtml,body{margin:0;padding:0}'
      : '.loom-export,.loom-export *,.loom-export *::before,.loom-export *::after{box-sizing:border-box}',
    '/* The output typeface, embedded: the design looks the same on every machine. */',
    fontFaceCss(),
    doc.meta.page?.background === 'aurora' ? auroraCss() : '',
    scope === 'document' ? `body{${ink}}` : '',
    `.loom-export{position:relative;isolation:isolate;min-height:100vh;width:100%${scope === 'component' ? `;${ink}` : ''}}`,
    rootIsPage(doc) ? '.loom-export>:first-child{position:relative !important;left:auto !important;top:auto !important;width:100% !important;min-height:100vh}' : '',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/** The aurora's markup, drawn after the design (see AuroraBackdrop), or nothing. */
export function exportAuroraMarkup(doc: Document, theme: Theme): string {
  return doc.meta.page?.background === 'aurora' ? renderToStaticMarkup(createElement(AuroraBackdrop, { theme })) : ''
}
