/**
 * Part styling: type and box for the named inner parts of a composite.
 *
 * Universal props style a component's ROOT. A composite's inner parts (a
 * grid's header cells, a KPI's number) style themselves inline, so a root
 * `fontSize` is inherited and immediately overridden: a control that looks
 * like it works and does not. Parts are how a designer reaches inside.
 *
 * The same pipe as responsive overrides and interaction states: one generated
 * stylesheet for the editor canvas, the preview and both exports, `!important`
 * because the base look is inline, and hooks only where they are needed.
 *
 * THE HOOK. A styled part carries `data-loom-part="<nodeId>/<part>"`. The
 * node id is IN the value, not found through an ancestor selector, for two
 * reasons: the same attribute works on every surface without the root's own
 * hook, and a KpiCard nested inside a Field can never pick up the Field's
 * `label` rule, because the rule names the Field.
 */

import type { Document, Node, PartStyle } from '../model/types'
import { getComponent, type ComponentSpec, type PartFieldGroup } from '../model/registry'
import { cssString } from './responsive'
import { isSafeColor } from './states'
import { resolveTheme, type Theme } from './theme'

export interface PartField {
  key: keyof PartStyle
  label: string
  group: PartFieldGroup
  kind: 'color' | 'number' | 'enum'
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: readonly string[]
}

