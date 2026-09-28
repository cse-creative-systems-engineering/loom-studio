/**
 * Responsive layout, as generated CSS.
 *
 * WHY CONTAINER QUERIES AND NOT MEDIA QUERIES. The thing being designed is a
 * box — a page, a panel, an embed — so its own inline width is the honest
 * input, not the browser window. That is also what lets the editor's viewport
 * switcher work honestly: it changes the artboard's width, the container
 * re-evaluates, and the layout responds. With media queries the switcher
 * would have to resize the OS window, which is not a feature, it is a rumour.
 *
 * ONE STYLESHEET, THREE TARGETS. The editor canvas, the live preview and both
 * exports all inject exactly this string. So the layout you author against is
 * the layout that ships — the same trick the behaviour layer uses, and for the
 * same reason: a preview that lies about responsive behaviour is worse than no
 * preview at all.
 *
 * The cascade is deliberately boring: the BASE styles are inline and are the
 * desktop case, and each narrower breakpoint overrides them inside a
 * `@container` band. Widest-first in the file, so the order reads the way the
 * design does: desktop, then tablet, then phone.
 */

import {
  BREAKPOINTS,
  BREAKPOINT_BAND,
  type Breakpoint,
  type Document,
  type Node,
  type ResponsiveOverride,
} from '../model/types'

/**
 * The attribute an OUTPUT element carries when generated rules must reach it.
 * Distinct from the editor's `data-loom-id` so exports stay free of editor
 * hooks, and emitted only on nodes that need it.
 */
export const OUTPUT_HOOK = 'data-loom-node'

/**
 * The selector for one node on every surface: the editor canvas addresses it
 * by its editor id, the preview and exports by the output hook.
 */
export function nodeSelector(id: string): string {
  const q = cssString(id)
  return `:is([data-loom-id=${q}],[${OUTPUT_HOOK}=${q}])`
}

/**
 * Any string as a quoted CSS string that can carry nothing but itself.
 *
 * Node ids come from files, and a file can name a node anything, so an id
 * written into a stylesheet raw could close its rule, or the `<style>` element
 * of an HTML export, and inject whatever followed. Every character outside
 * `[A-Za-z0-9_-]` becomes a CSS hex escape, which the selector engine decodes
 * back to the same character, so the rule still matches the real attribute.
 */
export function cssString(value: string): string {
  const body = Array.from(value, (ch) =>
    /^[A-Za-z0-9_-]$/.test(ch) ? ch : `\\${(ch.codePointAt(0) as number).toString(16)} `,
  ).join('')
  return `"${body}"`
}

/** The name of the container every responsive document establishes. */
export const CONTAINER_NAME = 'loom'

/** True when this node carries any responsive override at all. */
export function isResponsive(node: Node): boolean {
  return node.responsive !== undefined && Object.keys(node.responsive).length > 0
}

/** The breakpoints this node overrides, narrowest first. */
export function nodeBreakpoints(node: Node): Breakpoint[] {
  if (!node.responsive) return []
  return BREAKPOINTS.filter((bp) => node.responsive?.[bp] !== undefined)
}

function decls(over: ResponsiveOverride): string[] {
  const out: string[] = []
  if (typeof over.x === 'number') out.push(`left:${over.x}px`)
  if (typeof over.y === 'number') out.push(`top:${over.y}px`)
  if (typeof over.w === 'number') out.push(`width:${over.w}px`)
  if (typeof over.h === 'number') out.push(`height:${over.h}px`)
  if (typeof over.opacity === 'number') out.push(`opacity:${over.opacity}`)
  if (typeof over.flow === 'boolean') {
    out.push(over.flow ? 'display:flex' : 'display:block')
    if (over.flow) {
      out.push('flex-direction:column')
      out.push('align-items:stretch')
    }
  }
  // Only HIDING is expressible: a node hidden in the base layout is not in the
  // output at all, so there is nothing a breakpoint could reveal, and forcing
  // `display` on a visible node would erase its own (flex, grid, inline).
  if (over.visible === false) out.push('display:none')
  return out
}

/** Every rule one node needs at one breakpoint. */
function nodeRules(id: string, over: ResponsiveOverride): string[] {
  const d = decls(over)
  if (d.length === 0) return []
  // `!important` is required, not a shortcut: the base layout is INLINE, and
  // an inline declaration beats any stylesheet rule without it. The override
  // could never win otherwise — and did not, until it was measured.
  const rules = [`${nodeSelector(id)}{${d.map((x) => `${x} !important`).join(';')}}`]
  if (over.flow === true) {
    // A free container's children are absolutely positioned INLINE, so
    // `display:flex` on the parent alone moves nothing. Flowing means the
    // children leave absolute positioning; effect decoration layers
    // (`data-loom-fx`) stay where they are.
    rules.push(
      `${nodeSelector(id)}>:not([data-loom-fx]){position:relative !important;inset:auto !important}`,
    )
  }
  return rules
}

/**
 * The generated stylesheet for one document. Empty string when nothing
 * responds, so a document with no overrides ships no rules at all.
 */
export function responsiveCss(doc: Document): string {
  const rules: string[] = []
  // Widest first: the desktop band is the base, and each narrower band has to
  // be able to win, so it comes later.
  for (const bp of [...BREAKPOINTS].reverse()) {
    const { min, max } = BREAKPOINT_BAND[bp]
    const cond =
      max === null
        ? `(min-width: ${min}px)`
        : min > 0
          ? `(min-width: ${min}px) and (max-width: ${max}px)`
          : `(max-width: ${max}px)`
    const body: string[] = []
    for (const node of Object.values(doc.nodes)) {
      const over = node.responsive?.[bp]
      if (!over) continue
      body.push(...nodeRules(node.id, over))
    }
    if (body.length === 0) continue
    rules.push(`@container ${CONTAINER_NAME} ${cond}{${body.join('\n')}}`)
  }
  if (rules.length === 0) return ''
  return [
    `/* Generated by Loom: per-breakpoint layout. Do not edit by hand. */`,
    `.loom-container{container-type:inline-size;container-name:${CONTAINER_NAME}}`,
    ...rules,
  ].join('\n')
}

/**
 * The viewport widths the editor offers, narrowest first. These are the
 * CONTAINER widths, not window widths: the artboard is the thing being
 * measured.
 */
export const VIEWPORTS: ReadonlyArray<{ id: Breakpoint; label: string; width: number }> = [
  { id: 'sm', label: 'Phone', width: 390 },
  { id: 'md', label: 'Tablet', width: 834 },
  { id: 'lg', label: 'Desktop', width: 1280 },
]

/**
 * The zoom that shows a whole viewport in `room` px of canvas: never above
 * 100%, never below 25%. The canvas is ALWAYS the viewport's true width and
 * scales to fit; narrowing it instead (what it did) moved everything the
 * designer placed relative to the page, so "centred" in the design landed
 * left of centre in the preview.
 */
export function fitZoom(room: number, viewportWidth: number): number {
  if (!(room > 0) || !(viewportWidth > 0)) return 1
  return Math.min(1, Math.max(0.25, Math.floor((room / viewportWidth) * 100) / 100))
}

/** The viewport a given container width falls into. */
export function breakpointForWidth(width: number): Breakpoint {
  for (const bp of BREAKPOINTS) {
    const { min, max } = BREAKPOINT_BAND[bp]
    if (width >= min && (max === null || width <= max)) return bp
  }
  // Unreachable while the bands tile the space; fail wide rather than narrow,
  // so an out-of-range width still gets the base layout.
  return 'lg'
}
