/**
 * Web backend: compiles the semantic document tree into live DOM.
 *
 * This is a compiler, not a renderer. It walks the document and emits real
 * elements with real attributes, so the result is selectable, focusable, and
 * present in the accessibility tree. Anything GPU-flavoured attaches to this
 * DOM as a paint strategy rather than replacing it.
 *
 * FAIL-FAST: every component has an explicit style + preview + authoring
 * branch. Unknown types throw. There is no generic fallback div.
 */

import React from 'react'
import { getComponent } from '../model/registry'
import { parentOf } from '../model/ops'
import { typeStep, weightStep, resolveTheme, type Theme } from './theme'
import { applyEffects, normalizeEffects } from './effects'
import type { Document, Node, NodeId, PropValue } from '../model/types'

export interface RenderCtx {
  doc: Document
  onPointerDownNode?: (id: NodeId, e: React.PointerEvent) => void
  onContextMenuNode?: (id: NodeId, e: React.MouseEvent) => void
  selected: Set<NodeId>
  /** Resolved design tokens for this document. */
  theme?: Theme
  /**
   * `authoring` renders editor affordances (selection, handles, pointer
   * handlers). `preview` renders the OUTPUT ONLY — no outlines, no handles, no
   * data-loom-id hooks, real focusable controls. The preview surface must be
   * indistinguishable from what a user would actually ship.
   */
  mode?: 'authoring' | 'preview'
}

export const CORNERS = ['nw', 'ne', 'sw', 'se'] as const
export type Corner = (typeof CORNERS)[number]

function px(v: PropValue | undefined, fallback = 0): string {
  // Finite-only: NaN/Infinity would emit invalid CSS (`NaNpx`) that fails
  // silently in the browser. Non-finite geometry falls back like a missing key.
  return `${typeof v === 'number' && Number.isFinite(v) ? v : fallback}px`
}

function str(v: PropValue | undefined): string {
  return v == null ? '' : String(v)
}

