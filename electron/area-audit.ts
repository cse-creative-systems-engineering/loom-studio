/**
 * The customization audit: can a designer reach every area of every component?
 *
 * Loom's promise is total customization. A component's ROOT takes the universal
 * props; everything inside it that the renderer styles itself is reachable only
 * through a declared part (see `src/render/parts.ts`). So the question is
 * mechanical, and this answers it mechanically:
 *
 *   For every component, in every state it can be in (the property audit's own
 *   probe states), render the OUTPUT with every node and part hooked, and look
 *   at every element the component drew inside its root. An element that sets
 *   its own look inline (colour, type, surface, spacing, border, shadow) must
 *   either be a declared part, and that part must accept every one of those
 *   properties, or it is an area the designer cannot customize.
 *
 * Findings are keyed by component, then by the WHAT (a stable description of
 * the element) so a backlog entry means one area, not one render of it.
 *
 * What does NOT count, and why:
 *  - Structural layout (display, flex, position, overflow, transform...). That
 *    is how the component is built, not how it looks; exposing it would let a
 *    designer break the component rather than style it.
 *  - Sizes computed from DATA (a bar's height, a progress fill's width): they
 *    are the value, not a style. Fixed sizes of a part ARE counted, as `size`.
 *  - Child nodes: they are components in their own right, audited on their own.
 *  - Effect layers (`data-loom-fx`): the atmosphere panel owns them.
 */

import { allComponents, type ComponentSpec } from '../src/model/registry'
import { renderNode } from '../src/render/web'
import { fieldsFor, PART_ATTR, partsInHook } from '../src/render/parts'
import { OUTPUT_HOOK } from '../src/render/responsive'
import { renderToStaticMarkup } from 'react-dom/server'
import { docWith, ID, probeStates } from './prop-audit'
import '../src/model/toolbox'

/**
 * Inline CSS longhands that are LOOK, mapped to the part field that would
 * control them. A field named here that `PART_FIELDS` does not have yet is
 * still reported: it is exactly the gap a new field would close.
 */
const LOOK: Array<[RegExp, string]> = [
  [/^color$/, 'color'],
  [/^font-size$/, 'fontSize'],
  [/^font-weight$/, 'fontWeight'],
  [/^font-family$/, 'fontFamily'],
  [/^font-style$/, 'fontStyle'],
  [/^line-height$/, 'lineHeight'],
  [/^letter-spacing$/, 'letterSpacing'],
  [/^text-transform$/, 'textTransform'],
  [/^text-align$/, 'align'],
  [/^text-decoration(-line|-color|-style|-thickness)?$/, 'decoration'],
  [/^background(-color|-image)?$/, 'background'],
  [/^padding-(left|right|inline-start|inline-end)$/, 'paddingX'],
  [/^padding-(top|bottom|block-start|block-end)$/, 'paddingY'],
  [/^border-(top|right|bottom|left)-(left|right)?-?radius$|^border-(top|bottom)-(left|right)-radius$/, 'radius'],
  [/^border-(top|right|bottom|left)-color$/, 'border'],
  [/^border-(top|right|bottom|left)-width$/, 'borderWidth'],
  [/^box-shadow$/, 'shadow'],
  [/^opacity$/, 'opacity'],
  [/^(row-|column-)?gap$/, 'gap'],
  [/^accent-color$/, 'accent'],
  [/^fill$/, 'fill'],
  [/^stroke$/, 'stroke'],
]

/** Longhands that are construction, not look, and never count. */
const STRUCTURE = /^(display|position|top|right|bottom|left|inset|z-index|overflow(-x|-y)?|flex(-.*)?|align-(items|self|content)|justify-(content|items|self)|order|grid-.*|place-.*|transform(-origin)?|translate|scale|rotate|transition(-.*)?|animation(-.*)?|cursor|pointer-events|user-select|white-space|word-break|overflow-wrap|text-overflow|box-sizing|vertical-align|border-(top|right|bottom|left)-style|border-collapse|border-spacing|table-layout|visibility|clip-path|outline(-.*)?|resize|appearance|content|list-style(-.*)?|font-variant(-.*)?|font-feature-settings|tab-size|object-fit|object-position|aspect-ratio|margin(-.*)?|width|height|min-width|min-height|max-width|max-height|backdrop-filter|filter|mix-blend-mode|isolation|will-change|contain|container(-.*)?|scrollbar-.*|scroll-.*|text-indent|hyphens|caret-color|mask(-.*)?|-webkit-.*|stroke-.*|fill-.*|background-(position|size|repeat|clip|origin|attachment)(-.*)?|text-shadow|columns|column-.*|text-wrap(-.*)?|text-underline-offset|inset-.*|writing-mode|direction|color-scheme|font-kerning|font-optical-sizing|font-synthesis(-.*)?|font-stretch|line-clamp|touch-action|border-image(-.*)?|font-size-adjust|font-language-override|font-variation-settings|white-space-collapse|--.*)$/

export interface AreaFinding {
  component: string
  /** Stable description of the element: owning part (if any), tag, and a text sample. */
  where: string
  /** Part fields this element needs that no part gives it. */
  needs: string[]
  /** 'unreachable' = no part at all; 'field' = in a part that lacks these fields. */
  kind: 'unreachable' | 'field'
  sample: string
}

