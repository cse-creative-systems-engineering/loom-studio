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
import { delimiterChar, getComponent } from '../model/registry'
import { iconMarkup, isIconName, resolveIcon } from './icons'
import { parentOf } from '../model/ops'
import { typeStep, weightStep, resolveTheme, type Theme } from './theme'
import { applyEffects, normalizeEffects } from './effects'
import { behaviourAttrs, groupId } from './behaviour'
import { OUTPUT_HOOK, isResponsive } from './responsive'
import { FORCE_ATTR, hasStates } from './states'
import type { Document, InteractionState, Node, NodeId, PropValue } from '../model/types'

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
  /**
   * Authoring only: show this node in an interaction state without the
   * pointer, so the state being edited is the state on screen.
   */
  forceState?: { id: NodeId; state: InteractionState }
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

/**
 * Split a list-valued property using ITS OWN delimiter.
 *
 * Every list property ships a `delimiter` companion prop, so "where does this
 * split" is answered by the document instead of by a convention buried in the
 * renderer. That is the difference between a designer who can enter
 * `Ada, Countess of Lovelace` and one who silently gets two broken columns.
 */
/** The same split, coerced to finite numbers and junk dropped. */
function numericList(value: PropValue | undefined, delimiter: PropValue | undefined): number[] {
  return list(value, delimiter)
    .map((v) => Number(v.replace(/[$,%\s]/g, '')))
    .filter((v) => Number.isFinite(v))
}