function num(v: PropValue | undefined, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function csv(v: PropValue | undefined): string[] {
  return str(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Screen pixels → document units at a canvas zoom. Every pointer-derived
 * coordinate (drop point, drag delta, resize delta) passes through this, so
 * a drag at 200% moves the node half the screen distance — exactly like 100%.
 */
export function zoomed(pxValue: number, zoom: number): number {
  const z = typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  return pxValue / z
}

function toneColor(t: Theme, tone: string): string {
  switch (tone) {
    case 'success':
      return t.success
    case 'warning':
      return t.warning
    case 'danger':
      return t.danger
    case 'info':
    case 'accent':
      return t.accent
    case 'neutral':
      return t.textMuted
    default:
      return t.accent
  }
}

/**
 * Whether `id` is laid out by its parent's flow, or free-positioned.
 *
 * The rule is a single decision made by the PARENT: a flow container places
 * its children, a free container lets them float at their own coordinates.
 * Deciding per-child is what previously put every leaf at `left:0 top:0`
 * inside a flow panel.
 */
export function isFlowChild(doc: Document, id: NodeId): boolean {
  const parent = parentOf(doc, id)
  if (!parent) return false
  return doc.nodes[parent]?.flow === true
}

/**
 * Resolve a node's visual style from the document's THEME, not from literals.
 *
 * Every colour, radius, size, and shadow comes from `theme.ts`. That is what
 * makes a theme change one edit at the document level instead of an edit per
 * node — the gap the output-quality review called the single biggest quality
 * problem in the designed artifact.
 */
function styleFor(node: Node, flowChild: boolean, t: Theme): React.CSSProperties {
  const p = node.props
  const spec = getComponent(node.type)
  if (!spec) throw new Error(`unknown component: ${node.type}`)
  const isContainer = Boolean(spec.container)
  const s: React.CSSProperties = {
    fontFamily: t.fontFamily,
    transition: `box-shadow ${t.motionBase}ms ${t.ease}, background ${t.motionBase}ms ${t.ease}, border-color ${t.motionBase}ms ${t.ease}`,
  }

  if (isContainer) {
    // Anchor for absolutely-positioned children. Without this, free children
    // resolve against the nearest positioned ancestor and escape the panel.
    s.position = 'relative'
  }

  if (!flowChild) {
    s.position = 'absolute'
    s.left = px(p.x)
    s.top = px(p.y)
  }

  switch (node.type) {
    case 'Panel': {
      const glass = p.glass === true
      s.padding = px(p.padding, t.space4)
      s.borderRadius = px(p.radius, t.radiusLg)
      s.display = 'flex'
      s.flexDirection = p.direction === 'row' ? 'row' : 'column'
      s.gap = px(p.gap, t.space3)
      s.background = glass
        ? t.surfaceGlass
        : p.surface === 'gradient'
          ? `linear-gradient(140deg, ${t.surface}, ${t.bg})`
          : t.surface
      s.border = `1px solid ${t.border}`
      s.backdropFilter = glass ? 'blur(18px) saturate(140%)' : undefined
      s.boxShadow = t.shadowMd
      break
    }
    case 'Stack': {
      s.display = 'flex'
      s.flexDirection = 'column'
      s.gap = px(p.gap, t.space2)
      s.alignItems =
        p.align === 'start' ? 'flex-start' : p.align === 'end' ? 'flex-end' : p.align === 'center' ? 'center' : 'stretch'
      break
    }
    case 'Grid': {
      s.display = 'grid'
      s.gridTemplateColumns = `repeat(${num(p.columns, 2) || 2}, minmax(0, 1fr))`
      s.gap = px(p.gap, t.space3)
      s.alignItems = 'stretch'
      break
    }
    case 'Button': {
      const sizes: Record<string, [number, number]> = {
        sm: [t.space1 * 2, t.space2 + 2],
        md: [t.space2 + 2, t.space4],
        lg: [t.space3 + 2, t.space5],
      }
      const [py, pxv] = sizes[str(p.size)] ?? sizes.md
      const variants: Record<string, React.CSSProperties> = {
        primary: { background: t.accent, color: t.textOnAccent },
        secondary: { background: t.surface, color: t.textPrimary },
        ghost: { background: 'transparent', color: t.textSecondary },
        danger: { background: t.danger, color: t.textOnAccent },
      }
      Object.assign(s, variants[str(p.variant)] ?? variants.primary)
      s.padding = `${py}px ${pxv}px`
      s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`
      s.fontSize = `${t.textSm}px`
      s.fontWeight = t.weightSemibold
      s.lineHeight = 1.2
      s.cursor = p.disabled === true ? 'not-allowed' : 'pointer'
      s.opacity = p.disabled === true ? 0.5 : 1
      if (p.glow === true) s.boxShadow = t.shadowGlow
      break
    }
    case 'Label': {
      s.fontSize = `${typeStep(t, str(p.size))}px`
      s.fontWeight = weightStep(t, str(p.weight) || 'medium')
      s.color = str(p.color) || t.textPrimary
      s.lineHeight = t.lineHeight
      s.letterSpacing = str(p.size) === 'xs' ? '0.4px' : 'normal'
      s.whiteSpace = 'pre-wrap'
      break
    }
    case 'Input': {
      s.width = px(p.width, 200)
      s.padding = `${t.space2 + 1}px ${t.space3}px`
      s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`
      s.background = t.surface
      s.color = t.textPrimary
      s.fontSize = `${t.textSm}px`
      s.lineHeight = 1.3
      s.outline = 'none'
      break
    }
    case 'FormField': {
      s.display = 'flex'
      s.flexDirection = 'column'
      s.gap = `${t.space1 + 1}px`
      s.width = px(p.width, 240)
      break
    }
    case 'Heading': {
      s.lineHeight = 1.2
      s.color = str(p.color) || t.textPrimary
      s.textAlign = (str(p.align) || 'left') as React.CSSProperties['textAlign']
      break
    }
    case 'Gauge': {
      s.width = px(p.size, 140)
      s.height = px(p.size, 140)
      break
    }
    case 'Sparkline': {
      s.width = px(p.width, 220)
      s.height = px(p.height, 60)
      break
    }
    /* ---- catalog1 containers ---- */
    case 'Card': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space3)
      s.padding = px(p.padding, t.space4); s.borderRadius = px(p.radius, t.radiusLg)
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.boxShadow = p.elevation === 'none' ? undefined : p.elevation === 'sm' ? t.shadowSm : p.elevation === 'lg' ? t.shadowLg : t.shadowMd
      break
    }
    case 'Tabs': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space2)
      s.padding = `${t.space3}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      break
    }
    case 'TabPanel': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = px(p.padding, t.space3); s.borderRadius = `${t.radiusMd}px`
      s.background = t.bg; s.border = `1px solid ${t.border}`
      break
    }
    case 'Accordion': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space2)
      break
    }
    case 'AccordionItem': {
      s.display = 'flex'; s.flexDirection = 'column'
      s.borderRadius = `${t.radiusMd}px`; s.background = t.surface
      s.border = `1px solid ${t.border}`
      break
    }
    case 'Modal': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space3}px`
      s.width = px(p.width, 480); s.padding = `${t.space5}px`
      s.borderRadius = `${t.radiusLg}px`; s.background = t.surface
      s.border = `1px solid ${t.borderStrong}`; s.boxShadow = t.shadowLg
      break
    }
    case 'Drawer': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space3}px`
      s.width = px(p.width, 320); s.padding = `${t.space4}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      break
    }
    case 'Section': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 10)
      s.padding = px(p.padding, t.space4); s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'GroupBox': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = px(p.padding, t.space3); s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`
      break
    }
    case 'ScrollView': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.height = px(p.height, 300); s.overflow = 'auto'
      s.padding = `${t.space3}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = t.bg; s.border = `1px solid ${t.border}`
      break
    }
    case 'SplitH': {
      s.display = 'flex'; s.flexDirection = 'row'; s.gap = px(p.gap, t.space2)
      break
    }
    case 'SplitV': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space2)
      break
    }
    case 'Toolbar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = px(p.gap, t.space2); s.padding = `${t.space2}px ${t.space3}px`
      s.borderRadius = `${t.radiusMd}px`; s.background = t.surface
      s.border = `1px solid ${t.border}`
      break
    }
    case 'StatusBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space2}px`; s.padding = `${t.space2}px ${t.space3}px`
      s.fontSize = `${t.textXs}px`; s.color = t.textSecondary
      s.background = t.surface; s.borderTop = `1px solid ${t.border}`
      break
    }
    case 'Hero': {
      s.display = 'flex'; s.flexDirection = 'column'; s.alignItems = 'center'
      s.gap = `${t.space3}px`; s.padding = px(p.padding, t.space8)
      s.textAlign = 'center'; s.borderRadius = `${t.radiusLg}px`
      s.background = `linear-gradient(140deg, ${t.surface}, ${t.bg})`
      s.border = `1px solid ${t.border}`
      break
    }
    case 'HeaderBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space3}px`; s.height = px(p.height, 56)
      s.padding = `0 ${t.space4}px`; s.background = t.surface
      s.borderBottom = `1px solid ${t.border}`
      break
    }
    case 'FooterBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.height = px(p.height, 48); s.padding = `0 ${t.space4}px`
      s.fontSize = `${t.textXs}px`; s.color = t.textMuted
      s.background = t.surface; s.borderTop = `1px solid ${t.border}`
      break
    }
    case 'SidebarPanel': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.width = px(p.width, 240); s.padding = `${t.space4}px`
      s.background = t.surface; s.borderRight = `1px solid ${t.border}`
      break
    }
    case 'FormGrid': {
      s.display = 'grid'
      s.gridTemplateColumns = `repeat(${num(p.columns, 2) || 2}, minmax(0, 1fr))`
      s.gap = px(p.gap, t.space3)
      break
    }
    case 'BannerBox': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space2}px`; s.padding = `${t.space3}px ${t.space4}px`
      s.borderRadius = `${t.radiusMd}px`; s.fontSize = `${t.textSm}px`
      s.background = `${toneColor(t, str(p.tone))}1a`
      s.border = `1px solid ${toneColor(t, str(p.tone))}55`
      s.color = t.textPrimary
      break
    }
    /* ---- catalog1 controls ---- */
    case 'IconButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.justifyContent = 'center'
      s.width = str(p.size) === 'sm' ? '28px' : str(p.size) === 'lg' ? '44px' : '36px'
      s.height = str(p.size) === 'sm' ? '28px' : str(p.size) === 'lg' ? '44px' : '36px'
      s.borderRadius = `${t.radiusMd}px`
      s.background = str(p.variant) === 'primary' ? t.accent : str(p.variant) === 'ghost' ? 'transparent' : t.surface
      s.color = str(p.variant) === 'primary' ? t.textOnAccent : t.textPrimary
      s.border = `1px solid ${t.borderStrong}`
      s.cursor = p.disabled === true ? 'not-allowed' : 'pointer'
      s.opacity = p.disabled === true ? 0.5 : 1
      break
    }
    case 'Checkbox': case 'Radio': case 'Switch': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      s.opacity = p.disabled === true ? 0.55 : 1
      break
    }
    case 'RadioGroup': case 'Checklist': case 'ButtonGroup': {
      s.display = 'flex'; s.flexDirection = 'row'; s.flexWrap = 'wrap'
      s.gap = px(p.gap, 8); s.alignItems = 'center'
      break
    }
    case 'Slider': {
      s.display = 'flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.width = '200px'; s.color = t.textSecondary; s.fontSize = `${t.textXs}px`
      break
    }
    case 'Select': case 'ComboBox': case 'SearchBox': case 'NumberInput':
    case 'PasswordInput': case 'DatePicker': case 'TimePicker': case 'ColorInput':
    case 'SpinBox': {
      s.display = 'inline-flex'; s.alignItems = 'center'
      s.padding = `${t.space2}px ${t.space3}px`; s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`; s.background = t.surface
      s.color = t.textPrimary; s.fontSize = `${t.textSm}px`; s.gap = `${t.space2}px`
      break
    }
    case 'TextArea': {
      s.width = px(p.width, 280); s.padding = `${t.space2 + 1}px ${t.space3}px`
      s.borderRadius = `${t.radiusMd}px`; s.border = `1px solid ${t.borderStrong}`
      s.background = t.surface; s.color = t.textPrimary; s.fontSize = `${t.textSm}px`
      break
    }
    case 'FileUpload': {
      s.display = 'flex'; s.flexDirection = 'column'; s.alignItems = 'center'; s.justifyContent = 'center'
      s.gap = `${t.space2}px`; s.padding = `${t.space5}px`
      s.borderRadius = `${t.radiusLg}px`; s.border = `1px dashed ${t.borderStrong}`
      s.background = t.bg; s.color = t.textSecondary; s.fontSize = `${t.textSm}px`
      break
    }
    case 'DropdownButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.padding = `${t.space2 + 2}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = str(p.variant) === 'primary' ? t.accent : t.surface
      s.color = str(p.variant) === 'primary' ? t.textOnAccent : t.textPrimary
      s.border = `1px solid ${t.borderStrong}`; s.fontSize = `${t.textSm}px`
      s.fontWeight = t.weightSemibold; s.cursor = 'pointer'
      break
    }
    case 'Rating': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '2px'
      s.fontSize = `${t.textLg}px`; s.color = t.warning
      break
    }
    case 'ToggleButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.justifyContent = 'center'
      s.padding = `${t.space2}px ${t.space4}px`; s.borderRadius = `${t.radiusFull}px`
      s.fontSize = `${t.textSm}px`; s.fontWeight = t.weightSemibold
      s.background = p.pressed === true ? t.accent : t.surface
      s.color = p.pressed === true ? t.textOnAccent : t.textSecondary
      s.border = `1px solid ${t.borderStrong}`; s.cursor = 'pointer'
      break
    }
    case 'Segmented': {
      s.display = 'inline-flex'; s.gap = '2px'; s.padding = '3px'
      s.borderRadius = `${t.radiusMd}px`; s.background = t.bg
      s.border = `1px solid ${t.border}`
      break
    }
    case 'TagInput': case 'OtpInput': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.padding = `${t.space2}px ${t.space3}px`; s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`; s.background = t.surface
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      break
    }
    /* ---- catalog2 text ---- */
    case 'Paragraph': {
      s.fontSize = str(p.size) === 'xs' ? `${t.textXs}px` : str(p.size) === 'sm' ? `${t.textSm}px` : str(p.size) === 'lg' ? `${t.textLg}px` : `${t.textMd}px`
      s.color = str(p.color) || t.textPrimary; s.lineHeight = t.lineHeight
      s.textAlign = (str(p.align) || 'left') as React.CSSProperties['textAlign']
      s.whiteSpace = 'pre-wrap'
      break
    }
    case 'Caption': {
      s.fontSize = `${t.textXs}px`; s.color = str(p.color) || t.textMuted
      s.lineHeight = 1.4
      break
    }
    case 'Quote': {
      s.fontSize = `${t.textLg}px`; s.fontStyle = 'italic'; s.lineHeight = 1.5
      s.color = t.textPrimary; s.borderLeft = `3px solid ${str(p.accent) || t.accent}`
      s.paddingLeft = `${t.space4}px`
      break
    }
    case 'CodeBlock': {
      s.fontFamily = t.fontMono; s.fontSize = `${t.textSm}px`
      s.background = t.bg; s.color = t.textPrimary
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      s.padding = `${t.space3}px ${t.space4}px`; s.whiteSpace = 'pre-wrap'
      break
    }
    case 'InlineCode': {
      s.fontFamily = t.fontMono; s.fontSize = '0.92em'
      s.background = `${t.accent}1a`; s.color = t.accent
      s.padding = '1px 6px'; s.borderRadius = `${t.radiusSm}px`
      break
    }
    case 'Link': {
      s.fontSize = `${t.textSm}px`; s.color = str(p.color) || t.accent
      s.textDecoration = p.underline === false ? 'none' : 'underline'
      s.cursor = 'pointer'
      break
    }
    case 'BulletList': case 'NumberedList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 6)
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary; s.paddingLeft = `${t.space5}px`
      break
    }
    case 'Divider': {
      s.height = px(p.thickness, 1); s.marginTop = px(p.margin, 12); s.marginBottom = px(p.margin, 12)
      s.background = str(p.color) || t.borderStrong; s.opacity = 0.9
      break
    }
    case 'Badge': case 'Tag': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '4px'
      s.fontSize = str(p.size) === 'md' ? `${t.textSm}px` : `${t.textXs}px`
      s.fontWeight = t.weightSemibold; s.padding = str(p.size) === 'md' ? '4px 12px' : '2px 9px'
      s.borderRadius = `${t.radiusFull}px`
      s.background = `${toneColor(t, str(p.tone))}1e`; s.color = toneColor(t, str(p.tone))
      s.border = `1px solid ${toneColor(t, str(p.tone))}44`
      break
    }
    case 'Kbd': {
      s.display = 'inline-flex'; s.fontFamily = t.fontMono; s.fontSize = `${t.textXs}px`
      s.padding = '2px 7px'; s.borderRadius = `${t.radiusSm}px`
      s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      s.borderBottomWidth = '2px'; s.color = t.textSecondary
      break
    }
    /* ---- catalog2 data ---- */
    case 'Table': {
      s.display = 'flex'; s.flexDirection = 'column'; s.fontSize = `${t.textSm}px`
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      s.overflow = 'hidden'; s.background = t.surface
      break
    }
    case 'Stat': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '2px'
      break
    }
    case 'ProgressBar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '6px'
      s.width = '220px'; s.fontSize = `${t.textXs}px`; s.color = t.textSecondary
      break
    }
    case 'ProgressRing': {
      s.width = px(p.size, 72); s.height = px(p.size, 72)
      break
    }
    case 'Avatar': {
      s.width = px(p.size, 40); s.height = px(p.size, 40)
      s.borderRadius = `${t.radiusFull}px`; s.display = 'inline-flex'
      s.alignItems = 'center'; s.justifyContent = 'center'
      s.fontWeight = t.weightBold; s.color = t.textOnAccent
      s.background = str(p.tone) === 'neutral' ? t.textMuted : str(p.tone) === 'success' ? t.success : str(p.tone) === 'warning' ? t.warning : t.accent
      break
    }
    case 'AvatarGroup': {
      s.display = 'inline-flex'; s.alignItems = 'center'
      break
    }
    case 'Image': {
      s.borderRadius = px(p.radius, 12); s.background = t.bg
      s.border = `1px solid ${t.border}`; s.overflow = 'hidden'
      s.width = '320px'
      s.aspectRatio = str(p.aspect) === '1:1' ? '1 / 1' : str(p.aspect) === '4:3' ? '4 / 3' : str(p.aspect) === 'auto' ? undefined : '16 / 9'
      break
    }
    case 'BarChart': {
      s.width = '280px'; s.height = px(p.height, 120)
      break
    }
    case 'PieChart': {
      s.width = px(p.size, 140); s.height = px(p.size, 140)
      break
    }
    case 'LineChart': {
      s.width = px(p.width, 280); s.height = px(p.height, 140)
      break
    }
    case 'Timeline': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 12)
      s.paddingLeft = `${t.space4}px`
      break
    }
    case 'TimelineItem': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '2px'
      s.fontSize = `${t.textSm}px`; s.paddingBottom = `${t.space2}px`
      break
    }
    case 'TreeList': case 'DataList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 4)
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      break
    }
    case 'KeyValue': {
      s.display = 'flex'
      s.flexDirection = str(p.layout) === 'column' ? 'column' : 'row'
      s.gap = `${t.space2}px`; s.fontSize = `${t.textSm}px`
      break
    }
    case 'Calendar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space4}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.width = '280px'
      break
    }
    case 'KanbanColumn': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space3}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.bg; s.border = `1px solid ${t.border}`; s.minHeight = '120px'
      break
    }
    case 'EmptyState': {
      s.display = 'flex'; s.flexDirection = 'column'; s.alignItems = 'center'
      s.gap = `${t.space2}px`; s.padding = `${t.space6}px`; s.textAlign = 'center'
      break
    }
    case 'Skeleton': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      break
    }
    case 'DataCard': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space4}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`; s.boxShadow = t.shadowSm
      break
    }
    /* ---- catalog2 navigation ---- */
    case 'NavBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space3}px`; s.height = px(p.height, 56)
      s.padding = `0 ${t.space4}px`; s.background = t.surface
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'NavLink': {
      s.fontSize = `${t.textSm}px`; s.fontWeight = p.active === true ? t.weightSemibold : t.weightMedium
      s.color = p.active === true ? t.accent : t.textSecondary
      s.padding = `${t.space1 + 2}px ${t.space3}px`
      s.borderRadius = `${t.radiusSm}px`
      s.background = p.active === true ? `${t.accent}14` : 'transparent'
      s.cursor = 'pointer'
      break
    }
    case 'SideNav': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space1}px`
      s.width = px(p.width, 220); s.padding = `${t.space3}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'Breadcrumbs': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space2}px`; s.fontSize = `${t.textXs}px`; s.color = t.textMuted
      break
    }
    case 'Pagination': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '4px'
      break
    }
    case 'Stepper': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      break
    }
    case 'Menu': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 2)
      s.padding = `${t.space2}px`; s.background = t.surface
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      s.minWidth = '180px'
      break
    }
    case 'MenuItem': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.padding = `${t.space2}px ${t.space3}px`
      s.borderRadius = `${t.radiusSm}px`
      s.background = p.active === true ? `${t.accent}14` : 'transparent'
      s.color = p.danger === true ? t.danger : p.active === true ? t.accent : t.textPrimary
      s.cursor = 'pointer'
      break
    }
    case 'CommandBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = px(p.gap, 8); s.padding = `${t.space2}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'TabBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.gap = '2px'
      s.padding = '3px'; s.background = t.bg
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'AnchorList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space1}px`
      s.fontSize = `${t.textSm}px`
      break
    }
    case 'BackButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.fontWeight = t.weightMedium
      s.color = t.textSecondary; s.cursor = 'pointer'
      break
    }
    /* ---- catalog2 feedback ---- */
    case 'Alert': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '4px'
      s.padding = `${t.space3}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = `${toneColor(t, str(p.tone))}12`
      s.border = `1px solid ${toneColor(t, str(p.tone))}55`
      break
    }
    case 'Toast': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.padding = `${t.space3}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      s.boxShadow = t.shadowLg; s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      break
    }
    case 'Spinner': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.color = t.textSecondary
      break
    }
    case 'LoadingBar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '6px'; s.width = '220px'
      break
    }
    case 'ProgressDots': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '6px'
      break
    }
    case 'InlineMessage': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.color = toneColor(t, str(p.tone))
      break
    }
    case 'ErrorSummary': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = `${t.danger}10`; s.border = `1px solid ${t.danger}55`
      break
    }
    case 'SuccessCheck': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.color = t.success
      break
    }
    case 'WarningCallout': case 'InfoCallout': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '4px'
      s.padding = `${t.space3}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      s.borderLeftWidth = '3px'
      break
    }
    case 'ConfirmDialog': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space3}px`
      s.padding = `${t.space5}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      s.boxShadow = t.shadowLg; s.width = '400px'
      break
    }
    case 'NotificationList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 8)
      break
    }
    default:
      throw new Error(`unknown component: ${node.type}`)
  }

  // An author-dragged size overrides whatever the component derives from its
  // own props (Input.width, Gauge.size, ...). This is what the resize handles
  // write, and it must win or the handles would do nothing visible.
  if (typeof p.w === 'number') s.width = `${p.w}px`
  if (typeof p.h === 'number') s.height = `${p.h}px`

  return s
}

/**
 * Render one node as OUTPUT, not as an editable element.
 *
 * Everything here is what a user would actually ship: real `<button>`,
 * `<input>`, focusable, with the component's own styling and none of the
 * editor's affordances. Keeping this a separate function is what guarantees
 * the preview cannot drift into "the canvas with the chrome stripped".
 */
function renderPreviewNode(
  node: Node,
  flowChild: boolean,
  children: React.ReactElement[],
  key: string | number | undefined,
  t: Theme,
): React.ReactElement {
  const style = styleFor(node, flowChild, t)

  // The atmosphere layer must reach the OUTPUT, not just the editor. This is
  // the most important wiring in the file: a premium card that exports as a
  // flat rectangle is exactly the "output is a bootstrap template" bug.
  const eff = applyEffects(normalizeEffects(node.effects), t, {}, node.id)
  Object.assign(style, eff.style)
  style.zIndex = node.z ?? 0
  // Decoration layers ride INSIDE the node's own box, never beside it: a
  // sibling wrapper would break the absolute-positioning contract that every
  // free-positioned node depends on.
  const layers = eff.layers
  const content = renderPreviewBody(node, style, children, t, key)

  if (!layers.length) return content

  // Prepend the decoration layers INSIDE the element, preserving whatever
  // children it already had. `cloneElement`'s variadic children REPLACE the
  // original, so the existing kids are read back out and re-supplied.
  if (content.type === React.Fragment) {
    const kids = (content.props as { children?: React.ReactNode }).children
    return (
      <React.Fragment key={key}>
        {layers}
        {kids}
      </React.Fragment>
    )
  }
  const existing = (content.props as { children?: React.ReactNode }).children
  return React.cloneElement(
    content,
    { key },
    ...([layers, existing] as never[]),
  )
}

/** The node's own element, with no effect decoration. */
function renderPreviewBody(
  node: Node,
  style: React.CSSProperties,
  children: React.ReactElement[],
  t: Theme,
  key: string | number | undefined,
): React.ReactElement {
  const p = node.props

  switch (node.type) {
    case 'Button':
      return (
        <button key={key} type="button" style={style} disabled={p.disabled === true}>
          {str(p.label)}
        </button>
      )
    case 'Heading': {
      const level = str(p.level) || '1'
      const size = level === '1' ? t.textXxl : level === '2' ? t.textXl : t.textLg
      return (
        <div
          key={key}
          style={{
            ...style,
            fontSize: `${size}px`,
            fontWeight: level === '1' ? t.weightBold : t.weightSemibold,
            lineHeight: 1.2,
            letterSpacing: level === '1' ? '-0.4px' : 'normal',
            color: str(p.color) || t.textPrimary,
            textAlign: (str(p.align) || 'left') as React.CSSProperties['textAlign'],
          }}
        >
          {str(p.text)}
        </div>
      )
    }
    case 'Label':
      return (
        <div key={key} style={style}>
          {str(p.text)}
        </div>
      )
    case 'FormField':
      return (
        <div key={key} style={style}>
          {str(p.label) ? (
            <span
              style={{
                fontSize: `${t.textSm}px`,
                fontWeight: t.weightMedium,
                color: t.textSecondary,
                lineHeight: t.lineHeight,
              }}
            >
              {str(p.label)}
            </span>
          ) : null}
          <input
            type="text"
            style={{
              padding: `${t.space2 + 1}px ${t.space3}px`,
              borderRadius: `${t.radiusMd}px`,
              border: `1px solid ${str(p.error) ? t.danger : t.borderStrong}`,
              background: t.surface,
              color: t.textPrimary,
              fontSize: `${t.textSm}px`,
              fontFamily: t.fontFamily,
              outline: 'none',
              width: '100%',
            }}
            placeholder={str(p.placeholder)}
            defaultValue={str(p.value)}
            onChange={() => undefined}
          />
          {str(p.error) ? (
            <span style={{ fontSize: `${t.textXs}px`, color: t.danger, lineHeight: 1.35 }}>
              {str(p.error)}
            </span>
          ) : str(p.hint) ? (
            <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, lineHeight: 1.35 }}>
              {str(p.hint)}
            </span>
          ) : null}
        </div>
      )
    case 'Input':
      return (
        <input
          key={key}
          type="text"
          style={style}
          placeholder={str(p.placeholder)}
          defaultValue={str(p.value)}
          onChange={() => undefined}
        />
      )
    case 'Gauge':
      return (
        <div key={key} style={style}>
          <GaugeFace node={node} t={t} />
        </div>
      )
    case 'Sparkline':
      return (
        <div key={key} style={style}>
          <Spark node={node} t={t} />
        </div>
      )
    case 'Panel': {
      if (str(p.title)) {
        return (
          <div key={key} style={{ ...style, flexDirection: 'column', alignItems: 'stretch' }}>
            <span
              style={{
                fontSize: `${t.textXs}px`,
                fontWeight: t.weightSemibold,
                letterSpacing: '0.6px',
                textTransform: 'uppercase',
                color: t.textMuted,
                marginBottom: `${t.space2}px`,
              }}
            >
              {str(p.title)}
            </span>
            {children}
          </div>
        )
      }
      return <div key={key} style={style}>{children}</div>
    }
    case 'Stack':
    case 'Grid':
      return <div key={key} style={style}>{children}</div>
    /* ---- catalog1 containers ---- */
    case 'Card':
      return (
        <div key={key} style={style}>
          {str(p.title) ? <div style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</div> : null}
          {children}
        </div>
      )
    case 'Tabs': {
      const tabs = csv(p.tabs)
      const active = num(p.active, 0)
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, paddingBottom: `${t.space2}px` }}>
            {tabs.map((tb, i) => (
              <span key={i} style={{ fontSize: `${t.textSm}px`, fontWeight: i === active ? t.weightSemibold : t.weightMedium, color: i === active ? t.accent : t.textMuted, padding: `4px 10px`, borderRadius: `${t.radiusSm}px`, background: i === active ? `${t.accent}14` : 'transparent' }}>{tb}</span>
            ))}
          </div>
          {children}
        </div>
      )
    }
    case 'TabPanel':
    case 'Section':
      return (
        <div key={key} style={style}>
          {str(p.title) ? <div style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</div> : null}
          {children}
        </div>
      )
    case 'Accordion':
      return <div key={key} style={style}>{children}</div>
    case 'AccordionItem':
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: `${t.space2 + 2}px ${t.space3}px`, fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.textPrimary }}>
            <span>{str(p.title)}</span>
            <span style={{ color: t.textMuted }}>{p.expanded === true ? '▾' : '▸'}</span>
          </div>
          {p.expanded === true ? <div style={{ padding: `0 ${t.space3}px ${t.space3}px` }}>{children}</div> : children}
        </div>
      )
    case 'Modal':
      return (
        <div key={key} style={style} role="dialog" aria-label={str(p.title)}>
          <div style={{ fontSize: `${t.textLg}px`, fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.title)}</div>
          {children}
        </div>
      )
    case 'Drawer':
      return (
        <div key={key} style={{ ...style, borderLeft: str(p.side) === 'left' ? undefined : `1px solid ${t.border}`, borderRight: str(p.side) === 'left' ? `1px solid ${t.border}` : undefined }}>
          {children}
        </div>
      )
    case 'GroupBox':
      return (
        <fieldset key={key} style={{ ...style, margin: 0 }}>
          <legend style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: t.textSecondary, padding: '0 6px' }}>{str(p.title)}</legend>
          {children}
        </fieldset>
      )
    case 'ScrollView':
    case 'SplitH':
    case 'SplitV':
    case 'Toolbar':
    case 'FormGrid':
      return <div key={key} style={style}>{children}</div>
    case 'StatusBar':
      return <div key={key} style={style}><span>{str(p.text)}</span>{children}</div>
    case 'Hero':
      return (
        <div key={key} style={style}>
          <div style={{ fontSize: `${t.textXxl}px`, fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.title)}</div>
          <div style={{ fontSize: `${t.textMd}px`, color: t.textSecondary }}>{str(p.subtitle)}</div>
          {children}
        </div>
      )
    case 'HeaderBar':
      return (
        <header key={key} style={style}>
          <span style={{ fontWeight: t.weightBold, fontSize: `${t.textMd}px`, color: t.textPrimary }}>{str(p.title)}</span>
          {children}
        </header>
      )
    case 'FooterBar':
      return <footer key={key} style={style}><span>{str(p.text)}</span>{children}</footer>
    case 'SidebarPanel':
      return <div key={key} style={style}>{children}</div>
    case 'BannerBox':
      return <div key={key} style={style}><span aria-hidden="true">📢</span><span>{str(p.text)}</span>{children}</div>
    /* ---- catalog1 controls ---- */
    case 'IconButton':
      return <button key={key} type="button" style={style} disabled={p.disabled === true} aria-label={str(p.icon)}>{str(p.icon)}</button>
    case 'Checkbox':
      return (
        <label key={key} style={style}>
          <input type="checkbox" checked={p.checked === true} onChange={() => undefined} />
          <span>{str(p.label)}</span>
        </label>
      )
    case 'Radio':
      return (
        <label key={key} style={style}>
          <input type="radio" name={str(p.group)} checked={p.checked === true} onChange={() => undefined} />
          <span>{str(p.label)}</span>
        </label>
      )
    case 'RadioGroup': {
      const opts = csv(p.options)
      return (
        <div key={key} style={style} role="radiogroup">
          {opts.map((o) => (
            <label key={o} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: `${t.textSm}px`, color: t.textPrimary }}>
              <input type="radio" name={node.id} checked={str(p.value) === o} onChange={() => undefined} />
              <span>{o}</span>
            </label>
          ))}
          {children}
        </div>
      )
    }
    case 'Switch':
      return (
        <label key={key} style={style}>
          <span style={{ width: '34px', height: '20px', borderRadius: '999px', background: p.on === true ? t.accent : t.borderStrong, display: 'inline-flex', alignItems: 'center', padding: '2px', justifyContent: p.on === true ? 'flex-end' : 'flex-start' }}>
            <span style={{ width: '14px', height: '14px', borderRadius: '999px', background: '#fff' }} />
          </span>
          <span>{str(p.label)}</span>
        </label>
      )
    case 'Slider': {
      const v = num(p.value, 50)
      const min = num(p.min, 0)
      const max = num(p.max, 100)
      return (
        <label key={key} style={style}>
          <input type="range" min={min} max={max} step={num(p.step, 1) || 1} defaultValue={v} onChange={() => undefined} style={{ accentColor: t.accent }} />
          <span>{v}</span>
        </label>
      )
    }
    case 'Select': {
      const opts = csv(p.options)
      return (
        <select key={key} style={style} defaultValue={str(p.value)} onChange={() => undefined}>
          {str(p.placeholder) ? <option value="">{str(p.placeholder)}</option> : null}
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    case 'ComboBox': {
      const opts = csv(p.options)
      return (
        <div key={key} style={style}>
          <input list={`${node.id}-dl`} defaultValue={str(p.value)} placeholder={str(p.placeholder)} onChange={() => undefined} style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textSm}px`, width: '140px' }} />
          <datalist id={`${node.id}-dl`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
          <span style={{ color: t.textMuted }}>▾</span>
        </div>
      )
    }
    case 'TextArea':
      return <textarea key={key} style={style} rows={num(p.rows, 4) || 4} placeholder={str(p.placeholder)} defaultValue={str(p.value)} onChange={() => undefined} />
    case 'SearchBox':
      return (
        <label key={key} style={style}>
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder={str(p.placeholder)} defaultValue={str(p.value)} onChange={() => undefined} style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textSm}px`, width: '100%' }} />
        </label>
      )
    case 'NumberInput':
      return <input key={key} type="number" style={style} defaultValue={num(p.value, 0)} min={num(p.min, 0)} max={num(p.max, 100)} step={num(p.step, 1) || 1} onChange={() => undefined} />
    case 'PasswordInput':
      return <input key={key} type="password" style={style} placeholder={str(p.placeholder)} defaultValue={str(p.value)} onChange={() => undefined} />
    case 'DatePicker':
      return <input key={key} type="date" style={style} defaultValue={str(p.value)} min={str(p.min) || undefined} max={str(p.max) || undefined} onChange={() => undefined} />
    case 'TimePicker':
      return <input key={key} type="time" style={style} defaultValue={str(p.value)} onChange={() => undefined} />
    case 'ColorInput':
      return (
        <label key={key} style={style}>
          <input type="color" defaultValue={/^#[0-9a-fA-F]{6}$/.test(str(p.value)) ? str(p.value) : t.accent} onChange={() => undefined} style={{ width: '28px', height: '28px', border: 'none', background: 'none', padding: 0 }} />
          <span style={{ fontFamily: t.fontMono, fontSize: `${t.textXs}px` }}>{str(p.value) || t.accent}</span>
        </label>
      )
    case 'FileUpload':
      return <div key={key} style={style}><span aria-hidden="true">⤴</span><span>{str(p.label)}</span>{str(p.accept) ? <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted }}>{str(p.accept)}</span> : null}</div>
    case 'ButtonGroup':
      return <div key={key} style={style} role="group">{children}</div>
    case 'DropdownButton': {
      const items = csv(p.items)
      return (
        <div key={key} style={style}>
          <span>{str(p.label)}</span>
          <span aria-hidden="true">▾</span>
          <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{items.join(', ')}</span>
        </div>
      )
    }
    case 'Rating': {
      const v = num(p.value, 3)
      const max = num(p.max, 5) || 5
      return (
        <div key={key} style={style} role="img" aria-label={`${v} of ${max} stars`}>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} style={{ opacity: i < v ? 1 : 0.3 }}>★</span>
          ))}
        </div>
      )
    }
    case 'ToggleButton':
      return <button key={key} type="button" style={style} aria-pressed={p.pressed === true}>{str(p.label)}</button>
    case 'Segmented': {
      const opts = csv(p.options)
      return (
        <div key={key} style={style} role="group">
          {opts.map((o) => (
            <span key={o} style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightMedium, padding: '5px 12px', borderRadius: `${t.radiusSm}px`, background: str(p.value) === o ? t.surface : 'transparent', color: str(p.value) === o ? t.textPrimary : t.textMuted, border: str(p.value) === o ? `1px solid ${t.borderStrong}` : '1px solid transparent' }}>{o}</span>
          ))}
        </div>
      )
    }
    case 'SpinBox':
      return (
        <div key={key} style={style}>
          <button type="button" aria-label="decrease" style={{ background: 'transparent', border: 'none', color: t.textSecondary, cursor: 'pointer' }}>−</button>
          <span style={{ fontFamily: t.fontMono }}>{num(p.value, 1)}</span>
          <button type="button" aria-label="increase" style={{ background: 'transparent', border: 'none', color: t.textSecondary, cursor: 'pointer' }}>+</button>
        </div>
      )
    case 'Checklist': {
      const items = csv(p.items)
      return (
        <div key={key} style={{ ...style, flexDirection: 'column', alignItems: 'stretch' }}>
          {items.map((it) => (
            <label key={it} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: `${t.textSm}px`, color: t.textPrimary }}>
              <input type="checkbox" onChange={() => undefined} />
              <span>{it}</span>
            </label>
          ))}
          {children}
        </div>
      )
    }
    case 'TagInput': {
      const tags = csv(p.value)
      return (
        <div key={key} style={style}>
          {tags.map((tg) => (
            <span key={tg} style={{ background: `${t.accent}1a`, color: t.accent, borderRadius: `${t.radiusFull}px`, padding: '2px 9px', fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold }}>{tg}</span>
          ))}
          <input placeholder={str(p.placeholder)} onChange={() => undefined} style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textSm}px`, width: '90px' }} />
        </div>
      )
    }
    case 'OtpInput': {
      const len = num(p.length, 6) || 6
      return (
        <div key={key} style={{ ...style, background: 'transparent', border: 'none', padding: 0 }}>
          {Array.from({ length: len }, (_, i) => (
            <input key={i} maxLength={1} defaultValue={str(p.value)[i] ?? ''} onChange={() => undefined} aria-label={`digit ${i + 1}`} style={{ width: '36px', height: '44px', textAlign: 'center', fontSize: `${t.textLg}px`, fontFamily: t.fontMono, borderRadius: `${t.radiusMd}px`, border: `1px solid ${t.borderStrong}`, background: t.surface, color: t.textPrimary }} />
          ))}
        </div>
      )
    }
    /* ---- catalog2 text ---- */
    case 'Paragraph':
      return <p key={key} style={{ ...style, margin: 0 }}>{str(p.text)}</p>
    case 'Caption':
      return <div key={key} style={style}>{str(p.text)}</div>
    case 'Quote':
      return (
        <blockquote key={key} style={{ ...style, margin: 0 }}>
          <div>{str(p.text)}</div>
          {str(p.author) ? <cite style={{ display: 'block', marginTop: `${t.space2}px`, fontSize: `${t.textXs}px`, color: t.textMuted, fontStyle: 'normal' }}>{str(p.author)}</cite> : null}
        </blockquote>
      )
    case 'CodeBlock':
      return (
        <pre key={key} style={{ ...style, margin: 0 }}>
          {str(p.showLineNumbers) === 'true' || p.showLineNumbers === true ? null : null}
          <code>{str(p.code)}</code>
        </pre>
      )
    case 'InlineCode':
      return <code key={key} style={style}>{str(p.code)}</code>
    case 'Link':
      return <a key={key} style={style} href={str(p.href) || '#'}>{str(p.text)}</a>
    case 'BulletList': {
      const items = csv(p.items)
      const mark = str(p.bullet) === 'check' ? '✓' : str(p.bullet) === 'dash' ? '–' : str(p.bullet) === 'arrow' ? '→' : '•'
      return (
        <ul key={key} style={{ ...style, margin: 0, listStyle: 'none' }}>
          {items.map((it) => <li key={it} style={{ display: 'flex', gap: '8px' }}><span style={{ color: t.accent }}>{mark}</span><span>{it}</span></li>)}
        </ul>
      )
    }
    case 'NumberedList': {
      const items = csv(p.items)
      const start = num(p.start, 1) || 1
      return (
        <ol key={key} style={{ ...style, margin: 0 }} start={start}>
          {items.map((it) => <li key={it}>{it}</li>)}
        </ol>
      )
    }
    case 'Divider':
      return <hr key={key} style={{ ...style, border: 'none', borderTop: `${num(p.thickness, 1)}px ${str(p.style) || 'solid'} ${str(p.color) || t.borderStrong}`, height: 0, background: 'transparent', marginLeft: 0, marginRight: 0 }} />
    case 'Badge':
      return <span key={key} style={style}>{str(p.text)}</span>
    case 'Tag':
      return <span key={key} style={style}>{str(p.text)}{p.removable === true ? <span aria-hidden="true"> ×</span> : null}</span>
    case 'Kbd':
      return <kbd key={key} style={style}>{str(p.keys)}</kbd>
    /* ---- catalog2 data ---- */
    case 'Table': {
      const cols = csv(p.columns)
      const rows = str(p.rows).split(';').map((r) => r.split('|').map((c) => c.trim()))
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', background: t.bg, borderBottom: `1px solid ${t.border}`, fontWeight: t.weightSemibold, fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.5px', color: t.textMuted }}>
            {cols.map((c) => <div key={c} style={{ flex: 1, padding: `${t.space2}px ${t.space3}px` }}>{c}</div>)}
          </div>
          {rows.map((r, i) => (
            <div key={i} style={{ display: 'flex', borderBottom: `1px solid ${t.border}`, background: p.striped === true && i % 2 === 1 ? t.bg : 'transparent' }}>
              {r.map((c, j) => <div key={j} style={{ flex: 1, padding: p.dense === true ? `${t.space1 + 2}px ${t.space3}px` : `${t.space2 + 2}px ${t.space3}px`, color: t.textPrimary }}>{c}</div>)}
            </div>
          ))}
        </div>
      )
    }
    case 'Stat': {
      const up = str(p.trend) === 'up'
      const down = str(p.trend) === 'down'
      return (
        <div key={key} style={style}>
          <span style={{ fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.6px', color: t.textMuted, fontWeight: t.weightSemibold }}>{str(p.label)}</span>
          <span style={{ fontSize: `${t.textXl}px`, fontWeight: t.weightBold, color: str(p.accent) || t.textPrimary }}>{str(p.value)}</span>
          <span style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: up ? t.success : down ? t.danger : t.textMuted }}>{str(p.delta)}</span>
        </div>
      )
    }
    case 'ProgressBar': {
      const v = num(p.value, 62)
      const max = num(p.max, 100) || 100
      const pctv = Math.max(0, Math.min(100, (v / max) * 100))
      return (
        <div key={key} style={style}>
          <div style={{ height: `${num(p.height, 8)}px`, borderRadius: '999px', background: t.border, overflow: 'hidden' }}>
            <div style={{ width: `${pctv}%`, height: '100%', borderRadius: '999px', background: toneColor(t, str(p.tone)) }} />
          </div>
          {p.showLabel === true ? <span>{Math.round(pctv)}%</span> : null}
        </div>
      )
    }
    case 'ProgressRing': {
      const v = num(p.value, 72)
      const max = num(p.max, 100) || 100
      const pctv = Math.max(0, Math.min(1, v / max))
      const size = num(p.size, 72) || 72
      const r = size / 2 - 6
      const c = size / 2
      const circ = 2 * Math.PI * r
      return (
        <div key={key} style={style}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(pctv * 100)} percent`}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={t.border} strokeWidth={6} />
            <circle cx={c} cy={c} r={r} fill="none" stroke={toneColor(t, str(p.tone))} strokeWidth={6} strokeLinecap="round" strokeDasharray={`${pctv * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
            <text x={c} y={c + 4} textAnchor="middle" fontSize={size * 0.22} fontWeight={t.weightBold} fill={t.textPrimary} fontFamily={t.fontFamily}>{Math.round(pctv * 100)}</text>
          </svg>
        </div>
      )
    }
    case 'Avatar':
      return <div key={key} style={style} role="img" aria-label={str(p.initials)}>{str(p.image) ? <img src={str(p.image)} alt={str(p.initials)} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: 'cover' }} /> : str(p.initials)}</div>
    case 'AvatarGroup': {
      const names = csv(p.names).slice(0, num(p.max, 4) || 4)
      const size = num(p.size, 32) || 32
      return (
        <div key={key} style={style}>
          {names.map((n, i) => (
            <span key={n} title={n} style={{ width: `${size}px`, height: `${size}px`, borderRadius: '999px', background: i % 2 === 0 ? t.accent : t.textMuted, color: t.textOnAccent, fontSize: `${Math.round(size * 0.36)}px`, fontWeight: t.weightBold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `2px solid ${t.surface}`, marginLeft: i === 0 ? 0 : `-${Math.round(size * 0.35)}px` }}>{n.slice(0, 2).toUpperCase()}</span>
          ))}
        </div>
      )
    }
    case 'Image':
      return (
        <div key={key} style={style}>
          {str(p.src) ? <img src={str(p.src)} alt={str(p.alt)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: '120px', color: t.textMuted, fontSize: `${t.textSm}px` }}>{str(p.alt) || 'Image'}</span>}
        </div>
      )
    case 'BarChart': {
      const vals = str(p.values).split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      const h = num(p.height, 120) || 120
      const max = Math.max(...vals, 1)
      const accent = str(p.accent) || t.accent
      return (
        <div key={key} style={{ ...style, display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
          {vals.map((v, i) => (
            <div key={i} title={String(v)} style={{ flex: 1, height: `${Math.max(4, (v / max) * (h - 20))}px`, borderRadius: '4px 4px 2px 2px', background: `linear-gradient(180deg, ${accent}, ${accent}88)` }} />
          ))}
        </div>
      )
    }
    case 'PieChart': {
      const vals = str(p.values).split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
      const size = num(p.size, 140) || 140
      const total = vals.reduce((a, b) => a + b, 0) || 1
      const palette = [t.accent, t.success, t.warning, t.danger, '#8b5cf6', '#06b6d4']
      let acc = 0
      const segs = vals.map((v, i) => {
        const start = (acc / total) * 360
        acc += v
        const end = (acc / total) * 360
        return { start, end, color: palette[i % palette.length] }
      })
      const cx = size / 2
      const cy = size / 2
      const r = size / 2 - 4
      const pt = (a: number) => {
        const rad = ((a - 90) * Math.PI) / 180
        return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const
      }
      return (
        <div key={key} style={{ ...style, display: 'flex', alignItems: 'center', gap: `${t.space3}px` }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="pie chart">
            {segs.map((sg, i) => {
              const [x1, y1] = pt(sg.start)
              const [x2, y2] = pt(sg.end)
              const large = sg.end - sg.start > 180 ? 1 : 0
              return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={sg.color} stroke={t.surface} strokeWidth={2} />
            })}
          </svg>
          {p.showLegend === true ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: `${t.textXs}px`, color: t.textSecondary }}>
              {vals.map((v, i) => <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ width: '10px', height: '10px', borderRadius: '3px', background: palette[i % palette.length] }} />{Math.round((v / total) * 100)}%</span>)}
            </div>
          ) : null}
        </div>
      )
    }
    case 'LineChart': {
      const pts = str(p.points).split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      const w = num(p.width, 280) || 280
      const h = num(p.height, 140) || 140
      const accent = str(p.accent) || t.accent
      if (pts.length < 2) return <div key={key} style={style} />
      const min = Math.min(...pts)
      const max = Math.max(...pts)
      const span = max - min || 1
      const step = w / (pts.length - 1)
      const xy = pts.map((v, i) => [i * step, 8 + (h - 16) - ((v - min) / span) * (h - 16)] as const)
      const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
      return (
        <div key={key} style={style}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="line chart">
            {[0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} y1={h * f} x2={w} y2={h * f} stroke={t.border} strokeWidth={1} />)}
            <path d={line} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.5} fill={accent} />)}
          </svg>
        </div>
      )
    }
    case 'Timeline':
      return <div key={key} style={style}>{children}</div>
    case 'TimelineItem':
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '999px', background: toneColor(t, str(p.tone)) }} />
            <span style={{ fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</span>
          </div>
          <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, paddingLeft: '18px' }}>{str(p.time)}</span>
        </div>
      )
    case 'TreeList': {
      const items = csv(p.items)
      return (
        <div key={key} style={style}>
          {items.map((it) => {
            const depth = (it.match(/\//g) || []).length
            const leaf = it.split('/').pop() ?? it
            return <div key={it} style={{ paddingLeft: `${depth * 16}px`, display: 'flex', gap: '6px', alignItems: 'center' }}><span style={{ color: t.textMuted }}>{depth > 0 ? '└' : '▸'}</span><span>{leaf}</span></div>
          })}
        </div>
      )
    }
    case 'DataList': {
      const items = csv(p.items)
      return (
        <div key={key} style={style}>
          {items.map((it) => {
            const [k, v] = it.split(':')
            return <div key={it} style={{ display: 'flex', justifyContent: 'space-between', padding: `${t.space2}px 0`, borderBottom: p.divided === true ? `1px solid ${t.border}` : 'none', fontSize: `${t.textSm}px` }}><span style={{ color: t.textSecondary }}>{(k ?? it).trim()}</span><span style={{ color: t.textPrimary, fontWeight: t.weightMedium }}>{(v ?? '').trim()}</span></div>
          })}
        </div>
      )
    }
    case 'KeyValue':
      return (
        <div key={key} style={style}>
          <span style={{ color: t.textMuted, fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: t.weightSemibold }}>{str(p.label)}</span>
          <span style={{ color: t.textPrimary, fontWeight: t.weightMedium }}>{str(p.value)}</span>
        </div>
      )
    case 'Calendar': {
      const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: t.weightSemibold, fontSize: `${t.textSm}px`, color: t.textPrimary }}>{str(p.month)}</span>
            <span style={{ color: t.textMuted }}>‹ ›</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', fontSize: `${t.textXs}px` }}>
            {days.map((d, i) => <span key={i} style={{ color: t.textMuted, padding: '4px 0' }}>{d}</span>)}
            {Array.from({ length: 30 }, (_, i) => {
              const d = String(i + 1)
              const sel = str(p.selected) === d
              return <span key={d} style={{ padding: '5px 0', borderRadius: '6px', background: sel ? (str(p.accent) || t.accent) : 'transparent', color: sel ? t.textOnAccent : t.textPrimary, fontWeight: sel ? t.weightBold : t.weightNormal }}>{d}</span>
            })}
          </div>
        </div>
      )
    }
    case 'KanbanColumn':
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</span>
            <span style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightBold, background: `${toneColor(t, str(p.tone))}1a`, color: toneColor(t, str(p.tone)), borderRadius: '999px', padding: '1px 8px' }}>{num(p.count, 0)}</span>
          </div>
          {children}
        </div>
      )
    case 'EmptyState':
      return (
        <div key={key} style={style}>
          <div style={{ width: '48px', height: '48px', borderRadius: '999px', background: t.bg, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px' }}>○</div>
          <div style={{ fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</div>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textMuted }}>{str(p.hint)}</div>
          {str(p.actionLabel) ? <button type="button" style={{ marginTop: `${t.space2}px`, padding: `6px 14px`, borderRadius: `${t.radiusMd}px`, border: `1px solid ${t.borderStrong}`, background: t.surface, color: t.textPrimary, fontSize: `${t.textSm}px`, cursor: 'pointer' }}>{str(p.actionLabel)}</button> : null}
        </div>
      )
    case 'Skeleton': {
      const lines = num(p.lines, 3) || 3
      return (
        <div key={key} style={style} aria-label="loading">
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} style={{ height: `${num(p.height, 14)}px`, borderRadius: `${t.radiusSm}px`, background: t.border, opacity: p.animate === false ? 0.7 : 0.4 + (0.6 * (i % 2)), width: i === lines - 1 ? '62%' : '100%' }} />
          ))}
        </div>
      )
    }
    case 'DataCard':
      return (
        <div key={key} style={style}>
          <span style={{ fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.6px', color: t.textMuted, fontWeight: t.weightSemibold }}>{str(p.title)}</span>
          <span style={{ fontSize: `${t.textXl}px`, fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.value)}</span>
          <span style={{ fontSize: `${t.textXs}px`, color: t.success }}>{str(p.hint)}</span>
          {children}
        </div>
      )
    /* ---- catalog2 navigation ---- */
    case 'NavBar':
      return (
        <nav key={key} style={style}>
          <span style={{ fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.title)}</span>
          {children}
        </nav>
      )
    case 'NavLink':
      return <a key={key} style={style} href={str(p.href) || '#'} aria-current={p.active === true ? 'page' : undefined}>{str(p.label)}</a>
    case 'SideNav':
      return <nav key={key} style={style}>{children}</nav>
    case 'Breadcrumbs': {
      const trail = csv(p.trail)
      return (
        <nav key={key} style={style} aria-label="breadcrumb">
          {trail.map((bc, i) => (
            <React.Fragment key={bc}>
              {i > 0 ? <span aria-hidden="true">{str(p.separator) || '/'}</span> : null}
              <span style={{ color: i === trail.length - 1 ? t.textPrimary : t.textMuted, fontWeight: i === trail.length - 1 ? t.weightSemibold : t.weightNormal }}>{bc}</span>
            </React.Fragment>
          ))}
        </nav>
      )
    }
    case 'Pagination': {
      const page = num(p.page, 1) || 1
      const total = num(p.total, 12) || 12
      const nums = [page - 1, page, page + 1].filter((n) => n >= 1 && n <= total)
      return (
        <nav key={key} style={style} aria-label="pagination">
          <button type="button" disabled={page <= 1} style={pgBtn(t, false)}>‹</button>
          {nums[0] > 1 ? <span style={{ color: t.textMuted, fontSize: `${t.textXs}px` }}>…</span> : null}
          {nums.map((n) => <button key={n} type="button" aria-current={n === page ? 'page' : undefined} style={pgBtn(t, n === page)}>{n}</button>)}
          {nums[nums.length - 1] < total ? <span style={{ color: t.textMuted, fontSize: `${t.textXs}px` }}>…</span> : null}
          <button type="button" disabled={page >= total} style={pgBtn(t, false)}>›</button>
        </nav>
      )
    }
    case 'Stepper': {
      const steps = csv(p.steps)
      const cur = num(p.current, 1)
      return (
        <ol key={key} style={{ ...style, margin: 0, padding: 0, listStyle: 'none' }}>
          {steps.map((st, i) => {
            const n = i + 1
            const done = n < cur
            const now = n === cur
            return (
              <li key={st} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ width: '24px', height: '24px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: `${t.textXs}px`, fontWeight: t.weightBold, background: done || now ? t.accent : t.bg, color: done || now ? t.textOnAccent : t.textMuted, border: `1px solid ${done || now ? t.accent : t.borderStrong}` }}>{done ? '✓' : n}</span>
                <span style={{ fontSize: `${t.textSm}px`, color: now ? t.textPrimary : t.textMuted, fontWeight: now ? t.weightSemibold : t.weightNormal }}>{st}</span>
                {i < steps.length - 1 ? <span style={{ width: '24px', height: '1px', background: t.borderStrong }} /> : null}
              </li>
            )
          })}
        </ol>
      )
    }
    case 'Menu':
      return <div key={key} style={style} role="menu">{children}</div>
    case 'MenuItem':
      return (
        <div key={key} style={style} role="menuitem">
          <span aria-hidden="true">{str(p.icon)}</span>
          <span>{str(p.label)}</span>
        </div>
      )
    case 'CommandBar':
      return <div key={key} style={style} role="toolbar">{children}</div>
    case 'TabBar': {
      const tabs = csv(p.tabs)
      const active = num(p.active, 0)
      return (
        <div key={key} style={style} role="tablist">
          {tabs.map((tb, i) => (
            <button key={tb} type="button" role="tab" aria-selected={i === active} style={{ border: 'none', cursor: 'pointer', fontSize: `${t.textSm}px`, fontWeight: i === active ? t.weightSemibold : t.weightMedium, padding: '6px 14px', borderRadius: `${t.radiusSm}px`, background: i === active ? t.surface : 'transparent', color: i === active ? t.textPrimary : t.textMuted, boxShadow: i === active ? t.shadowSm : 'none' }}>{tb}</button>
          ))}
        </div>
      )
    }
    case 'AnchorList': {
      const links = csv(p.links)
      return (
        <div key={key} style={style}>
          {links.map((l) => (
            <a key={l} href={`#${l.toLowerCase()}`} style={{ fontSize: `${t.textSm}px`, color: str(p.active) === l ? t.accent : t.textMuted, fontWeight: str(p.active) === l ? t.weightSemibold : t.weightNormal, borderLeft: `2px solid ${str(p.active) === l ? t.accent : 'transparent'}`, paddingLeft: `${t.space2 + 2}px`, textDecoration: 'none' }}>{l}</a>
          ))}
        </div>
      )
    }
    case 'BackButton':
      return <button key={key} type="button" style={style}><span aria-hidden="true">←</span><span>{str(p.label)}</span></button>
    /* ---- catalog2 feedback ---- */
    case 'Alert':
      return (
        <div key={key} style={style} role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: toneColor(t, str(p.tone)) }} />
            <strong style={{ fontSize: `${t.textSm}px`, color: t.textPrimary }}>{str(p.title)}</strong>
            {p.dismissible === true ? <button type="button" aria-label="dismiss" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer' }}>×</button> : null}
          </div>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textSecondary }}>{str(p.body)}</div>
        </div>
      )
    case 'Toast':
      return (
        <div key={key} style={style} role="status">
          <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: toneColor(t, str(p.tone)) }} />
          <span>{str(p.message)}</span>
        </div>
      )
    case 'Spinner': {
      const size = num(p.size, 24) || 24
      return (
        <div key={key} style={style} role="status">
          <span style={{ width: `${size}px`, height: `${size}px`, borderRadius: '999px', border: `2px solid ${t.borderStrong}`, borderTopColor: str(p.accent) || t.accent, display: 'inline-block' }} />
          {str(p.label) ? <span>{str(p.label)}</span> : null}
        </div>
      )
    }
    case 'LoadingBar': {
      const v = num(p.progress, 40)
      return (
        <div key={key} style={style}>
          <div style={{ height: '6px', borderRadius: '999px', background: t.border, overflow: 'hidden' }}>
            <div style={{ width: p.indeterminate === true ? '40%' : `${Math.max(0, Math.min(100, v))}%`, height: '100%', borderRadius: '999px', background: toneColor(t, str(p.tone)) }} />
          </div>
        </div>
      )
    }
    case 'ProgressDots': {
      const steps = num(p.steps, 4) || 4
      const cur = num(p.current, 1)
      return (
        <div key={key} style={style} aria-label={`${cur} of ${steps}`}>
          {Array.from({ length: steps }, (_, i) => (
            <span key={i} style={{ width: '8px', height: '8px', borderRadius: '999px', background: i < cur ? t.accent : t.borderStrong }} />
          ))}
        </div>
      )
    }
    case 'InlineMessage':
      return (
        <div key={key} style={style} role="status">
          <span aria-hidden="true">ⓘ</span>
          <span>{str(p.text)}</span>
        </div>
      )
    case 'ErrorSummary': {
      const items = csv(p.items)
      return (
        <div key={key} style={style} role="alert">
          <strong style={{ fontSize: `${t.textSm}px`, color: t.danger }}>{str(p.title)}</strong>
          <ul style={{ margin: 0, paddingLeft: '18px', fontSize: `${t.textSm}px`, color: t.textPrimary }}>
            {items.map((it) => <li key={it}>{it}</li>)}
          </ul>
        </div>
      )
    }
    case 'SuccessCheck': {
      const size = num(p.size, 40) || 40
      return (
        <div key={key} style={style}>
          <span style={{ width: `${size}px`, height: `${size}px`, borderRadius: '999px', background: `${t.success}1a`, border: `1px solid ${t.success}66`, color: t.success, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(size * 0.5)}px`, fontWeight: t.weightBold }}>✓</span>
          <span style={{ fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.label)}</span>
        </div>
      )
    }
    case 'WarningCallout':
      return (
        <div key={key} style={{ ...style, borderLeftColor: t.warning }}>
          <strong style={{ fontSize: `${t.textSm}px`, color: t.textPrimary }}>{str(p.title)}</strong>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textSecondary }}>{str(p.body)}</div>
        </div>
      )
    case 'InfoCallout':
      return (
        <div key={key} style={{ ...style, borderLeftColor: t.accent }}>
          <strong style={{ fontSize: `${t.textSm}px`, color: t.textPrimary }}>{str(p.title)}</strong>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textSecondary }}>{str(p.body)}</div>
        </div>
      )
    case 'ConfirmDialog':
      return (
        <div key={key} style={style} role="alertdialog" aria-label={str(p.title)}>
          <div style={{ fontSize: `${t.textLg}px`, fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.title)}</div>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textSecondary }}>{str(p.message)}</div>
          {children}
          <div style={{ display: 'flex', gap: `${t.space2}px`, justifyContent: 'flex-end' }}>
            <button type="button" style={{ padding: `7px 14px`, borderRadius: `${t.radiusMd}px`, border: `1px solid ${t.borderStrong}`, background: 'transparent', color: t.textSecondary, cursor: 'pointer' }}>{str(p.cancelLabel)}</button>
            <button type="button" style={{ padding: `7px 14px`, borderRadius: `${t.radiusMd}px`, border: 'none', background: t.danger, color: t.textOnAccent, cursor: 'pointer' }}>{str(p.confirmLabel)}</button>
          </div>
        </div>
      )
    case 'NotificationList':
      return <div key={key} style={style}>{children}</div>
    default:
      throw new Error(`unknown component: ${node.type}`)
  }
}

function pgBtn(t: Theme, on: boolean): React.CSSProperties {
  return {
    minWidth: '28px',
    height: '28px',
    borderRadius: `${t.radiusSm}px`,
    border: `1px solid ${on ? t.accent : t.border}`,
    background: on ? t.accent : t.surface,
    color: on ? t.textOnAccent : t.textSecondary,
    fontSize: `${t.textXs}px`,
    cursor: 'pointer',
  }
}

/** Inner content for a SELECTED leaf in authoring mode (outer div + handles wrap it). */
function authorInner(node: Node, t: Theme): React.ReactNode {
  const p = node.props
  switch (node.type) {
    case 'Button':
      return <button type="button" tabIndex={-1} disabled={node.props.disabled === true}>{str(node.props.label)}</button>
    case 'Label':
      return <div>{str(node.props.text)}</div>
    case 'Input':
      return <input type="text" tabIndex={-1} readOnly placeholder={str(node.props.placeholder)} defaultValue={str(node.props.value)} />
    case 'Gauge':
      return <GaugeFace node={node} t={t} />
    case 'Sparkline':
      return <Spark node={node} t={t} />
    case 'Heading':
      return <div>{str(p.text)}</div>
    case 'IconButton':
      return <button type="button" tabIndex={-1}>{str(p.icon)}</button>
    case 'Checkbox':
      return <label><input type="checkbox" tabIndex={-1} checked={p.checked === true} readOnly /> {str(p.label)}</label>
    case 'Radio':
      return <label><input type="radio" tabIndex={-1} checked={p.checked === true} readOnly /> {str(p.label)}</label>
    case 'Switch':
      return <span>{str(p.label)} {p.on === true ? '●' : '○'}</span>
    case 'Slider':
      return <input type="range" tabIndex={-1} defaultValue={num(p.value, 50)} min={num(p.min, 0)} max={num(p.max, 100)} readOnly />
    case 'Select':
      return <select tabIndex={-1}><option>{str(p.value)}</option></select>
    case 'ComboBox':
      return <input tabIndex={-1} readOnly defaultValue={str(p.value)} placeholder={str(p.placeholder)} />
    case 'TextArea':
      return <textarea tabIndex={-1} readOnly rows={num(p.rows, 4) || 4} defaultValue={str(p.value)} placeholder={str(p.placeholder)} />
    case 'SearchBox':
      return <input type="search" tabIndex={-1} readOnly defaultValue={str(p.value)} placeholder={str(p.placeholder)} />
    case 'NumberInput':
      return <input type="number" tabIndex={-1} readOnly defaultValue={num(p.value, 0)} />
    case 'PasswordInput':
      return <input type="password" tabIndex={-1} readOnly defaultValue={str(p.value)} placeholder={str(p.placeholder)} />
    case 'DatePicker':
      return <input type="date" tabIndex={-1} defaultValue={str(p.value)} />
    case 'TimePicker':
      return <input type="time" tabIndex={-1} defaultValue={str(p.value)} />
    case 'ColorInput':
      return <input type="color" tabIndex={-1} value={/^#[0-9a-fA-F]{6}$/.test(str(p.value)) ? str(p.value) : t.accent} readOnly />
    case 'DropdownButton':
      return <span>{str(p.label)} ▾</span>
    case 'Rating': {
      const v = num(p.value, 3)
      const max = num(p.max, 5) || 5
      return <span>{Array.from({ length: max }, (_, i) => (i < v ? '★' : '☆')).join('')}</span>
    }
    case 'ToggleButton':
      return <button type="button" tabIndex={-1}>{str(p.label)}</button>
    case 'Segmented':
      return <span>{str(p.value) || csv(p.options)[0] || ''}</span>
    case 'SpinBox':
      return <span>{num(p.value, 1)}</span>
    case 'TagInput':
      return <span>{str(p.value)}</span>
    case 'OtpInput':
      return <span>{'•'.repeat(num(p.length, 6) || 6)}</span>
    case 'FileUpload':
      return <span>{str(p.label)}</span>
    case 'FormField':
      return <span>{str(p.label)}</span>
    case 'Paragraph':
      return <span>{str(p.text)}</span>
    case 'Caption':
      return <span>{str(p.text)}</span>
    case 'Quote':
      return <span>{str(p.text)}</span>
    case 'CodeBlock':
      return <code>{str(p.code)}</code>
    case 'InlineCode':
      return <code>{str(p.code)}</code>
    case 'Link':
      return <a tabIndex={-1}>{str(p.text)}</a>
    case 'BulletList':
      return <span>{csv(p.items).join(' • ')}</span>
    case 'NumberedList':
      return <span>{csv(p.items).join(', ')}</span>
    case 'Divider':
      return <hr />
    case 'Badge':
      return <span>{str(p.text)}</span>
    case 'Tag':
      return <span>{str(p.text)}</span>
    case 'Kbd':
      return <kbd>{str(p.keys)}</kbd>
    case 'Table':
      return <span>{csv(p.columns).join(' · ')}</span>
    case 'Stat':
      return <span>{str(p.value)} {str(p.label)}</span>
    case 'ProgressBar':
      return <span>{num(p.value, 0)}%</span>
    case 'ProgressRing':
      return <span>{num(p.value, 0)}%</span>
    case 'Avatar':
      return <span>{str(p.initials)}</span>
    case 'AvatarGroup':
      return <span>{str(p.names)}</span>
    case 'Image':
      return <span>{str(p.alt) || 'Image'}</span>
    case 'BarChart':
      return <span>bars</span>
    case 'PieChart':
      return <span>pie</span>
    case 'LineChart':
      return <span>trend</span>
    case 'TimelineItem':
      return <span>{str(p.title)}</span>
    case 'TreeList':
      return <span>{csv(p.items).join(', ')}</span>
    case 'DataList':
      return <span>{csv(p.items).join(', ')}</span>
    case 'KeyValue':
      return <span>{str(p.label)}: {str(p.value)}</span>
    case 'Calendar':
      return <span>{str(p.month)}</span>
    case 'EmptyState':
      return <span>{str(p.title)}</span>
    case 'Skeleton':
      return <span>loading…</span>
    case 'NavLink':
      return <a tabIndex={-1}>{str(p.label)}</a>
    case 'Breadcrumbs':
      return <span>{csv(p.trail).join(' / ')}</span>
    case 'Pagination':
      return <span>{num(p.page, 1)} / {num(p.total, 12)}</span>
    case 'Stepper':
      return <span>{csv(p.steps).join(' → ')}</span>
    case 'MenuItem':
      return <span>{str(p.label)}</span>
    case 'TabBar':
      return <span>{csv(p.tabs).join(' · ')}</span>
    case 'AnchorList':
      return <span>{csv(p.links).join(', ')}</span>
    case 'BackButton':
      return <button type="button" tabIndex={-1}>← {str(p.label)}</button>
    case 'Alert':
      return <span>{str(p.title)}: {str(p.body)}</span>
    case 'Toast':
      return <span>{str(p.message)}</span>
    case 'Spinner':
      return <span>{str(p.label) || 'Loading…'}</span>
    case 'LoadingBar':
      return <span>{num(p.progress, 0)}%</span>
    case 'ProgressDots':
      return <span>{num(p.current, 0)}/{num(p.steps, 0)}</span>
    case 'InlineMessage':
      return <span>{str(p.text)}</span>
    case 'ErrorSummary':
      return <span>{str(p.title)}</span>
    case 'SuccessCheck':
      return <span>✓ {str(p.label)}</span>
    case 'WarningCallout':
      return <span>{str(p.title)}</span>
    case 'InfoCallout':
      return <span>{str(p.title)}</span>
    /* Containers render children; never reach here as leaves. */
    case 'Panel':
    case 'Stack':
    case 'Grid':
    case 'Card':
    case 'Tabs':
    case 'TabPanel':
    case 'Accordion':
    case 'AccordionItem':
    case 'Modal':
    case 'Drawer':
    case 'Section':
    case 'GroupBox':
    case 'ScrollView':
    case 'SplitH':
    case 'SplitV':
    case 'Toolbar':
    case 'StatusBar':
    case 'Hero':
    case 'HeaderBar':
    case 'FooterBar':
    case 'SidebarPanel':
    case 'FormGrid':
    case 'BannerBox':
    case 'RadioGroup':
    case 'ButtonGroup':
    case 'Checklist':
    case 'Timeline':
    case 'KanbanColumn':
    case 'DataCard':
    case 'NavBar':
    case 'SideNav':
    case 'Menu':
    case 'CommandBar':
    case 'ConfirmDialog':
    case 'NotificationList':
      return null
    default:
      throw new Error(`unknown component: ${node.type}`)
  }
}

export function renderNode(ctx: RenderCtx, id: NodeId, key?: string | number): React.ReactElement {
  const node = ctx.doc.nodes[id]
  if (!node) throw new Error(`missing node: ${id}`)
  const spec = getComponent(node.type)
  if (!spec) throw new Error(`unknown component: ${node.type}`)

  const flowChild = isFlowChild(ctx.doc, id)
  const t = ctx.theme ?? resolveTheme(ctx.doc.meta.theme)
  const isContainer = Boolean(spec.container)
  const children: React.ReactElement[] = []
  node.children.forEach((cid, i) => {
    // Hidden nodes are output-truth: preview/export skip them. Authoring
    // renders them ghosted below instead, so hidden work is never lost.
    if (ctx.mode === 'preview' && ctx.doc.nodes[cid]?.visible === false) return
    children.push(renderNode(ctx, cid, i))
  })

  // Preview mode emits the output artifact: real interactive controls, no
  // editor attributes at all.
  if (ctx.mode === 'preview') {
    return renderPreviewNode(node, flowChild, children, key, t)
  }

  const authored = styleFor(node, flowChild, t)

  // The atmosphere layer: grain / glass / aurora / spotlight / shimmer / glow
  // / tilt / chromatic, declared in render/effects.tsx and gated by target
  // capability. Authoring shows the same effect the output will, because a
  // preview that lies about atmosphere is worse than no preview.
  const eff = applyEffects(normalizeEffects(node.effects), t, {}, id)
  Object.assign(authored, eff.style)
  authored.zIndex = node.z ?? 0

  if (node.visible === false) {
    // Ghost, not gone: hidden nodes stay manipulable while authoring.
    authored.opacity = 0.35
    authored.outline = `1px dashed ${t.warning}`
    authored.outlineOffset = '2px'
  }
  const common: Record<string, unknown> = {
    'data-loom-id': id,
    'data-loom-type': node.type,
    'data-loom-flow': flowChild ? 'child' : 'free',
    'data-selected': ctx.selected.has(id) ? 'true' : 'false',
    // Marks a drop target, so a component can be dropped INTO a container.
    'data-loom-container': isContainer ? 'true' : 'false',
    'data-loom-hidden': node.visible === false ? 'true' : 'false',
    'data-loom-locked': node.locked === true ? 'true' : 'false',
    style: authored,
    onPointerDown: (e: React.PointerEvent) => ctx.onPointerDownNode?.(id, e),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      ctx.onContextMenuNode?.(id, e)
    },
  }

  if (ctx.selected.has(id)) {
    // Handles are editor chrome, not output: they are injected only while
    // authoring and never appear in an exported document.
    const handles = CORNERS.map((corner) => (
      <span key={corner} className="loom-handle" data-corner={corner} data-loom-handle={corner} />
    ))
    const inner = isContainer ? children : authorInner(node, t)
    return (
      <div key={key} {...common}>
        {eff.layers}
        {inner}
        {handles}
      </div>
    )
  }

  switch (node.type) {
    case 'Button':
      return (
        <button key={key} type="button" {...common} disabled={node.props.disabled === true}>
          {str(node.props.label)}
        </button>
      )
    case 'Label':
      return (
        <div key={key} {...common}>
          {str(node.props.text)}
        </div>
      )
    case 'Input':
      return (
        <input
          key={key}
          {...common}
          type="text"
          placeholder={str(node.props.placeholder)}
          defaultValue={str(node.props.value)}
          onChange={() => {
            /* designer mode: value binding is not live yet */
          }}
        />
      )
    case 'Heading': {
      const level = str(node.props.level) || '1'
      const size = level === '1' ? t.textXxl : level === '2' ? t.textXl : t.textLg
      return (
        <div key={key} {...common} style={{ ...(common.style as React.CSSProperties), fontSize: `${size}px`, fontWeight: level === '1' ? t.weightBold : t.weightSemibold, color: str(node.props.color) || t.textPrimary, textAlign: (str(node.props.align) || 'left') as React.CSSProperties['textAlign'] }}>
          {str(node.props.text)}
        </div>
      )
    }
    case 'FormField':
      return <div key={key} {...common}><span>{str(node.props.label)}</span></div>
    case 'Gauge':
      return (
        <div key={key} {...common}>
          <GaugeFace node={node} t={t} />
        </div>
      )
    case 'Sparkline':
      return (
        <div key={key} {...common}>
          <Spark node={node} t={t} />
        </div>
      )
    case 'Panel':
    case 'Stack':
    case 'Grid':
    case 'Card':
    case 'Tabs':
    case 'TabPanel':
    case 'Accordion':
    case 'AccordionItem':
    case 'Modal':
    case 'Drawer':
    case 'Section':
    case 'GroupBox':
    case 'ScrollView':
    case 'SplitH':
    case 'SplitV':
    case 'Toolbar':
    case 'StatusBar':
    case 'Hero':
    case 'HeaderBar':
    case 'FooterBar':
    case 'SidebarPanel':
    case 'FormGrid':
    case 'BannerBox':
    case 'RadioGroup':
    case 'ButtonGroup':
    case 'Checklist':
    case 'Timeline':
    case 'KanbanColumn':
    case 'DataCard':
    case 'NavBar':
    case 'SideNav':
    case 'Menu':
    case 'CommandBar':
    case 'ConfirmDialog':
    case 'NotificationList':
      return (
        <div key={key} {...common}>
          {children}
        </div>
      )
    case 'IconButton':
      return <button key={key} type="button" {...common} disabled={node.props.disabled === true}>{str(node.props.icon)}</button>
    case 'Checkbox':
      return <label key={key} {...common}><input type="checkbox" tabIndex={-1} checked={node.props.checked === true} readOnly /> {str(node.props.label)}</label>
    case 'Radio':
      return <label key={key} {...common}><input type="radio" tabIndex={-1} checked={node.props.checked === true} readOnly /> {str(node.props.label)}</label>
    case 'Switch':
      return <div key={key} {...common}><span>{str(node.props.label)}</span></div>
    case 'Slider':
      return <input key={key} {...common} type="range" min={num(node.props.min, 0)} max={num(node.props.max, 100)} defaultValue={num(node.props.value, 50)} onChange={() => undefined} />
    case 'Select':
      return <select key={key} {...common} defaultValue={str(node.props.value)} onChange={() => undefined}>{csv(node.props.options).map((o) => <option key={o} value={o}>{o}</option>)}</select>
    case 'ComboBox':
      return <input key={key} {...common} defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} onChange={() => undefined} />
    case 'TextArea':
      return <textarea key={key} {...common} rows={num(node.props.rows, 4) || 4} defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} onChange={() => undefined} />
    case 'SearchBox':
      return <input key={key} {...common} type="search" defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} onChange={() => undefined} />
    case 'NumberInput':
      return <input key={key} {...common} type="number" defaultValue={num(node.props.value, 0)} onChange={() => undefined} />
    case 'PasswordInput':
      return <input key={key} {...common} type="password" defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} onChange={() => undefined} />
    case 'DatePicker':
      return <input key={key} {...common} type="date" defaultValue={str(node.props.value)} onChange={() => undefined} />
    case 'TimePicker':
      return <input key={key} {...common} type="time" defaultValue={str(node.props.value)} onChange={() => undefined} />
    case 'ColorInput':
      return <input key={key} {...common} type="color" value={/^#[0-9a-fA-F]{6}$/.test(str(node.props.value)) ? str(node.props.value) : t.accent} onChange={() => undefined} />
    case 'FileUpload':
      return <div key={key} {...common}>{str(node.props.label)}</div>
    case 'DropdownButton':
      return <button key={key} type="button" {...common}>{str(node.props.label)} ▾</button>
    case 'Rating': {
      const v = num(node.props.value, 3)
      const max = num(node.props.max, 5) || 5
      return <div key={key} {...common}>{Array.from({ length: max }, (_, i) => (i < v ? '★' : '☆')).join('')}</div>
    }
    case 'ToggleButton':
      return <button key={key} type="button" {...common}>{str(node.props.label)}</button>
    case 'Segmented':
      return <div key={key} {...common}>{str(node.props.value)}</div>
    case 'SpinBox':
      return <div key={key} {...common}>{num(node.props.value, 1)}</div>
    case 'TagInput':
      return <div key={key} {...common}>{str(node.props.value)}</div>
    case 'OtpInput':
      return <div key={key} {...common}>{'•'.repeat(num(node.props.length, 6) || 6)}</div>
    case 'Paragraph':
      return <p key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{str(node.props.text)}</p>
    case 'Caption':
      return <div key={key} {...common}>{str(node.props.text)}</div>
    case 'Quote':
      return <blockquote key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{str(node.props.text)}</blockquote>
    case 'CodeBlock':
      return <pre key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}><code>{str(node.props.code)}</code></pre>
    case 'InlineCode':
      return <code key={key} {...common}>{str(node.props.code)}</code>
    case 'Link':
      return <a key={key} {...common} href={str(node.props.href) || '#'}>{str(node.props.text)}</a>
    case 'BulletList':
      return <ul key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{csv(node.props.items).map((it) => <li key={it}>{it}</li>)}</ul>
    case 'NumberedList':
      return <ol key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{csv(node.props.items).map((it) => <li key={it}>{it}</li>)}</ol>
    case 'Divider':
      return <hr key={key} {...common} />
    case 'Badge':
      return <span key={key} {...common}>{str(node.props.text)}</span>
    case 'Tag':
      return <span key={key} {...common}>{str(node.props.text)}</span>
    case 'Kbd':
      return <kbd key={key} {...common}>{str(node.props.keys)}</kbd>
    case 'Table':
      return <div key={key} {...common}>{csv(node.props.columns).join(' · ')}</div>
    case 'Stat':
      return <div key={key} {...common}>{str(node.props.value)} {str(node.props.label)}</div>
    case 'ProgressBar':
      return <div key={key} {...common}>{num(node.props.value, 0)}%</div>
    case 'ProgressRing':
      return <div key={key} {...common}>{num(node.props.value, 0)}%</div>
    case 'Avatar':
      return <div key={key} {...common}>{str(node.props.initials)}</div>
    case 'AvatarGroup':
      return <div key={key} {...common}>{str(node.props.names)}</div>
    case 'Image':
      return <div key={key} {...common}>{str(node.props.alt)}</div>
    case 'BarChart':
      return <div key={key} {...common}>bars</div>
    case 'PieChart':
      return <div key={key} {...common}>pie</div>
    case 'LineChart':
      return <div key={key} {...common}>trend</div>
    case 'TimelineItem':
      return <div key={key} {...common}>{str(node.props.title)}</div>
    case 'TreeList':
      return <div key={key} {...common}>{csv(node.props.items).join(', ')}</div>
    case 'DataList':
      return <div key={key} {...common}>{csv(node.props.items).join(', ')}</div>
    case 'KeyValue':
      return <div key={key} {...common}>{str(node.props.label)}: {str(node.props.value)}</div>
    case 'Calendar':
      return <div key={key} {...common}>{str(node.props.month)}</div>
    case 'EmptyState':
      return <div key={key} {...common}>{str(node.props.title)}</div>
    case 'Skeleton':
      return <div key={key} {...common}>loading…</div>
    case 'NavLink':
      return <a key={key} {...common} href={str(node.props.href) || '#'}>{str(node.props.label)}</a>
    case 'Breadcrumbs':
      return <div key={key} {...common}>{csv(node.props.trail).join(' / ')}</div>
    case 'Pagination':
      return <div key={key} {...common}>{num(node.props.page, 1)} / {num(node.props.total, 12)}</div>
    case 'Stepper':
      return <div key={key} {...common}>{csv(node.props.steps).join(' → ')}</div>
    case 'MenuItem':
      return <div key={key} {...common}>{str(node.props.label)}</div>
    case 'TabBar':
      return <div key={key} {...common}>{csv(node.props.tabs).join(' · ')}</div>
    case 'AnchorList':
      return <div key={key} {...common}>{csv(node.props.links).join(', ')}</div>
    case 'BackButton':
      return <button key={key} type="button" {...common}>← {str(node.props.label)}</button>
    case 'Alert':
      return <div key={key} {...common}>{str(node.props.title)}: {str(node.props.body)}</div>
    case 'Toast':
      return <div key={key} {...common}>{str(node.props.message)}</div>
    case 'Spinner':
      return <div key={key} {...common}>{str(node.props.label)}</div>
    case 'LoadingBar':
      return <div key={key} {...common}>{num(node.props.progress, 0)}%</div>
    case 'ProgressDots':
      return <div key={key} {...common}>{num(node.props.current, 0)}/{num(node.props.steps, 0)}</div>
    case 'InlineMessage':
      return <div key={key} {...common}>{str(node.props.text)}</div>
    case 'ErrorSummary':
      return <div key={key} {...common}>{str(node.props.title)}</div>
    case 'SuccessCheck':
      return <div key={key} {...common}>✓ {str(node.props.label)}</div>
    case 'WarningCallout':
      return <div key={key} {...common}>{str(node.props.title)}</div>
    case 'InfoCallout':
      return <div key={key} {...common}>{str(node.props.title)}</div>
    default:
      throw new Error(`unknown component: ${node.type}`)
  }
}

/**
 * Radial gauge.
 *
 * Fixes three defects the output-quality review demonstrated:
 *  - the progress arc used a BOUNDING-BOX gradient, which compressed the whole
 *    blue->purple range into the arc's box and washed out the left tail;
 *  - there was no scale, so a gauge was a decorative donut;
 *  - there was no colour-by-value, so a gauge could never signal danger.
 */
function GaugeFace({ node, t }: { node: Node; t: Theme }) {
  const value = Number(node.props.value) || 0
  const min = Number(node.props.min) || 0
  const max = Number(node.props.max) || 100
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min || 1)))
  const angle = -120 + pct * 240
  const size = Number(node.props.size) || 140
  const r = size / 2 - 12
  const c = size / 2
  const uid = `g-${node.id}`

  // Colour by value: a gauge that cannot turn red at 90% is half a gauge.
  const dangerAt = Number(node.props.dangerAt ?? 85)
  const warnAt = Number(node.props.warnAt ?? 65)
  const arc = pct >= dangerAt / 100 ? t.danger : pct >= warnAt / 100 ? t.warning : t.accent

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${Math.round(pct * 100)}${str(node.props.unit)}`}
    >
      {/* Track: visible enough to read as a scale. */}
      <path
        d={describeArc(c, c, r, -120, 120)}
        fill="none"
        stroke={t.border}
        strokeWidth={8}
        strokeLinecap="round"
      />
      {/* Ticks at 0 / 50 / 100 so the arc means something. */}
      {[-120, 0, 120].map((a) => {
        const rad = ((a - 90) * Math.PI) / 180
        const inner = r - 13
        const outer = r - 7
        return (
          <line
            key={a}
            x1={c + inner * Math.cos(rad)}
            y1={c + inner * Math.sin(rad)}
            x2={c + outer * Math.cos(rad)}
            y2={c + outer * Math.sin(rad)}
            stroke={t.borderStrong}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        )
      })}
      {/* Progress arc: a USER-space gradient along the path, not a bounding box. */}
      <path
        d={describeArc(c, c, r, -120, angle)}
        fill="none"
        stroke={`url(#${uid})`}
        strokeWidth={8}
        strokeLinecap="round"
      />
      <defs>
        <linearGradient id={uid} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={size} y2={size}>
          <stop offset="0%" stopColor={arc} stopOpacity={0.65} />
          <stop offset="100%" stopColor={arc} />
        </linearGradient>
      </defs>
      <text
        x={c}
        y={c + 6}
        textAnchor="middle"
        fill={t.textPrimary}
        fontSize={size * 0.24}
        fontWeight={t.weightBold}
        fontFamily={t.fontFamily}
      >
        {Math.round(pct * 100)}
        <tspan fontSize={size * 0.13} fill={t.textMuted} dx={2}>
          {str(node.props.unit)}
        </tspan>
      </text>
    </svg>
  )
}

