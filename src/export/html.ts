/**
 * Standalone HTML exporter (web target).
 *
 * Format decision: single self-contained `.html` file FIRST, not React+CSS.
 * A React export would force every recipient to run `npm install` and match
 * our React version before they can open the artifact — a whole class of
 * breakage (version drift, missing modules, build-step failures) that a
 * static file simply does not have. Any browser opens this. That is the
 * robust choice; a React/native emitter can be layered on later.
 *
 * Single source of truth: the body is `renderToStaticMarkup` of the SAME
 * preview renderer the app shows (`mode: 'preview'`). There is no parallel
 * per-component emitter to maintain, so export cannot drift from preview:
 * all 111 components are covered by construction, fail-fast is inherited
 * (unknown types / missing nodes throw in the renderer), and escaping is
 * handled by React rather than by string concatenation.
 *
 * Pure and deterministic: same document in, same bytes out. No timestamps,
 * no random ids, no layout reads. Verify asserts on this.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { renderNode } from '../render/web'
import { behaviourCss, behaviourRuntime } from '../render/behaviour'
import { responsiveCss } from '../render/responsive'
import { resolveTheme } from '../render/theme'
import type { Document } from '../model/types'

/** `My App / v2.0!` -> `my-app-v2-0.html`. Mirrors `persist.filenameFor`. */
export function exportFilenameFor(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'untitled'}.html`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Render `doc` to a standalone HTML page.
 *
 * Throws on unknown components / missing nodes (fail-fast, via the
 * renderer) rather than emitting a silent generic div.
 */
export function emitHtml(doc: Document): string {
  const theme = resolveTheme(doc.meta.theme)
  // An empty workspace exports an empty page, not a broken one: a document
  // with no root is a legitimate thing to save and share.
  const body =
    doc.root === null
      ? ''
      : renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode: 'preview', theme }, doc.root))
  const title = escapeHtml(doc.meta.name || 'Untitled')
  // Page fill applies ONLY to a root the user left untouched: unsized and at
  // the origin. Such a root is the canvas, so on a real page it must BE the
  // page. The moment the user sizes or moves it, it is a designed element and
  // the export honours exactly what they authored — the editor never silently
  // overrides a decision the user made.
  const rootNode = doc.root === null ? undefined : doc.nodes[doc.root]
  const rootUntouched = rootNode
    ? Number(rootNode.props.w ?? 0) <= 0 &&
      Number(rootNode.props.h ?? 0) <= 0 &&
      Number(rootNode.props.x ?? 0) === 0 &&
      Number(rootNode.props.y ?? 0) === 0
    : false
  const pageFill = rootNode && rootUntouched
    ? '.loom-export>:first-child{position:relative !important;left:auto !important;top:auto !important;width:100% !important;min-height:100vh}'
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:${theme.bg};color:${theme.textPrimary};font-family:${theme.fontFamily}}
.loom-export{position:relative;min-height:100vh;width:100%}
${pageFill}
/* Built-in control behaviour: the same state rules the editor preview uses. */
${behaviourCss()}
/* Per-breakpoint layout: the same generated rules the editor authors against. */
${responsiveCss(doc)}
</style>
</head>
<body>
<div class="loom-export loom-container">${body}</div>
<!-- Built-in control behaviour. Inline and dependency-free on purpose: an
     exported document must work by opening the file, with no network. -->
<script>${behaviourRuntime()}</script>
</body>
</html>`
}