/** Every field a part can take, in panel order. The one source for UI, op, loader and CSS. */
export const PART_FIELDS: readonly PartField[] = [
  { key: 'fontSize', label: 'Size', group: 'text', kind: 'number', min: 6, max: 96, step: 1, unit: 'px' },
  { key: 'fontWeight', label: 'Weight', group: 'text', kind: 'number', min: 100, max: 900, step: 100 },
  { key: 'color', label: 'Colour', group: 'text', kind: 'color' },
  { key: 'lineHeight', label: 'Line height', group: 'text', kind: 'number', min: 0.8, max: 3, step: 0.05 },
  { key: 'letterSpacing', label: 'Tracking', group: 'text', kind: 'number', min: -4, max: 12, step: 0.1, unit: 'px' },
  { key: 'textTransform', label: 'Case', group: 'text', kind: 'enum', options: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  { key: 'align', label: 'Align', group: 'text', kind: 'enum', options: ['left', 'center', 'right'] },
  { key: 'fontFamily', label: 'Font', group: 'text', kind: 'enum', options: ['sans', 'mono'] },
  { key: 'decoration', label: 'Decoration', group: 'text', kind: 'enum', options: ['none', 'underline', 'line-through'] },
  { key: 'background', label: 'Background', group: 'surface', kind: 'color' },
  { key: 'paddingX', label: 'Padding X', group: 'box', kind: 'number', min: 0, max: 64, step: 1, unit: 'px' },
  { key: 'paddingY', label: 'Padding Y', group: 'box', kind: 'number', min: 0, max: 64, step: 1, unit: 'px' },
  { key: 'radius', label: 'Radius', group: 'box', kind: 'number', min: 0, max: 64, step: 1, unit: 'px' },
  { key: 'border', label: 'Border colour', group: 'box', kind: 'color' },
  { key: 'borderWidth', label: 'Border width', group: 'box', kind: 'number', min: 0, max: 8, step: 1, unit: 'px' },
  { key: 'shadow', label: 'Shadow', group: 'box', kind: 'enum', options: ['none', 'sm', 'md', 'lg', 'glow'] },
  { key: 'gap', label: 'Spacing', group: 'layout', kind: 'number', min: 0, max: 64, step: 1, unit: 'px' },
]

/** The fields a part with these groups accepts. `box` includes the surface. */
export function fieldsFor(groups: readonly PartFieldGroup[]): PartField[] {
  const on = new Set<PartFieldGroup>(groups)
  if (on.has('box')) on.add('surface')
  return PART_FIELDS.filter((f) => on.has(f.group))
}

/** The parts a component declares, or none. */
export function partsOf(type: string): ComponentSpec['parts'] {
  return getComponent(type)?.parts
}

/**
 * Keep only fields this part accepts, with valid values clamped into range.
 * Returns what was dropped so the file loader can report it; the op path just
 * applies the clean result. An unknown part accepts nothing.
 */
export function cleanPartStyle(type: string, part: string, raw: Record<string, unknown>): { style: PartStyle; dropped: string[] } {
  const spec = partsOf(type)?.[part]
  const style: Record<string, string | number> = {}
  const dropped: string[] = []
  const allowed = new Map((spec ? fieldsFor(spec.fields) : []).map((f) => [f.key as string, f]))
  for (const [key, value] of Object.entries(raw)) {
    const field = allowed.get(key)
    if (!field) {
      dropped.push(`${key} (${PART_FIELDS.some((f) => f.key === key) ? 'not accepted by this part' : 'unknown'})`)
      continue
    }
    if (field.kind === 'color') {
      if (isSafeColor(value)) style[key] = value.trim()
      else dropped.push(`${key} (not a colour)`)
    } else if (field.kind === 'enum') {
      if (typeof value === 'string' && (field.options ?? []).includes(value)) style[key] = value
      else dropped.push(`${key} (not one of ${(field.options ?? []).join('|')})`)
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      style[key] = Math.min(field.max ?? value, Math.max(field.min ?? value, value))
    } else {
      dropped.push(`${key} (not a finite number)`)
    }
  }
  return { style: style as PartStyle, dropped }
}

/** True when this node styles the named part. */
export function partStyled(node: Node, part: string): boolean {
  return Object.keys(node.parts?.[part] ?? {}).length > 0 || !!node.looks?.[part]
}

export const PART_ATTR = 'data-loom-part'

/** The hook value for one part of one node. */
export function partHook(id: string, part: string): string {
  return `${id}/${part}`
}

/**
 * The attribute a renderer puts on a part's element(s). The editor always
 * carries it, so the panel can point at a part before it is styled; output
 * carries it only when the part IS styled, so a plain export stays clean.
 *
 * An element can be more than one part: the active link is a `link` AND the
 * `active` one. The hooks are a space-separated list (matched with `~=`), and
 * a later-declared part's rule wins over an earlier one's.
 */
export function partAttrs(node: Node, part: string | string[], editor: boolean): Record<string, string> {
  const names = (Array.isArray(part) ? part : [part]).filter((n) => editor || partStyled(node, n))
  return names.length > 0 ? { [PART_ATTR]: names.map((n) => partHook(node.id, n)).join(' ') } : {}
}

/** The part names an element's hook carries for node `id`. */
export function partsInHook(hook: string | null, id: string): string[] {
  if (!hook) return []
  return hook.split(/\s+/).filter((h) => h.startsWith(`${id}/`)).map((h) => h.slice(id.length + 1))
}

/** The selector for one part of one node, on every surface. */
export function partSelector(id: string, part: string): string {
  return `[${PART_ATTR}~=${cssString(partHook(id, part))}]`
}

/** A named elevation, from the document's own theme: never a raw value. */
function shadowOf(name: string, t: Theme): string {
  return name === 'sm' ? t.shadowSm : name === 'md' ? t.shadowMd : name === 'lg' ? t.shadowLg : name === 'glow' ? t.shadowGlow : 'none'
}

function decls(st: PartStyle, lines: boolean, t: Theme): string[] {
  const out: string[] = []
  if (st.fontSize !== undefined) out.push(`font-size:${st.fontSize}px`)
  if (st.fontWeight !== undefined) out.push(`font-weight:${st.fontWeight}`)
  if (st.color !== undefined) out.push(`color:${st.color}`)
  if (st.lineHeight !== undefined) out.push(`line-height:${st.lineHeight}`)
  if (st.letterSpacing !== undefined) out.push(`letter-spacing:${st.letterSpacing}px`)
  if (st.textTransform !== undefined) out.push(`text-transform:${st.textTransform}`)
  if (st.align !== undefined) out.push(`text-align:${st.align}`)
  // The theme's own faces, by role: a raw font stack typed into a part would
  // be the one place a design stops following its theme.
  if (st.fontFamily !== undefined) out.push(`font-family:${st.fontFamily === 'mono' ? t.fontMono : t.fontFamily}`)
  if (st.decoration !== undefined) out.push(`text-decoration-line:${st.decoration}`)
  if (st.background !== undefined) out.push(`background:${st.background}`)
  if (st.paddingX !== undefined) out.push(`padding-left:${st.paddingX}px`, `padding-right:${st.paddingX}px`)
  if (st.paddingY !== undefined) out.push(`padding-top:${st.paddingY}px`, `padding-bottom:${st.paddingY}px`)
  if (st.radius !== undefined) out.push(`border-radius:${st.radius}px`)
  // A width draws a full border. A colour alone recolours the lines a part
  // already draws (a grid's row rules), which is what a designer means there;
  // anywhere else it draws a hairline, or it would be a control that does
  // nothing (see `PartSpec.lines`).
  if (st.borderWidth !== undefined) out.push(`border-width:${st.borderWidth}px`, 'border-style:solid')
  else if (st.border !== undefined && !lines) out.push('border-width:1px', 'border-style:solid')
  if (st.border !== undefined) out.push(`border-color:${st.border}`)
  if (st.gap !== undefined) out.push(`gap:${st.gap}px`)
  if (st.shadow !== undefined) out.push(`box-shadow:${shadowOf(st.shadow, t)}`)
  return out.map((d) => `${d} !important`)
}

/**
 * The generated stylesheet for every styled part in a document. Empty when no
 * node styles a part. Sanitised again here, not only on the way in: a document
 * built in code never passed through the op or the loader, and this is where
 * values become stylesheet text.
 */
export function partCss(doc: Document, theme: Theme = resolveTheme(doc.meta.theme)): string {
  const rules: string[] = []
  for (const node of Object.values(doc.nodes)) {
    if (!node.parts) continue
    // In DECLARED order, not the order they were styled in: where an element
    // is two parts (a link that is the active one), the later part wins.
    const declared = Object.keys(partsOf(node.type) ?? {})
    for (const part of declared) {
      const raw = node.parts[part]
      if (!raw) continue
      const d = decls(cleanPartStyle(node.type, part, raw as Record<string, unknown>).style, partsOf(node.type)?.[part]?.lines === true, theme)
      if (d.length > 0) rules.push(`${partSelector(node.id, part)}{${d.join(';')}}`)
    }
  }
  if (rules.length === 0) return ''
  return [`/* Generated by Loom: part styling. Do not edit by hand. */`, ...rules].join('\n')
}
