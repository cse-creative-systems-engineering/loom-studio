/**
 * Atelier DSL adapter — the interchange contract.
 *
 * Shane's `atelier-ai-bundle.zip` ships `component-dsl.json`, a per-element
 * shape that is a SUPERSET of Loom's `Document`:
 *
 *   { id, type, role, absolute:{x,y,w,h,rotation,z}, content:{text},
 *     styleTokens:{font,color,background,radius,shadow,padding},
 *     effects:{...}, constraints:{snapGrid,locked}, intent:"..." }
 *
 * Adopting it means Loom can import anything Atelier exports and vice versa,
 * rather than each tool having a private format. Everything else in Atelier's
 * bundle — the token JSONs, the four export targets, the AI prompt packs — is
 * downstream of this shape.
 *
 * Conversion is LOSSY IN ONE DIRECTION ONLY on purpose: Atelier is flat
 * (absolute siblings, no nesting), so DSL -> Loom can synthesise containers.
 * Loom -> DSL flattens, because the format has no tree.
 */

import type { Document, Node, NodeId, PropValue } from './types'
import { getComponent, normalizeProps } from './registry'
// Import the TOOLBOX, not the raw catalogs: toolbox.ts is what pulls in every
// catalog AND declares the core controls (Button, Panel, Heading, Label),
// which live there rather than in catalog1/2. Importing only the catalogs
// silently leaves those unregistered, so every control fails to resolve.
import './toolbox'

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

interface DslElement {
  id?: string
  type?: string
  role?: string
  absolute?: { x?: number; y?: number; w?: number; h?: number; rotation?: number; z?: number }
  content?: { text?: string; placeholder?: string }
  styleTokens?: Record<string, string | number>
  effects?: Record<string, unknown>
  constraints?: { snapGrid?: number; locked?: boolean }
  intent?: string
}

export interface DslBundle {
  artboard?: { w?: number; h?: number; radius?: number; bg?: string }
  elements?: DslElement[]
  designTokens?: unknown
  meta?: { name?: string }
}

export interface ImportResult {
  doc: Document | null
  /** Elements whose type Loom does not know, mapped to a generic Panel. */
  remapped: Array<{ from: string; to: string; count: number }>
  issues: string[]
}

/**
 * Atelier type -> Loom component, where the names differ.
 *
 * Every right-hand side is VERIFIED to exist in the registry; a name that does
 * not resolve would silently fall back to a generic Panel and lose the
 * element's semantics. Keep this table honest — `bundle-tests` asserts that
 * every Atelier type lands on a real component and that none falls back.
 */
const TYPE_ALIASES: Record<string, string> = {
  // Buttons
  'primary-button': 'Button',
  'ghost-button': 'Button',
  'glass-button': 'Button',
  'icon-button': 'IconButton',
  'shimmer-button': 'Button',
  'magnetic-button': 'Button',
  'glass-morph-button': 'Button',
  'spotlight-action': 'Button',
  'submit-button': 'Button',
  // Surfaces
  'glass-card': 'Card',
  'elevated-card': 'Card',
  'aurora-card': 'Card',
  'spotlight-card': 'Card',
  'glass-panel-pro': 'Card',
  'bento-tile': 'Card',
  'noise-card': 'Card',
  'tilt-card': 'Card',
  'pricing-tier': 'Card',
  'panel': 'Card',
  'card': 'Card',
  // Data display
  'metric-trend': 'Stat',
  'stat-card': 'Stat',
  'kpi': 'Stat',
  'metric': 'Stat',
  'sparkline': 'LineChart',
  'trend-chart': 'LineChart',
  // Text
  'display-heading': 'Hero',
  'gradient-display': 'Hero',
  'hero-heading': 'Hero',
  'headline': 'Heading',
  'section-title': 'Heading',
  'subheading': 'Heading',
  'body-text': 'Paragraph',
  'body-pro': 'Paragraph',
  'caption-text': 'Caption',
  'quote-text': 'Quote',
  // Labels / affordances
  eyebrow: 'Badge',
  'eyebrow-dot': 'Badge',
  badge: 'Badge',
  tag: 'Tag',
  link: 'Link',
  'text-link': 'Link',
  // Inputs
  input: 'TextArea',
  'text-input': 'TextArea',
  'form-input': 'TextArea',
  textarea: 'TextArea',
  select: 'Select',
  'dropdown': 'Select',
  checkbox: 'Checkbox',
  switch: 'Switch',
  toggle: 'Switch',
  slider: 'Slider',
  // Containers
  section: 'Section',
  'bento-grid': 'SidebarPanel',
  container: 'Card',
}