/**
 * A stable name for an element: its tag path from the component root, plus
 * the first `data-loom-*` role it carries. Text is NOT part of it, because the
 * probe states fill content in differently and one area would count many times.
 */
function describe(el: Element, root: Element): string {
  const path: string[] = []
  for (let cur: Element | null = el; cur && cur !== root; cur = cur.parentElement) path.unshift(cur.tagName.toLowerCase())
  const loomAttr = [...el.attributes].map((a) => a.name).find((n) => n.startsWith('data-loom-') && n !== PART_ATTR && n !== OUTPUT_HOOK)
  return path.join('>') + (loomAttr ? ` ${loomAttr}` : '')
}

/** A short text sample, for a person reading the backlog. */
function sample(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24)
}

/** The look fields an element sets on itself, from its inline style and SVG paint attributes. */
function lookOf(el: Element): { fields: Set<string>; unknown: string[] } {
  const fields = new Set<string>()
  const unknown: string[] = []
  const st = (el as HTMLElement).style
  if (st) {
    for (let i = 0; i < st.length; i++) {
      const prop = st[i]
      // `border: none` expands to a width and colour for a border that is not
      // drawn: no look to customize on that side.
      const side = /^border-(top|right|bottom|left)-(color|width)$/.exec(prop)
      if (side && st.getPropertyValue(`border-${side[1]}-style`).trim() === 'none') continue
      const hit = LOOK.find(([re]) => re.test(prop))
      if (hit) {
        // A transparent or inherited value is the absence of a look.
        const v = st.getPropertyValue(prop).trim()
        // `text-decoration: none` expands to a style and colour for a line
        // that is not drawn.
        if (hit[1] === 'decoration' && st.getPropertyValue('text-decoration-line').trim() === 'none') continue
        if (v === 'transparent' || v === 'inherit' || v === 'none' || v === 'currentcolor' || v === 'initial' || v === 'unset' || v === '0px' && hit[1] !== 'radius') continue
        fields.add(hit[1])
      } else if (!STRUCTURE.test(prop)) {
        unknown.push(prop)
      }
    }
  }
  for (const attr of ['fill', 'stroke']) {
    const v = el.getAttribute(attr)
    if (v && v !== 'none' && v !== 'transparent' && v !== 'currentColor' && !v.startsWith('url(')) fields.add(attr)
  }
  return { fields, unknown }
}

export interface AreaReport {
  components: number
  elements: number
  findings: AreaFinding[]
  /** Inline properties neither LOOK nor STRUCTURE: the audit's own blind spots. */
  unclassified: string[]
}

export function auditAreas(only?: (spec: ComponentSpec) => boolean): AreaReport {
  const byKey = new Map<string, AreaFinding>()
  const unclassified = new Set<string>()
  let elements = 0
  let components = 0
  for (const spec of allComponents()) {
    if (only && !only(spec)) continue
    components += 1
    const parts = spec.parts ?? {}
    for (const state of probeStates(spec)) {
      const doc = docWith(spec.name, state.base, state.children)
      let html: string
      try {
        html = renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode: 'preview', hookAll: true }, ID))
      } catch {
        // A state the component refuses to render is the property audit's
        // business, not this one's.
        continue
      }
      const holder = new DOMParser().parseFromString(`<div id="area-audit-root">${html}</div>`, 'text/html').getElementById('area-audit-root')
      if (!holder) continue
      const root = holder.querySelector(`[${OUTPUT_HOOK}="${ID}"]`) ?? holder.firstElementChild
      if (!root) continue
      for (const el of root.querySelectorAll('*')) {
        // Another node's territory, or the atmosphere layer's.
        const owner = el.closest(`[${OUTPUT_HOOK}]`)
        if (owner && owner !== root) continue
        if (el.closest('[data-loom-fx]')) continue
        elements += 1
        const { fields, unknown } = lookOf(el)
        for (const u of unknown) unclassified.add(`${spec.name}: ${u}`)
        if (fields.size === 0) continue
        // An element can be several parts (the active link is `link` and
        // `active`): it is reachable through any of them.
        const names = partsInHook(el.getAttribute(PART_ATTR), ID).filter((n) => parts[n])
        const accepted = names.length > 0 ? new Set(names.flatMap((n) => fieldsFor(parts[n].fields).map((f) => f.key as string))) : null
        const needs = [...fields].filter((f) => !accepted || !accepted.has(f)).sort()
        if (needs.length === 0) continue
        const partName = names.join('+')
        const where = `${partName ? `[${partName}] ` : ''}${describe(el, root)}`
        const key = `${spec.name}|${where}`
        const prev = byKey.get(key)
        if (prev) {
          prev.needs = [...new Set([...prev.needs, ...needs])].sort()
        } else {
          byKey.set(key, { component: spec.name, where, needs, kind: accepted ? 'field' : 'unreachable', sample: sample(el) })
        }
      }
    }
  }
  return { components, elements, findings: [...byKey.values()], unclassified: [...unclassified].sort() }
}
