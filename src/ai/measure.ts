/**
 * check_layout: what is actually wrong on screen, measured.
 *
 * An agent reading the document tree cannot see that a label is cut off, a
 * card spills out of its panel, two free nodes sit on top of each other, a
 * button is too small to tap on a phone, or grey text vanishes into a grey
 * card. These are measured on the real output boxes (the render window draws
 * the design as it ships, every node hooked) and reported per node, in words
 * the agent can act on.
 */

import type { Document, Node } from '../model/types'
import { getComponent } from '../model/registry'

export interface LayoutIssue {
  id: string
  type: string
  kind: 'clipped-text' | 'wrapped' | 'overflows-parent' | 'offscreen' | 'overlap' | 'small-target' | 'low-contrast' | 'zero-size'
  detail: string
}

export interface LayoutReport {
  viewport: string
  screen: { width: number; height: number }
  pageHeight: number
  /** How boxes are sized on this surface; must be the export's border-box. */
  boxSizing: string
  issues: LayoutIssue[]
  /** Every node's drawn box, rounded, relative to the screen. */
  boxes: Array<{ id: string; type: string; x: number; y: number; w: number; h: number }>
}

/** Controls that are one line by nature: wrapping means they were squeezed. */
const SINGLE_LINE = new Set(['Button', 'IconButton', 'Link', 'ToggleButton', 'DropdownButton', 'BackButton', 'Badge', 'Tag', 'Kbd', 'Select', 'SearchBox', 'Input'])

const INTERACTIVE = new Set(['Button', 'IconButton', 'Link', 'Input', 'PasswordInput', 'SearchBox', 'Select', 'ComboBox', 'Checkbox', 'Switch', 'ToggleButton', 'DropdownButton', 'NumberInput', 'DatePicker', 'TimePicker', 'TextArea', 'BackButton'])

function parseColor(c: string): [number, number, number, number] | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(c)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])] : null
}