/** Exported so tests can assert the table is exhaustive, not just mostly right. */
export const TYPE_ALIAS = TYPE_ALIASES

/** Atelier style shorthand -> Loom props. */
function styleTokensToProps(t: DslElement['styleTokens']): Record<string, PropValue> {
  const out: Record<string, PropValue> = {}
  if (!t) return out

  if (typeof t.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(t.color)) {
    out.color = t.color
  }
  if (typeof t.background === 'string') {
    const bg = t.background
    if (bg.startsWith('#') || bg.startsWith('rgba')) {
      out.background = bg
      out.surface = 'solid'
    } else if (bg.includes('gradient')) {
      out.surface = 'gradient'
    }
  }
  if (typeof t.radius === 'number') out.radius = t.radius
  if (typeof t.shadow === 'string' && t.shadow !== 'none') out.elevation = t.shadow

  // "JetBrains Mono 11px/1.5 700 ls 1.4" -> family / size / weight / spacing
  if (typeof t.font === 'string') {
    const fam = /^\S+/.exec(t.font)?.[1]
    const size = /(\d+(?:\.\d+)?)px/.exec(t.font)?.[1]
    const weight = /\s(\d{3})\s/.exec(t.font)?.[1]
    if (fam) out.fontFamily = fam
    if (size) {
      const px = Number(size)
      // Snap to Loom's scale where it lands close, else keep the exact value.
      const scale: Array<[number, string]> = [
        [11, 'xs'],
        [13, 'sm'],
        [15, 'md'],
        [19, 'lg'],
        [22, 'xl'],
        [28, 'xxl'],
      ]
      const near = scale.find(([v]) => Math.abs(v - px) <= 3)
      out.size = near ? near[1] : px
    }
    if (weight) out.weight = weight
  }
  return out
}

/** Import an Atelier bundle into a Loom document. */
export function importDsl(raw: unknown): ImportResult {
  const issues: string[] = []
  const remappedCounts = new Map<string, number>()

  let bundle: DslBundle
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    // Atelier ships `component-dsl.json` as a BARE ARRAY of elements, while
    // the bundle as a whole is an object. Accept both, plus the wrapped form,
    // because a real user will hand us either one.
    if (Array.isArray(parsed)) {
      bundle = { elements: parsed as DslElement[] }
    } else {
      bundle = (parsed as DslBundle) ?? {}
    }
    if (!Array.isArray(bundle.elements)) {
      return { doc: null, remapped: [], issues: ['no elements array'] }
    }
  } catch (e) {
    return { doc: null, remapped: [], issues: [`invalid JSON: ${String(e)}`] }
  }

  const artW = Number(bundle.artboard?.w) || 1200
  const artH = Number(bundle.artboard?.h) || 800

  const rootId: NodeId = 'root'
  const nodes: Record<NodeId, Node> = {
    [rootId]: {
      id: rootId,
      type: 'Panel',
      props: normalizeProps('Panel', { x: 0, y: 0, padding: 0, gap: 0, direction: 'column' }),
      children: [],
      flow: true,
      visible: true,
      locked: false,
      z: 0,
    },
  }

  for (const el of bundle.elements) {
    const rawType = String(el.type ?? '')
    if (!rawType) {
      issues.push('element with no type skipped')
      continue
    }

    // Resolve the component, remapping unknown Atelier types to a Panel so
    // the geometry and text survive rather than the whole element vanishing.
    let target = rawType
    if (!getComponent(rawType)) {
      target = TYPE_ALIASES[rawType] ?? 'Panel'
      if (!getComponent(target)) target = 'Panel'
      remappedCounts.set(`${rawType} -> ${target}`, (remappedCounts.get(`${rawType} -> ${target}`) ?? 0) + 1)
    }

    const id: NodeId = `n${(el.id ?? Math.random().toString(36).slice(2, 9)).replace(/[^a-zA-Z0-9]/g, '')}`
    if (nodes[id]) {
      issues.push(`duplicate id ${el.id}, skipped`)
      continue
    }

    const a = el.absolute ?? {}
    // Only carry w/h when the DSL actually specified them; normalizeProps
    // drops undeclared keys, and an `undefined` would otherwise ride along.
    const geometry: Record<string, PropValue> = { x: Number(a.x) || 0, y: Number(a.y) || 0 }
    if (a.w !== undefined) geometry.w = Number(a.w)
    if (a.h !== undefined) geometry.h = Number(a.h)

    const props = normalizeProps(target, {
      ...styleTokensToProps(el.styleTokens),
      ...geometry,
      ...(el.content?.text ? { text: el.content.text, label: el.content.text } : {}),
      ...(el.content?.placeholder ? { placeholder: el.content.placeholder } : {}),
    })

    nodes[id] = {
      id,
      type: target,
      props,
      children: [],
      // Atelier is absolute by definition: every element is a free child of
      // the artboard, never a flow sibling.
      flow: false,
      visible: true,
      locked: el.constraints?.locked === true,
      z: Number(a.z) || 0,
      effects: el.effects,
    }
    nodes[rootId].children.push(id)
  }

  const doc: Document = {
    version: 1,
    meta: {
      name: bundle.meta?.name ?? 'Imported',
      targets: ['web'],
      theme: 'midnight',
      artboard: { w: artW, h: artH },
      snapGrid: 4,
      created: Date.now(),
    },
    root: rootId,
    nodes,
  }

  return {
    doc,
    remapped: [...remappedCounts.entries()].map(([k, count]) => {
      const [from, to] = k.split(' -> ')
      return { from, to, count }
    }),
    issues,
  }
}