function describeArc(cx: number, cy: number, r: number, start: number, end: number): string {
  const rad = (d: number) => ((d - 90) * Math.PI) / 180
  const large = end - start <= 180 ? 0 : 1
  const x1 = cx + r * Math.cos(rad(start))
  const y1 = cy + r * Math.sin(rad(start))
  const x2 = cx + r * Math.cos(rad(end))
  const y2 = cy + r * Math.sin(rad(end))
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`
}

/**
 * Sparkline with an area fill, a gradient stroke, and a last-point marker.
 * The review's complaint was that a bare 2px polyline reads as a scratch, not
 * a trend.
 */
function Spark({ node, t }: { node: Node; t: Theme }) {
  const pts = str(node.props.points)
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v))
  const w = Number(node.props.width) || 220
  const h = Number(node.props.height) || 60
  const accent = str(node.props.accent) || t.accent
  if (pts.length < 2) return <div style={{ width: w, height: h }} />

  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const step = w / (pts.length - 1)
  const pad = 4
  const usable = h - pad * 2
  const xy = pts.map((v, i) => [
    i * step,
    pad + usable - ((v - min) / span) * usable,
  ] as const)
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L ${w} ${h} L 0 ${h} Z`
  const [lx, ly] = xy[xy.length - 1]
  const uid = `s-${node.id}`

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="trend">
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={0.28} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${uid})`} />
      <path
        d={line}
        fill="none"
        stroke={accent}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r={3} fill={accent} />
      <circle cx={lx} cy={ly} r={6} fill={accent} opacity={0.18} />
    </svg>
  )
}