function luminance([r, g, b]: [number, number, number, number]): number {
  const f = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** The colour actually behind an element: the nearest opaque-enough background. */
function backgroundOf(el: Element | null): [number, number, number, number] {
  for (let e = el; e; e = e.parentElement) {
    const c = parseColor(getComputedStyle(e).backgroundColor)
    if (c && c[3] >= 0.5) return c
  }
  const b = parseColor(getComputedStyle(document.body).backgroundColor)
  return b && b[3] >= 0.5 ? b : [255, 255, 255, 1]
}

export function measureLayout(stage: HTMLElement, doc: Document, screen: { width: number; height: number; viewport: string }): LayoutReport {
  const issues: LayoutIssue[] = []
  const boxes: LayoutReport['boxes'] = []
  const origin = stage.getBoundingClientRect()
  const el = (id: string) => stage.querySelector<HTMLElement>(`[data-loom-node="${CSS.escape(id)}"]`)
  const parentOf = new Map<string, string>()
  for (const n of Object.values(doc.nodes)) for (const c of n.children) parentOf.set(c, n.id)
  const name = (n: Node) => `${n.type}${typeof n.props.label === 'string' && n.props.label ? ` "${n.props.label}"` : typeof n.props.title === 'string' && n.props.title ? ` "${n.props.title}"` : typeof n.props.text === 'string' && n.props.text ? ` "${String(n.props.text).slice(0, 24)}"` : ''}`

  for (const n of Object.values(doc.nodes)) {
    if (n.visible === false) continue
    const e = el(n.id)
    if (!e) continue
    const r = e.getBoundingClientRect()
    const box = { id: n.id, type: n.type, x: Math.round(r.left - origin.left), y: Math.round(r.top - origin.top), w: Math.round(r.width), h: Math.round(r.height) }
    boxes.push(box)
    const spec = getComponent(n.type)

    if (box.w < 2 || box.h < 2) {
      if (n.type !== 'Divider') issues.push({ id: n.id, type: n.type, kind: 'zero-size', detail: `${name(n)} is drawn ${box.w}x${box.h}px: invisible` })
      continue
    }

    // Text cut off: content wider/taller than its box, with the overflow
    // hidden, on the node or anything inside it that is not another node
    // (a label's ellipsis often lives on an inner span).
    const cs = getComputedStyle(e)
    if (!spec?.container) {
      const inner = [e, ...e.querySelectorAll<HTMLElement>('*')].filter((x) => x === e || !x.closest('[data-loom-node]') || x.closest('[data-loom-node]') === e)
      const cut = inner.find((x) => {
        const xs = getComputedStyle(x)
        const clips = xs.overflowX !== 'visible' || xs.textOverflow === 'ellipsis'
        return clips && (x.textContent ?? '').trim() !== '' && (x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 2)
      })
      if (cut) issues.push({ id: n.id, type: n.type, kind: 'clipped-text', detail: `${name(n)}: its text needs ${cut.scrollWidth}x${cut.scrollHeight}px but has ${cut.clientWidth}x${cut.clientHeight}px, so part of it is cut off` })
    }

    // A one-line control whose words broke onto a second line ("Sign" over
    // "In"): not clipped, so the check above misses it, and it reads broken.
    if (SINGLE_LINE.has(n.type)) {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3
      const text = (e.textContent ?? '').trim()
      if (text.includes(' ') && r.height > lh * 1.8 + (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)) {
        issues.push({ id: n.id, type: n.type, kind: 'wrapped', detail: `${name(n)} wraps onto more than one line at ${box.w}px wide: give it room (or a width of "auto")` })
      }
    }

    // Beyond its container (the root is measured against the screen).
    const pid = parentOf.get(n.id)
    const pe = pid ? el(pid) : null
    if (pe) {
      const pr = pe.getBoundingClientRect()
      const out = Math.max(pr.left - r.left, r.right - pr.right, pr.top - r.top, r.bottom - pr.bottom)
      if (out > 2) issues.push({ id: n.id, type: n.type, kind: 'overflows-parent', detail: `${name(n)} extends ${Math.round(out)}px outside its ${doc.nodes[pid!]?.type ?? 'parent'} (${pid})` })
    }
    if (r.right - origin.left > screen.width + 2 || r.left - origin.left < -2) {
      issues.push({ id: n.id, type: n.type, kind: 'offscreen', detail: `${name(n)} runs off the ${screen.width}px screen (x ${box.x} to ${box.x + box.w})` })
    }

    // Too small to tap, on a phone.
    if (screen.viewport === 'sm' && INTERACTIVE.has(n.type) && (box.h < 44 || box.w < 44)) {
      issues.push({ id: n.id, type: n.type, kind: 'small-target', detail: `${name(n)} is ${box.w}x${box.h}px; on a phone a tap target should be at least 44x44` })
    }

    // Text that does not stand out from what is behind it (WCAG AA).
    if (!spec?.container && (e.textContent ?? '').trim()) {
      const fg = parseColor(cs.color)
      if (fg) {
        const bg = backgroundOf(e)
        const hi = Math.max(luminance(fg), luminance(bg))
        const lo = Math.min(luminance(fg), luminance(bg))
        const ratio = (hi + 0.05) / (lo + 0.05)
        const size = parseFloat(cs.fontSize)
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700)
        const need = large ? 3 : 4.5
        if (ratio < need) issues.push({ id: n.id, type: n.type, kind: 'low-contrast', detail: `${name(n)}: text contrast ${ratio.toFixed(2)}:1, needs ${need}:1 (${cs.color} on ${`rgb(${bg.slice(0, 3).join(', ')})`})` })
      }
    }
  }

  // Free siblings on top of each other (flow siblings never overlap).
  for (const n of Object.values(doc.nodes)) {
    if (n.flow) continue
    const kids = n.children.filter((c) => doc.nodes[c]?.visible !== false)
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = boxes.find((b) => b.id === kids[i])
        const b = boxes.find((x) => x.id === kids[j])
        if (!a || !b) continue
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (w > 4 && h > 4) issues.push({ id: b.id, type: b.type, kind: 'overlap', detail: `${name(doc.nodes[b.id]!)} overlaps ${name(doc.nodes[a.id]!)} by ${w}x${h}px (both free-positioned in ${n.type} ${n.id})` })
      }
    }
  }

  return { viewport: screen.viewport, screen: { width: screen.width, height: screen.height }, pageHeight: Math.round(stage.getBoundingClientRect().height), boxSizing: getComputedStyle(stage).boxSizing, issues, boxes }
}