/* ------------------------------------------------------------------ *
 * Writing
 * ------------------------------------------------------------------ */

/** Render a prop as an Atelier `styleTokens` shorthand. */
function fontShorthand(p: Record<string, PropValue>): string {
  const sizeMap: Record<string, number> = { xs: 11, sm: 13, md: 15, lg: 19, xl: 22, xxl: 28 }
  const size = typeof p.size === 'string' ? (sizeMap[p.size] ?? 15) : Number(p.size) || 15
  const family = String(p.fontFamily ?? 'Inter')
  const weight = String(p.weight ?? '500')
  const lh = '1.5'
  return `${family} ${size}px/${lh} ${weight}`
}

/**
 * Export a Loom document as an Atelier bundle.
 *
 * The DSL is FLAT, so nested containers are emitted as siblings carrying a
 * breadcrumb in `intent` — enough for an AI to understand the grouping even
 * though the format cannot express the tree.
 */
export function exportDsl(doc: Document): DslBundle {
  const elements: DslElement[] = []
  const breadcrumb = new Map<NodeId, string>()

  const walk = (id: NodeId, trail: string[]) => {
    const node = doc.nodes[id]
    if (!node) return
    breadcrumb.set(id, trail.join(' › '))
    for (const child of node.children) walk(child, [...trail, node.type])
  }
  walk(doc.root, [])

  for (const node of Object.values(doc.nodes)) {
    if (node.id === doc.root) continue
    if (node.visible === false) continue

    const p = node.props
    const styleTokens: Record<string, string | number> = {
      font: fontShorthand(p),
      color: String(p.color ?? ''),
      background: String(p.background ?? ''),
      radius: Number(p.radius ?? 0),
      shadow: String(p.elevation ?? 'none'),
      padding: `${p.paddingY ?? p.padding ?? 0}px ${p.paddingX ?? p.padding ?? 0}px`,
    }

    elements.push({
      id: node.id,
      type: node.type,
      role: node.type.match(/Button|Input|FormField/)
        ? 'control'
        : node.type.match(/Label|Heading/)
          ? 'text'
          : 'surface',
      absolute: {
        x: Math.round(Number(p.x) || 0),
        y: Math.round(Number(p.y) || 0),
        w: Math.round(Number(p.w) || Number(p.width) || Number(p.size) || 120),
        h: Math.round(Number(p.h) || Number(p.height) || 48),
        rotation: 0,
        z: node.z ?? 0,
      },
      content: { text: String(p.text ?? p.label ?? '') },
      styleTokens,
      effects: node.effects,
      constraints: { snapGrid: doc.meta.snapGrid ?? 4, locked: node.locked === true },
      intent: breadcrumb.get(node.id) || undefined,
    })
  }

  return {
    artboard: {
      w: doc.meta.artboard?.w ?? 1200,
      h: doc.meta.artboard?.h ?? 800,
      radius: 24,
      bg: 'dark',
    },
    elements,
    meta: { name: doc.meta.name },
  }
}