function list(value: PropValue | undefined, delimiter: PropValue | undefined): string[] {
  const raw = str(value)
  if (raw.trim() === '') return []
  return raw.split(delimiterChar(delimiter)).map((s) => s.trim()).filter((s) => s !== '')
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
 * Group a fixed-point number the way a number is READ: thousands separators,
 * and a minus sign outside them. Done on the string, not with `toLocaleString`,
 * so the output does not change with the machine's locale — a document that
 * renders `1 284,5` for one designer and `1,284.5` for another is a bug in a
 * design tool.
 */
function groupDigits(fixed: string): string {
  const [whole, frac] = fixed.split('.')
  const negative = whole.startsWith('-')
  const digits = negative ? whole.slice(1) : whole
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac === undefined ? '' : `.${frac}`}`
}

/**
 * A metric, formatted as a metric: fixed to `precision` places, grouped, and
 * carrying its unit. `precision` below zero means "as the designer typed it" —
 * `$48.2k` is shorthand somebody chose, and expanding it to 48200 would be the
 * renderer overruling an author. A value that does not parse as a number is
 * likewise shown verbatim, because it is a label, not a figure.
 */
function formatMetric(value: string, precision: number, unit: string): string {
  const parsed = Number(value.replace(/[$,%\s]/g, ''))
  if (value === '' || !Number.isFinite(parsed)) return `${value}${unit}`
  const digits = precision >= 0 ? Math.min(20, Math.floor(precision)) : -1
  return `${groupDigits(digits >= 0 ? parsed.toFixed(digits) : String(parsed))}${unit}`
}

/**
 * The icon a feedback component shows when the designer names none.
 *
 * A toast with a tone and no glyph is half a toast: the shape of the message —
 * saved, broken, careful — is the whole reason it is a component rather than a
 * box. This is the default, not a substitute: a named `icon` always wins.
 */
const TONE_ICON: Record<string, string> = {
  success: 'check',
  warning: 'alert-triangle',
  danger: 'alert-triangle',
  info: 'info',
  accent: 'info',
  neutral: 'info',
}

/**
 * The tone a callout takes from its TYPE.
 *
 * A callout's meaning is what it is — a warning cannot be recoloured into a
 * tip — so this is read from the component, never from a `tone` property, and
 * both the box and the body ask the same question.
 */
function calloutTone(type: string): string {
  return type === 'WarningCallout' ? 'warning' : 'accent'
}

/**
 * The icon slot of a feedback component: rendered when `showIcon` is on, and
 * the tone's own glyph when the designer names none. `undefined` means the slot
 * is off, so the caller writes one expression instead of a condition.
 */
function feedbackIcon(props: Record<string, PropValue>, tone: string, size: number, color: string) {
  if (props.showIcon === false) return null
  const named = str(props.icon)
  return <IconGlyph value={named || TONE_ICON[tone] || 'info'} size={size} color={color} />
}

/**
 * A divider with a word in it: two rules and the label between them.
 *
 * Which rule keeps its size is `labelAlign` — a start-aligned label gets a
 * short trailing rule, an end-aligned one a short leading rule — so the
 * property moves something a person can see rather than only reordering two
 * identical elements. Shared by the preview and the canvas, because a labelled
 * divider that only exists in the output is a divider nobody can lay out.
 */
function LabelledDivider({
  p,
  t,
  style,
  middle,
  nodeKey,
}: {
  p: Record<string, PropValue>
  t: Theme
  style: React.CSSProperties
  middle: React.ReactNode
  nodeKey?: string | number
}) {
  const thickness = num(p.thickness, 1)
  const colour = str(p.color) || t.borderStrong
  const named = str(p.ariaLabel)
  const align = str(p.labelAlign) || 'center'
  const fixed = '0 0 24px'
  const rule = (flex: string) => ({
    flex,
    height: `${thickness}px`,
    borderTop: `${thickness}px ${str(p.style) || 'solid'} ${colour}`,
  })
  return (
    <div
      key={nodeKey}
      role={named ? 'separator' : undefined}
      aria-label={named || undefined}
      style={{
        ...style,
        height: 'auto',
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: `${t.space2}px`,
        marginTop: px(p.margin, 12),
        marginBottom: px(p.margin, 12),
        opacity: 1,
      }}
    >
      <span style={rule(align === 'start' ? fixed : '1')} />
      <span style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0, fontSize: `${t.textXs}px`, color: t.textMuted, whiteSpace: 'nowrap' }}>
        {middle}
      </span>
      <span style={rule(align === 'end' ? fixed : '1')} />
    </div>
  )
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
/** Sentinel for "the designer did not set this". */
const UNSET = -1

/**
 * Apply the shared property vocabulary to a node's style.
 *
 * Reads only what the component DECLARED, so the panel and the renderer cannot
 * disagree about what a component supports, and no property is quietly ignored.
 */
/**
 * Components that render an INLINE box by default. An inline box ignores
 * border-radius, so a radius on one of these looked like a dead control. The
 * list is explicit rather than inferred from `display`, because a `div` that
 * simply has no display set is still a block and must not be promoted.
 */
const INLINE_BY_NATURE = new Set(['InlineCode', 'Kbd', 'Code', 'Link', 'Badge', 'Tag'])

/**
 * Components whose WIDTH is not the shared `width` property.
 *
 * The shared pass runs LAST, so a component that owns its box gets the last
 * word — but only if the shared pass does not stamp its own answer over the
 * top. A collapsed side rail is a different width from an expanded one, and
 * `width` is always set on a side nav, so without this the expanded width was
 * written back over the rail and `railWidth` changed nothing a person could
 * see. The component's own branch answers for both states.
 */
const WIDTH_IS_OWNED = new Set(['SideNav'])

function applyCommonStyle(
  s: React.CSSProperties,
  p: Record<string, PropValue>,
  t: Theme,
  nodeType: string,
): void {
  // --- box ---
  const w = num(p.width, UNSET)
  if (w > 0 && !WIDTH_IS_OWNED.has(nodeType)) s.width = px(p.width, w)
  const h = num(p.height, UNSET)
  if (h > 0) s.height = px(p.height, h)
  const r = num(p.radius, UNSET)
  if (r >= 0) {
    s.borderRadius = `${r}px`
    if (
      INLINE_BY_NATURE.has(nodeType) &&
      s.display !== 'block' &&
      s.display !== 'flex' &&
      s.display !== 'grid'
    ) {
      s.display = 'inline-block'
    }
  }

  // --- semantic tone ---
  // `tone` is part of the shared vocabulary, so the shared pass honours it:
  // any component that declares a tone becomes signal-coloured, whether it is a
  // toast, a callout, a slider or a checkbox. Two deliberate rules:
  //   - an explicit `color` always wins, because the designer chose it;
  //   - `accentColor` is set too, which is the right knob for native controls.
  const tone = str(p.tone)
  if (tone && tone !== 'neutral' && tone !== 'inherit') {
    const toneColor =
      tone === 'info' ? t.accent : tone === 'success' ? t.success : tone === 'warning' ? t.warning : t.danger
    s.accentColor = toneColor
    if (str(p.color) === '') s.color = toneColor
  }
  const bg = str(p.background)
  if (bg) s.background = bg
  const bd = str(p.border)
  const bw = num(p.borderWidth, UNSET)
  if (bd || bw >= 0) {
    s.border = `${bw >= 0 ? bw : 1}px solid ${bd || t.border}`
  }
  const shadow = str(p.shadow)
  if (shadow && shadow !== 'none') s.boxShadow = t[`shadow${shadow.charAt(0).toUpperCase()}${shadow.slice(1)}` as keyof Theme] as string

  // --- spacing: `padding` is the shorthand, X/Y are the override ---
  const pad = num(p.padding, UNSET)
  const padX = num(p.paddingX, UNSET)
  const padY = num(p.paddingY, UNSET)
  if (pad >= 0) s.padding = `${pad}px`
  if (padX >= 0) {
    s.paddingLeft = `${padX}px`
    s.paddingRight = `${padX}px`
  }
  if (padY >= 0) {
    s.paddingTop = `${padY}px`
    s.paddingBottom = `${padY}px`
  }
  const gap = num(p.gap, UNSET)
  if (gap >= 0) s.gap = `${gap}px`

  // --- flow ---
  if (s.display === 'flex') {
    if (str(p.direction) === 'row') s.flexDirection = 'row'
    else if (str(p.direction) === 'column') s.flexDirection = 'column'
    const align = str(p.align)
    if (align) s.alignItems = align === 'baseline' ? 'baseline' : align
    const justify = str(p.justify)
    if (justify) s.justifyContent = justify === 'start' ? 'flex-start' : justify
    if (p.wrap === true) s.flexWrap = 'wrap'
  }

  // --- type ---
  const fs = num(p.fontSize, UNSET)
  if (fs > 0) s.fontSize = `${fs}px`
  const fw = num(p.fontWeight, UNSET)
  if (fw > 0) s.fontWeight = fw
  const col = str(p.color)
  if (col) s.color = col
  const align = str(p.align)
  if (align && (s.display === 'flex' || s.display === 'block' || s.textAlign !== undefined || true)) {
    s.textAlign = align as React.CSSProperties['textAlign']
  }
  const lh = num(p.lineHeight, UNSET)
  if (lh > 0) s.lineHeight = lh
  const ls = num(p.letterSpacing, UNSET)
  if (ls !== UNSET) s.letterSpacing = `${ls}px`
  const mw = num(p.maxWidth, UNSET)
  if (mw > 0) s.maxWidth = `${mw}px`

  // --- docking ---
  // An anchor pins a free node to an edge of its parent, so it survives the
  // parent resizing. It REPLACES the numeric position on purpose: "pin to the
  // top right" and "be at 40,12" are different intentions, and a component
  // silently doing both is worse than either. Flow children are placed by their
  // parent, so an anchor means nothing there and is ignored.
  const anchorRaw = str(p.anchor)
  const anchor = anchorRaw === 'none' ? '' : anchorRaw
  const free = s.position === 'absolute' || s.position === 'fixed' || s.position === undefined
  if (anchor && free) {
    // Clear whatever x/y put there so the anchor is the only position.
    s.left = undefined
    s.top = undefined
    s.right = undefined
    s.bottom = undefined
    switch (anchor) {
      case 'top-left': s.top = '0'; s.left = '0'; break
      case 'top': s.top = '0'; s.left = '0'; s.right = '0'; break
      case 'top-right': s.top = '0'; s.right = '0'; break
      case 'right': s.top = '0'; s.right = '0'; s.bottom = '0'; break
      case 'bottom-right': s.bottom = '0'; s.right = '0'; break
      case 'bottom': s.bottom = '0'; s.left = '0'; s.right = '0'; break
      case 'bottom-left': s.bottom = '0'; s.left = '0'; break
      case 'left': s.top = '0'; s.bottom = '0'; s.left = '0'; break
      case 'center':
        s.top = '50%'
        s.left = '50%'
        break
      case 'fill': s.inset = '0'; break
      default: break
    }
  }
  if (p.sticky === true) {
    // Sticky is the other half of docking: it keeps a node put while the
    // content around it scrolls.
    s.position = 'sticky'
  }
  const rotate = num(p.rotate, 0)
  if (rotate !== 0) {
    // Compose rather than clobber: centring uses a translate, and rotation
    // must not erase it.
    const existing = str(s.transform)
    s.transform = existing ? `${existing} rotate(${rotate}deg)` : `rotate(${rotate}deg)`
  }

  // --- conditions ---
  if (p.disabled === true) {
    s.opacity = 0.5
    s.cursor = 'not-allowed'
  }
  if (str(p.overflow) === 'auto' || str(p.overflow) === 'scroll') s.overflow = str(p.overflow)
  else if (str(p.overflow) === 'hidden') s.overflow = 'hidden'
}

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
      // Glass is a SURFACE, not a shadow: `surface: 'glass'` and the `glass`
      // switch mean the same thing, and an option in the enum that quietly
      // rendered identical to 'solid' was a lie the panel could not afford.
      const glass = p.glass === true || p.surface === 'glass'
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
      // The generic pass treats `shadow: 'none'` as "not set", because for most
      // components no shadow IS the default. A panel defaults to `md`, so
      // 'none' has to be said out loud here or the elevation could never be
      // taken off.
      if (str(p.shadow) === 'none') s.boxShadow = 'none'
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
      // A grid's two alignment axes, which the generic pass cannot reach: it
      // only applies flow alignment to a FLEX box, and this box is a grid.
      const align = str(p.align)
      s.alignItems = align === 'start' || align === 'center' || align === 'end' ? align : 'stretch'
      s.justifyContent = str(p.justify) || 'start'
      break
    }
    case 'Button': {
      // size -> [paddingY, paddingX, fontSize]. The scale is the whole point of
      // a size: a small button that keeps the medium button's type is not small.
      const sizes: Record<string, [number, number, number]> = {
        sm: [t.space1 * 2, t.space2 + 2, t.textXs + 1],
        md: [t.space2 + 2, t.space4, t.textSm],
        lg: [t.space3 + 2, t.space5, t.textMd],
      }
      const [py, pxv, fs] = sizes[str(p.size)] ?? sizes.md
      // Explicit padding overrides the scale's, which is why these two props
      // start unset: an unstyled button is still a well-proportioned one.
      const padY = num(p.paddingY, -1) >= 0 ? num(p.paddingY) : py
      const padX = num(p.paddingX, -1) >= 0 ? num(p.paddingX) : pxv
      const variants: Record<string, React.CSSProperties> = {
        primary: { background: t.accent, color: t.textOnAccent },
        secondary: { background: t.surface, color: t.textPrimary },
        ghost: { background: 'transparent', color: t.textSecondary },
        danger: { background: t.danger, color: t.textOnAccent },
      }
      Object.assign(s, variants[str(p.variant)] ?? variants.primary)
      s.padding = `${padY}px ${padX}px`
      s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`
      s.fontSize = `${fs}px`
      s.fontWeight = t.weightSemibold
      s.lineHeight = 1.2
      s.cursor = p.disabled === true ? 'not-allowed' : p.loading === true ? 'progress' : 'pointer'
      s.opacity = p.disabled === true ? 0.5 : 1
      if (p.glow === true) s.boxShadow = t.shadowGlow
      // A full-width button is the one layout a toolbar and a form card both
      // need, and it is a decision the box cannot make on its own.
      if (p.fullWidth === true) s.width = '100%'
      // A capped label ellipsises instead of wrapping to two lines and pushing
      // the row apart — which is what `maxWidth` is for everywhere else.
      if (num(p.maxWidth, -1) > 0) {
        s.overflow = 'hidden'
        s.textOverflow = 'ellipsis'
        s.whiteSpace = 'nowrap'
      }
      break
    }
    case 'Label': {
      s.fontSize = `${typeStep(t, str(p.size))}px`
      s.fontWeight = weightStep(t, str(p.weight) || 'medium')
      s.color = str(p.color) || t.textPrimary
      s.lineHeight = t.lineHeight
      s.letterSpacing = str(p.size) === 'xs' ? '0.4px' : 'normal'
      s.whiteSpace = 'pre-wrap'
      // The eyebrow treatment: a small, letter-spaced, shouted label. It is one
      // boolean rather than a `textTransform` string, because the only two
      // answers anyone wants are "as typed" and "as an eyebrow".
      if (p.uppercase === true) s.textTransform = 'uppercase'
      break
    }
    case 'Input': {
      // size -> [paddingY, paddingX, fontSize]. `md` is the historical box, so a
      // drop looks exactly as it always did.
      const sizes: Record<string, [number, number, number]> = {
        sm: [t.space1 + 2, t.space2, t.textXs + 1],
        md: [t.space2 + 1, t.space3, t.textSm],
        lg: [t.space3, t.space4, t.textMd],
      }
      const [py, pxv, fs] = sizes[str(p.size)] ?? sizes.md
      // The treatments a text field actually comes in. `default` is the
      // outlined surface the component has always drawn.
      const variants: Record<string, React.CSSProperties> = {
        default: { background: t.surface, border: `1px solid ${t.borderStrong}` },
        primary: { background: `${t.accent}0f`, border: `1px solid ${t.accent}` },
        secondary: { background: t.bg, border: 'none' },
        ghost: { background: 'transparent', border: `1px solid ${t.border}` },
        danger: { background: `${t.danger}0f`, border: `1px solid ${t.danger}` },
      }
      Object.assign(s, variants[str(p.variant)] ?? variants.default)
      s.width = px(p.width, 200)
      s.padding = `${py}px ${pxv}px`
      s.borderRadius = `${t.radiusMd}px`
      s.color = t.textPrimary
      s.fontSize = `${fs}px`
      s.lineHeight = 1.3
      s.outline = 'none'
      break
    }
    case 'Field': {
      const inline = str(p.layout) === 'inline'
      s.display = 'flex'
      // `inline` is the settings-row pattern: label and description on the
      // left, control on the right. It is the layout half of why a form-heavy
      // screen is fast to build.
      s.flexDirection = inline ? 'row' : 'column'
      s.alignItems = inline ? 'center' : 'stretch'
      s.gap = inline ? `${t.space3}px` : `${t.space1 + 1}px`
      s.width = px(p.width, 280)
      break
    }
    case 'Heading': {
      s.lineHeight = 1.2
      s.color = str(p.color) || t.textPrimary
      s.textAlign = (str(p.align) || 'left') as React.CSSProperties['textAlign']
      if (p.uppercase === true) s.textTransform = 'uppercase'
      // One line, ellipsis. Anything longer is a paragraph, not a title.
      if (p.truncate === true) {
        s.overflow = 'hidden'
        s.textOverflow = 'ellipsis'
        s.whiteSpace = 'nowrap'
      }
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
      s.display = 'flex'; s.flexDirection = 'column'
      // size -> [padding, gap]. A dialog is a scale decision before it is a
      // width decision: `sm` is a confirm, `lg` is a form.
      const mSizes: Record<string, [number, number]> = {
        sm: [t.space3, t.space2],
        md: [t.space5, t.space3],
        lg: [t.space6, t.space4],
      }
      const [mpad, mgap] = mSizes[str(p.size)] ?? mSizes.md
      s.gap = `${mgap}px`
      s.width = px(p.width, 480); s.padding = `${mpad}px`
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
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space2)
      s.height = px(p.height, 300)
      // The scroll AXES are this component's own `direction` — vertical,
      // horizontal or both — so they are set as the longhands rather than
      // folded into the flow direction. `scrollbars` then says whether a bar
      // is drawn: `always` pins it, `hidden` keeps the content scrollable and
      // only takes the bar away, `none` stops the region scrolling at all.
      const axis = str(p.direction)
      const bars = str(p.scrollbars)
      const scroll = (a: boolean, pinned: boolean): 'auto' | 'scroll' | 'hidden' =>
        !a || bars === 'none' ? 'hidden' : bars === 'always' || pinned ? 'scroll' : 'auto'
      s.overflowY = scroll(axis !== 'horizontal', axis === 'vertical')
      s.overflowX = scroll(axis !== 'vertical', axis === 'horizontal')
      if (bars === 'hidden') s.scrollbarWidth = 'none'
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
      // size -> [paddingY, paddingX, fontSize]: a strip of actions is one
      // scale decision, not three independent nudges.
      const tSizes: Record<string, [number, number, number]> = {
        sm: [t.space1, t.space2, t.textXs],
        md: [t.space2, t.space3, t.textSm],
        lg: [t.space3, t.space4, t.textMd],
      }
      const [tpy, tpxv, tfs] = tSizes[str(p.size)] ?? tSizes.md
      s.gap = px(p.gap, t.space2); s.padding = `${tpy}px ${tpxv}px`
      s.fontSize = `${tfs}px`
      s.borderRadius = `${t.radiusMd}px`; s.background = t.surface
      s.border = `1px solid ${t.border}`
      break
    }
    case 'StatusBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = px(p.gap, t.space2); s.padding = `${t.space2}px ${t.space3}px`
      s.fontSize = `${t.textXs}px`
      // A status bar reports a condition, so `tone` colours it and `neutral`
      // stays the quiet default it has always been.
      s.color = p.tone === 'neutral' ? t.textSecondary : toneColor(t, str(p.tone))
      s.background = t.surface
      s.borderTop = p.divider === false ? 'none' : `1px solid ${t.border}`
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
      s.gap = px(p.gap, t.space3); s.height = px(p.height, 56)
      s.padding = `0 ${t.space4}px`; s.background = t.surface
      s.borderBottom = p.divider === false ? 'none' : `1px solid ${t.border}`
      break
    }
    case 'FooterBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.height = px(p.height, 48); s.padding = `0 ${t.space4}px`
      s.fontSize = `${t.textXs}px`; s.color = t.textMuted
      s.background = t.surface
      s.borderTop = p.divider === false ? 'none' : `1px solid ${t.border}`
      break
    }
    case 'SettingsSection': {
      s.display = 'flex'
      s.flexDirection = 'column'
      s.gap = px(p.gap, t.space2)
      s.padding = `${t.space4}px`
      s.borderRadius = `${t.radiusLg}px`
      s.border = `1px solid ${p.danger === true ? t.danger : t.border}`
      s.background = t.surface
      s.width = px(p.width, 640)
      break
    }
    case 'SettingsRow': {
      s.display = 'flex'
      s.flexDirection = 'row'
      s.alignItems = 'center'
      s.gap = px(p.gap, t.space4)
      s.padding = `${t.space3}px 0`
      s.width = px(p.width, 640)
      break
    }
    case 'CommandPalette': {
      // The palette is an overlay sized to the viewport, not a box in the flow.
      s.position = 'fixed'
      s.inset = '0'
      s.width = '100%'
      s.height = '100%'
      s.zIndex = 100
      break
    }
    case 'AppShell': {
      s.display = 'flex'
      s.flexDirection = 'row'
      s.width = px(p.width, 1200)
      s.height = px(p.height, 720)
      s.borderRadius = `${t.radiusLg}px`
      s.border = `1px solid ${t.border}`
      s.background = t.bg
      s.overflow = 'hidden'
      break
    }
    case 'SidebarPanel': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, t.space2)
      s.width = px(p.width, 240); s.padding = `${t.space4}px`
      s.background = t.surface; s.borderRight = `1px solid ${t.border}`
      break
    }
    case 'FormGrid': {
      s.display = 'grid'
      s.gridTemplateColumns = `repeat(${num(p.columns, 2) || 2}, minmax(0, 1fr))`
      s.gap = px(p.gap, t.space3)
      // A grid has the same two alignment axes a flex box has, and the generic
      // pass only reaches flex boxes, so they are read here.
      const fAlign = str(p.align)
      s.alignItems = fAlign === 'start' || fAlign === 'center' || fAlign === 'end' ? fAlign : 'stretch'
      s.justifyContent = str(p.justify) || 'start'
      break
    }
    case 'BannerBox': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = px(p.gap, t.space2); s.padding = `${t.space3}px ${t.space4}px`
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
      // The same four treatments a Button has, so the two never disagree:
      // `secondary` is the quiet surface, `ghost` has no fill at all.
      const ibVariant = str(p.variant)
      const ibDanger = ibVariant === 'danger'
      s.background = ibVariant === 'primary' ? t.accent : ibDanger ? t.danger : ibVariant === 'ghost' ? 'transparent' : t.surface
      s.color = ibVariant === 'primary' || ibDanger ? t.textOnAccent : t.textPrimary
      s.border = `1px solid ${ibDanger ? t.danger : t.borderStrong}`
      s.cursor = p.disabled === true ? 'not-allowed' : 'pointer'
      s.opacity = p.disabled === true ? 0.5 : 1
      break
    }
    case 'Checkbox': case 'Radio': case 'Switch': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      // size is the LABEL scale here: the box is the browser's, and a control
      // whose own text disagrees with the form around it is the thing this
      // fixes.
      s.fontSize = str(p.size) === 'sm' ? `${t.textXs}px` : str(p.size) === 'lg' ? `${t.textMd}px` : `${t.textSm}px`
      s.color = t.textPrimary
      s.opacity = p.disabled === true ? 0.55 : 1
      break
    }
    case 'RadioGroup': case 'Checklist': case 'ButtonGroup': {
      s.display = 'flex'; s.flexDirection = str(p.direction) === 'row' ? 'row' : 'column'
      s.flexWrap = p.wrap === true ? 'wrap' : 'nowrap'
      s.gap = px(p.gap, 8); s.alignItems = 'center'
      break
    }
    case 'Slider': {
      s.display = 'flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.width = px(p.width, 200); s.color = t.textSecondary; s.fontSize = `${t.textXs}px`
      break
    }
    case 'Select': case 'ComboBox': case 'SearchBox': case 'NumberInput':
    case 'PasswordInput': case 'DatePicker': case 'TimePicker': case 'ColorInput':
    case 'SpinBox': {
      s.display = 'inline-flex'; s.alignItems = 'center'
      // The same size -> [paddingY, paddingX, fontSize] scale every text field
      // in the kit uses, so a Select and an Input can finally agree.
      const iSizes: Record<string, [number, number, number]> = {
        sm: [t.space1, t.space2, t.textXs],
        md: [t.space2 + 1, t.space3, t.textSm],
        lg: [t.space3, t.space4, t.textMd],
      }
      const [ipy, ipx, ifs] = iSizes[str(p.size)] ?? iSizes.md
      s.padding = `${ipy}px ${ipx}px`; s.borderRadius = `${t.radiusMd}px`
      // The treatments a field actually comes in, named as they are elsewhere.
      const iVariants: Record<string, React.CSSProperties> = {
        default: { background: t.surface, border: `1px solid ${t.borderStrong}` },
        primary: { background: `${t.accent}0f`, border: `1px solid ${t.accent}` },
        secondary: { background: t.bg, border: `1px solid ${t.border}` },
        ghost: { background: 'transparent', border: `1px solid ${t.border}` },
        danger: { background: `${t.danger}0f`, border: `1px solid ${t.danger}` },
      }
      const iv = iVariants[str(p.variant)] ?? iVariants.default
      s.border = iv.border; s.background = iv.background
      s.color = t.textPrimary; s.fontSize = `${ifs}px`; s.gap = `${t.space2}px`
      break
    }
    case 'TextArea': {
      const aSizes: Record<string, [number, number, number]> = {
        sm: [t.space1 + 1, t.space2, t.textXs],
        md: [t.space2 + 1, t.space3, t.textSm],
        lg: [t.space3, t.space4, t.textMd],
      }
      const [apy, apx, afs] = aSizes[str(p.size)] ?? aSizes.md
      s.width = px(p.width, 280); s.padding = `${apy}px ${apx}px`
      s.borderRadius = `${t.radiusMd}px`
      const aVariants: Record<string, React.CSSProperties> = {
        default: { background: t.surface, border: `1px solid ${t.borderStrong}` },
        primary: { background: `${t.accent}0f`, border: `1px solid ${t.accent}` },
        secondary: { background: t.bg, border: `1px solid ${t.border}` },
        ghost: { background: 'transparent', border: `1px solid ${t.border}` },
        danger: { background: `${t.danger}0f`, border: `1px solid ${t.danger}` },
      }
      const av = aVariants[str(p.variant)] ?? aVariants.default
      s.border = av.border; s.background = av.background
      s.color = t.textPrimary; s.fontSize = `${afs}px`
      break
    }
    case 'FileUpload': {
      s.display = 'flex'; s.flexDirection = 'column'; s.alignItems = 'center'; s.justifyContent = 'center'
      s.gap = px(p.gap, t.space2); s.padding = `${t.space5}px`
      s.borderRadius = `${t.radiusLg}px`
      // A dashed edge says "drop here"; a solid one is an ordinary button that
      // happens to open a picker. Both are legitimate, so both are offered.
      s.border = str(p.variant) === 'solid' ? `1px solid ${t.borderStrong}` : `1px dashed ${t.borderStrong}`
      s.background = t.bg; s.color = t.textSecondary
      s.fontSize = str(p.size) === 'sm' ? `${t.textXs}px` : str(p.size) === 'lg' ? `${t.textMd}px` : `${t.textSm}px`
      break
    }
    case 'DropdownButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      const dSizes: Record<string, [number, number, number]> = {
        sm: [t.space1 + 1, t.space2 + 2, t.textXs],
        md: [t.space2 + 2, t.space4, t.textSm],
        lg: [t.space3, t.space5, t.textMd],
      }
      const [dpy, dpx, dfs] = dSizes[str(p.size)] ?? dSizes.md
      s.padding = `${dpy}px ${dpx}px`; s.borderRadius = `${t.radiusMd}px`
      const dbVariant = str(p.variant)
      const dbDanger = dbVariant === 'danger'
      s.background = dbVariant === 'primary' ? t.accent : dbDanger ? t.danger : dbVariant === 'ghost' ? 'transparent' : t.surface
      s.color = dbVariant === 'primary' || dbDanger ? t.textOnAccent : t.textPrimary
      s.border = `1px solid ${dbDanger ? t.danger : t.borderStrong}`; s.fontSize = `${dfs}px`
      s.fontWeight = t.weightSemibold
      s.cursor = p.disabled === true ? 'not-allowed' : 'pointer'
      break
    }
    case 'Rating': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '2px'
      s.fontSize = str(p.size) === 'sm' ? `${t.textMd}px` : str(p.size) === 'lg' ? `${t.textXl}px` : `${t.textLg}px`
      s.color = p.tone === 'inherit' ? t.warning : toneColor(t, str(p.tone))
      break
    }
    case 'ToggleButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.justifyContent = 'center'
      const gSizes: Record<string, [number, number, number]> = {
        sm: [t.space1 + 1, t.space2 + 2, t.textXs],
        md: [t.space2, t.space4, t.textSm],
        lg: [t.space3, t.space5, t.textMd],
      }
      const [gpy, gpx, gfs] = gSizes[str(p.size)] ?? gSizes.md
      s.padding = `${gpy}px ${gpx}px`; s.borderRadius = `${t.radiusFull}px`
      s.fontSize = `${gfs}px`; s.fontWeight = t.weightSemibold
      // The ON state is the variant; the OFF state stays a surface. A declared
      // `background` is deliberately NOT in this component's vocabulary, or it
      // would quietly win over the pressed state.
      const variant = str(p.variant)
      const hot = variant === 'danger' ? t.danger : t.accent
      s.background = p.pressed === true
        ? variant === 'ghost' ? t.bg : hot
        : variant === 'ghost' ? 'transparent' : t.surface
      s.color = p.pressed === true ? t.textOnAccent : variant === 'danger' || variant === 'primary' ? hot : t.textSecondary
      s.border = `1px solid ${variant === 'danger' || variant === 'primary' ? hot : t.borderStrong}`
      s.cursor = p.disabled === true ? 'not-allowed' : 'pointer'
      s.opacity = p.disabled === true ? 0.5 : 1
      break
    }
    case 'Segmented': {
      s.display = 'inline-flex'; s.gap = '2px'
      s.padding = str(p.size) === 'sm' ? '2px' : str(p.size) === 'lg' ? '4px' : '3px'
      s.borderRadius = `${t.radiusMd}px`; s.background = t.bg
      s.border = `1px solid ${t.border}`
      break
    }
    case 'TagInput': case 'OtpInput': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      const vSizes: Record<string, [number, number, number]> = {
        sm: [t.space1, t.space2, t.textXs],
        md: [t.space2, t.space3, t.textSm],
        lg: [t.space3, t.space4, t.textMd],
      }
      const [vpy, vpx, vfs] = vSizes[str(p.size)] ?? vSizes.md
      s.padding = `${vpy}px ${vpx}px`; s.borderRadius = `${t.radiusMd}px`
      s.border = `1px solid ${t.borderStrong}`; s.background = t.surface
      s.fontSize = `${vfs}px`; s.color = t.textPrimary
      break
    }
    /* ---- catalog2 text ---- */
    case 'Paragraph': {
      const scale = str(p.size) === 'xs' ? t.textXs : str(p.size) === 'sm' ? t.textSm : str(p.size) === 'lg' ? t.textLg : t.textMd
      const fs = num(p.fontSize, -1)
      s.fontSize = fs > 0 ? `${fs}px` : `${scale}px`
      s.color = str(p.color) || t.textPrimary; s.lineHeight = t.lineHeight
      s.textAlign = (str(p.align) || 'left') as React.CSSProperties['textAlign']
      s.whiteSpace = 'pre-wrap'
      if (p.uppercase === true) s.textTransform = 'uppercase'
      const indent = num(p.indent, 0)
      if (indent > 0) s.textIndent = `${indent}px`
      // A line clamp is the only way to bound a paragraph honestly: a maxHeight
      // cuts the last line in half, which is what every teaser card gets wrong.
      const clamp = num(p.clamp, -1)
      if (clamp > 0) {
        s.display = '-webkit-box'
        s.WebkitLineClamp = clamp
        s.WebkitBoxOrient = 'vertical'
        s.overflow = 'hidden'
      }
      break
    }
    case 'Caption': {
      const scale = str(p.size) === 'md' ? t.textSm : str(p.size) === 'sm' ? t.textXs + 1 : t.textXs
      s.fontSize = `${scale}px`; s.color = str(p.color) || t.textMuted
      s.lineHeight = 1.4
      if (p.uppercase === true) s.textTransform = 'uppercase'
      const clamp = num(p.clamp, -1)
      if (clamp > 0) {
        s.display = '-webkit-box'
        s.WebkitLineClamp = clamp
        s.WebkitBoxOrient = 'vertical'
        s.overflow = 'hidden'
      }
      break
    }
    case 'Quote': {
      // size -> the quote's own type scale, so a pull quote and an inline
      // quotation are the same component at two sizes.
      const size = str(p.size) || 'md'
      s.fontSize = size === 'sm' ? `${t.textMd}px` : size === 'lg' ? `${t.textXl}px` : `${t.textLg}px`
      s.fontStyle = p.italic === false ? 'normal' : 'italic'
      s.lineHeight = 1.5
      s.color = t.textPrimary; s.borderLeft = `3px solid ${str(p.accent) || t.accent}`
      s.paddingLeft = `${t.space4}px`
      break
    }
    case 'CodeBlock': {
      s.fontFamily = t.fontMono; s.fontSize = `${t.textSm}px`
      s.background = t.bg; s.color = t.textPrimary
      s.border = `1px solid ${t.border}`; s.borderRadius = `${t.radiusMd}px`
      s.padding = `${t.space3}px ${t.space4}px`
      // Wrapping soft lines is the default because a short snippet that scrolls
      // sideways is a worse read; an excerpt wants `pre` plus an overflow.
      s.whiteSpace = p.wrapLines === false ? 'pre' : 'pre-wrap'
      break
    }
    case 'InlineCode': {
      const accent = str(p.accent) || t.accent
      s.fontFamily = t.fontMono; s.fontSize = '0.92em'
      s.background = `${accent}1a`; s.color = accent
      s.padding = '1px 6px'; s.borderRadius = `${t.radiusSm}px`
      break
    }
    case 'Link': {
      const size = str(p.size) || 'md'
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      s.color = str(p.color) || t.accent
      s.textDecoration = p.underline === false ? 'none' : 'underline'
      s.cursor = 'pointer'
      // A capped label ellipsises instead of wrapping onto three lines and
      // pushing the row apart, which is what `maxWidth` is for everywhere else.
      if (p.truncate === true) {
        s.display = 'inline-block'
        s.overflow = 'hidden'
        s.textOverflow = 'ellipsis'
        s.whiteSpace = 'nowrap'
      }
      break
    }
    case 'BulletList': case 'NumberedList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 6)
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      s.paddingLeft = `${num(p.indent, 24)}px`
      // An ordered list's marker shape is the browser's, so the format is a
      // `list-style-type` rather than a string the renderer has to draw — which
      // also means the numbering stays correct for a screen reader.
      if (node.type === 'NumberedList') {
        const fmt = str(p.format) || 'decimal'
        s.listStyleType = (fmt === 'lower-alpha' || fmt === 'upper-alpha' || fmt === 'lower-roman' || fmt === 'upper-roman'
          ? fmt
          : 'decimal') as React.CSSProperties['listStyleType']
      }
      break
    }
    case 'Divider': {
      const colour = str(p.color) || t.borderStrong
      if (str(p.orientation) === 'vertical') {
        // A vertical rule is a box `thickness` wide, not a rotated rule: a
        // rotated `<hr>` is a hairline at a strange angle in every browser.
        s.width = px(p.thickness, 1)
        s.height = num(p.height, -1) > 0 ? px(p.height) : '100%'
        s.margin = '0'
        s.background = colour
        s.opacity = 0.9
        break
      }
      s.height = px(p.thickness, 1); s.marginTop = px(p.margin, 12); s.marginBottom = px(p.margin, 12)
      s.background = colour; s.opacity = 0.9
      break
    }
    case 'Badge': case 'Tag': {
      const md = str(p.size) === 'md'
      const tone = toneColor(t, str(p.tone))
      const variant = str(p.variant) || 'soft'
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '4px'
      s.fontSize = md ? `${t.textSm}px` : `${t.textXs}px`
      s.fontWeight = t.weightSemibold; s.padding = md ? '4px 12px' : '2px 9px'
      s.borderRadius = `${t.radiusFull}px`
      // The three treatments, from a wash you can read through to a fill you
      // cannot miss. `soft` is the default because a chip should not shout.
      if (variant === 'solid') {
        s.background = tone; s.color = t.textOnAccent; s.border = `1px solid ${tone}`
      } else if (variant === 'outline') {
        s.background = 'transparent'; s.color = tone; s.border = `1px solid ${tone}66`
      } else {
        s.background = `${tone}1e`; s.color = tone; s.border = `1px solid ${tone}44`
      }
      if (p.uppercase === true) s.textTransform = 'uppercase'
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
    case 'DataGrid': {
      // A grid is a box that scrolls; a fixed height is what turns it from a
      // table into a grid, because the header has to stay put.
      const h = num(p.height, 0)
      s.width = '100%'
      if (h > 0) {
        s.height = px(p.height, 320)
        s.overflow = 'auto'
      }
      s.borderRadius = `${t.radiusLg}px`
      s.border = p.borderless === true ? 'none' : `1px solid ${t.border}`
      s.background = t.surface
      // A bordered grid clips to its own corners; a borderless one only scrolls
      // when it was given a height to scroll in.
      s.overflow = p.borderless === true ? (h > 0 ? 'auto' : 'visible') : 'hidden'
      // Row hover is a stylesheet rule, so switching it OFF has to be said in
      // the document's own terms: an explicit transparent hover colour. A
      // boolean that can only ever be "on" would not be a control.
      if (p.hoverable === false) {
        (s as React.CSSProperties & Record<string, string>)['--loom-row-hover'] = 'transparent'
      }
      break
    }
    case 'Stat': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '2px'
      break
    }
    case 'KpiCard': {
      const size = str(p.size) || 'md'
      s.display = 'flex'
      s.flexDirection = 'column'
      s.gap = `${t.space2}px`
      s.padding = size === 'sm' ? `${t.space3}px` : size === 'lg' ? `${t.space5}px` : `${t.space4}px`
      s.borderRadius = `${t.radiusLg}px`
      s.border = `1px solid ${t.border}`
      s.background = t.surface
      s.width = px(p.width, 220)
      break
    }
    case 'ProgressBar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '6px'
      s.width = '220px'; s.fontSize = `${t.textXs}px`; s.color = t.textSecondary
      // `height` is the TRACK's thickness, and the generic pass faithfully
      // applies it to this box too — which would squeeze the caption out of
      // existence. A floor is what keeps the box as tall as the bar it wraps.
      const barH = num(p.height, 8)
      s.minHeight = p.showLabel === true ? barH + 20 : barH
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
      s.width = px(p.width, 280); s.height = px(p.height, 120)
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
      // The indent is the rail's position, which is why this component does not
      // take a `padding` shorthand: a padding all round would move the rail.
      s.paddingLeft = `${num(p.indent, 16)}px`
      break
    }
    case 'TimelineItem': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '2px'
      const size = str(p.size) || 'md'
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      s.paddingBottom = `${t.space2}px`
      break
    }
    case 'TreeList': case 'DataList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 4)
      s.fontSize = `${t.textSm}px`; s.color = t.textPrimary
      break
    }
    case 'KeyValue': {
      s.display = 'flex'
      const stacked = str(p.layout) === 'column'
      s.flexDirection = stacked ? 'column' : 'row'
      s.gap = px(p.gap, 8)
      const size = str(p.size) || 'md'
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      // `align` is where the pair sits along its row. In a COLUMN stack the
      // generic pass's `align-items` already is that answer, so mapping it here
      // as well would apply it twice.
      if (!stacked) {
        const a = str(p.align) || 'start'
        s.justifyContent = a === 'between' ? 'space-between' : a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start'
      }
      break
    }
    case 'Calendar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space4}px`; s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.width = '280px'
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : t.textSm}px`
      break
    }
    case 'KanbanColumn': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 8)
      const size = str(p.size) || 'md'
      s.padding = size === 'sm' ? `${t.space2}px` : size === 'lg' ? `${t.space4}px` : `${t.space3}px`
      s.borderRadius = `${t.radiusLg}px`
      s.background = t.bg; s.border = `1px solid ${t.border}`
      // A lane with no cards still has to read as a lane, so the floor is a
      // property rather than a literal someone has to guess at.
      s.minHeight = px(p.minHeight, 120)
      break
    }
    case 'EmptyState': {
      s.display = 'flex'; s.flexDirection = 'column'; s.alignItems = 'center'
      s.gap = `${t.space2}px`; s.padding = `${t.space6}px`; s.textAlign = 'center'
      break
    }
    case 'Skeleton': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 8)
      break
    }
    case 'DataCard': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 8)
      const size = str(p.size) || 'md'
      s.padding = size === 'sm' ? `${t.space3}px` : size === 'lg' ? `${t.space5}px` : `${t.space4}px`
      s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.border}`; s.boxShadow = t.shadowSm
      s.fontSize = `${size === 'sm' ? t.textSm : size === 'lg' ? t.textLg : t.textMd}px`
      break
    }
    /* ---- catalog2 navigation ---- */
    case 'NavBar': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = px(p.gap, 12); s.height = px(p.height, 56)
      s.padding = `0 ${t.space4}px`
      // Three bars: a surface, a surface lifted off the page, and no bar at all
      // for one that sits on the page background.
      const variant = str(p.variant) || 'solid'
      s.background = variant === 'transparent' ? 'transparent' : t.surface
      s.border = variant === 'transparent' ? 'none' : `1px solid ${t.border}`
      s.boxShadow = variant === 'elevated' ? t.shadowSm : undefined
      s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'NavLink': {
      const size = str(p.size) || 'md'
      // size -> padding and type together. A small nav link that keeps the
      // medium link's padding is not a small link.
      const padY = size === 'sm' ? `${t.space1}px` : size === 'lg' ? `${t.space2 + 2}px` : `${t.space1 + 2}px`
      const padX = size === 'sm' ? `${t.space2}px` : size === 'lg' ? `${t.space4}px` : `${t.space3}px`
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      s.fontWeight = p.active === true ? t.weightSemibold : t.weightMedium
      s.color = p.active === true ? t.accent : t.textSecondary
      s.padding = `${padY} ${padX}`
      s.borderRadius = `${t.radiusSm}px`
      s.background = p.active === true ? `${t.accent}14` : 'transparent'
      s.textDecoration = p.underline === true ? 'underline' : 'none'
      s.cursor = 'pointer'
      if (p.truncate === true) {
        s.overflow = 'hidden'
        s.textOverflow = 'ellipsis'
        s.whiteSpace = 'nowrap'
      }
      break
    }
    case 'SideNav': {
      const rail = p.collapsed === true
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 4)
      // A collapsed rail is a RAIL, not a squeezed column: the authored width is
      // swapped for the rail width and the labels are clipped away, so the
      // collapse is a real collapse rather than a narrower squeeze.
      s.width = rail ? px(p.railWidth, 64) : px(p.width, 220)
      s.padding = rail ? `${t.space2}px` : `${t.space3}px`
      if (rail) s.overflow = 'hidden'
      s.background = t.surface; s.border = `1px solid ${t.border}`
      s.borderRadius = `${t.radiusMd}px`
      break
    }
    case 'Breadcrumbs': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'
      s.gap = `${t.space2}px`
      // A crumb trail is secondary type by definition, so `md` is the small
      // step and the scale goes down and up from there.
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs - 1 : str(p.size) === 'lg' ? t.textSm : t.textXs}px`
      s.color = t.textMuted
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
      // A context menu is as wide as its longest row; a designer who knows the
      // width sets it, and the rest keep hugging their content.
      const w = num(p.width, -1)
      if (w > 0) { s.width = px(p.width, 180); s.minWidth = px(p.width, 180) }
      else s.minWidth = '180px'
      break
    }
    case 'MenuItem': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      const size = str(p.size) || 'md'
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      s.padding = size === 'sm' ? `4px ${t.space2 + 2}px` : size === 'lg' ? `${t.space2 + 2}px ${t.space4}px` : `${t.space2}px ${t.space3}px`
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
      s.borderRadius = `${t.radiusMd}px`
      // The strip's own surface belongs to the variant: a segmented control is
      // a track, an underline strip is not a box at all.
      if (str(p.variant) === 'underline') {
        s.padding = '0'
        s.background = 'transparent'
        s.border = 'none'
        s.borderBottom = `1px solid ${t.border}`
      } else {
        s.padding = '3px'; s.background = t.bg
        s.border = `1px solid ${t.border}`
      }
      break
    }
    case 'AnchorList': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space1}px`
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm}px`
      break
    }
    case 'Icon': {
      // An icon is a box that hugs its drawing, and must stay a box when it is
      // flexed into a row — otherwise a 20px glyph in a nav item collapses.
      s.display = 'inline-flex'
      s.alignItems = 'center'
      s.justifyContent = 'center'
      s.flexShrink = 0
      break
    }
    case 'BackButton': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      const size = str(p.size) || 'md'
      s.fontSize = `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`
      s.fontWeight = t.weightMedium
      s.color = t.textSecondary; s.cursor = 'pointer'
      // A back control has to survive on a photo as often as it sits in a
      // header, so the surface and the border are options rather than a given.
      const variant = str(p.variant) || 'ghost'
      if (variant === 'surface') {
        s.background = t.surface
        s.border = `1px solid ${t.border}`
        s.borderRadius = `${t.radiusMd}px`
        s.padding = `${t.space1 + 2}px ${t.space3}px`
      } else if (variant === 'outline') {
        s.background = 'transparent'
        s.border = `1px solid ${t.borderStrong}`
        s.borderRadius = `${t.radiusMd}px`
        s.padding = `${t.space1 + 2}px ${t.space3}px`
      }
      break
    }
    /* ---- catalog2 feedback ---- */
    case 'Alert': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '4px'
      s.padding = `${t.space3}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      // The three treatments, from a wash you can read a table through to a
      // fill that cannot be missed. `soft` is the default because an alert that
      // shouts is an alert people stop reading.
      const tone = toneColor(t, str(p.tone))
      const variant = str(p.variant) || 'soft'
      if (variant === 'solid') {
        s.background = tone; s.color = t.textOnAccent
        s.border = `1px solid ${tone}`
      } else if (variant === 'outline') {
        s.background = 'transparent'; s.border = `1px solid ${tone}55`
      } else {
        s.background = `${tone}12`; s.border = `1px solid ${tone}55`
      }
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : t.textSm}px`
      break
    }
    case 'Toast': {
      s.display = 'flex'; s.flexDirection = 'row'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.padding = `${t.space3}px ${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      const tone = toneColor(t, str(p.tone))
      const variant = str(p.variant) || 'solid'
      if (variant === 'soft') {
        s.background = `${tone}1a`; s.color = t.textPrimary
        s.border = `1px solid ${tone}44`
      } else if (variant === 'outline') {
        s.background = t.surface; s.color = t.textPrimary
        s.border = `1px solid ${tone}66`
      } else {
        s.background = t.surface; s.color = t.textPrimary
        s.border = `1px solid ${t.borderStrong}`
      }
      s.boxShadow = t.shadowLg; s.fontSize = `${str(p.size) === 'sm' ? t.textXs : t.textSm}px`
      break
    }
    case 'Spinner': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${t.textSm}px`; s.color = t.textSecondary
      break
    }
    case 'LoadingBar': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = '6px'; s.width = '220px'
      // Same floor as the progress bar: `height` is the track's thickness, and
      // the generic pass applies it to this box as well.
      const barH = num(p.height, 6)
      s.minHeight = str(p.label) ? barH + 20 : barH
      s.fontSize = `${t.textXs}px`; s.color = t.textSecondary
      break
    }
    case 'ProgressDots': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = '6px'
      break
    }
    case 'InlineMessage': {
      s.display = 'inline-flex'; s.alignItems = 'center'; s.gap = `${t.space2}px`
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm}px`
      s.color = toneColor(t, str(p.tone))
      // `soft` gives the note a surface of its own, which is what a note inside
      // a table cell needs to be findable.
      if (str(p.variant) === 'soft') {
        s.background = `${toneColor(t, str(p.tone))}14`
        s.border = `1px solid ${toneColor(t, str(p.tone))}33`
        s.borderRadius = `${t.radiusFull}px`
        s.padding = `${t.space1}px ${t.space2 + 2}px`
      }
      break
    }
    case 'ErrorSummary': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = `${t.space2}px`
      s.padding = `${t.space4}px`; s.borderRadius = `${t.radiusMd}px`
      const tone = toneColor(t, str(p.tone) || 'danger')
      const variant = str(p.variant) || 'soft'
      if (variant === 'solid') {
        s.background = tone; s.color = t.textOnAccent
        s.border = `1px solid ${tone}`
      } else if (variant === 'outline') {
        s.background = 'transparent'; s.border = `1px solid ${tone}55`
      } else {
        s.background = `${tone}10`; s.border = `1px solid ${tone}55`
      }
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : t.textSm}px`
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
      // The tone is the component's identity, so it is read from the TYPE and
      // not from a property: a `tone` switch here would be one click away from
      // turning a warning into a tip.
      const tone = toneColor(t, calloutTone(node.type))
      const accent = str(p.accent) || tone
      const variant = str(p.variant) || 'outline'
      if (variant === 'soft') {
        s.background = `${accent}12`; s.border = `1px solid ${accent}44`
      } else if (variant === 'solid') {
        s.background = accent; s.color = t.textOnAccent; s.border = `1px solid ${accent}`
      } else {
        s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      }
      s.borderLeftWidth = '3px'
      s.borderLeftColor = accent
      s.fontSize = `${str(p.size) === 'sm' ? t.textXs : t.textSm}px`
      break
    }
    case 'ConfirmDialog': {
      s.display = 'flex'; s.flexDirection = 'column'; s.gap = px(p.gap, 12)
      const size = str(p.size) || 'md'
      s.padding = size === 'sm' ? `${t.space4}px` : size === 'lg' ? `${t.space6}px` : `${t.space5}px`
      s.borderRadius = `${t.radiusLg}px`
      s.background = t.surface; s.border = `1px solid ${t.borderStrong}`
      s.boxShadow = t.shadowLg; s.width = px(p.width, 400)
      s.fontSize = `${size === 'sm' ? t.textSm : t.textMd}px`
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

  // Element transparency. Opacity is a node-level field (not 111 schema
  // props), so it applies uniformly and flows into preview, HTML export,
  // and the React emitter untouched. It composes MULTIPLICATIVELY with
  // state dimming (a disabled Button at 0.5 × author opacity 0.4 = 0.2):
  // the two are independent intents and neither may silently discard the
  // other — which is what happened when this ran before the switch.
  // Fully opaque stays unexpressed. (Non-finite values compare false here
  // and are ignored; writers clamp.)
  if (node.opacity < 1) {
    s.opacity = (typeof s.opacity === 'number' ? s.opacity : 1) * node.opacity
  }

  // The shared vocabulary, applied generically.
  //
  // A component exposes a property by DECLARING it; this pass makes that
  // declaration mean something. `-1` is the "not set" sentinel throughout, so
  // an unexposed property changes nothing and a component that never declares
  // `radius` is not silently rounded. That is the whole trick behind giving
  // every component a real properties panel: adding an option is a schema
  // change, not a new branch in here.
  applyCommonStyle(s, node.props, t, node.type)

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
/**
 * The theme, exposed to the behaviour stylesheet as inherited custom
 * properties. State rules (pressed, on, active, sorted) live in CSS; the
 * colours they need come from here, so there is exactly one source of truth
 * for both.
 */
function themeVars(t: Theme): React.CSSProperties {
  return {
    '--loom-accent': t.accent,
    '--loom-on': t.accent,
    '--loom-off': t.borderStrong,
    '--loom-on-bg': `${t.accent}1f`,
    '--loom-on-fg': t.accent,
    '--loom-surface': t.surface,
    '--loom-text': t.textPrimary,
    '--loom-muted': t.textMuted,
    '--loom-border': t.border,
    '--loom-border-strong': t.borderStrong,
    '--loom-danger': t.danger,
    '--loom-success': t.success,
    '--loom-warning': t.warning,
    '--loom-danger-wash': `${t.danger}14`,
    // Data typography. Tabular figures are the single most important decision
    // in any interface that shows numbers: without them digits do not line up
    // down a column and a dense table reads as decoration. It is a TOKEN, not a
    // hard-coded string at each call site, so one place decides.
    '--loom-numeric': 'tabular-nums',
    '--loom-numeric-align': 'right',
  } as React.CSSProperties
}

function renderPreviewNode(
  node: Node,
  flowChild: boolean,
  children: React.ReactElement[],
  key: string | number | undefined,
  t: Theme,
  ctx: RenderCtx,
): React.ReactElement {
  // Where a control sits among its siblings is what makes a group work: the
  // Nth TabPanel belongs to the Nth tab.
  const parentId = parentOf(ctx.doc, node.id)
  const style = styleFor(node, flowChild, t)
  // Theme colours reach the behaviour stylesheet as custom properties, so the
  // rules that draw a pressed/toggled/active state can reference them without
  // the renderer hard-coding a second copy of the theme. Inherited, so one
  // set per document is enough.
  Object.assign(style, themeVars(t))

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
  const content = withOutputHook(node, renderPreviewBody(node, style, children, t, key, parentId, ctx))

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

/**
 * Give the output element the hook its generated rules address.
 *
 * Output carries no editor ids, so a node whose look is adjusted by a
 * generated stylesheet (per-breakpoint overrides, interaction states) needs its
 * own stable attribute, or the rules match nothing — which is exactly how
 * responsive overrides silently did nothing in the preview and both exports.
 * Only nodes that NEED it carry it, so a plain export stays free of hooks.
 */
function withOutputHook(node: Node, el: React.ReactElement): React.ReactElement {
  if (!isResponsive(node) && !hasStates(node)) return el
  if (el.type === React.Fragment) {
    // Fail loudly: an override that cannot attach would silently not apply.
    throw new Error(`${node.type} has no root element, so its overrides and states cannot apply`)
  }
  return React.cloneElement(el, { [OUTPUT_HOOK]: node.id } as Record<string, unknown>)
}

/** The node's own element, with no effect decoration. */
function renderPreviewBody(
  node: Node,
  style: React.CSSProperties,
  children: React.ReactElement[],
  t: Theme,
  key: string | number | undefined,
  parentId: NodeId | undefined,
  ctx: RenderCtx,
): React.ReactElement {
  const p = node.props

  switch (node.type) {
    case 'Button': {
      // The three things a button can carry, in one place: the icon, the text,
      // and the state that says the text is not the whole story right now.
      const iconSize = str(p.size) === 'sm' ? 12 : str(p.size) === 'lg' ? 16 : 14
      const icon = str(p.icon) ? <IconGlyph value={str(p.icon)} size={iconSize} /> : null
      const label = (
        <span style={{ opacity: p.loading === true ? 0.55 : 1 }}>{str(p.label)}</span>
      )
      const rawType = str(p.type)
      const buttonType: 'button' | 'submit' | 'reset' =
        rawType === 'submit' ? 'submit' : rawType === 'reset' ? 'reset' : 'button'
      return (
        <button
          key={key}
          type={buttonType}
          style={style}
          disabled={p.disabled === true || p.loading === true}
          aria-busy={p.loading === true ? 'true' : undefined}
          data-loom-action={str(p.action) || undefined}
          {...behaviourAttrs({ role: 'press', label: str(p.ariaLabel) || undefined })}
        >
          {icon ? (
            // Inline flex, not a flex button: the button itself stays a text
            // box, so `align` keeps meaning text alignment.
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: `${t.space1 + 2}px` }}>
              {str(p.iconPosition) === 'end' ? label : icon}
              {str(p.iconPosition) === 'end' ? icon : label}
            </span>
          ) : (
            label
          )}
        </button>
      )
    }
    case 'Heading': {
      const level = str(p.level) || '1'
      const size = level === '1' ? t.textXxl : level === '2' ? t.textXl : t.textLg
      // The level sets the type; the declared overrides win where they are set.
      // Reading them back here is what stops `fontSize`/`lineHeight`/
      // `letterSpacing` from being controls that only work in the editor.
      const fs = num(p.fontSize, -1)
      const lh = num(p.lineHeight, -1)
      const ls = num(p.letterSpacing, -1)
      return (
        <div
          key={key}
          style={{
            ...style,
            fontSize: fs > 0 ? `${fs}px` : `${size}px`,
            fontWeight: level === '1' ? t.weightBold : t.weightSemibold,
            lineHeight: lh > 0 ? lh : 1.2,
            letterSpacing: ls !== -1 ? `${ls}px` : level === '1' ? '-0.4px' : 'normal',
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
    case 'Field': {
      const inline = str(p.layout) === 'inline'
      const validation = str(p.state) || 'default'
      const message = str(p.message)
      const tone = validation === 'error' ? t.danger : validation === 'success' ? t.success : validation === 'warning' ? t.warning : t.textMuted
      // The field's own type scale — the label, the description and the
      // message. The control inside keeps its own size: a form whose field and
      // input disagree about scale is a form nobody can read.
      const scales: Record<string, [number, number]> = {
        sm: [t.textXs, t.textXs],
        md: [t.textSm, t.textXs],
        lg: [t.textMd, t.textSm],
      }
      const [labelPx, smallPx] = scales[str(p.size)] ?? scales.md
      // Ids so the field can be NAMED rather than merely labelled: a group with
      // no accessible name is decoration, and the help text is the part a
      // screen-reader user needs most.
      const labelId = `f-label-${node.id}`
      const helpId = `f-help-${node.id}`
      const msgId = `f-msg-${node.id}`
      const description = str(p.description)
      const described = [description ? helpId : '', message ? msgId : ''].filter(Boolean).join(' ')
      const labelBlock = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', ...(inline ? { width: px(p.labelWidth, 180), flexShrink: 0 } : {}) }}>
          <span id={labelId} style={{ fontSize: `${labelPx}px`, fontWeight: t.weightMedium, color: t.textSecondary, lineHeight: t.lineHeight }}>
            {str(p.label)}
            {p.required === true ? <span style={{ color: t.danger }} aria-hidden="true"> *</span> : null}
          </span>
          {description ? (
            <span id={helpId} style={{ fontSize: `${smallPx}px`, color: t.textMuted, lineHeight: 1.4 }}>{description}</span>
          ) : null}
        </div>
      )
      return (
        <div
          key={key}
          style={style}
          data-loom-field="true"
          data-loom-state={validation}
          aria-invalid={validation === 'error' ? 'true' : undefined}
          role="group"
          aria-label={str(p.ariaLabel) || undefined}
          aria-labelledby={!str(p.ariaLabel) && str(p.label) ? labelId : undefined}
          aria-describedby={described || undefined}
        >
          {inline ? labelBlock : null}
          {!inline && labelBlock}
          {/* The control goes here — ANY control. That is the whole point of
              this replacing a form field that drew its own text input. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: `${t.space1}px`, flex: 1, minWidth: 0 }}>{children}</div>
          {message ? (
            <span
              id={msgId}
              data-loom-field-message
              role={validation === 'error' ? 'alert' : undefined}
              style={{ fontSize: `${smallPx}px`, color: tone, lineHeight: 1.35 }}
            >
              {message}
            </span>
          ) : null}
        </div>
      )
    }

    case 'Input': {
      const type = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(str(p.type)) ? str(p.type) : 'text'
      const maxLength = num(p.maxLength, -1)
      return (
        <input
          key={key}
          type={type}
          style={style}
          placeholder={str(p.placeholder)}
          defaultValue={str(p.value)}
          name={str(p.name) || undefined}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          maxLength={maxLength > 0 ? maxLength : undefined}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    }
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
      const aria = str(p.ariaLabel)
      // Sticky means sticky: the title stays put while the content scrolls
      // under it, which only works if the title is opaque and sits above it.
      const sticky = p.stickyHeader === true
      const titleStyle: React.CSSProperties = {
        fontSize: `${t.textXs}px`,
        fontWeight: t.weightSemibold,
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        color: t.textMuted,
        marginBottom: `${t.space2}px`,
        ...(sticky
          ? {
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: p.glass === true || str(p.surface) === 'glass' ? t.surfaceGlass : str(p.background) || t.surface,
              paddingTop: `${t.space1}px`,
              paddingBottom: `${t.space1}px`,
              marginTop: `-${t.space1}px`,
              marginBottom: `${t.space1}px`,
            }
          : {}),
      }
      if (str(p.title)) {
        return (
          <div
            key={key}
            style={style}
            role={aria ? 'group' : undefined}
            aria-label={aria || undefined}
          >
            <span style={titleStyle}>{str(p.title)}</span>
            {children}
          </div>
        )
      }
      return (
        <div key={key} style={style} role={aria ? 'group' : undefined} aria-label={aria || undefined}>
          {children}
        </div>
      )
    }
    case 'Stack':
    case 'Grid': {
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'group' : undefined} aria-label={aria || undefined}>
          {children}
        </div>
      )
    }
    /* ---- catalog1 containers ---- */
    case 'Card': {
      // The header INHERITS the card's declared typography, so `fontSize`,
      // `fontWeight` and `letterSpacing` on a Card are controls that change
      // what you see rather than three sliders that move nothing.
      const headStyle: React.CSSProperties = {
        fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
        fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
        letterSpacing: num(p.letterSpacing, -1) !== -1 ? 'inherit' : 'normal',
        lineHeight: num(p.lineHeight, -1) > 0 ? 'inherit' : t.lineHeight,
        color: str(p.color) || t.textPrimary,
      }
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'group' : undefined} aria-label={aria || undefined}>
          {str(p.title) ? <div style={headStyle}>{str(p.title)}</div> : null}
          {children}
        </div>
      )
    }
    case 'Tabs': {
      const tabs = list(p.tabs, p.tabsSep)
      const active = num(p.active, 0)
      const variant = str(p.variant) || 'underline'
      const full = p.fullWidth === true
      const justify = str(p.justify)
      // The strip's own geometry is what `variant` and `fullWidth` are about:
      // where the rule is, how a selected tab is filled, and whether the tabs
      // share the panel's width or sit at their natural size.
      const strip: React.CSSProperties = variant === 'enclosed'
        ? { display: 'flex', gap: '4px', padding: '3px', borderRadius: `${t.radiusMd}px`, background: t.bg, border: `1px solid ${t.border}`, justifyContent: justify === 'center' ? 'center' : justify === 'end' ? 'flex-end' : 'flex-start' }
        : variant === 'pills'
          ? { display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, paddingBottom: `${t.space2}px`, justifyContent: justify === 'center' ? 'center' : justify === 'end' ? 'flex-end' : 'flex-start' }
          : { display: 'flex', gap: '4px', borderBottom: `1px solid ${t.border}`, paddingBottom: `${t.space2}px`, justifyContent: justify === 'center' ? 'center' : justify === 'end' ? 'flex-end' : 'flex-start' }
      const tabStyle = (on: boolean): React.CSSProperties => {
        const base: React.CSSProperties = {
          fontSize: `${t.textSm}px`,
          fontWeight: on ? t.weightSemibold : t.weightMedium,
          color: on ? t.accent : t.textMuted,
          borderRadius: `${t.radiusSm}px`,
          border: 'none',
          cursor: 'pointer',
          ...(full ? { flex: 1 } : {}),
        }
        if (variant === 'enclosed') {
          return { ...base, padding: '5px 12px', background: on ? t.surface : 'transparent', boxShadow: on ? t.shadowSm : 'none' }
        }
        if (variant === 'pills') {
          return { ...base, padding: '5px 12px', background: on ? `${t.accent}1f` : 'transparent' }
        }
        return { ...base, padding: '4px 10px', background: on ? `${t.accent}14` : 'transparent' }
      }
      // The strip owns the group; each tab is a real button so it is
      // clickable, focusable, and reports its selected state to assistive tech.
      return (
        <div key={key} style={style} data-loom-tabs={node.id} data-loom-active={String(active)}>
          <div role="tablist" style={strip}>
            {tabs.map((tb, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                {...behaviourAttrs({ role: 'tab', group: node.id, index: i, active: i === active })}
                style={tabStyle(i === active)}
              >
                {tb}
              </button>
            ))}
          </div>
          {children}
        </div>
      )
    }
    case 'TabPanel': {
      // The Nth TabPanel is the Nth tab's content. It ships SHOWN so a panel
      // dropped on its own is never invisible, and hidden the moment its tab
      // is switched away from.
      const sibs = parentId ? (ctx.doc.nodes[parentId]?.children ?? []) : []
      const index = Math.max(0, sibs.indexOf(node.id))
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role="tabpanel"
          aria-label={aria || str(p.title) || undefined}
          data-loom-shown="1"
          {...behaviourAttrs({ role: 'panel', group: parentId, index })}
        >
          {str(p.title) ? (
            <div
              style={{
                fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
                fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
                color: str(p.color) || t.textPrimary,
              }}
            >
              {str(p.title)}
            </div>
          ) : null}
          {children}
        </div>
      )
    }
    case 'Section': {
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'group' : undefined} aria-label={aria || undefined}>
          {str(p.title) ? (
            <div
              style={{
                fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
                fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
                color: str(p.color) || t.textPrimary,
              }}
            >
              {str(p.title)}
            </div>
          ) : null}
          {children}
        </div>
      )
    }
    case 'Accordion': {
      // `open` is how many sections start expanded. 0 — the default — leaves
      // them all shut, which is what an unanswered FAQ looks like; 1 is the
      // "expand the first" accordion. It is applied to the CHILDREN because
      // the state belongs to the section, not to the stack around it.
      const startOpen = Math.max(0, num(p.open, 0))
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'group' : undefined} aria-label={aria || undefined}>
          {children.map((child, i) =>
            i < startOpen && React.isValidElement(child)
              ? React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
                  'data-loom-open': '1',
                  'aria-expanded': true,
                })
              : child,
          )}
        </div>
      )
    }
    case 'AccordionItem': {
      // A disclosure, for real: the summary is the control, the body is shown
      // only while open, and the authored `expanded` prop is the initial state
      // so the design still decides how it starts.
      const open = p.expanded === true
      const icon = str(p.icon) || 'caret'
      const summaryStyle: React.CSSProperties = {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '8px',
        padding: `${t.space2 + 2}px ${t.space3}px`,
        fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
        fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
        color: str(p.color) || t.textPrimary,
      }
      return (
        <div key={key} style={style} {...behaviourAttrs({ role: 'disclosure', open })}>
          <div data-loom-summary role="button" tabIndex={0} aria-expanded={open} style={summaryStyle}>
            <span>{str(p.title)}</span>
            {icon === 'none' ? null : (
              <span data-loom-caret style={{ color: t.textMuted }}>{icon === 'plus' ? '+' : '▸'}</span>
            )}
          </div>
          <div data-loom-body style={{ padding: `0 ${t.space3}px ${t.space3}px` }}>{children}</div>
        </div>
      )
    }
    case 'Modal': {
      const dismiss = p.dismissible !== false
      const actions = list(p.actions, p.actionsSep)
      const justify = str(p.justify) || 'end'
      return (
        <div
          key={key}
          style={style}
          role="dialog"
          aria-modal="true"
          aria-label={str(p.ariaLabel) || str(p.title) || undefined}
          id={node.id}
          data-loom-reveal
          data-loom-open={p.open === false ? '0' : '1'}
        >
          {/* The scrim is also the ESCAPE target: the runtime dismisses a
              reveal whose scrim is `1`. So a dialog that must be answered
              (`dismissible: false`) gets neither the close button nor the
              scrim, which is exactly what "not dismissible" has to mean. */}
          <span data-loom-scrim={dismiss ? '1' : '0'} aria-hidden="true" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textLg}px`,
                fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightBold,
                color: str(p.color) || t.textPrimary,
              }}
            >
              {str(p.title)}
            </div>
            {dismiss ? (
              <button
                type="button"
                data-loom-b="press"
                data-loom-close={node.id}
                aria-label="close"
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', fontSize: `${t.textLg}px`, lineHeight: 1 }}
              >
                ×
              </button>
            ) : null}
          </div>
          {children}
          {actions.length > 0 ? (
            <div
              data-loom-footer=""
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: `${t.space2}px`,
                marginTop: `${t.space1}px`,
                justifyContent: justify === 'center' ? 'center' : justify === 'start' ? 'flex-start' : justify === 'between' ? 'space-between' : 'flex-end',
              }}
            >
              {actions.map((a) => (
                <button
                  key={a}
                  type="button"
                  data-loom-b="press"
                  data-loom-action={a.trim().toLowerCase().replace(/\s+/g, '.') || undefined}
                  style={{
                    background: t.surface,
                    color: t.textPrimary,
                    border: `1px solid ${t.borderStrong}`,
                    borderRadius: `${t.radiusMd}px`,
                    padding: `${t.space1 + 2}px ${t.space3}px`,
                    fontSize: `${t.textSm}px`,
                    fontWeight: t.weightSemibold,
                    cursor: 'pointer',
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    case 'Drawer': {
      const side = str(p.side) === 'left'
      const open = p.open !== false
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={{ ...style, borderLeft: side ? undefined : `1px solid ${t.border}`, borderRight: side ? `1px solid ${t.border}` : undefined }}
          id={node.id}
          role={aria ? 'complementary' : undefined}
          aria-label={aria || undefined}
          data-loom-reveal
          data-loom-open={open ? '1' : '0'}
        >
          <button
            type="button"
            data-loom-b="press"
            data-loom-close={node.id}
            aria-label={open ? 'collapse' : 'expand'}
            style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', alignSelf: side ? 'flex-end' : 'flex-start' }}
          >
            {side ? '›' : '‹'}
          </button>
          <div data-loom-body style={{ display: 'flex', flexDirection: 'column', gap: `${t.space2}px`, flex: 1 }}>{children}</div>
        </div>
      )
    }
    case 'GroupBox': {
      const aria = str(p.ariaLabel)
      return (
        <fieldset
          key={key}
          style={{ ...style, margin: 0 }}
          aria-label={aria || undefined}
        >
          <legend
            style={{
              fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textXs}px`,
              fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
              color: str(p.color) || t.textSecondary,
              padding: '0 6px',
            }}
          >
            {str(p.title)}
          </legend>
          {children}
        </fieldset>
      )
    }
    case 'ScrollView': {
      // A sticky header is the FIRST child, pinned to the top of the scroll
      // box. It is the child's own element, so it is restyled in place rather
      // than wrapped in anything the designer would have to reason about.
      const [head, ...rest] = children
      const sticky = p.stickyHeader === true && head !== undefined
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role={aria ? 'region' : undefined}
          aria-label={aria || undefined}
        >
          {sticky
            ? React.cloneElement(head as React.ReactElement<Record<string, unknown>>, {
                style: {
                  ...((head as React.ReactElement<{ style?: React.CSSProperties }>).props.style ?? {}),
                  position: 'sticky',
                  top: 0,
                  zIndex: 1,
                  background: str(p.background) || t.bg,
                },
              })
            : head}
          {rest}
        </div>
      )
    }
    case 'SplitH':
    case 'SplitV': {
      // `ratio` is the INITIAL SHARE of the first pane, and it is applied to
      // the panes themselves rather than guessed from the parent: the divider
      // sits where the designer said before anything has been dragged. `divider`
      // then says whether the two panes are separated by a drawn rule or only
      // by the gap.
      const share = Math.min(90, Math.max(10, num(p.ratio, 50)))
      const [a, b, ...rest] = children
      const pane = (el: React.ReactElement | undefined, basis: string): React.ReactElement | null => {
        if (!el) return null
        const own = (el as React.ReactElement<{ style?: React.CSSProperties }>).props.style ?? {}
        return React.cloneElement(el as React.ReactElement<Record<string, unknown>>, {
          style: { ...own, flex: basis, minWidth: 0, minHeight: 0 },
        })
      }
      const rule = str(p.divider)
      return (
        <div key={key} style={style}>
          {pane(a, `0 0 ${share}%`)}
          {rule !== 'none' ? (
            <span
              data-loom-divider=""
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                alignSelf: 'stretch',
                background: t.border,
                ...(node.type === 'SplitH'
                  ? { width: rule === 'strong' ? '3px' : '1px' }
                  : { height: rule === 'strong' ? '3px' : '1px' }),
              }}
            />
          ) : null}
          {pane(b, '1 1 0%')}
          {rest}
        </div>
      )
    }
    case 'Toolbar': {
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'toolbar' : undefined} aria-label={aria || undefined}>
          {children}
        </div>
      )
    }
    case 'FormGrid':
      return <div key={key} style={style}>{children}</div>
    case 'StatusBar': {
      // A status bar is where the product says what it is doing, so it is a
      // live region: `live` is what makes a screen reader hear the change
      // instead of leaving the reader on whatever it was reading.
      const live = p.live === true
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role={live ? 'status' : undefined}
          aria-live={live ? 'polite' : undefined}
          aria-label={aria || undefined}
        >
          <span>{str(p.text)}</span>
          {children}
        </div>
      )
    }
    case 'Hero': {
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role={aria ? 'region' : undefined} aria-label={aria || undefined}>
          <div
            style={{
              // `fontSize` on a Hero is the TITLE's scale, and the subtitle
              // follows it in `em` so the two keep their ratio instead of
              // collapsing onto one size.
              fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textXxl}px`,
              fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightBold,
              color: str(p.color) || t.textPrimary,
            }}
          >
            {str(p.title)}
          </div>
          <div
            style={{
              fontSize: num(p.fontSize, -1) > 0 ? '0.62em' : `${t.textMd}px`,
              color: t.textSecondary,
            }}
          >
            {str(p.subtitle)}
          </div>
          {children}
        </div>
      )
    }
    case 'HeaderBar': {
      const aria = str(p.ariaLabel)
      return (
        <header key={key} style={style} aria-label={aria || str(p.title) || undefined}>
          <span
            style={{
              fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightBold,
              fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textMd}px`,
              color: str(p.color) || t.textPrimary,
            }}
          >
            {str(p.title)}
          </span>
          {children}
        </header>
      )
    }
    case 'FooterBar': {
      const aria = str(p.ariaLabel)
      return (
        <footer key={key} style={style} aria-label={aria || undefined}>
          <span>{str(p.text)}</span>
          {children}
        </footer>
      )
    }
    case 'SettingsSection': {
      const danger = p.danger === true
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role={aria ? 'group' : undefined}
          aria-label={aria || undefined}
          data-loom-settings-section={danger ? 'danger' : 'default'}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: `${t.space2}px` }}>
            <span
              style={{
                fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
                fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightSemibold,
                color: danger ? t.danger : str(p.color) || t.textPrimary,
              }}
            >
              {str(p.title)}
            </span>
            {str(p.description) ? (
              <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, lineHeight: 1.4 }}>{str(p.description)}</span>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {children.map((child, i) => (
              <React.Fragment key={i}>
                {/* A divider ABOVE each row but the first: a list of settings
                    reads as a list because of the rules between them, not
                    because each row is boxed. */}
                {p.dividers !== false && i > 0 ? (
                  <div style={{ height: '1px', background: t.border }} />
                ) : null}
                {child}
              </React.Fragment>
            ))}
          </div>
          {p.saveBar === true ? (
            <div
              data-loom-save-bar=""
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: `${t.space3}px`,
                marginTop: `${t.space3}px`,
                paddingTop: `${t.space3}px`,
                borderTop: `1px solid ${t.border}`,
              }}
            >
              {p.dirty === true ? (
                <span data-loom-dirty="" style={{ width: '8px', height: '8px', borderRadius: '999px', background: t.warning }} aria-label="Unsaved changes" />
              ) : (
                <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted }}>Saved</span>
              )}
              <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, flex: 1 }}>{p.dirty === true ? 'You have unsaved changes' : ''}</span>
              <button
                type="button"
                data-loom-b="press"
                style={{
                  background: t.accent,
                  color: t.textOnAccent,
                  border: 'none',
                  borderRadius: `${t.radiusMd}px`,
                  padding: `${t.space2}px ${t.space4}px`,
                  fontSize: `${t.textSm}px`,
                  fontWeight: t.weightSemibold,
                  cursor: 'pointer',
                }}
              >
                {str(p.saveLabel)}
              </button>
            </div>
          ) : null}
        </div>
      )
    }
    case 'SettingsRow': {
      const destructive = p.destructive === true
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role={aria ? 'group' : undefined}
          aria-label={aria || undefined}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: px(p.labelWidth, 220), flexShrink: 0 }}>
            <span
              style={{
                fontSize: num(p.fontSize, -1) > 0 ? 'inherit' : `${t.textSm}px`,
                fontWeight: num(p.fontWeight, -1) > 0 ? 'inherit' : t.weightMedium,
                color: destructive ? t.danger : str(p.color) || t.textPrimary,
              }}
            >
              {str(p.label)}
            </span>
            {str(p.description) ? (
              <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, lineHeight: 1.4 }}>{str(p.description)}</span>
            ) : null}
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              // Right-aligned is the default because a settings page is read as
              // two columns: names on the left, controls on one vertical line.
              justifyContent: str(p.align) === 'left' ? 'flex-start' : 'flex-end',
            }}
          >
            {children}
          </div>
        </div>
      )
    }
    case 'Icon': {
      // Colour is the parent's, unless the designer asked for a signal tone or
      // named a colour outright. The wrapper exists so the shared vocabulary
      // (colour, size box, rotation, docking) has a box to apply to — an icon
      // is the one place where a bare glyph would silently drop all of it.
      return (
        <span key={key} style={style}>
          <IconGlyph
            value={str(p.name)}
            size={num(p.size, 20) || 20}
            color={str(p.color) || iconTone(p.tone, t)}
            title={str(p.label) || undefined}
          />
        </span>
      )
    }
    case 'CommandPalette': {
      const hotkey = str(p.hotkey) || 'mod+k'
      // The panel is sized by the designer, not by a literal in here: a palette
      // that is 560px wide on a large screen is a palette nobody can read.
      const panelW = num(p.width, 560) || 560
      const listH = num(p.listHeight, 320) || 320
      return (
        <div key={key} style={style} data-loom-palette={node.id} data-loom-open="0">
          {/* The scrim and the panel are editor-independent chrome: the runtime
              fills the list, because only it knows what the document can do. */}
          <div data-loom-palette-scrim="" style={{ position: 'absolute', inset: 0, background: '#000a' }} />
          <div
            data-loom-palette-panel=""
            role="dialog"
            aria-modal="true"
            aria-label={str(p.label) || 'Command palette'}
            style={{
              position: 'absolute',
              top: '12%',
              left: '50%',
              transform: 'translateX(-50%)',
              width: `min(${panelW}px, 90%)`,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: `${t.radiusLg}px`,
              background: t.surface,
              border: `1px solid ${t.borderStrong}`,
              boxShadow: t.shadowLg,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: `${t.space2}px`, padding: `${t.space3}px ${t.space4}px`, borderBottom: `1px solid ${t.border}` }}>
              <span aria-hidden="true" style={{ color: t.textMuted }}>⌕</span>
              <input
                type="text"
                data-loom-palette-input
                placeholder={str(p.placeholder)}
                aria-label={str(p.placeholder)}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textSm}px` }}
              />
              <kbd style={{ fontSize: `${t.textXs}px`, color: t.textMuted, border: `1px solid ${t.border}`, borderRadius: `${t.radiusSm}px`, padding: '2px 6px' }}>
                {hotkey.replace('mod+', '⌘')}
              </kbd>
            </div>
            <div data-loom-palette-list="" role="listbox" style={{ maxHeight: `${listH}px`, overflow: 'auto', padding: `${t.space2}px` }} />
            <div
              data-loom-palette-empty=""
              style={{ display: 'none', padding: `${t.space4}px`, textAlign: 'center', color: t.textMuted, fontSize: `${t.textSm}px` }}
            >
              {str(p.emptyHint)}
            </div>
            {p.footer !== false ? (
              <div style={{ display: 'flex', gap: `${t.space3}px`, padding: `${t.space2}px ${t.space4}px`, borderTop: `1px solid ${t.border}`, color: t.textMuted, fontSize: `${t.textXs}px` }}>
                <span>↑↓ navigate</span>
                <span>↵ run</span>
                <span>esc close</span>
              </div>
            ) : null}
          </div>
          {p.trigger !== false ? (
            <button
              type="button"
              data-loom-b="press"
              data-loom-palette-trigger={node.id}
              aria-haspopup="dialog"
              aria-expanded="false"
              style={{
                position: 'absolute',
                top: `${t.space3}px`,
                right: `${t.space3}px`,
                background: t.surface,
                border: `1px solid ${t.borderStrong}`,
                borderRadius: `${t.radiusSm}px`,
                color: t.textMuted,
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: `${t.textXs}px`,
              }}
            >
              {hotkey.replace('mod+', '⌘')}
            </button>
          ) : null}
        </div>
      )
    }
    case 'AppShell': {
      const railW = num(p.railWidth, 64) || 64
      const topH = num(p.topbarHeight, 56) || 56
      const collapsed = p.collapsed === true
      // Collapsing to a rail is the default; a shell that collapses to nothing
      // is the other real choice, and it is the collapse TARGET variable being
      // set inline — the same mechanism, pointed at 0 instead of the rail.
      const hideOnCollapse = collapsed && p.railOnCollapse === false
      // One surface colour for the whole shell: if the designer names one, the
      // chrome and the content area all sit on it rather than three regions
      // quietly keeping their own.
      const surface = str(p.background) || t.surface
      const canvas = str(p.background) || t.bg
      const contentPad = num(p.contentPadding, 0)
      // Positional slots: [0] sidebar, [1] top bar, the rest content. The order
      // is the contract and it is visible in Layers — no type-sniffing, because
      // silently swallowing a node because of its type would be a trap.
      const [sidebar, topbar, ...content] = children
      return (
        <div
          key={key}
          // The rail width travels as a custom property so the collapse rule
          // can use the document's value instead of a hard-coded 64px.
          style={{ ...style, '--loom-rail': `${railW}px` } as React.CSSProperties}
          role={str(p.ariaLabel) ? 'main' : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          data-loom-shell={node.id}
          data-loom-collapsed={collapsed ? '1' : '0'}
        >
          <div
            data-loom-shell-sidebar=""
            style={{
              // The width is expressed as a VARIABLE, so collapsing only has to
              // redefine that variable — no `!important` wrestling with an
              // inline width, which is the same pattern the field ring uses.
              // The AUTHORED width rides in as a variable the stylesheet falls
              // back to. It is deliberately not `--loom-sidebar-w`: an inline
              // custom property outranks every stylesheet rule, so naming the
              // collapse target the same variable would make it uncollapsible.
              ...({ '--loom-sidebar-authored': `${num(p.sidebarWidth, 240) || 240}px` } as React.CSSProperties),
              ...(hideOnCollapse ? ({ '--loom-sidebar-w': '0px' } as React.CSSProperties) : {}),
              width: 'var(--loom-sidebar-w, var(--loom-sidebar-authored))',
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: `${t.space2}px`,
              padding: `${t.space3}px`,
              boxSizing: 'border-box',
              background: surface,
              borderRight: `1px solid ${t.border}`,
              // The rail keeps the icons and drops the words: overflow clipping
              // is what makes a collapse a real collapse rather than a squeeze.
              overflow: 'hidden',
            }}
          >
            {sidebar}
            <button
              type="button"
              data-loom-b="press"
              data-loom-shell-toggle={node.id}
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              style={{
                marginTop: 'auto',
                alignSelf: collapsed ? 'center' : 'flex-start',
                background: 'transparent',
                border: `1px solid ${t.border}`,
                borderRadius: `${t.radiusSm}px`,
                color: t.textMuted,
                cursor: 'pointer',
                padding: '4px 8px',
                fontSize: `${t.textXs}px`,
              }}
            >
              {collapsed ? '›' : '‹'}
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div
              data-loom-shell-top=""
              style={{
                height: topH,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: `${t.space3}px`,
                padding: `0 ${t.space4}px`,
                boxSizing: 'border-box',
                borderBottom: `1px solid ${t.border}`,
                background: surface,
              }}
            >
              {topbar}
            </div>
            <div
              data-loom-shell-content=""
              style={{
                flex: 1,
                position: 'relative',
                minHeight: 0,
                overflow: 'auto',
                background: canvas,
                // The CONTENT region is the one place a shell needs an inset —
                // padding the shell itself would squeeze the sidebar and the
                // top bar too, which is never what "room to breathe" means.
                ...(contentPad > 0 ? { padding: `${contentPad}px` } : {}),
              }}
            >
              {content}
            </div>
          </div>
        </div>
      )
    }
    case 'SidebarPanel': {
      const collapsed = p.collapsed === true
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          id={node.id}
          role={aria ? 'complementary' : undefined}
          aria-label={aria || undefined}
          data-loom-reveal
          data-loom-open={collapsed ? '0' : '1'}
        >
          <button
            type="button"
            data-loom-b="press"
            data-loom-target={node.id}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
            style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer' }}
          >
            {collapsed ? '›' : '‹'}
          </button>
          <div data-loom-body style={{ display: 'flex', flexDirection: 'column', gap: `${t.space2}px`, flex: 1 }}>{children}</div>
        </div>
      )
    }
    case 'BannerBox': {
      // A banner that appears unasked is a live region: without `live` a
      // screen-reader user is told nothing has happened at all.
      const live = p.live === true
      const icon = str(p.icon)
      return (
        <div
          key={key}
          style={style}
          role={live ? (str(p.tone) === 'danger' ? 'alert' : 'status') : undefined}
          aria-live={live ? 'polite' : undefined}
        >
          {icon ? <span aria-hidden="true">{icon}</span> : null}
          <span>{str(p.text)}</span>
          {children}
        </div>
      )
    }
    /* ---- catalog1 controls ---- */
    case 'IconButton': {
      // The aria-label must survive the icon becoming a DRAWING: a name like
      // "search" is still a label, a glyph like "\u2315" is not, so fall back
      // to the button being labelled by the control around it.
      const iconValue = str(p.icon)
      const derived = isIconName(iconValue) ? iconValue.replace(/-/g, ' ') : iconValue || 'icon'
      // An explicit `ariaLabel` wins: "search" is a fine derived name, but a
      // designer who typed "Find in files" meant it.
      const label = str(p.ariaLabel) || derived
      // The drawing scales with the box. A 44px button holding a 16px glyph is
      // a size scale that only resized the padding.
      const glyph = str(p.size) === 'sm' ? 14 : str(p.size) === 'lg' ? 20 : 16
      return (
        <button
          key={key}
          type="button"
          style={style}
          disabled={p.disabled === true}
          aria-label={label}
          {...behaviourAttrs({ role: 'press' })}
        >
          <IconGlyph value={iconValue} size={glyph} />
        </button>
      )
    }
    case 'Checkbox': {
      const on = p.checked === true
      const off = p.disabled === true
      // `tone` is the accent the tick is drawn in. The native control already
      // themes its own check mark, so this is a real colour control rather
      // than a repaint that the browser undoes.
      const accent = str(p.tone) === 'inherit' ? t.accent : toneColor(t, str(p.tone))
      return (
        <label key={key} style={style} {...behaviourAttrs({ role: 'check', on })}>
          <input
            type="checkbox"
            defaultChecked={on}
            disabled={off}
            required={p.required === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ accentColor: accent, width: 16, height: 16 }}
          />
          <span>{str(p.label)}</span>
        </label>
      )
    }
    case 'Radio': {
      const group = str(p.group) || node.id
      const on = p.checked === true
      const off = p.disabled === true
      const accent = str(p.tone) === 'inherit' ? t.accent : toneColor(t, str(p.tone))
      return (
        <label key={key} style={style} {...behaviourAttrs({ role: 'radio', group, on })}>
          <input
            type="radio"
            name={group}
            defaultChecked={on}
            disabled={off}
            required={p.required === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ accentColor: accent, width: 16, height: 16 }}
          />
          <span>{str(p.label)}</span>
        </label>
      )
    }
    case 'RadioGroup': {
      const opts = list(p.options, p.optionsSep)
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      const name = str(p.ariaLabel) || str(p.label)
      return (
        <div
          key={key}
          // `direction` and `align` are applied generically in styleFor, so
          // nothing here re-decides them: a second opinion would be one the
          // panel could not show.
          style={style}
          role="radiogroup"
          aria-label={name || undefined}
        >
          {str(p.label) ? (
            <span style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: t.textSecondary }}>{str(p.label)}</span>
          ) : null}
          {opts.map((o) => (
            <label
              key={o}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: `${fs}px`, color: t.textPrimary }}
              {...behaviourAttrs({ role: 'radio', group: node.id, index: opts.indexOf(o), on: str(p.value) === o })}
            >
              <input type="radio" name={node.id} defaultChecked={str(p.value) === o} disabled={p.disabled === true} />
              <span>{o}</span>
            </label>
          ))}
          {children}
        </div>
      )
    }
    case 'Switch': {
      // The track and knob carry no colour of their own: the stylesheet picks
      // the on/off colour from the state attribute, using the theme custom
      // properties, so flipping the switch actually looks like flipping it.
      const on = p.on === true
      return (
        <label
          key={key}
          style={style}
          {...behaviourAttrs({ role: 'toggle', on })}
          aria-checked={on}
          aria-label={str(p.ariaLabel) || undefined}
        >
          {/* The track and knob keep their proportions: the shared stylesheet
              moves the knob by a fixed 14px, so `size` on a Switch is the LABEL
              scale (applied in styleFor) rather than a track that no longer
              lines up. */}
          <input type="checkbox" defaultChecked={on} disabled={p.disabled === true} tabIndex={-1} aria-hidden="true" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
          <span data-loom-track style={{ width: '34px', height: '20px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', padding: '2px' }}>
            <span data-loom-knob style={{ width: '14px', height: '14px', borderRadius: '999px', background: '#fff', display: 'block' }} />
          </span>
          <span>{str(p.label)}</span>
        </label>
      )
    }
    case 'Slider': {
      const v = num(p.value, 50)
      const min = num(p.min, 0)
      const max = num(p.max, 100)
      // The range input is native and already drags; the readout is wired to
      // it so the number tracks the thumb instead of lying.
      const readoutId = groupId(node.id, 'slider')
      const off = p.disabled === true
      const accent = str(p.tone) === 'inherit' ? t.accent : toneColor(t, str(p.tone))
      const showValue = p.showValue !== false
      return (
        <label key={key} style={style}>
          <input
            type="range"
            min={min}
            max={max}
            step={num(p.step, 1) || 1}
            defaultValue={v}
            disabled={off}
            aria-label={str(p.ariaLabel) || undefined}
            data-loom-output={showValue ? readoutId : undefined}
            style={{ accentColor: accent, height: str(p.size) === 'sm' ? 16 : str(p.size) === 'lg' ? 28 : 20 }}
          />
          {showValue ? <span id={readoutId} data-loom-readout>{v}</span> : null}
        </label>
      )
    }
    case 'Select': {
      const opts = list(p.options, p.optionsSep)
      // `multiple` is the native one, and a multi-select is a taller box
      // rather than a taller row: without an explicit size the browser shows
      // exactly one option and every other choice is invisible.
      const multi = p.multiple === true
      return (
        <select
          key={key}
          style={multi ? { ...style, height: 'auto' } : style}
          defaultValue={multi ? opts.filter((o) => o === str(p.value)) : str(p.value)}
          multiple={multi}
          size={multi ? Math.max(2, Math.min(6, opts.length)) : undefined}
          disabled={p.disabled === true}
          required={p.required === true}
          aria-label={str(p.ariaLabel) || undefined}
        >
          {str(p.placeholder) && !multi ? <option value="">{str(p.placeholder)}</option> : null}
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    case 'ComboBox': {
      const opts = list(p.options, p.optionsSep)
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      return (
        <div key={key} style={style}>
          <input
            list={`${node.id}-dl`}
            defaultValue={str(p.value)}
            placeholder={str(p.placeholder)}
            disabled={p.disabled === true}
            readOnly={p.readOnly === true}
            required={p.required === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${fs}px`, width: '140px' }}
          />
          <datalist id={`${node.id}-dl`}>{opts.map((o) => <option key={o} value={o} />)}</datalist>
          <span aria-hidden="true" style={{ color: t.textMuted }}>▾</span>
        </div>
      )
    }
    case 'TextArea': {
      const maxLength = num(p.maxLength, -1)
      const resize = (str(p.resize) || 'vertical') as React.CSSProperties['resize']
      return (
        <textarea
          key={key}
          style={{ ...style, resize }}
          rows={num(p.rows, 4) || 4}
          placeholder={str(p.placeholder)}
          defaultValue={str(p.value)}
          maxLength={maxLength > 0 ? maxLength : undefined}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    }
    case 'SearchBox': {
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      return (
        <label key={key} style={style}>
          {str(p.icon) ? <span aria-hidden="true">{str(p.icon)}</span> : null}
          <input
            type="search"
            placeholder={str(p.placeholder)}
            defaultValue={str(p.value)}
            disabled={p.disabled === true}
            readOnly={p.readOnly === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${fs}px`, width: '100%' }}
          />
        </label>
      )
    }
    case 'NumberInput':
      return (
        <input
          key={key}
          type="number"
          style={style}
          defaultValue={num(p.value, 0)}
          min={num(p.min, 0)}
          max={num(p.max, 100)}
          step={num(p.step, 1) || 1}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    case 'PasswordInput':
      return (
        <input
          key={key}
          // `reveal` is the shipped input TYPE, not a pretend toggle button:
          // "this field masks its content" is a real design decision, while the
          // widget that unmasks it belongs to the product, not the schema.
          type={p.reveal === true ? 'text' : 'password'}
          style={style}
          placeholder={str(p.placeholder)}
          defaultValue={str(p.value)}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          autoComplete={str(p.autocomplete) || undefined}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    case 'DatePicker':
      return (
        <input
          key={key}
          type="date"
          style={style}
          defaultValue={str(p.value)}
          min={str(p.min) || undefined}
          max={str(p.max) || undefined}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    case 'TimePicker':
      return (
        <input
          key={key}
          type="time"
          style={style}
          defaultValue={str(p.value)}
          step={num(p.step, 60) || 60}
          min={str(p.min) || undefined}
          max={str(p.max) || undefined}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          aria-label={str(p.ariaLabel) || undefined}
        />
      )
    case 'ColorInput': {
      const hex = /^#[0-9a-fA-F]{6}$/.test(str(p.value)) ? str(p.value) : t.accent
      const swatch = str(p.size) === 'sm' ? 20 : str(p.size) === 'lg' ? 36 : 28
      return (
        <label key={key} style={style}>
          <input
            type="color"
            defaultValue={hex}
            disabled={p.disabled === true}
            required={p.required === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ width: `${swatch}px`, height: `${swatch}px`, border: 'none', background: 'none', padding: 0 }}
          />
          {p.showValue !== false ? <span style={{ fontFamily: t.fontMono, fontSize: `${t.textXs}px` }}>{str(p.value) || t.accent}</span> : null}
        </label>
      )
    }
    case 'FileUpload': {
      // A real file input, visually hidden behind the drop zone: clicking
      // opens a real picker, so the control is not a picture of a control.
      const off = p.disabled === true
      return (
        <label
          key={key}
          style={{ ...style, cursor: off ? 'not-allowed' : 'pointer' }}
          aria-disabled={off || undefined}
          aria-label={str(p.ariaLabel) || undefined}
          {...behaviourAttrs({ role: 'press' })}
        >
          {/* `multiple` belongs on the input itself: a drop zone that says
              "many" and then hands the product one file is worse than no
              promise at all. */}
          <input
            type="file"
            accept={str(p.accept) || undefined}
            multiple={p.multiple === true}
            disabled={off}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }}
          />
          <span aria-hidden="true">⤴</span>
          <span>{str(p.label)}</span>
          {str(p.hint) ? <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted }}>{str(p.hint)}</span> : null}
          {str(p.accept) ? <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted }}>{str(p.accept)}</span> : null}
        </label>
      )
    }
    case 'ButtonGroup': {
      const aria = str(p.ariaLabel)
      return (
        <div key={key} style={style} role="group" aria-label={aria || undefined}>
          {children}
        </div>
      )
    }
    case 'DropdownButton': {
      // A real menu: the button toggles it, the items are pressable, and the
      // menu closes on Escape or an outside click.
      const items = list(p.items, p.itemsSep)
      const open = false
      const menuId = groupId(node.id, 'menu')
      const off = p.disabled === true
      // Which side the panel opens toward. A menu that is wider than its
      // trigger has to be told, or it hangs off the edge of the viewport.
      const side = str(p.align) === 'start' ? 'flex-start' : 'flex-end'
      return (
        <div key={key} style={{ ...style, flexDirection: 'column', alignItems: side }} data-loom-menu={menuId}>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            disabled={off}
            aria-label={str(p.ariaLabel) || undefined}
            data-loom-menu-trigger={menuId}
            {...behaviourAttrs({ role: 'toggle', on: open })}
            style={{ background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', cursor: off ? 'not-allowed' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: 0 }}
          >
            <span>{str(p.label)}</span>
            <span aria-hidden="true">▾</span>
          </button>
          <div role="menu" data-loom-menu-panel={menuId} data-loom-open={open ? '1' : '0'} style={{ display: open ? 'flex' : 'none', flexDirection: 'column', gap: '2px', marginTop: '6px', padding: '4px', borderRadius: `${t.radiusMd}px`, background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadowMd }}>
            {items.map((it) => (
              <div key={it} role="menuitem" tabIndex={0} {...behaviourAttrs({ role: 'press' })} style={{ padding: '6px 10px', borderRadius: `${t.radiusSm}px`, fontSize: `${t.textSm}px`, color: t.textPrimary }}>
                {it}
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'Rating': {
      const v = num(p.value, 3)
      const max = num(p.max, 5) || 5
      // A rating you can only READ is a different component: no press role, no
      // pointer, no stars that look clickable and then do nothing.
      const readOnly = p.readOnly === true
      const tone = str(p.tone) === 'inherit' ? t.warning : toneColor(t, str(p.tone))
      return (
        <div
          key={key}
          style={style}
          role="img"
          aria-label={str(p.ariaLabel) || `${v} of ${max} stars`}
          data-loom-value={String(v)}
          {...(readOnly ? {} : behaviourAttrs({ role: 'rate' }))}
        >
          {Array.from({ length: max }, (_, i) => (
            <span
              key={i}
              data-loom-star={readOnly ? undefined : ''}
              data-loom-i={String(i + 1)}
              data-loom-lit={i < v ? '1' : '0'}
              style={{ display: 'inline-block', color: i < v ? tone : t.textMuted }}
            >
              ★
            </span>
          ))}
          {p.showValue !== false ? (
            <span style={{ fontFamily: t.fontMono, fontSize: `${t.textXs}px`, color: t.textMuted, marginLeft: '4px' }}>
              {v}/{max}
            </span>
          ) : null}
        </div>
      )
    }
    case 'ToggleButton': {
      const on = p.on === true || p.pressed === true
      return (
        <button
          key={key}
          type="button"
          style={style}
          aria-pressed={on}
          disabled={p.disabled === true}
          aria-label={str(p.ariaLabel) || undefined}
          {...behaviourAttrs({ role: 'toggle', on })}
        >
          {str(p.icon) ? <IconGlyph value={str(p.icon)} size={14} /> : null}
          {str(p.label)}
        </button>
      )
    }
    case 'Segmented': {
      // A segmented control IS a radio group, so it uses real radios: one
      // choice, keyboard arrows for free, and no custom state to keep in sync.
      const opts = list(p.options, p.optionsSep)
      const current = str(p.value)
      const full = p.fullWidth === true
      const tint = str(p.tone) === 'inherit' ? t.accent : toneColor(t, str(p.tone))
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      return (
        <div
          key={key}
          style={{ ...style, width: full ? '100%' : style.width }}
          role="radiogroup"
          aria-label={str(p.ariaLabel) || undefined}
        >
          {opts.map((o) => (
            <label
              key={o}
              {...behaviourAttrs({ role: 'radio', group: node.id, index: opts.indexOf(o), on: current === o })}
              style={{
                fontSize: `${fs}px`,
                fontWeight: t.weightMedium,
                padding: str(p.size) === 'sm' ? '3px 9px' : str(p.size) === 'lg' ? '7px 15px' : '5px 12px',
                borderRadius: `${t.radiusSm}px`,
                // `tone` tints the SELECTED option; `inherit` leaves it the
                // neutral surface it has always been.
                background: current === o ? (str(p.tone) === 'inherit' ? t.surface : `${tint}1f`) : 'transparent',
                color: current === o ? t.textPrimary : t.textMuted,
                border: `1px solid ${current === o ? t.borderStrong : 'transparent'}`,
                cursor: 'pointer',
                textAlign: 'center',
                // `fullWidth` means the options SHARE the control's width — the
                // difference between a segmented control and a row of buttons.
                ...(full ? { flex: 1 } : {}),
              }}
            >
              <input type="radio" name={node.id} defaultChecked={current === o} style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
              {o}
            </label>
          ))}
        </div>
      )
    }
    case 'SpinBox': {
      const start = num(p.value, 1)
      const min = num(p.min, Number.isFinite(Number(p.min)) ? Number(p.min) : start - 10)
      const max = num(p.max, Number.isFinite(Number(p.max)) ? Number(p.max) : start + 10)
      const stepBy = num(p.step, 1) || 1
      // A disabled spinbox must not keep its step role: the runtime drives
      // stepping off that attribute, so a `disabled` control that still carries
      // it would keep counting up for whoever clicked it.
      const off = p.disabled === true
      const stepRole = off ? {} : { 'data-loom-b': 'step' }
      const buttons = p.showButtons !== false
      return (
        <div
          key={key}
          style={style}
          role="spinbutton"
          aria-valuenow={start}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-label={str(p.ariaLabel) || undefined}
          aria-disabled={off || undefined}
          data-loom-steps={node.id}
          data-loom-current={String(start)}
          data-loom-value-min={String(min)}
          data-loom-value-max={String(max)}
          data-loom-value-step={String(stepBy)}
        >
          {buttons ? (
            <button type="button" {...stepRole} data-loom-nav="prev" disabled={off} aria-label="decrease" style={{ background: 'transparent', border: 'none', color: t.textSecondary, cursor: off ? 'not-allowed' : 'pointer' }}>−</button>
          ) : null}
          <span data-loom-spin style={{ fontFamily: t.fontMono }}>{start}</span>
          {buttons ? (
            <button type="button" {...stepRole} data-loom-nav="next" disabled={off} aria-label="increase" style={{ background: 'transparent', border: 'none', color: t.textSecondary, cursor: off ? 'not-allowed' : 'pointer' }}>+</button>
          ) : null}
        </div>
      )
    }
    case 'Checklist': {
      const items = list(p.items, p.itemsSep)
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      const aria = str(p.ariaLabel)
      return (
        <div
          key={key}
          style={style}
          role={aria ? 'group' : undefined}
          aria-label={aria || undefined}
        >
          {items.map((it) => (
            <label
              key={it}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: `${fs}px`, color: t.textPrimary, cursor: 'pointer' }}
              {...behaviourAttrs({ role: 'check', group: node.id, index: items.indexOf(it) })}
            >
              <input type="checkbox" disabled={p.disabled === true} />
              <span>{it}</span>
            </label>
          ))}
          {children}
        </div>
      )
    }
    case 'TagInput': {
      const all = list(p.value, p.valueSep)
      // `maxTags` is a cap on what is SHOWN, not a truncation of the value:
      // the rest still round-trips in the document.
      const cap = num(p.maxTags, -1)
      const tags = cap > 0 ? all.slice(0, cap) : all
      const tint = str(p.tone) === 'inherit' ? t.accent : toneColor(t, str(p.tone))
      const fs = str(p.size) === 'sm' ? t.textXs : str(p.size) === 'lg' ? t.textMd : t.textSm
      return (
        <div key={key} style={style} aria-label={str(p.ariaLabel) || undefined}>
          {tags.map((tg) => (
            <span key={tg} style={{ background: `${tint}1a`, color: tint, borderRadius: `${t.radiusFull}px`, padding: '2px 9px', fontSize: `${fs}px`, fontWeight: t.weightSemibold }}>{tg}</span>
          ))}
          {cap > 0 && all.length > cap ? (
            <span style={{ color: t.textMuted, fontSize: `${t.textXs}px` }}>+{all.length - cap}</span>
          ) : null}
          <input
            placeholder={str(p.placeholder)}
            disabled={p.disabled === true}
            readOnly={p.readOnly === true}
            aria-label={str(p.ariaLabel) || undefined}
            style={{ background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${fs}px`, width: '90px' }}
          />
        </div>
      )
    }
    case 'OtpInput': {
      const len = num(p.length, 6) || 6
      const box = str(p.size) === 'sm' ? 28 : str(p.size) === 'lg' ? 44 : 36
      const tall = str(p.size) === 'sm' ? 36 : str(p.size) === 'lg' ? 52 : 44
      return (
        // The cells are the control, so the frame around them is transparent
        // unless the designer asked for a surface of their own.
        <div
          key={key}
          style={{
            ...style,
            background: str(p.background) || 'transparent',
            border: str(p.border) || num(p.borderWidth, -1) >= 0
              ? `${num(p.borderWidth, -1) >= 0 ? num(p.borderWidth) : 1}px solid ${str(p.border) || t.border}`
              : 'none',
            padding: `${num(p.padding, 0)}px`,
          }}
          role="group"
          aria-label={str(p.ariaLabel) || 'One-time code'}
        >
          {Array.from({ length: len }, (_, i) => (
            <input
              key={i}
              type={p.mask === true ? 'password' : 'text'}
              inputMode="numeric"
              maxLength={1}
              defaultValue={str(p.value)[i] ?? ''}
              disabled={p.disabled === true}
              aria-label={`digit ${i + 1}`}
              style={{ width: `${box}px`, height: `${tall}px`, textAlign: 'center', fontSize: str(p.size) === 'sm' ? `${t.textMd}px` : `${t.textLg}px`, fontFamily: t.fontMono, borderRadius: `${t.radiusMd}px`, border: `1px solid ${t.borderStrong}`, background: t.surface, color: t.textPrimary }}
            />
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
          {p.showAuthor !== false && str(p.author) ? <cite style={{ display: 'block', marginTop: `${t.space2}px`, fontSize: `${t.textXs}px`, color: t.textMuted, fontStyle: 'normal' }}>{str(p.author)}</cite> : null}
        </blockquote>
      )
    case 'CodeBlock': {
      // Real line numbers, drawn as their own gutter: a number that is part of
      // the code text would be selectable and copyable, and a code block whose
      // gutter is part of the source is one people paste from wrongly.
      const source = (num(p.tabSize, 2) || 2) > 0 ? str(p.code).replace(/\t/g, ' '.repeat(num(p.tabSize, 2) || 2)) : str(p.code)
      const lines = source.split('\n')
      const showNumbers = p.showLineNumbers === true
      const start = num(p.startLine, 1)
      const gutter = showNumbers ? `${String(lines.length + start - 1).length + 1}ch` : '0px'
      return (
        <pre key={key} style={{ ...style, margin: 0 }}>
          {p.showLanguage === true && str(p.language) ? (
            <span style={{ display: 'block', fontSize: `${t.textXs}px`, color: t.textMuted, marginBottom: `${t.space2}px`, fontFamily: t.fontFamily, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              {str(p.language)}
            </span>
          ) : null}
          <span style={{ display: 'flex' }}>
            {showNumbers ? (
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  width: gutter,
                  paddingRight: `${t.space3}px`,
                  textAlign: 'right',
                  color: t.textMuted,
                  userSelect: 'none',
                  borderRight: `1px solid ${t.border}`,
                  marginRight: `${t.space3}px`,
                }}
              >
                {lines.map((_, i) => <div key={i}>{start + i}</div>)}
              </span>
            ) : null}
            <code style={{ flex: 1, minWidth: 0 }}>{source}</code>
          </span>
        </pre>
      )
    }
    case 'InlineCode':
      return <code key={key} style={style}>{str(p.code)}</code>
    case 'Link': {
      // A disabled link is not a link: it keeps its place in the sentence and
      // says so, rather than staying focusable and pretending.
      const off = p.disabled === true
      const target = str(p.target) || '_self'
      const body = str(p.text)
      const icon = str(p.icon) ? <IconGlyph value={str(p.icon)} size={14} /> : null
      return (
        <a
          key={key}
          style={style}
          href={off ? undefined : str(p.href) || '#'}
          target={off ? undefined : target}
          // A link that opens a new context hands that page a reference to this
          // one unless it is told not to, which is a security decision and not a
          // style — so it follows the target rather than the designer's memory.
          rel={off ? undefined : str(p.rel) || (target === '_blank' ? 'noopener noreferrer' : '')}
          aria-disabled={off ? 'true' : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          {...(off ? {} : behaviourAttrs({ role: 'press' }))}
        >
          {icon ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              {str(p.iconPosition) === 'end' ? body : icon}
              {str(p.iconPosition) === 'end' ? icon : body}
            </span>
          ) : (
            body
          )}
        </a>
      )
    }
    case 'BulletList': {
      const items = list(p.items, p.itemsSep)
      const mark = str(p.bullet) === 'check' ? '✓' : str(p.bullet) === 'dash' ? '–' : str(p.bullet) === 'arrow' ? '→' : '•'
      const markerGap = num(p.markerGap, 8)
      const truncate = p.truncate === true
      return (
        <ul key={key} style={{ ...style, margin: 0, listStyle: 'none' }}>
          {items.map((it) => (
            <li key={it} style={{ display: 'flex', gap: `${markerGap}px`, minWidth: 0, ...(truncate ? { overflow: 'hidden' } : {}) }}>
              <span aria-hidden="true" style={{ color: str(p.markerColor) || t.accent, flexShrink: 0 }}>{mark}</span>
              <span style={{ minWidth: 0, ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{it}</span>
            </li>
          ))}
        </ul>
      )
    }
    case 'NumberedList': {
      const items = list(p.items, p.itemsSep)
      const start = num(p.start, 1) || 1
      const truncate = p.truncate === true
      return (
        <ol key={key} style={{ ...style, margin: 0 }} start={start} reversed={p.reversed === true}>
          {items.map((it) => (
            <li key={it} style={truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined}>{it}</li>
          ))}
        </ol>
      )
    }
    case 'Divider': {
      const thickness = num(p.thickness, 1)
      const colour = str(p.color) || t.borderStrong
      const named = str(p.ariaLabel)
      const label = str(p.label)
      if (str(p.orientation) === 'vertical') {
        // A vertical rule is a box, and it says so to assistive tech: a rule
        // that only reads as "separator" tells a screen-reader user nothing
        // about which way the panes are split.
        return (
          <div
            key={key}
            role={named ? 'separator' : undefined}
            aria-label={named || undefined}
            aria-orientation="vertical"
            aria-hidden={named ? undefined : 'true'}
            style={style}
          />
        )
      }
      if (label || children.length > 0) {
        // A labelled divider is two rules with a word between them, which is a
        // different element: an `<hr>` cannot hold a child.
        //
        // The word is the divider's CHILD, not a property of its own: dropping
        // a Label into a Divider is how a designer writes one, and until this
        // branch read the children the labelled layout — and with it
        // `labelAlign` — could never be reached at all.
        return <LabelledDivider key={key} p={p} t={t} style={style} middle={label ? label : children} />
      }
      return <hr key={key} role={named ? 'separator' : undefined} aria-label={named || undefined} aria-hidden={named ? undefined : 'true'} style={{ ...style, border: 'none', borderTop: `${thickness}px ${str(p.style) || 'solid'} ${colour}`, height: 0, background: 'transparent', marginLeft: 0, marginRight: 0 }} />
    }
    case 'Badge': {
      // A count that stops counting: 1,284 becomes "99+", which is the
      // difference between a badge and a column of digits.
      const cap = num(p.max, -1)
      const typed = str(p.text)
      const asNumber = Number(typed.replace(/[$,%\s]/g, ''))
      const shown = cap > 0 && Number.isFinite(asNumber) && asNumber > cap ? `${cap}+` : typed
      return (
        <span key={key} style={style}>
          {p.dot === true ? <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '999px', background: 'currentColor', display: 'inline-block' }} /> : null}
          {shown}
        </span>
      )
    }
    case 'Tag':
      return <span key={key} style={style}>{str(p.text)}{p.removable === true ? <span aria-hidden="true"> ×</span> : null}</span>
    case 'Kbd': {
      // A chord is a LIST of keys, not a string: "Ctrl,K" is two caps with a
      // gap between them, and a single item stays a single cap.
      const keys = list(p.keys, p.keysSep)
      if (keys.length <= 1) return <kbd key={key} style={style}>{str(p.keys)}</kbd>
      // The CAPS are the visual, and the wrapper is the box: a free-positioned
      // node is absolutely positioned, and two absolutely positioned children
      // would stack on top of each other instead of sitting side by side.
      const cap: React.CSSProperties = { ...style }
      delete cap.position
      delete cap.left
      delete cap.top
      delete cap.right
      delete cap.bottom
      return (
        <span key={key} style={{ ...style, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
          {keys.map((k) => <kbd key={k} style={cap}>{k}</kbd>)}
        </span>
      )
    }
    /* ---- catalog2 data ---- */
    case 'DataGrid': {
      // Headers split on the SAME delimiter as the row data (`|`). The old
      // Table split headers on commas and cells on pipes, so its own default
      // data rendered as a single column. One convention, or none.
      const cols = list(p.columns, p.columnsSep)
      // Rows and cells split on their OWN declared separators, so a value that
      // contains a comma or a pipe is data, not a delimiter.
      const rows = str(p.rows)
        .split(delimiterChar(p.rowSep))
        .map((r) => r.split(delimiterChar(p.cellSep)).map((c) => c.trim()))
        .filter((r) => r.some((c) => c !== ''))
      const density = str(p.density) || 'normal'
      const rowPad = density === 'compact' ? `${t.space1 + 1}px ${t.space3}px` : density === 'roomy' ? `${t.space3 + 2}px ${t.space3}px` : `${t.space2}px ${t.space3}px`
      const selectable = p.selectable === true
      const sortable = p.sortable !== false
      const searching = p.search === true
      const rowActions = p.rowActions === true
      const showHeader = p.showHeader !== false
      const borderless = p.borderless === true
      const sticky = p.stickyHeader !== false
      const bulk = list(p.bulkActions, p.bulkActionsSep)
      // A column whose every value parses as a number is a number column, and
      // number columns are right-aligned with tabular figures. This is the
      // rule that makes a dense table scannable instead of decorative, and
      // inferring it beats making the designer declare it 12 times.
      const numericCols = cols.map((_, ci) => {
        const vals = rows.map((r) => r[ci] ?? '').filter((v) => v !== '')
        return vals.length > 0 && vals.every((v) => Number.isFinite(Number(v.replace(/[$,%\s]/g, ''))))
      })
      // The state the grid OPENS in. The behaviour runtime re-sorts on click, so
      // this is the authored initial order and nothing more.
      const sortCol = num(p.sortColumn, -1)
      const sortDir = str(p.sortDirection) || 'none'
      const sorted =
        sortCol >= 0 && sortDir !== 'none' && cols[sortCol]
          ? [...rows].sort((a, b) => {
            const av = str(a[sortCol])
            const bv = str(b[sortCol])
            const an = Number(av.replace(/[$,%\s]/g, ''))
            const bn = Number(bv.replace(/[$,%\s]/g, ''))
            const cmp = Number.isFinite(an) && Number.isFinite(bn) ? an - bn : av.localeCompare(bv)
            return sortDir === 'desc' ? -cmp : cmp
          })
          : rows
      const bulkId = groupId(node.id, 'bulk')
      const rowMenu = (i: number) => groupId(node.id, 'row' + i)
      // A borderless grid has no frame to clip its corners to, and no rules to
      // break: the same decision, expressed once.
      const line = borderless ? 'none' : `1px solid ${t.border}`

      return (
        <div
          key={key}
          style={style}
          data-loom-grid={node.id}
          data-loom-visible={String(Math.min(sorted.length, 1))}
          data-loom-selected="0"
        >
          {searching && (
            <div style={{ display: 'flex', alignItems: 'center', gap: `${t.space2}px`, padding: `${t.space2}px ${t.space3}px`, borderBottom: line }}>
              <span aria-hidden="true" style={{ color: t.textMuted }}>⌕</span>
              <input
                type="search"
                data-loom-filter={node.id}
                placeholder={str(p.searchPlaceholder) || 'Filter rows'}
                aria-label={str(p.searchPlaceholder) || 'Filter rows'}
                style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textSm}px` }}
              />
            </div>
          )}

          {/* The bulk bar is CSS-driven: it appears because rows are selected,
              not because a framework re-rendered. */}
          {selectable && bulk.length > 0 && (
            <div data-loom-bulk={bulkId} style={{ display: 'none', alignItems: 'center', gap: `${t.space2}px`, padding: `${t.space2}px ${t.space3}px`, borderBottom: line, background: `${t.accent}14` }}>
              <span data-loom-bulk-count style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.accent }}>0 selected</span>
              {bulk.map((b) => (
                <button key={b} type="button" data-loom-b="press" style={{ background: t.surface, border: `1px solid ${t.borderStrong}`, borderRadius: `${t.radiusSm}px`, color: t.textPrimary, fontSize: `${t.textXs}px`, padding: '4px 10px', cursor: 'pointer' }}>
                  {b}
                </button>
              ))}
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: `${t.textSm}px` }} aria-label={str(p.ariaLabel) || undefined}>
            {showHeader ? (
              <thead>
                <tr>
                  {selectable && (
                    <th scope="col" style={{ width: '38px', position: sticky ? 'sticky' : 'static', top: 0, background: t.bg, textAlign: 'left', padding: rowPad, borderBottom: line }}>
                      <input
                        type="checkbox"
                        data-loom-select-all={node.id}
                        aria-label="Select all rows"
                        style={{ accentColor: t.accent }}
                      />
                    </th>
                  )}
                  {cols.map((c, ci) => (
                    <th
                      key={c}
                      scope="col"
                      aria-sort={sortCol === ci && sortDir !== 'none' ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      {...(sortable ? behaviourAttrs({ role: 'sort', group: node.id, index: ci }) : {})}
                      {...(sortCol === ci && sortDir !== 'none' ? { 'data-loom-sort': sortDir } : {})}
                      style={{
                        position: sticky ? 'sticky' : 'static',
                        top: 0,
                        background: t.bg,
                        textAlign: numericCols[ci] ? 'right' : 'left',
                        padding: rowPad,
                        borderBottom: line,
                        color: t.textMuted,
                        fontSize: `${t.textXs}px`,
                        fontWeight: t.weightSemibold,
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                        whiteSpace: 'nowrap',
                        cursor: sortable ? 'pointer' : 'default',
                        ...(p.freezeFirst === true && ci === 0 ? { position: 'sticky', left: 0, zIndex: 2 } : {}),
                      }}
                    >
                      {c}
                    </th>
                  ))}
                  {rowActions && <th scope="col" style={{ width: '44px', position: sticky ? 'sticky' : 'static', top: 0, background: t.bg, borderBottom: line }} />}
                </tr>
              </thead>
            ) : null}
            <tbody data-loom-rows>
              {sorted.map((r, i) => (
                <tr
                  key={i}
                  data-loom-row
                  style={{
                    background: p.striped === true && i % 2 === 1 ? t.bg : 'transparent',
                    // Numeric cells get tabular figures so digits line up down
                    // the column; without this a dense table looks amateur.
                    fontVariantNumeric: numericCols.some(Boolean) ? 'var(--loom-numeric)' : 'normal',
                  }}
                >
                  {selectable && (
                    <td style={{ padding: rowPad, borderBottom: line, width: '38px' }}>
                      <input
                        type="checkbox"
                        data-loom-select={node.id}
                        aria-label={`Select row ${i + 1}`}
                        style={{ accentColor: t.accent }}
                      />
                    </td>
                  )}
                  {cols.map((c, ci) => (
                    <td
                      key={c + ci}
                      // Addressed BY COLUMN, not by position: a selectable grid
                      // puts a checkbox cell and an actions cell in the row, so
                      // "the third child" is not "the third column" — and
                      // sorting by position silently sorted the checkbox.
                      data-loom-cell={ci}
                      style={{
                        padding: rowPad,
                        borderBottom: line,
                        textAlign: numericCols[ci] ? 'right' : 'left',
                        color: t.textPrimary,
                        whiteSpace: 'nowrap',
                        ...(p.freezeFirst === true && ci === 0
                          ? { position: 'sticky', left: 0, background: p.striped === true && i % 2 === 1 ? t.bg : t.surface, fontWeight: t.weightMedium }
                          : {}),
                      }}
                    >
                      {r[ci] ?? ''}
                    </td>
                  ))}
                  {rowActions && (
                    <td style={{ padding: rowPad, borderBottom: line, textAlign: 'right' }}>
                      <div data-loom-menu={rowMenu(i)} style={{ display: 'inline-block' }}>
                        <button
                          type="button"
                          aria-label={`Row actions for row ${i + 1}`}
                          data-loom-menu-trigger={rowMenu(i)}
                          style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', padding: '2px 6px' }}
                        >
                          ⋯
                        </button>
                        <div
                          role="menu"
                          data-loom-menu-panel={rowMenu(i)}
                          data-loom-open="0"
                          style={{ position: 'absolute', zIndex: 30, minWidth: '140px', display: 'none', flexDirection: 'column', padding: '4px', borderRadius: `${t.radiusMd}px`, background: t.surface, border: `1px solid ${t.border}`, boxShadow: t.shadowMd }}
                        >
                          {['Open', 'Duplicate', 'Delete'].map((item) => (
                            <div key={item} role="menuitem" tabIndex={0} data-loom-b="press" style={{ padding: '6px 10px', borderRadius: `${t.radiusSm}px`, fontSize: `${t.textSm}px`, color: t.textPrimary, cursor: 'pointer' }}>
                              {item}
                            </div>
                          ))}
                        </div>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {/* Shown only when a filter matches nothing. */}
              <tr data-loom-nomatch style={{ display: 'none' }}>
                <td colSpan={cols.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)} style={{ padding: `${t.space5}px ${t.space3}px`, textAlign: 'center', color: t.textMuted, fontSize: `${t.textSm}px` }}>
                  {str(p.emptyMessage) || 'No rows match this filter'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    }
    case 'Stat': {
      const size = str(p.size) || 'md'
      const valueSize = size === 'sm' ? t.textLg : size === 'lg' ? t.textXxl : t.textXl
      const tone = str(p.trend) || 'flat'
      // A metric is not always better when it goes up: churn down, errors down.
      const risingIsGood = str(p.goodDirection) !== 'down'
      const good = tone === 'flat' ? null : (tone === 'up') === risingIsGood
      const deltaToneColour = good === null ? t.textMuted : good ? t.success : t.danger
      const arrow = tone === 'up' ? '▲' : tone === 'down' ? '▼' : '■'
      const deltaStyle = str(p.trendStyle) || 'plain'
      // A value that does not PARSE as a number is shown exactly as typed:
      // "$48.2k" is shorthand a designer chose, not something to reformat.
      const typed = str(p.value)
      const shown = formatMetric(typed, num(p.precision, -1), str(p.unit))
      const delta = str(p.delta)
      return (
        <div key={key} style={style}>
          {p.showLabel !== false ? (
            <span style={{ fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.6px', color: t.textMuted, fontWeight: t.weightSemibold }}>{str(p.label)}</span>
          ) : null}
          <span style={{ fontSize: `${valueSize}px`, fontWeight: t.weightBold, color: str(p.accent) || t.textPrimary }}>{shown}</span>
          {p.showDelta !== false && delta ? (
            deltaStyle === 'bar' ? (
              // A bar is the quiet comparison: the same delta, without a
              // coloured word, for a card that sits next to nine others.
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: deltaToneColour }}>
                <span aria-hidden="true" style={{ display: 'inline-block', width: tone === 'flat' ? '8px' : '18px', height: '3px', borderRadius: '2px', background: deltaToneColour, transform: tone === 'down' ? 'scaleX(-1)' : undefined }} />
                <span>{delta}</span>
              </span>
            ) : deltaStyle === 'badge' ? (
              <span style={{ alignSelf: 'flex-start', fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: deltaToneColour, background: `${deltaToneColour}1e`, border: `1px solid ${deltaToneColour}44`, borderRadius: `${t.radiusFull}px`, padding: '1px 8px' }}>
                {tone !== 'flat' ? <span aria-hidden="true">{arrow} </span> : null}{delta}
              </span>
            ) : (
              <span style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: deltaToneColour }}>
                {deltaStyle === 'arrow' ? <span aria-hidden="true">{arrow} </span> : null}{delta}
              </span>
            )
          ) : null}
        </div>
      )
    }
    case 'KpiCard': {
      const size = str(p.size) || 'md'
      const accent = str(p.accent) || t.accent
      const trend = str(p.trend) || 'flat'
      // A metric is not always better when it goes up: churn down, errors down.
      // Without this a falling error rate is painted red, which teaches people
      // to ignore the colour channel entirely.
      const risingIsGood = str(p.goodDirection) !== 'down'
      const good = trend === 'flat' ? null : (trend === 'up') === risingIsGood
      const tone = good === null ? t.textMuted : good ? t.success : t.danger
      const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '■'
      const points = numericList(p.points, p.pointsSep)
      const valueSize = size === 'sm' ? t.textXl : size === 'lg' ? t.textXxl : t.textXl
      const visual = str(p.visual) || 'sparkline'
      const visH = size === 'sm' ? 28 : size === 'lg' ? 64 : 44
      // The same honesty as Stat: a value that parses is formatted, and one
      // that does not is shown as the designer typed it.
      const shown = formatMetric(str(p.value), num(p.precision, -1), str(p.unit))
      return (
        <div key={key} style={style}>
          {p.showLabel !== false ? (
            <span style={{ fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.6px', color: t.textMuted, fontWeight: t.weightSemibold }}>
              {str(p.label)}
            </span>
          ) : null}
          <span style={{ fontSize: `${valueSize}px`, fontWeight: t.weightBold, color: t.textPrimary, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
            {shown}
          </span>
          {/* The comparison: a direction, the number, and what it is measured
              against. Colour follows GOODNESS, not direction. */}
          {p.showDelta !== false && str(p.delta) ? (
            <span
              data-loom-kpi-delta=""
              style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: tone }}
            >
              <span aria-hidden="true">{arrow}</span>
              <span>{str(p.delta)}</span>
              {str(p.deltaLabel) ? (
                <span style={{ fontWeight: t.weightNormal, color: t.textMuted, fontSize: `${t.textXs}px` }}>{str(p.deltaLabel)}</span>
              ) : null}
            </span>
          ) : null}
          {visual === 'sparkline' ? (
            <Sparkline points={points} width={Number(p.width) || 220} height={visH} accent={accent} id={node.id} />
          ) : visual === 'bars' ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: visH }}>
              {points.map((v, i) => {
                const max = Math.max(...points, 1)
                return (
                  <div
                    key={i}
                    style={{ flex: 1, height: `${Math.max(3, (v / max) * visH)}px`, borderRadius: '2px', background: i === points.length - 1 ? accent : `${accent}66` }}
                  />
                )
              })}
            </div>
          ) : null}
        </div>
      )
    }
    case 'ProgressBar': {
      const v = num(p.value, 62)
      const max = num(p.max, 100) || 100
      const min = num(p.min, 0)
      const pctv = Math.max(0, Math.min(100, ((v - min) / (max - min || 1)) * 100))
      // Thresholds turn the bar amber and then red, so a quota bar can say
      // "over" without a second chart or a caption.
      const dangerAt = num(p.dangerAt, -1)
      const warnAt = num(p.warnAt, -1)
      const barTone = dangerAt >= 0 && v >= dangerAt ? t.danger : warnAt >= 0 && v >= warnAt ? t.warning : toneColor(t, str(p.tone))
      const radius = num(p.radius, -1) >= 0 ? `${num(p.radius)}px` : '999px'
      const precision = num(p.precision, -1)
      return (
        <div key={key} style={style}>
          <div style={{ height: `${num(p.height, 8)}px`, borderRadius: radius, background: str(p.trackColor) || t.border, overflow: 'hidden' }}>
            <div style={{ width: `${pctv}%`, height: '100%', borderRadius: radius, background: barTone }} />
          </div>
          {p.showLabel === true ? (
            <span>
              {precision >= 0
                ? (pctv / 100).toFixed(precision)
                : Math.round(pctv)}
              {str(p.unit)}
            </span>
          ) : null}
        </div>
      )
    }
    case 'ProgressRing': {
      const v = num(p.value, 72)
      const max = num(p.max, 100) || 100
      const min = num(p.min, 0)
      const pctv = Math.max(0, Math.min(1, (v - min) / (max - min || 1)))
      const size = num(p.size, 72) || 72
      const thickness = num(p.thickness, 6) || 6
      const r = size / 2 - thickness / 2
      const c = size / 2
      const circ = 2 * Math.PI * r
      const dangerAt = num(p.dangerAt, -1)
      const warnAt = num(p.warnAt, -1)
      const arcTone = dangerAt >= 0 && v >= dangerAt ? t.danger : warnAt >= 0 && v >= warnAt ? t.warning : toneColor(t, str(p.tone))
      const precision = num(p.precision, -1)
      const bare = precision >= 0 ? (pctv * 100).toFixed(precision) : String(Math.round(pctv * 100))
      const readout = `${bare}${str(p.unit)}`
      return (
        <div key={key} style={style}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={str(p.ariaLabel) || `${bare} percent`}>
            <circle cx={c} cy={c} r={r} fill="none" stroke={str(p.trackColor) || t.border} strokeWidth={thickness} />
            <circle cx={c} cy={c} r={r} fill="none" stroke={arcTone} strokeWidth={thickness} strokeLinecap={str(p.cap) === 'butt' ? 'butt' : 'round'} strokeDasharray={`${pctv * circ} ${circ}`} transform={`rotate(-90 ${c} ${c})`} />
            {p.showValue !== false ? (
              <text x={c} y={c + 4} textAnchor="middle" fontSize={size * 0.22} fontWeight={t.weightBold} fill={t.textPrimary} fontFamily={t.fontFamily}>
                {readout}
              </text>
            ) : null}
          </svg>
        </div>
      )
    }
    case 'Avatar': {
      const size = num(p.size, 40)
      const label = str(p.ariaLabel) || str(p.initials)
      const picture = str(p.image)
      const fit = (str(p.imageFit) || 'cover') as React.CSSProperties['objectFit']
      return (
        <div key={key} style={style} role="img" aria-label={label}>
          {picture ? (
            <img src={picture} alt={label} style={{ width: '100%', height: '100%', borderRadius: 'inherit', objectFit: fit, objectPosition: 'center', display: 'block' }} />
          ) : str(p.fallback) === 'icon' ? (
            <IconGlyph value="user" size={Math.round(size * 0.55)} />
          ) : (
            str(p.initials)
          )}
        </div>
      )
    }
    case 'AvatarGroup': {
      const all = list(p.names, p.namesSep)
      const max = num(p.max, 4) || 4
      // Past `max` the rest fold into a "+N" chip, which is the difference
      // between a face row and a column of faces.
      const folded = p.overflow !== false && all.length > max
      const shown = folded ? all.slice(0, Math.max(1, max - 1)) : all
      const rest = all.length - shown.length
      const size = num(p.size, 32) || 32
      const tone = str(p.tone) || 'alternate'
      const chip = (i: number) =>
        tone === 'alternate'
          ? i % 2 === 0 ? t.accent : t.textMuted
          : tone === 'neutral' ? t.textMuted : tone === 'success' ? t.success : tone === 'warning' ? t.warning : t.accent
      return (
        <div
          key={key}
          style={style}
          role="img"
          aria-label={str(p.ariaLabel) || `${all.length} people`}
        >
          {shown.map((n, i) => (
            <span key={n} title={n} style={{ width: `${size}px`, height: `${size}px`, borderRadius: num(p.radius, -1) >= 0 ? `${num(p.radius)}px` : '999px', background: chip(i), color: t.textOnAccent, fontSize: `${Math.round(size * 0.36)}px`, fontWeight: t.weightBold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `${num(p.ring, 2)}px solid ${str(p.ringColor) || t.surface}`, marginLeft: i === 0 ? 0 : `-${Math.round(size * 0.35)}px` }}>
              {n.slice(0, 2).toUpperCase()}
            </span>
          ))}
          {folded ? (
            <span title={all.slice(shown.length).join(', ')} style={{ width: `${size}px`, height: `${size}px`, borderRadius: num(p.radius, -1) >= 0 ? `${num(p.radius)}px` : '999px', background: t.surface, color: t.textMuted, fontSize: `${Math.round(size * 0.34)}px`, fontWeight: t.weightSemibold, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `${num(p.ring, 2)}px solid ${str(p.ringColor) || t.surface}`, marginLeft: `-${Math.round(size * 0.35)}px` }}>
              +{rest}
            </span>
          ) : null}
        </div>
      )
    }
    case 'Image': {
      const fit = (str(p.fit) || 'cover') as React.CSSProperties['objectFit']
      const where = str(p.align) || 'center'
      return (
        <div key={key} style={style}>
          {str(p.src) ? (
            <img
              src={str(p.src)}
              alt={str(p.alt)}
              loading={str(p.loading) === 'eager' ? 'eager' : 'lazy'}
              style={{ width: '100%', height: '100%', objectFit: fit, objectPosition: where, display: 'block' }}
            />
          ) : (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: '120px', color: t.textMuted, fontSize: `${t.textSm}px` }}>{str(p.alt) || 'Image'}</span>
          )}
        </div>
      )
    }
    case 'BarChart': {
      const vals = list(p.values, p.valuesSep).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      const names = list(p.labels, p.labelsSep)
      const h = num(p.height, 120) || 120
      // The domain: -1 fits the data, and a bar chart that starts at an
      // arbitrary number is a chart that lies about its own bars.
      const dataMin = vals.length ? Math.min(...vals) : 0
      const dataMax = vals.length ? Math.max(...vals) : 1
      const lo = num(p.min, -1) >= 0 ? num(p.min) : Math.min(0, dataMin)
      const hi = num(p.max, -1) >= 0 ? num(p.max) : Math.max(dataMax, lo + 1)
      const span = hi - lo || 1
      const accent = str(p.accent) || t.accent
      const gap = `${num(p.gap, 6)}px`
      const radius = `${num(p.barRadius, 4)}px`
      const precision = num(p.precision, -1)
      const unit = str(p.unit)
      const dangerAt = num(p.dangerAt, -1)
      const warnAt = num(p.warnAt, -1)
      // The axis takes its own room, so the bars are scaled against what is
      // actually left rather than being drawn under the labels.
      const axisH = p.showAxis === true && names.length > 0 ? 16 : 0
      const plotH = Math.max(8, h - 20 - axisH)
      // Grid lines, as a gradient on the plot rather than a stack of divs: they
      // have to sit behind the bars and know nothing about their positions.
      const grid = p.showGrid === true
        ? { backgroundImage: `repeating-linear-gradient(to top, ${t.border} 0, ${t.border} 1px, transparent 1px, transparent ${Math.max(16, Math.round(plotH / 3))}px)` }
        : {}
      return (
        <div key={key} style={{ ...style, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div
            style={{ display: 'flex', alignItems: 'flex-end', gap, flex: 1, minHeight: 0, paddingRight: '4px', ...grid }}
            role="img"
            aria-label={str(p.ariaLabel) || `bar chart, ${vals.length} bars, from ${lo} to ${hi}`}
          >
            {vals.map((v, i) => {
              // Thresholds first: a bar over the line is the whole reason a bar
              // chart gets a colour it did not ask for.
              const over = dangerAt >= 0 && v >= dangerAt ? t.danger : warnAt >= 0 && v >= warnAt ? t.warning : accent
              const fill = str(p.colorBy) === 'value'
                ? fade(over, 0.35 + 0.65 * Math.max(0, Math.min(1, (v - lo) / span)))
                : over
              return (
                <div key={i} title={`${precision >= 0 ? v.toFixed(precision) : v}${unit}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 0 }}>
                  {p.showLabels === true ? (
                    <span style={{ fontSize: `${t.textXs}px`, color: t.textMuted, textAlign: 'center', marginBottom: '2px', fontVariantNumeric: 'var(--loom-numeric)' }}>
                      {precision >= 0 ? v.toFixed(precision) : v}{unit}
                    </span>
                  ) : null}
                  <div style={{ height: `${Math.max(4, ((v - lo) / span) * plotH)}px`, borderRadius: radius, background: `linear-gradient(180deg, ${fill}, ${fade(fill, 0.55)})` }} />
                </div>
              )
            })}
          </div>
          {p.showAxis === true && names.length > 0 ? (
            <div style={{ display: 'flex', gap }} aria-hidden="true">
              {names.map((n, i) => (
                <span key={`${n}-${i}`} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: `${t.textXs}px`, color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    case 'PieChart': {
      const vals = list(p.values, p.valuesSep).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
      const names = list(p.labels, p.labelsSep)
      const size = num(p.size, 140) || 140
      const total = vals.reduce((a, b) => a + b, 0) || 1
      // A palette is a LIST of colours, so a designer can hand a chart the exact
      // brand ramp instead of taking the theme's.
      const authored = list(p.palette, p.paletteSep).filter((c) => c.trim() !== '')
      const palette = authored.length > 0
        ? authored
        : [t.accent, t.success, t.warning, t.danger, '#8b5cf6', '#06b6d4']
      const colour = (i: number) => palette[i % palette.length]
      let acc = 0
      const offset = num(p.startAngle, 0)
      const donut = p.donut === true
      const thickness = num(p.thickness, 24)
      const segs = vals.map((v, i) => {
        const start = (acc / total) * 360 + offset
        acc += v
        const end = (acc / total) * 360 + offset
        return { start, end, color: colour(i), v }
      })
      const cx = size / 2
      const cy = size / 2
      const r = size / 2 - 4
      const pt = (a: number) => {
        const rad = ((a - 90) * Math.PI) / 180
        return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const
      }
      const precision = num(p.precision, -1)
      const unit = str(p.unit)
      const share = (v: number) => `${precision >= 0 ? ((v / total) * 100).toFixed(precision) : Math.round((v / total) * 100)}${unit}`
      const legend = str(p.legendFormat) || 'percent'
      return (
        <div key={key} style={{ ...style, display: 'flex', alignItems: 'center', gap: `${t.space3}px` }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={str(p.ariaLabel) || 'pie chart'}>
            {segs.map((sg, i) => {
              const [x1, y1] = pt(sg.start)
              const [x2, y2] = pt(sg.end)
              const large = sg.end - sg.start > 180 ? 1 : 0
              // A donut is a stroked ARC, not a disc with a hole punched in it:
              // the hole has to be genuinely transparent, because the card
              // behind a pie chart is rarely a colour you can guess.
              if (donut) {
                const full = sg.end - sg.start >= 359.99
                return (
                  <circle
                    key={i}
                    cx={cx}
                    cy={cy}
                    r={r - thickness / 2}
                    fill="none"
                    stroke={sg.color}
                    strokeWidth={thickness}
                    strokeDasharray={full ? undefined : `${((sg.end - sg.start) / 360) * 2 * Math.PI * (r - thickness / 2)} ${2 * Math.PI * (r - thickness / 2)}`}
                    strokeDashoffset={full ? undefined : -((sg.start / 360) * 2 * Math.PI * (r - thickness / 2))}
                    transform={`rotate(-90 ${cx} ${cy})`}
                  />
                )
              }
              return <path key={i} d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`} fill={sg.color} stroke={t.surface} strokeWidth={2} />
            })}
          </svg>
          {p.showLegend === true ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: `${t.textXs}px`, color: t.textSecondary }}>
              {vals.map((v, i) => (
                <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span aria-hidden="true" style={{ width: '10px', height: '10px', borderRadius: '3px', background: colour(i), flexShrink: 0 }} />
                  {legend === 'label' ? names[i] ?? share(v) : legend === 'label-percent' ? `${names[i] ?? ''} ${share(v)}`.trim() : legend === 'value' ? `${precision >= 0 ? v.toFixed(precision) : v}${unit === '%' ? '' : unit}` : share(v)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    case 'LineChart': {
      const pts = list(p.points, p.pointsSep).map((v) => Number(v.trim())).filter((v) => Number.isFinite(v))
      const w = num(p.width, 280) || 280
      const h = num(p.height, 140) || 140
      const accent = str(p.accent) || t.accent
      if (pts.length < 2) return <div key={key} style={style} />
      const lo = num(p.min, -1) >= 0 ? num(p.min) : Math.min(...pts)
      const hi = num(p.max, -1) >= 0 ? num(p.max) : Math.max(...pts)
      const span = hi - lo || 1
      const step = w / (pts.length - 1)
      const xy = pts.map((v, i) => [i * step, 8 + (h - 16) - ((v - lo) / span) * (h - 16)] as const)
      const line = xy
        .map(([x, y], i) => `${i === 0 ? 'M' : str(p.curve) === 'smooth' ? 'C' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`)
        .join(' ')
      // A smooth trace is only honest if the curve cannot overshoot the data:
      // the control points sit on a third of the way along each span, which
      // keeps the curve inside the envelope the straight line already drew.
      const smooth = xy
        .map(([x, y], i) => {
          if (i === 0) return `M ${x.toFixed(1)} ${y.toFixed(1)}`
          const [px, py] = xy[i - 1]
          const k = (x - px) / 3
          return `C ${(px + k).toFixed(1)} ${py.toFixed(1)} ${(x - k).toFixed(1)} ${y.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`
        })
        .join(' ')
      const precision = num(p.precision, -1)
      const unit = str(p.unit)
      const fmt = (v: number) => `${precision >= 0 ? v.toFixed(precision) : v}${unit}`
      const reference = num(p.referenceAt, -1)
      const uid = `lc-${node.id}`
      return (
        <div key={key} style={style}>
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={str(p.ariaLabel) || `line chart, ${fmt(pts[0])} to ${fmt(pts[pts.length - 1])}`}>
            {p.showGrid !== false ? [0.25, 0.5, 0.75].map((f) => <line key={f} x1={0} y1={h * f} x2={w} y2={h * f} stroke={t.border} strokeWidth={1} />) : null}
            {reference >= 0 ? (
              <>
                <line x1={0} y1={8 + (h - 16) - ((reference - lo) / span) * (h - 16)} x2={w} y2={8 + (h - 16) - ((reference - lo) / span) * (h - 16)} stroke={t.warning} strokeWidth={1} strokeDasharray="4 4" />
                <text x={w - 2} y={8 + (h - 16) - ((reference - lo) / span) * (h - 16) - 4} textAnchor="end" fontSize={Math.max(8, h * 0.07)} fill={t.warning} fontFamily={t.fontFamily}>{fmt(reference)}</text>
              </>
            ) : null}
            {p.showArea === true ? (
              <>
                <defs>
                  <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent} stopOpacity="0.26" />
                    <stop offset="100%" stopColor={accent} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={`${str(p.curve) === 'smooth' ? smooth : line} L ${w} ${h} L 0 ${h} Z`} fill={`url(#${uid})`} />
              </>
            ) : null}
            <path d={str(p.curve) === 'smooth' ? smooth : line} fill="none" stroke={accent} strokeWidth={num(p.strokeWidth, 2)} strokeLinejoin="round" strokeLinecap="round" />
            {p.showPoints !== false ? xy.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={Math.max(2, num(p.strokeWidth, 2)) + 0.5} fill={accent} />) : null}
          </svg>
        </div>
      )
    }
    case 'Timeline':
      return (
        <div key={key} style={style}>
          {p.rail === true ? (
            <span
              aria-hidden="true"
              style={{ position: 'absolute', left: Math.max(1, num(p.indent, 16) / 2 - 1), top: 0, bottom: 0, width: '2px', background: t.border, borderRadius: '1px', pointerEvents: 'none' }}
            />
          ) : null}
          {children}
        </div>
      )
    case 'TimelineItem': {
      const size = str(p.size) || 'md'
      const small = size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm
      const marker = num(p.markerSize, 10)
      const tone = toneColor(t, str(p.tone))
      const shape = str(p.markerStyle) || 'dot'
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              aria-hidden="true"
              style={{
                width: `${marker}px`,
                height: `${marker}px`,
                flexShrink: 0,
                borderRadius: shape === 'square' ? '2px' : shape === 'ring' ? '999px' : '999px',
                background: shape === 'ring' ? 'transparent' : tone,
                border: shape === 'ring' ? `2px solid ${tone}` : undefined,
              }}
            />
            <span style={{ fontWeight: t.weightSemibold, color: t.textPrimary, fontSize: `${small}px` }}>{str(p.title)}</span>
          </div>
          {str(p.time) ? <span style={{ fontSize: `${Math.max(t.textXs, small - 2)}px`, color: t.textMuted, paddingLeft: `${marker + 8}px` }}>{str(p.time)}</span> : null}
          {str(p.description) ? <span style={{ fontSize: `${Math.max(t.textXs, small - 2)}px`, color: t.textSecondary, paddingLeft: `${marker + 8}px` }}>{str(p.description)}</span> : null}
        </div>
      )
    }
    case 'TreeList': {
      const items = list(p.items, p.itemsSep)
      const depth0 = num(p.expandDepth, 1)
      const indent = num(p.indent, 16)
      const truncate = p.truncate === true
      return (
        <div key={key} style={style} role="tree">
          {items.map((it, i) => {
            const depth = (it.match(/\//g) || []).length
            const leaf = it.split('/').pop() ?? it
            const open = depth < depth0
            return (
              <div
                key={it}
                data-loom-row
                data-loom-open={open ? '1' : '0'}
                aria-expanded={open}
                style={{
                  paddingLeft: `${depth * indent}px`,
                  display: 'flex',
                  gap: '6px',
                  alignItems: 'center',
                  minWidth: 0,
                  // A guide line per level, so depth is a thing you can SEE
                  // rather than a thing you count.
                  ...(p.guides === true && depth > 0
                    ? { borderLeft: `1px solid ${t.border}`, marginLeft: `${Math.max(0, depth * indent - indent / 2 - 1)}px`, paddingLeft: `${indent / 2}px` }
                    : {}),
                }}
              >
                <span
                  {...behaviourAttrs({ role: 'expand', group: node.id, index: i })}
                  style={{ color: t.textMuted, cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}
                >
                  {depth > 0 ? '└' : '▾'}
                </span>
                <span style={{ minWidth: 0, ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{leaf}</span>
              </div>
            )
          })}
        </div>
      )
    }
    case 'DataList': {
      const items = list(p.items, p.itemsSep)
      const pairSep = str(p.pairSep) || ':'
      const density = str(p.density) || 'normal'
      const padY = density === 'compact' ? `${t.space1}px` : density === 'roomy' ? `${t.space3}px` : `${t.space2}px`
      const stacked = str(p.layout) === 'column'
      const a = str(p.align) || 'between'
      const along = a === 'between' ? 'space-between' : a === 'center' ? 'center' : a === 'end' ? 'flex-end' : 'flex-start'
      const labelWidth = num(p.labelWidth, 0)
      const truncate = p.truncate === true
      return (
        <div key={key} style={style}>
          {items.map((it) => {
            const cut = it.indexOf(pairSep)
            const k = cut >= 0 ? it.slice(0, cut) : it
            const v = cut >= 0 ? it.slice(cut + pairSep.length) : ''
            return (
              <div
                key={it}
                style={{
                  display: 'flex',
                  flexDirection: stacked ? 'column' : 'row',
                  justifyContent: stacked ? undefined : along,
                  alignItems: stacked ? 'stretch' : 'center',
                  gap: stacked ? '2px' : `${t.space2}px`,
                  padding: `${padY}px 0`,
                  borderBottom: p.divided === true ? `1px solid ${t.border}` : 'none',
                  fontSize: `${t.textSm}px`,
                }}
              >
                <span
                  style={{
                    color: t.textSecondary,
                    // A fixed label column is the point of the property: without
                    // it the values start wherever the longest label ends, and a
                    // column of figures has nothing to line up on. `flex: 0 0 auto`
                    // keeps the label at its width instead of letting the value
                    // column squeeze it, in the row layout as well as the stacked one.
                    ...(labelWidth > 0
                      ? stacked
                        ? { width: `${labelWidth}px` }
                        : { width: `${labelWidth}px`, flex: '0 0 auto' }
                      : {}),
                    ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                  }}
                >
                  {k.trim()}
                </span>
                <span style={{ color: t.textPrimary, fontWeight: t.weightMedium, minWidth: 0, ...(truncate ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}) }}>{v.trim()}</span>
              </div>
            )
          })}
        </div>
      )
    }
    case 'KeyValue': {
      const size = str(p.size) || 'md'
      const labelSize = size === 'sm' ? t.textXs : size === 'lg' ? t.textSm : t.textXs
      const valueSize = size === 'sm' ? t.textXs + 1 : size === 'lg' ? t.textMd : t.textSm
      const caps = p.uppercase !== false
      return (
        <div key={key} style={style}>
          <span style={{ color: t.textMuted, fontSize: `${labelSize}px`, ...(caps ? { textTransform: 'uppercase', letterSpacing: '0.5px' } : {}), fontWeight: t.weightSemibold, flexShrink: 0 }}>{str(p.label)}</span>
          <span style={{ color: t.textPrimary, fontSize: `${valueSize}px`, fontWeight: t.weightMedium, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{str(p.value)}</span>
        </div>
      )
    }
    case 'Calendar': {
      // The three facts a month grid is made of: which day the week starts on,
      // how many days the month has, and how many blanks sit before the 1st.
      // Without the last two it is a grid of the wrong number of days in the
      // wrong places.
      const sunFirst = str(p.weekStart) === 'sun'
      const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      const heads = sunFirst ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : days
      // The offset is a COUNT OF DAYS, so a fractional one is rounded rather
      // than truncated: `Array.from({length: 0.5})` is zero blanks, which
      // meant a typed 0.5 moved nothing at all.
      const offset = Math.max(0, Math.min(6, Math.round(num(p.offset, 0))))
      const count = Math.max(1, Math.min(31, num(p.days, 30)))
      const size = str(p.size) || 'md'
      const cellPad = size === 'sm' ? '3px 0' : size === 'lg' ? '7px 0' : '5px 0'
      const today = str(p.today)
      const accent = str(p.accent) || t.accent
      return (
        <div key={key} style={style}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: t.weightSemibold, fontSize: size === 'sm' ? `${t.textXs}px` : `${t.textSm}px`, color: t.textPrimary }}>{str(p.month)}</span>
            {p.showNav !== false ? <span aria-hidden="true" style={{ color: t.textMuted }}>‹ ›</span> : null}
          </div>
          <div role="grid" aria-label={str(p.month) || 'calendar'} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px', textAlign: 'center', fontSize: size === 'sm' ? `${t.textXs - 1}px` : `${t.textXs}px` }}>
            {heads.map((d, i) => <span key={`${d}-${i}`} style={{ color: t.textMuted, padding: '4px 0' }}>{d}</span>)}
            {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
            {Array.from({ length: count }, (_, i) => {
              const d = String(i + 1)
              const sel = str(p.selected) === d
              const isToday = today !== '' && today === d
              return (
                <span
                  key={d}
                  role="gridcell"
                  aria-selected={sel}
                  style={{
                    padding: cellPad,
                    borderRadius: '6px',
                    background: sel ? accent : 'transparent',
                    color: sel ? t.textOnAccent : isToday ? accent : t.textPrimary,
                    fontWeight: sel || isToday ? t.weightBold : t.weightNormal,
                    // "Today" without a selected day still has to be findable.
                    boxShadow: !sel && isToday ? `inset 0 0 0 1px ${accent}55` : undefined,
                  }}
                >
                  {d}
                </span>
              )
            })}
          </div>
        </div>
      )
    }
    case 'KanbanColumn': {
      const size = str(p.size) || 'md'
      return (
        <div key={key} style={style}>
          {p.showHeader !== false ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: size === 'sm' ? `${t.textXs}px` : `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.title)}</span>
              {p.showCount !== false ? (
                <span style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightBold, background: `${toneColor(t, str(p.tone))}1a`, color: toneColor(t, str(p.tone)), borderRadius: '999px', padding: '1px 8px' }}>{num(p.count, 0)}</span>
              ) : null}
            </div>
          ) : null}
          {children}
        </div>
      )
    }
    case 'EmptyState': {
      const size = str(p.size) || 'md'
      const disc = size === 'sm' ? 36 : size === 'lg' ? 64 : 48
      const glyph = size === 'sm' ? 16 : size === 'lg' ? 28 : 22
      const action = str(p.actionLabel)
      const variant = str(p.actionVariant) || 'default'
      return (
        <div key={key} style={style}>
          {p.showIcon !== false ? (
            <div style={{ width: `${disc}px`, height: `${disc}px`, borderRadius: '999px', background: t.bg, border: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: `${glyph}px`, flexShrink: 0 }}>
              <IconGlyph value={str(p.icon)} size={glyph} color={t.textMuted} />
            </div>
          ) : null}
          <div style={{ fontWeight: t.weightSemibold, color: t.textPrimary, fontSize: size === 'sm' ? `${t.textSm}px` : `${t.textMd}px` }}>{str(p.title)}</div>
          {str(p.hint) ? <div style={{ fontSize: `${t.textSm}px`, color: t.textMuted }}>{str(p.hint)}</div> : null}
          {action ? (
            <button
              type="button"
              style={{
                marginTop: `${t.space2}px`,
                padding: `6px 14px`,
                borderRadius: `${t.radiusMd}px`,
                border: variant === 'primary' || variant === 'danger' ? 'none' : `1px solid ${t.borderStrong}`,
                background: variant === 'primary' ? t.accent : variant === 'danger' ? t.danger : variant === 'ghost' ? 'transparent' : t.surface,
                color: variant === 'primary' || variant === 'danger' ? t.textOnAccent : t.textPrimary,
                fontSize: `${t.textSm}px`,
                cursor: 'pointer',
              }}
            >
              {action}
            </button>
          ) : null}
        </div>
      )
    }
    case 'Skeleton': {
      const lines = num(p.lines, 3) || 3
      const h = num(p.height, 14)
      const variant = str(p.variant) || 'lines'
      const fill = str(p.color) || t.border
      const radius = num(p.radius, -1) >= 0 ? `${num(p.radius)}px` : `${t.radiusSm}px`
      // A block is one placeholder, so the line count stops mattering; a circle
      // is an avatar or an icon, which is square rather than wide.
      const count = variant === 'block' ? 1 : lines
      return (
        <div key={key} style={style} aria-label="loading" aria-busy="true">
          {Array.from({ length: count }, (_, i) => (
            <div
              key={i}
              style={{
                height: variant === 'circle' ? `${h * 2}px` : `${h}px`,
                width: variant === 'circle' ? `${h * 2}px` : variant === 'block' ? '100%' : i === count - 1 ? '62%' : '100%',
                borderRadius: variant === 'circle' ? '999px' : radius,
                background: fill,
                opacity: p.animate === false ? 0.7 : 0.4 + (0.6 * (i % 2)),
              }}
            />
          ))}
        </div>
      )
    }
    case 'DataCard': {
      const size = str(p.size) || 'md'
      const valueSize = size === 'sm' ? t.textLg : size === 'lg' ? t.textXxl : t.textXl
      // The value may break into pieces, so a figure can read as "1,284 orders"
      // rather than as one run-on number. The separator character is put back
      // between them: nothing the designer typed is thrown away.
      const parts = list(p.value, p.valueSep)
      const sep = delimiterChar(p.valueSep)
      return (
        <div key={key} style={style}>
          {p.showTitle !== false ? (
            <span style={{ fontSize: `${t.textXs}px`, textTransform: 'uppercase', letterSpacing: '0.6px', color: t.textMuted, fontWeight: t.weightSemibold }}>{str(p.title)}</span>
          ) : null}
          <span style={{ fontSize: `${valueSize}px`, fontWeight: t.weightBold, color: t.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
            {parts.map((seg, i) => (
              <React.Fragment key={`${seg}-${i}`}>
                {i > 0 ? <span key={`s-${i}`} style={{ fontSize: t.textLg, color: t.textMuted, fontWeight: t.weightMedium }}>{sep.trim() || ' '}</span> : null}
                <span key={`v-${i}`}>{seg}</span>
              </React.Fragment>
            ))}
          </span>
          {p.showHint !== false && str(p.hint) ? <span style={{ fontSize: `${t.textXs}px`, color: toneColor(t, str(p.hintTone) || 'success') }}>{str(p.hint)}</span> : null}
          {children}
        </div>
      )
    }
    /* ---- catalog2 navigation ---- */
    case 'NavBar':
      return (
        <nav key={key} style={style} aria-label={str(p.ariaLabel) || 'Main'}>
          {p.showTitle !== false ? <span style={{ fontWeight: t.weightBold, color: t.textPrimary }}>{str(p.title)}</span> : null}
          {children}
        </nav>
      )
    case 'NavLink': {
      const off = p.disabled === true
      const label = str(p.label)
      const icon = str(p.icon) ? <IconGlyph value={str(p.icon)} size={14} /> : null
      return (
        <a
          key={key}
          style={style}
          href={off ? undefined : str(p.href) || '#'}
          aria-current={p.active === true ? 'page' : undefined}
          aria-disabled={off ? 'true' : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          {...(off ? {} : behaviourAttrs({ role: 'press' }))}
        >
          {icon ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {str(p.iconPosition) === 'end' ? label : icon}
              {str(p.iconPosition) === 'end' ? icon : label}
            </span>
          ) : (
            label
          )}
        </a>
      )
    }
    case 'SideNav':
      return <nav key={key} style={style} aria-label={str(p.ariaLabel) || undefined} data-loom-collapsed={p.collapsed === true ? '1' : '0'}>{children}</nav>
    case 'Breadcrumbs': {
      const all = list(p.trail, p.trailSep)
      // Past a certain depth, keep the first crumb and the last few and elide
      // the middle: a trail that wraps onto three lines is not a trail.
      const limit = num(p.maxItems, 0)
      const elided = limit > 1 && all.length > limit
      const trail = elided
        ? [all[0], `…${all.length - limit + 1} more`, ...all.slice(all.length - (limit - 1))]
        : all
      const size = str(p.size) || 'md'
      return (
        <nav key={key} style={style} aria-label={str(p.ariaLabel) || 'breadcrumb'}>
          {trail.map((bc, i) => (
            <React.Fragment key={`${bc}-${i}`}>
              {i > 0 ? <span aria-hidden="true">{str(p.separator) || '/'}</span> : null}
              <span
                aria-current={i === trail.length - 1 ? 'page' : undefined}
                style={{
                  color: i === trail.length - 1 ? t.textPrimary : t.textMuted,
                  fontWeight: i === trail.length - 1 ? t.weightSemibold : t.weightNormal,
                  fontSize: `${size === 'sm' ? t.textXs - 1 : size === 'lg' ? t.textSm : t.textXs}px`,
                  ...(p.truncate === true ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : {}),
                }}
              >
                {bc}
              </span>
            </React.Fragment>
          ))}
        </nav>
      )
    }
    case 'Pagination': {
      const page = num(p.page, 1) || 1
      // `total` is the last page NUMBER; `itemCount`/`pageSize` are the honest
      // alternative, and take over the moment a designer knows the row count.
      const rows = num(p.itemCount, 0)
      const pageSize = Math.max(1, Math.round(num(p.pageSize, 10)))
      const last = rows > 0 ? Math.max(1, Math.ceil(rows / pageSize)) : num(p.total, 12) || 12
      const siblings = num(p.siblings, 1)
      const window: number[] = []
      for (let n = Math.max(1, page - siblings); n <= Math.min(last, page + siblings); n += 1) window.push(n)
      const small = str(p.size) === 'sm'
      // The size scale lives here rather than in the shared button helper, which
      // every pager would otherwise have to grow a parameter for.
      const btn = (on: boolean) => {
        const base = pgBtn(t, on)
        return small ? { ...base, minWidth: '24px', height: '24px', fontSize: `${t.textXs - 1}px` } : base
      }
      return (
        <nav
          key={key}
          style={style}
          aria-label={str(p.ariaLabel) || 'pagination'}
          data-loom-pager={node.id}
          // What the runtime needs to re-page when the size changes: the row
          // count, the authored page total and the current size.
          data-loom-items={rows > 0 ? String(rows) : undefined}
          data-loom-total={String(last)}
          data-loom-pagesize={String(pageSize)}
        >
          {p.showEdges !== false ? (
            <button type="button" data-loom-b="page" data-loom-delta="-1" disabled={page <= 1} aria-label="previous page" style={btn(false)}>‹</button>
          ) : null}
          {window[0] > 1 ? <span data-loom-more="start" style={{ color: t.textMuted, fontSize: `${t.textXs}px` }}>…</span> : null}
          {window.map((n) => (
            <button
              key={n}
              type="button"
              data-loom-b="page"
              data-loom-i={String(n)}
              aria-current={n === page ? 'page' : undefined}
              style={btn(n === page)}
            >
              {n}
            </button>
          ))}
          {window[window.length - 1] < last ? <span data-loom-more="end" style={{ color: t.textMuted, fontSize: `${t.textXs}px` }}>…</span> : null}
          {p.showEdges !== false ? (
            <button type="button" data-loom-b="page" data-loom-delta="1" disabled={page >= last} aria-label="next page" style={btn(false)}>›</button>
          ) : null}
          {/* The rows-per-page control, and only where it means something: a
              pager that has been told how many rows there are has a page size,
              and one that has not is just a number of pages. It is a real
              control — the runtime re-pages on change — rather than a caption
              that says 10 and never can be anything else. */}
          {rows > 0 ? (
            <label
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginLeft: `${t.space2}px`, color: t.textMuted, fontSize: `${t.textXs}px` }}
            >
              <span>Rows</span>
              <select
                data-loom-pagesize-select=""
                defaultValue={String(pageSize)}
                aria-label="rows per page"
                style={{
                  background: t.surface,
                  color: t.textPrimary,
                  border: `1px solid ${t.border}`,
                  borderRadius: `${t.radiusSm}px`,
                  fontSize: `${t.textXs}px`,
                  padding: '2px 4px',
                }}
              >
                {[...new Set([10, 25, 50, 100, pageSize])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
        </nav>
      )
    }
    case 'Stepper': {
      const steps = list(p.steps, p.stepsSep)
      const cur = num(p.current, 1)
      const vertical = str(p.orientation) === 'vertical'
      const size = str(p.size) || 'md'
      const dot = size === 'sm' ? 20 : size === 'lg' ? 28 : 24
      const live = p.interactive !== false
      return (
        <ol
          key={key}
          style={{ ...style, margin: 0, padding: 0, listStyle: 'none', flexDirection: vertical ? 'column' : 'row', alignItems: vertical ? 'flex-start' : 'center' }}
          data-loom-steps={node.id}
          data-loom-current={String(cur)}
          aria-label={str(p.ariaLabel) || undefined}
        >
          {steps.map((st, i) => {
            const n = i + 1
            const state = n < cur ? 'done' : n === cur ? 'now' : 'todo'
            return (
              <li
                key={st}
                {...(live ? behaviourAttrs({ role: 'step', group: node.id, index: i }) : {})}
                data-loom-state={state}
                aria-current={state === 'now' ? 'step' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: vertical ? 'column' : 'row', alignSelf: vertical ? 'stretch' : undefined }}
              >
                <span
                  style={{
                    width: `${dot}px`,
                    height: `${dot}px`,
                    borderRadius: '999px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    fontSize: `${t.textXs}px`,
                    fontWeight: t.weightBold,
                    background: state === 'todo' ? t.bg : t.accent,
                    color: state === 'todo' ? t.textMuted : t.textOnAccent,
                    border: `1px solid ${state === 'todo' ? t.borderStrong : t.accent}`,
                  }}
                >
                  {state === 'done' ? '✓' : p.showNumbers === false ? '' : n}
                </span>
                <span style={{ fontSize: `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`, color: state === 'todo' ? t.textMuted : t.textPrimary, fontWeight: state === 'now' ? t.weightSemibold : t.weightNormal, textAlign: vertical ? 'left' : 'center' }}>
                  {st}
                </span>
                {i < steps.length - 1 ? (
                  <span aria-hidden="true" style={{ ...(vertical ? { width: '1px', height: '20px' } : { width: `${dot}px`, height: '1px' }), background: t.borderStrong, flexShrink: 0 }} />
                ) : null}
              </li>
            )
          })}
        </ol>
      )
    }
    case 'Menu':
      return <div key={key} style={style} role="menu" aria-label={str(p.ariaLabel) || undefined}>{children}</div>
    case 'MenuItem': {
      const off = p.disabled === true
      return (
        <div
          key={key}
          style={style}
          role="menuitem"
          aria-disabled={off ? 'true' : undefined}
          tabIndex={off ? -1 : 0}
          aria-label={str(p.ariaLabel) || undefined}
          {...(off ? {} : behaviourAttrs({ role: 'press' }))}
        >
          <IconGlyph value={str(p.icon)} size={16} />
          <span style={{ flex: 1, minWidth: 0 }}>{str(p.label)}</span>
          {/* The chord on the right: it tells you the shortcut before you press
              it, which is the only reason to look at a menu row. */}
          {str(p.shortcut) ? <span style={{ marginLeft: 'auto', fontSize: `${t.textXs}px`, color: t.textMuted, fontFamily: t.fontMono }}>{str(p.shortcut)}</span> : null}
        </div>
      )
    }
    case 'CommandBar':
      return <div key={key} style={style} role="toolbar" aria-label={str(p.ariaLabel) || undefined}>{children}</div>
    case 'TabBar': {
      const tabs = list(p.tabs, p.tabsSep)
      const active = num(p.active, 0)
      const size = str(p.size) || 'md'
      const underlined = str(p.variant) === 'underline'
      return (
        <div key={key} style={style} role="tablist" aria-label={str(p.ariaLabel) || undefined} data-loom-tabs={node.id} data-loom-active={String(active)}>
          {tabs.map((tb, i) => (
            <button
              key={tb}
              type="button"
              role="tab"
              aria-selected={i === active}
              {...behaviourAttrs({ role: 'tab', group: node.id, index: i, active: i === active })}
              style={{
                border: underlined ? 'none' : 'none',
                cursor: 'pointer',
                fontSize: `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`,
                fontWeight: i === active ? t.weightSemibold : t.weightMedium,
                padding: underlined
                  ? `${t.space2}px ${t.space3}px`
                  : size === 'sm' ? '4px 10px' : size === 'lg' ? '8px 18px' : '6px 14px',
                flex: p.stretch === true ? 1 : undefined,
                borderRadius: underlined ? '0' : `${t.radiusSm}px`,
                borderBottom: underlined && i === active ? `2px solid ${t.accent}` : underlined ? '2px solid transparent' : 'none',
                background: underlined ? 'transparent' : i === active ? t.surface : 'transparent',
                color: i === active ? t.textPrimary : t.textMuted,
                boxShadow: !underlined && i === active ? t.shadowSm : 'none',
              }}
            >
              {tb}
            </button>
          ))}
        </div>
      )
    }
    case 'AnchorList': {
      const links = list(p.links, p.linksSep)
      const size = str(p.size) || 'md'
      const bar = str(p.marker) !== 'none'
      const indent = num(p.indent, 10)
      return (
        <div key={key} style={style}>
          {links.map((l) => {
            const on = str(p.active) === l
            return (
              <a
                key={l}
                href={`#${l.toLowerCase()}`}
                aria-current={on ? 'true' : undefined}
                style={{
                  display: 'block',
                  fontSize: `${size === 'sm' ? t.textXs : size === 'lg' ? t.textMd : t.textSm}px`,
                  color: on ? t.accent : t.textMuted,
                  fontWeight: on ? t.weightSemibold : t.weightNormal,
                  borderLeft: bar ? `2px solid ${on ? t.accent : 'transparent'}` : undefined,
                  paddingLeft: `${indent + 2}px`,
                  paddingTop: '2px',
                  paddingBottom: '2px',
                  textDecoration: 'none',
                }}
              >
                {l}
              </a>
            )
          })}
        </div>
      )
    }
    case 'BackButton': {
      const label = str(p.label)
      const icon = <IconGlyph value={str(p.icon) || 'arrow-left'} size={14} />
      const off = p.disabled === true
      return (
        <button
          key={key}
          type="button"
          style={style}
          disabled={off}
          aria-disabled={off ? 'true' : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          {...(off ? {} : behaviourAttrs({ role: 'press' }))}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: `${t.space2}px` }}>
            {str(p.iconPosition) === 'end' ? <span>{label}</span> : icon}
            {str(p.iconPosition) === 'end' ? icon : <span>{label}</span>}
          </span>
        </button>
      )
    }
    /* ---- catalog2 feedback ---- */
    case 'Alert': {
      const tone = toneColor(t, str(p.tone))
      const solid = str(p.variant) === 'solid'
      const size = str(p.size) || 'md'
      // On a solid fill the title has to sit on the fill's own text colour, or
      // "success green with black text" is what ships.
      const ink = solid ? t.textOnAccent : t.textPrimary
      const bodyInk = solid ? t.textOnAccent : t.textSecondary
      return (
        <div key={key} style={style} role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {str(p.icon) ? (
              <IconGlyph value={str(p.icon)} size={size === 'sm' ? 14 : 16} color={solid ? t.textOnAccent : tone} />
            ) : (
              <span aria-hidden="true" style={{ width: '8px', height: '8px', borderRadius: '999px', background: solid ? t.textOnAccent : tone, flexShrink: 0 }} />
            )}
            <strong style={{ fontSize: size === 'sm' ? `${t.textXs}px` : `${t.textSm}px`, color: ink }}>{str(p.title)}</strong>
            {p.dismissible === true ? (
              <button type="button" aria-label="dismiss" style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: bodyInk, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
            ) : null}
          </div>
          <div style={{ fontSize: size === 'sm' ? `${t.textXs}px` : `${t.textSm}px`, color: bodyInk }}>{str(p.body)}</div>
          {/* The ONE action an alert may offer. Three of them is a dialog. */}
          {str(p.actionLabel) ? (
            <button
              type="button"
              style={{
                alignSelf: 'flex-start',
                marginTop: `${t.space1}px`,
                padding: '4px 10px',
                borderRadius: `${t.radiusSm}px`,
                border: `1px solid ${solid ? t.textOnAccent : tone}66`,
                background: solid ? 'transparent' : `${tone}14`,
                color: solid ? t.textOnAccent : tone,
                fontSize: `${t.textXs}px`,
                cursor: 'pointer',
              }}
            >
              {str(p.actionLabel)}
            </button>
          ) : null}
        </div>
      )
    }
    case 'Toast': {
      const toneName = str(p.tone) || 'success'
      const tone = toneColor(t, toneName)
      const size = str(p.size) || 'md'
      // Auto-dismiss is a TIMER, not a style, so what the renderer owes is the
      // authored duration in a form the delegated runtime can read. The runtime
      // hides the toast when it runs out and the stylesheet does the fade; a
      // toast that says "saved" and stays for a minute is a lie about time.
      const seconds = num(p.duration, 4)
      return (
        <div
          key={key}
          style={style}
          role="status"
          data-loom-toast=""
          data-loom-duration={seconds > 0 ? String(seconds) : undefined}
        >
          {feedbackIcon(p, toneName, size === 'sm' ? 14 : 16, tone)}
          <span style={{ flex: 1, minWidth: 0 }}>{str(p.message)}</span>
          {p.dismissible === true ? (
            <button type="button" data-loom-dismiss="" aria-label="dismiss" style={{ background: 'transparent', border: 'none', color: t.textMuted, cursor: 'pointer', padding: 0, lineHeight: 1 }}>×</button>
          ) : null}
        </div>
      )
    }
    case 'Spinner': {
      const size = num(p.size, 24) || 24
      return (
        <div key={key} style={style} role="status" aria-label={str(p.ariaLabel) || (str(p.label) ? undefined : 'Loading')}>
          <span aria-hidden="true" style={{ width: `${size}px`, height: `${size}px`, borderRadius: '999px', border: `${num(p.thickness, 2)}px solid ${t.borderStrong}`, borderTopColor: str(p.accent) || t.accent, display: 'inline-block', flexShrink: 0 }} />
          {p.showLabel !== false && str(p.label) ? <span>{str(p.label)}</span> : null}
        </div>
      )
    }
    case 'LoadingBar': {
      const v = num(p.progress, 40)
      const radius = num(p.radius, -1) >= 0 ? `${num(p.radius)}px` : '999px'
      // An indeterminate bar does not report a position, because it has none:
      // the fill slides across the track forever and the width it happens to
      // have while sliding is a lie, not a reading. The motion itself is the
      // keyframe rule in the behaviour stylesheet, driven from this attribute.
      const unknown = p.indeterminate === true
      return (
        <div key={key} style={style}>
          {str(p.label) ? <span>{str(p.label)}</span> : null}
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={unknown ? undefined : Math.max(0, Math.min(100, Math.round(v)))}
            aria-label={str(p.label) || (unknown ? 'loading' : `${Math.round(v)}% loaded`)}
            style={{ height: `${num(p.height, 6)}px`, borderRadius: radius, background: str(p.trackColor) || t.border, overflow: 'hidden' }}
          >
            <div
              data-loom-indeterminate={unknown ? '1' : undefined}
              style={{
                width: unknown ? '40%' : `${Math.max(0, Math.min(100, v))}%`,
                height: '100%',
                borderRadius: radius,
                background: toneColor(t, str(p.tone)),
              }}
            />
          </div>
        </div>
      )
    }
    case 'ProgressDots': {
      const steps = num(p.steps, 4) || 4
      const cur = num(p.current, 1)
      const size = str(p.size) || 'md'
      const dot = size === 'sm' ? 6 : size === 'lg' ? 11 : 8
      const live = p.interactive !== false
      return (
        <div key={key} style={style} aria-label={str(p.ariaLabel) || `${cur} of ${steps}`} data-loom-dots={node.id} data-loom-current={String(cur)}>
          {Array.from({ length: steps }, (_, i) => (
            <span
              key={i}
              {...(live ? behaviourAttrs({ role: 'dot', group: node.id, index: i + 1 }) : {})}
              data-loom-lit={i < cur ? '1' : '0'}
              style={{ width: `${dot}px`, height: `${dot}px`, borderRadius: '999px', background: i < cur ? toneColor(t, str(p.tone)) : t.borderStrong, cursor: live ? 'pointer' : 'default', flexShrink: 0 }}
            />
          ))}
        </div>
      )
    }
    case 'InlineMessage': {
      const tone = toneColor(t, str(p.tone))
      return (
        <div key={key} style={style} role="status">
          {p.showIcon !== false && str(p.icon) ? <IconGlyph value={str(p.icon)} size={14} color={tone} /> : null}
          <span style={{ minWidth: 0 }}>{str(p.text)}</span>
        </div>
      )
    }
    case 'ErrorSummary': {
      const all = list(p.items, p.itemsSep)
      const cap = num(p.maxItems, 0)
      const items = cap > 0 ? all.slice(0, cap) : all
      const rest = all.length - items.length
      const solid = str(p.variant) === 'solid'
      const tone = toneColor(t, str(p.tone) || 'danger')
      const ink = solid ? t.textOnAccent : t.textPrimary
      const List = p.ordered === true ? 'ol' : 'ul'
      return (
        <div key={key} style={style} role="alert">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {p.showIcon !== false && str(p.icon) ? <IconGlyph value={str(p.icon)} size={16} color={solid ? t.textOnAccent : tone} /> : null}
            <strong style={{ fontSize: `${t.textSm}px`, color: ink }}>{str(p.title)}</strong>
          </div>
          <List style={{ margin: 0, paddingLeft: '18px', fontSize: `${t.textSm}px`, color: ink }}>
            {items.map((it) => <li key={it}>{it}</li>)}
          </List>
          {/* A summary that scrolls off the screen stops being a summary, so
              what was left out is said out loud. */}
          {rest > 0 ? <span style={{ fontSize: `${t.textXs}px`, color: solid ? t.textOnAccent : t.textMuted }}>{`+${rest} more`}</span> : null}
        </div>
      )
    }
    case 'SuccessCheck': {
      const size = num(p.size, 40) || 40
      const tone = toneColor(t, str(p.tone) || 'success')
      return (
        <div key={key} style={style}>
          <span style={{ width: `${size}px`, height: `${size}px`, borderRadius: '999px', background: `${tone}1a`, border: `1px solid ${tone}66`, color: tone, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: `${Math.round(size * 0.5)}px`, fontWeight: t.weightBold, flexShrink: 0 }}>
            <IconGlyph value={str(p.icon) || '✓'} size={Math.round(size * 0.5)} color={tone} />
          </span>
          {p.showLabel !== false && str(p.label) ? <span style={{ fontWeight: t.weightSemibold, color: t.textPrimary }}>{str(p.label)}</span> : null}
        </div>
      )
    }
    case 'WarningCallout':
    case 'InfoCallout': {
      // The tone is the component's identity, read from its TYPE: a `tone`
      // property here would be one click away from turning a warning into a
      // tip. `accent` is how you recolour it without changing what it means.
      const toneName = calloutTone(node.type)
      const tone = toneColor(t, toneName)
      const accent = str(p.accent) || tone
      const solid = str(p.variant) === 'solid'
      const ink = solid ? t.textOnAccent : t.textPrimary
      return (
        <div key={key} style={style}>
          {feedbackIcon(p, toneName, 16, solid ? t.textOnAccent : accent)}
          <strong style={{ fontSize: `${t.textSm}px`, color: ink }}>{str(p.title)}</strong>
          <div style={{ fontSize: `${t.textSm}px`, color: solid ? t.textOnAccent : t.textSecondary }}>{str(p.body)}</div>
          {str(p.actionLabel) ? (
            <button
              type="button"
              style={{
                alignSelf: 'flex-start',
                marginTop: `${t.space1}px`,
                padding: '4px 10px',
                borderRadius: `${t.radiusSm}px`,
                border: `1px solid ${solid ? t.textOnAccent : accent}66`,
                background: solid ? 'transparent' : `${accent}14`,
                color: solid ? t.textOnAccent : accent,
                fontSize: `${t.textXs}px`,
                cursor: 'pointer',
              }}
            >
              {str(p.actionLabel)}
            </button>
          ) : null}
        </div>
      )
    }
    case 'ConfirmDialog': {
      // `danger` is the default because a confirm dialog with a neutral confirm
      // button is how people delete the wrong thing.
      const toneName = str(p.tone) || 'danger'
      const tone = toneColor(t, toneName)
      const size = str(p.size) || 'md'
      const align = str(p.buttonAlign) || 'end'
      return (
        <div key={key} style={style} role="alertdialog" aria-label={str(p.title)}>
          {feedbackIcon(p, toneName, 20, tone)}
          <div style={{ fontSize: size === 'sm' ? `${t.textLg}px` : `${t.textXl}px`, fontWeight: t.weightBold, color: t.textPrimary, lineHeight: 1.2 }}>{str(p.title)}</div>
          <div style={{ fontSize: `${t.textSm}px`, color: t.textSecondary }}>{str(p.message)}</div>
          {children}
          {p.showFooter !== false ? (
            <div style={{ display: 'flex', gap: `${t.space2}px`, justifyContent: align === 'start' ? 'flex-start' : align === 'center' ? 'center' : 'flex-end' }}>
              <button type="button" style={{ padding: `7px 14px`, borderRadius: `${t.radiusMd}px`, border: `1px solid ${t.borderStrong}`, background: 'transparent', color: t.textSecondary, cursor: 'pointer', fontSize: `${t.textSm}px` }}>{str(p.cancelLabel)}</button>
              <button type="button" style={{ padding: `7px 14px`, borderRadius: `${t.radiusMd}px`, border: 'none', background: tone, color: t.textOnAccent, cursor: 'pointer', fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold }}>{str(p.confirmLabel)}</button>
            </div>
          ) : null}
        </div>
      )
    }
    case 'NotificationList':
      return (
        <div
          key={key}
          style={style}
          role={str(p.ariaLabel) ? 'region' : undefined}
          aria-label={str(p.ariaLabel) || undefined}
        >
          {children}
          {/* A notification centre with nothing in it and no explanation is the
              most common dead end in a product. */}
          {children.length === 0 && str(p.emptyHint) ? (
            <div style={{ padding: `${t.space4}px`, textAlign: 'center', color: t.textMuted, fontSize: `${t.textSm}px`, border: `1px dashed ${t.border}`, borderRadius: `${t.radiusMd}px` }}>
              {str(p.emptyHint)}
            </div>
          ) : null}
        </div>
      )
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
    case 'Button': {
      const icon = str(p.icon) ? <IconGlyph value={str(p.icon)} size={str(p.size) === 'sm' ? 12 : 14} /> : null
      const rawType = str(p.type)
      return (
        <button
          type={rawType === 'submit' ? 'submit' : rawType === 'reset' ? 'reset' : 'button'}
          tabIndex={-1}
          disabled={p.disabled === true || p.loading === true}
          aria-busy={p.loading === true ? 'true' : undefined}
        >
          {icon ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {str(p.iconPosition) === 'end' ? str(p.label) : icon}
              {str(p.iconPosition) === 'end' ? icon : str(p.label)}
            </span>
          ) : (
            str(p.label)
          )}
        </button>
      )
    }
    case 'Label':
      return <div>{str(node.props.text)}</div>
    case 'Input': {
      const rawType = str(p.type)
      const type = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(rawType) ? rawType : 'text'
      const maxLength = num(p.maxLength, -1)
      return (
        <input
          type={type}
          tabIndex={-1}
          readOnly={p.readOnly === true}
          disabled={p.disabled === true}
          required={p.required === true}
          name={str(p.name) || undefined}
          maxLength={maxLength > 0 ? maxLength : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          placeholder={str(node.props.placeholder)}
          defaultValue={str(node.props.value)}
        />
      )
    }
    case 'Gauge':
      return <GaugeFace node={node} t={t} />
    case 'Sparkline':
      return <Spark node={node} t={t} />
    case 'Heading': {
      // The level IS the type, so the canvas shows it: a selected heading that
      // changes size only in the preview is a heading the designer cannot edit
      // by looking at it.
      const level = str(p.level) || '1'
      const size = level === '1' ? t.textXxl : level === '2' ? t.textXl : t.textLg
      const fs = num(p.fontSize, -1)
      return (
        <div style={{ fontSize: fs > 0 ? `${fs}px` : `${size}px`, fontWeight: level === '1' ? t.weightBold : t.weightSemibold }}>
          {str(p.text)}
        </div>
      )
    }
    case 'IconButton':
      return <button type="button" tabIndex={-1} disabled={p.disabled === true}><IconGlyph value={str(p.icon)} size={str(p.size) === 'sm' ? 14 : str(p.size) === 'lg' ? 20 : 16} /></button>
    case 'Checkbox':
      return <label><input type="checkbox" tabIndex={-1} checked={p.checked === true} disabled={p.disabled === true} readOnly /> {str(p.label)}</label>
    case 'Radio':
      return <label><input type="radio" tabIndex={-1} checked={p.checked === true} disabled={p.disabled === true} readOnly /> {str(p.label)}</label>
    case 'Switch':
      return <span>{str(p.label)} {p.on === true ? '●' : '○'}</span>
    case 'Slider':
      return <input type="range" tabIndex={-1} defaultValue={num(p.value, 50)} min={num(p.min, 0)} max={num(p.max, 100)} step={num(p.step, 1) || 1} disabled={p.disabled === true} readOnly />
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
      return <span>{str(p.value) || list(p.options, p.optionsSep)[0] || ''}</span>
    case 'SpinBox':
      return <span>{num(p.value, 1)}</span>
    case 'TagInput':
      return <span>{str(p.value)}</span>
    case 'OtpInput':
      return <span>{'•'.repeat(num(p.length, 6) || 6)}</span>
    case 'FileUpload':
      return <span>{str(p.label)}</span>
    case 'Field': {
      // The field's own type scale, so `size` is something the designer can see
      // while authoring rather than only in the preview.
      const scales: Record<string, number> = { sm: t.textXs, md: t.textSm, lg: t.textMd }
      return <span style={{ fontSize: `${scales[str(p.size)] ?? t.textSm}px` }}>{str(p.label)}</span>
    }
    case 'AppShell':
      return <span>shell</span>
    case 'Icon':
      // The canvas draws the icon at the size it will ship at: a 32px icon
      // shown as 16px is a property panel lying to the person reading it.
      return <IconGlyph value={str(p.name)} size={num(p.size, 20) || 20} color={str(p.color) || iconTone(p.tone, t)} />
    case 'CommandPalette':
      return <span>⌘K</span>
    case 'SettingsSection':
      return <span>{str(p.title)}</span>
    case 'SettingsRow':
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
      return <span>{list(p.items, p.itemsSep).join(' • ')}</span>
    case 'NumberedList':
      return <span>{list(p.items, p.itemsSep).join(', ')}</span>
    case 'Divider':
      return <hr />
    case 'Badge':
      return <span>{str(p.text)}</span>
    case 'Tag':
      return <span>{str(p.text)}</span>
    case 'Kbd':
      return <kbd>{str(p.keys)}</kbd>
    case 'DataGrid':
      return <span>{list(p.columns, p.columnsSep).join(' · ')}</span>
    case 'Stat':
      return <span>{str(p.value)} {str(p.label)}</span>
    case 'KpiCard':
      return <span>{str(p.value)}</span>
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
      return <span>{list(p.items, p.itemsSep).join(', ')}</span>
    case 'DataList':
      return <span>{list(p.items, p.itemsSep).join(', ')}</span>
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
      return <span>{list(p.trail, p.trailSep).join(' / ')}</span>
    case 'Pagination':
      return <span>{num(p.page, 1)} / {num(p.total, 12)}</span>
    case 'Stepper':
      return <span>{list(p.steps, p.stepsSep).join(' → ')}</span>
    case 'MenuItem':
      return <span>{str(p.label)}</span>
    case 'TabBar':
      return <span>{list(p.tabs, p.tabsSep).join(' · ')}</span>
    case 'AnchorList':
      return <span>{list(p.links, p.linksSep).join(', ')}</span>
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
    return renderPreviewNode(node, flowChild, children, key, t, ctx)
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
    ...(ctx.forceState?.id === id ? { [FORCE_ATTR]: ctx.forceState.state } : {}),
    style: authored,
    onPointerDown: (e: React.PointerEvent) => ctx.onPointerDownNode?.(id, e),
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
      ctx.onContextMenuNode?.(id, e)
    },
  }

  if (ctx.selected.has(id)) {
    // Handles are editor chrome, not output: they are injected only while
    // authoring and never appear in an exported document. The root gets them
    // too: the user placed it, so it is sized and moved like any other node.
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
    case 'Button': {
      const p = node.props
      const icon = str(p.icon) ? <IconGlyph value={str(p.icon)} size={str(p.size) === 'sm' ? 12 : str(p.size) === 'lg' ? 16 : 14} /> : null
      const label = <span style={{ opacity: p.loading === true ? 0.55 : 1 }}>{str(p.label)}</span>
      const rawType = str(p.type)
      return (
        <button
          key={key}
          type={rawType === 'submit' ? 'submit' : rawType === 'reset' ? 'reset' : 'button'}
          {...common}
          disabled={p.disabled === true || p.loading === true}
          aria-busy={p.loading === true ? 'true' : undefined}
        >
          {icon ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              {str(p.iconPosition) === 'end' ? label : icon}
              {str(p.iconPosition) === 'end' ? icon : label}
            </span>
          ) : (
            label
          )}
        </button>
      )
    }
    case 'Label':
      return (
        <div key={key} {...common}>
          {str(node.props.text)}
        </div>
      )
    case 'Input': {
      const p = node.props
      const rawType = str(p.type)
      const type = ['text', 'email', 'password', 'search', 'tel', 'url', 'number'].includes(rawType) ? rawType : 'text'
      return (
        <input
          key={key}
          {...common}
          type={type}
          placeholder={str(node.props.placeholder)}
          defaultValue={str(node.props.value)}
          disabled={p.disabled === true}
          readOnly={p.readOnly === true}
          required={p.required === true}
          name={str(p.name) || undefined}
          maxLength={num(p.maxLength, -1) > 0 ? num(p.maxLength) : undefined}
          aria-label={str(p.ariaLabel) || undefined}
          onChange={() => {
            /* designer mode: value binding is not live yet */
          }}
        />
      )
    }
    case 'Heading': {
      const p = node.props
      const level = str(p.level) || '1'
      const size = level === '1' ? t.textXxl : level === '2' ? t.textXl : t.textLg
      // Same rule as the preview: the level sets the type, and a declared
      // override wins where it is set — otherwise the canvas and the output
      // would disagree about the very same node.
      const fs = num(p.fontSize, -1)
      return (
        <div key={key} {...common} style={{ ...(common.style as React.CSSProperties), fontSize: fs > 0 ? `${fs}px` : `${size}px`, fontWeight: level === '1' ? t.weightBold : t.weightSemibold, color: str(p.color) || t.textPrimary, textAlign: (str(p.align) || 'left') as React.CSSProperties['textAlign'] }}>
          {str(p.text)}
        </div>
      )
    }
    case 'Field': {
      const scales: Record<string, number> = { sm: t.textXs, md: t.textSm, lg: t.textMd }
      return (
        <div key={key} {...common}>
          <span style={{ fontSize: `${scales[str(node.props.size)] ?? t.textSm}px` }}>{str(node.props.label)}</span>
        </div>
      )
    }
    case 'AppShell':
      return <div key={key} {...common}><span>shell</span></div>
    case 'Icon':
      return <div key={key} {...common}><IconGlyph value={str(node.props.name)} size={num(node.props.size, 20) || 20} color={str(node.props.color) || iconTone(node.props.tone, t)} /></div>
    case 'CommandPalette':
      return <div key={key} {...common}><span>⌘K</span></div>
    case 'SettingsSection':
      return <div key={key} {...common}><span>{str(node.props.title)}</span></div>
    case 'SettingsRow':
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
      return (
        <button key={key} type="button" {...common} disabled={node.props.disabled === true} aria-label={str(node.props.ariaLabel) || str(node.props.icon) || 'icon'}>
          <IconGlyph value={str(node.props.icon)} size={str(node.props.size) === 'sm' ? 14 : str(node.props.size) === 'lg' ? 20 : 16} />
        </button>
      )
    case 'Checkbox':
      return <label key={key} {...common}><input type="checkbox" tabIndex={-1} checked={node.props.checked === true} disabled={node.props.disabled === true} readOnly /> {str(node.props.label)}</label>
    case 'Radio':
      return <label key={key} {...common}><input type="radio" tabIndex={-1} checked={node.props.checked === true} disabled={node.props.disabled === true} readOnly /> {str(node.props.label)}</label>
    case 'Switch':
      return <div key={key} {...common}><span>{str(node.props.label)}</span></div>
    case 'Slider':
      return <input key={key} {...common} type="range" min={num(node.props.min, 0)} max={num(node.props.max, 100)} step={num(node.props.step, 1) || 1} defaultValue={num(node.props.value, 50)} disabled={node.props.disabled === true} />
    case 'Select':
      return <select key={key} {...common} defaultValue={str(node.props.value)} disabled={node.props.disabled === true}>{list(node.props.options, node.props.optionsSep).map((o) => <option key={o} value={o}>{o}</option>)}</select>
    case 'ComboBox':
      return <input key={key} {...common} defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} disabled={node.props.disabled === true} />
    case 'TextArea':
      return <textarea key={key} {...common} rows={num(node.props.rows, 4) || 4} defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} disabled={node.props.disabled === true} />
    case 'SearchBox':
      return <input key={key} {...common} type="search" defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} disabled={node.props.disabled === true} />
    case 'NumberInput':
      return <input key={key} {...common} type="number" defaultValue={num(node.props.value, 0)} disabled={node.props.disabled === true} />
    case 'PasswordInput':
      return <input key={key} {...common} type={node.props.reveal === true ? 'text' : 'password'} defaultValue={str(node.props.value)} placeholder={str(node.props.placeholder)} disabled={node.props.disabled === true} />
    case 'DatePicker':
      return <input key={key} {...common} type="date" defaultValue={str(node.props.value)} disabled={node.props.disabled === true} />
    case 'TimePicker':
      return <input key={key} {...common} type="time" defaultValue={str(node.props.value)} disabled={node.props.disabled === true} />
    case 'ColorInput':
      return <input key={key} {...common} type="color" value={/^#[0-9a-fA-F]{6}$/.test(str(node.props.value)) ? str(node.props.value) : t.accent} />
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
      return <ul key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{list(node.props.items, node.props.itemsSep).map((it) => <li key={it}>{it}</li>)}</ul>
    case 'NumberedList':
      return <ol key={key} {...common} style={{ ...(common.style as React.CSSProperties), margin: 0 }}>{list(node.props.items, node.props.itemsSep).map((it) => <li key={it}>{it}</li>)}</ol>
    case 'Divider': {
      // The canvas draws the labelled divider too: an editor that renders a
      // bare rule while the output renders a heading is an editor that cannot
      // be used to check the output.
      if (node.children.length === 0) return <hr key={key} {...common} />
      return <LabelledDivider key={key} p={node.props} t={t} style={common.style as React.CSSProperties} middle={children} />
    }
    case 'Badge':
      return <span key={key} {...common}>{str(node.props.text)}</span>
    case 'Tag':
      return <span key={key} {...common}>{str(node.props.text)}</span>
    case 'Kbd':
      return <kbd key={key} {...common}>{str(node.props.keys)}</kbd>
    case 'DataGrid':
      return <div key={key} {...common}>{list(node.props.columns, node.props.columnsSep).join(' · ')}</div>
    case 'Stat':
      return <div key={key} {...common}>{str(node.props.value)} {str(node.props.label)}</div>
    case 'KpiCard':
      return <div key={key} {...common}>{str(node.props.value)}</div>
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
      return <div key={key} {...common}>{list(node.props.items, node.props.itemsSep).join(', ')}</div>
    case 'DataList':
      return <div key={key} {...common}>{list(node.props.items, node.props.itemsSep).join(', ')}</div>
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
      return <div key={key} {...common}>{list(node.props.trail, node.props.trailSep).join(' / ')}</div>
    case 'Pagination':
      return <div key={key} {...common}>{num(node.props.page, 1)} / {num(node.props.total, 12)}</div>
    case 'Stepper':
      return <div key={key} {...common}>{list(node.props.steps, node.props.stepsSep).join(' → ')}</div>
    case 'MenuItem':
      return <div key={key} {...common}>{str(node.props.label)}</div>
    case 'TabBar':
      return <div key={key} {...common}>{list(node.props.tabs, node.props.tabsSep).join(' · ')}</div>
    case 'AnchorList':
      return <div key={key} {...common}>{list(node.props.links, node.props.linksSep).join(', ')}</div>
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
/** Map an icon's tone property onto a theme colour. */
function iconTone(tone: PropValue | undefined, t: Theme): string | undefined {
  switch (str(tone)) {
    case 'accent':
      return t.accent
    case 'muted':
      return t.textMuted
    case 'success':
      return t.success
    case 'warning':
      return t.warning
    case 'danger':
      return t.danger
    default:
      return undefined
  }
}

/**
 * ONE way to draw an icon, for every control in the toolbox.
 *
 * A value that names an icon in the set renders as that icon; anything else is
 * drawn as the literal glyph it is. That keeps every existing icon string
 * working while giving the whole toolbox a single, consistent family the moment
 * a name is used — which is the only way "never mix icon styles" is achievable
 * when the icon is a property rather than a drawn asset.
 */
function IconGlyph({
  value,
  size = 16,
  color,
  title,
}: {
  value: string
  size?: number
  color?: string
  title?: string
}) {
  const resolved = resolveIcon(value)
  if (resolved.kind === 'icon') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color ?? 'currentColor'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        role={title ? 'img' : 'presentation'}
        aria-label={title}
        aria-hidden={title ? undefined : 'true'}
        style={{ display: 'block', flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: iconMarkup(resolved.name) ?? '' }}
      />
    )
  }
  return (
    <span aria-hidden={title ? undefined : 'true'} aria-label={title} style={{ fontSize: `${size}px`, lineHeight: 1, color }}>
      {resolved.glyph}
    </span>
  )
}

/**
 * A sparkline, as a pure component.
 *
 * Extracted from the `Sparkline` NODE so that anything needing a trend line
 * draws it the same way — a KPI card and a standalone sparkline must not be two
 * different charts that happen to look similar.
 */
function Sparkline({
  points,
  width,
  height,
  accent,
  id,
  animate,
}: {
  points: number[]
  width: number
  height: number
  accent: string
  id: string
  /** Draw the trace in. Off by default: only a Sparkline node has the choice. */
  animate?: boolean
}) {
  if (points.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...points)
  const max = Math.max(...points)
  const span = max - min || 1
  const step = width / (points.length - 1)
  const pad = 4
  const usable = height - pad * 2
  const xy = points.map((v, i) => [i * step, pad + usable - ((v - min) / span) * usable] as const)
  const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const [lx, ly] = xy[xy.length - 1]
  const uid = `s-${id}`
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="trend"
      data-loom-spark={animate === true ? 'animate' : undefined}
    >
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* `pathLength=1` is what makes the draw-in measurable without measuring
          anything: the dash pattern is then one path long by definition, so the
          keyframes can run 1 -> 0 whatever the real length is. */}
      <path d={area} data-loom-spark-area="" fill={`url(#${uid})`} />
      <path d={line} data-loom-spark-line="" pathLength={1} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle data-loom-spark-head="" cx={lx} cy={ly} r="3" fill={accent} />
    </svg>
  )
}

/** The `Sparkline` node, delegating to the shared component. */
function Spark({ node, t }: { node: Node; t: Theme }) {
  return (
    <Sparkline
      points={numericList(node.props.points, node.props.pointsSep)}
      width={Number(node.props.width) || 220}
      height={Number(node.props.height) || 60}
      accent={str(node.props.accent) || t.accent}
      id={node.id}
      animate={node.props.animate !== false}
    />
  )
}

/**
 * A colour at an opacity.
 *
 * Charts used to write `${accent}66`, which is only an alpha channel when the
 * colour happens to be six-digit hex — a named colour or an `rgb()` string
 * makes the whole declaration invalid and the mark disappears, which is worse
 * than the transparency the author asked for. This does the same job properly
 * and degrades to the colour itself when there is nothing to parse.
 */
function fade(colour: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour.trim())
  const a = Math.max(0, Math.min(1, alpha))
  if (!hex) return colour
  const full = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
  const r = parseInt(full.slice(0, 2), 16)
  const g = parseInt(full.slice(2, 4), 16)
  const b = parseInt(full.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`
}
