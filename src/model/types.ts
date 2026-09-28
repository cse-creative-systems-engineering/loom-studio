/**
 * Loom document model.
 *
 * The document is a RENDERER-NEUTRAL semantic scene tree. It is deliberately
 * not HTML: Loom targets both web (Chromium/CSS) and desktop (native widget
 * trees), and those two share no rendering primitives. A document that
 * encoded HTML could never produce a native widget tree.
 *
 * Every mutation goes through a named Operation (see ops.ts). That matters for
 * two reasons: undo is exact, and the future AI assistant drives the SAME
 * operation set rather than emitting markup.
 */

import type { EffectValues } from '../render/effects'

export type NodeId = string

export type PropValue = string | number | boolean | null

export interface Node {
  id: NodeId
  /** Component name; must exist in the component registry. */
  type: string
  props: Record<string, PropValue>
  children: NodeId[]
  /** Container children flow (flex) instead of being free-positioned. */
  flow: boolean
  /**
   * Hidden in preview/export output. Authoring still shows the node
   * (ghosted) so hidden work can never be lost behind an invisible state.
   */
  visible: boolean
  /**
   * Locked against canvas drag/resize/delete. Selectable and inspectable
   * so it can always be unlocked again — a lock you cannot see past would
   * be a trap, not a feature.
   */
  locked: boolean
  /**
   * Element opacity, 0 (invisible but present) to 1 (solid). A node-level
   * field rather than 111 schema props: every component gets transparency
   * uniformly, including future ones. Clamped on write.
   */
  opacity: number
  /**
   * Atmosphere layer (grain / glass / aurora / spotlight / shimmer / glow /
   * tilt / chromatic). Typed rather than `Record<string, unknown>` because the
   * inspector generates its controls from this declaration; optional so older
   * files and fixtures load without it.
   */
  effects?: EffectValues
  /**
   * Explicit z-order; higher paints later. Optional on purpose: fixtures,
   * older files, and hand-written documents may omit it, and `cloneNode`
   * normalises it to 0 on the way in rather than making every construction
   * site carry it.
   */
  z?: number
  /**
   * Per-breakpoint overrides.
   *
   * A deliberate, SMALL surface: geometry, flow, visibility and opacity only.
   * Responsive *styling* (colour, type, spacing) is a much larger surface and
   * is not here — a half-implemented one is worse than none, because a
   * designer would reasonably expect a responsive card to restyle, not just
   * move. If that changes, it changes as its own typed bag, not as `any`.
   *
   * Keys are breakpoint names ('sm' | 'md' | 'lg'); a node only carries the
   * breakpoints it actually overrides, so the common case costs nothing.
   */
  responsive?: ResponsiveOverrides
  /**
   * Interaction-state styling: how the node looks while hovered, focused or
   * pressed. Same shape and discipline as `responsive` — a small typed bag per
   * state, carried only for the states a node actually styles.
   */
  states?: InteractionStyles
  /**
   * Styling for the named inner parts of a composite (a grid's header, a KPI's
   * value). Universal props style a component's ROOT, and inner parts style
   * themselves inline, so without this a card's number could never change
   * size. Keys are the part names the component declares in the registry;
   * same discipline as `states`: a small typed bag, only for styled parts.
   */
  parts?: PartStyles
  /**
   * Item lists: the rows a component draws from data rather than from child
   * nodes (a timeline's events, a menu's commands, a nav bar's links). Keyed
   * by the list name the component declares in the registry. A list is data
   * edited in the component's own panel, so the parts are not separate tools a
   * person has to find, drag and stack by hand.
   */
  lists?: NodeLists
}

/** One row of an item list: field name to value, validated per field. */
export type ListItem = Record<string, string | number | boolean>

export type NodeLists = Record<string, ListItem[]>

/**
 * What a part may change. Type and box only: a part is placed by its
 * component, so nothing here moves it. Which fields a given part accepts is
 * declared by the component (a table row has no padding to give).
 */
export interface PartStyle {
  fontSize?: number
  fontWeight?: number
  color?: string
  lineHeight?: number
  letterSpacing?: number
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  align?: 'left' | 'center' | 'right'
  /** The theme's sans or mono face. */
  fontFamily?: 'sans' | 'mono'
  decoration?: 'none' | 'underline' | 'line-through'
  background?: string
  paddingX?: number
  paddingY?: number
  radius?: number
  /** Border colour. */
  border?: string
  borderWidth?: number
  /** Space between the items a part lays out. */
  gap?: number
  /** A named elevation from the theme. */
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'glow'
}

export type PartStyles = Record<string, PartStyle>

/** The interaction states a node can be styled for, in cascade order. */
export type InteractionState = 'hover' | 'focus' | 'pressed'

export const INTERACTION_STATES: readonly InteractionState[] = ['hover', 'focus', 'pressed'] as const

/**
 * What a state may change. Deliberately visual-only and SMALL: every field
 * animates, none of them moves layout (so a hover can never reflow a page), and
 * `scale`/`lift`/`brightness` work on any component without knowing its colour.
 */
export interface StateStyle {
  /** Surface colour. */
  background?: string
  /** Text colour. */
  color?: string
  /** Border colour. */
  border?: string
  shadow?: 'none' | 'sm' | 'md' | 'lg' | 'glow'
  /** 0 to 1. */
  opacity?: number
  /** 1 is natural size. */
  scale?: number
  /** Pixels upward; negative sinks. */
  lift?: number
  /** 1 is unchanged; above brightens, below darkens. */
  brightness?: number
}

export type InteractionStyles = Partial<Record<InteractionState, StateStyle>>

/** The viewport widths a document can be authored for. */
export type Breakpoint = 'sm' | 'md' | 'lg'

/** Breakpoint order, narrowest first. Drives the cascade order. */
export const BREAKPOINTS: readonly Breakpoint[] = ['sm', 'md', 'lg'] as const

/**
 * The container-width band each breakpoint covers.
 *
 * Note the direction: the BASE document is authored at desktop, and narrower
 * breakpoints override it. That is the opposite of the mobile-first default,
 * and deliberately so — a designer lays out on the canvas they can see, so the
 * canvas must be the widest case, and phones are the adaptation.
 */
export const BREAKPOINT_BAND: Record<Breakpoint, { min: number; max: number | null }> = {
  sm: { min: 0, max: 639 },
  md: { min: 640, max: 1023 },
  lg: { min: 1024, max: null },
}

export interface ResponsiveOverride {
  x?: number
  y?: number
  w?: number
  h?: number
  flow?: boolean
  visible?: boolean
  opacity?: number
}

export type ResponsiveOverrides = Partial<Record<Breakpoint, ResponsiveOverride>>

export type TargetId = 'web' | 'desktop'

export interface DocMeta {
  name: string
  /** Which targets this document is being authored for. */
  targets: TargetId[]
  /** Artboard size, in design pixels. Snapping anchors to its centre. */
  artboard?: { w: number; h: number }
  /**
   * Pixel grid for snapping; 0 disables grid snapping. Edge snapping is always
   * on and wins over the grid.
   */
  snapGrid?: number
  /**
   * Named design theme from `render/theme.ts`. Changing this ONE field
   * re-skins the whole document — the reason tokens exist.
   */
  theme?: string
  /**
   * What is behind the UI. Absent or `none` means nothing: the UI is drawn on
   * whatever it is shown over (a browser's white, a desktop behind a
   * transparent window). `theme` is the theme's page colour; `color` any
   * colour, alpha included. `blur` (px) blurs what is behind a translucent
   * page where the platform can (a window's native material).
   */
  page?: PageBackground
  created: number
}

export interface PageBackground {
  background: 'none' | 'theme' | 'color'
  color?: string
  blur?: number
}

export interface Document {
  version: 1
  meta: DocMeta
  /**
   * The workspace root, or null for a TRULY empty workspace. No panel is
   * ever auto-created: the user's first drop brings the workspace into
   * existence, and deleting the last node returns to empty. Every consumer
   * handles null — the compiler enforces it.
   */
  root: NodeId | null
  nodes: Record<NodeId, Node>
}

/* ------------------------------------------------------------------ *
 * Operations — the single mutation vocabulary.
 *
 * Each op is a discriminated union member so the future AI assistant can
 * emit one as JSON and have it validated and applied identically to a
 * human's drag.
 * ------------------------------------------------------------------ */

export type Op =
  | {
      op: 'insert'
      /**
       * Destination, or `null` when the workspace has no root yet — in which
       * case the inserted node BECOMES the root (the user's first drop).
       */
      parent: NodeId | null
      index?: number
      node: Node
      /**
       * Additional nodes that must be materialised alongside `node` (the rest
       * of a captured subtree). Present only when undoing a `remove`.
       */
      tree?: Record<NodeId, Node>
    }
  | { op: 'remove'; id: NodeId }
  | { op: 'move'; id: NodeId; x: number; y: number }
  /**
   * Set a node's intrinsic size (w/h). Distinct from `move`: a resize is a
   * different intent, and the AI assistant must be able to express it without
   * knowing which components derive size from which props.
   */
  | { op: 'resize'; id: NodeId; w: number; h: number }
  | { op: 'setProp'; id: NodeId; key: string; value: PropValue }
  /**
   * Set the whole atmosphere bag on a node.
   *
   * A distinct op rather than a `setProp` per effect field: toggling three
   * related fields is one user action and must be ONE undo step, and the
   * assistant needs to express "make this card feel like glass" atomically.
   * `patch` is merged over the existing bag so a partial update keeps the rest.
   */
  | { op: 'setEffects'; id: NodeId; patch: Record<string, unknown> }
  | { op: 'setFlow'; id: NodeId; flow: boolean }
  | { op: 'setVisible'; id: NodeId; visible: boolean }
  | { op: 'setLocked'; id: NodeId; locked: boolean }
  | { op: 'setOpacity'; id: NodeId; opacity: number }
  | { op: 'reparent'; id: NodeId; parent: NodeId; index?: number }
  /**
   * Set the workspace root. `id: null` empties the workspace. Used by the
   * user's first drop (becomes root) and by removing the last node, so
   * "empty" is a first-class, undoable state rather than a special case
   * scattered across the UI.
   */
  | { op: 'setRoot'; id: NodeId | null }
  /**
   * Write one breakpoint's overrides for a node. `null` in the patch means
   * "this key was not overridden here", which is different from an override of
   * zero and is how a node returns to the base value.
   */
  | { op: 'setResponsive'; id: NodeId; breakpoint: Breakpoint; patch: Record<string, number | boolean | null> }
  /**
   * Write one interaction state's styling for a node. `null` in the patch
   * removes that key, which is how a state returns to the base look. Values
   * are sanitised on apply: a colour string lands in a generated stylesheet,
   * so it must not be able to carry anything but a colour.
   */
  | { op: 'setStateStyle'; id: NodeId; state: InteractionState; patch: Record<string, string | number | null> }
  /**
   * Write one named part's styling for a node. `null` removes a key. Same
   * sanitising as `setStateStyle`, plus the part must be one the component
   * declares and the key one that part accepts.
   */
  | { op: 'setPartStyle'; id: NodeId; part: string; patch: Record<string, string | number | null> }
  /**
   * Replace one item list on a node. Whole-list, not per-row, so add, remove,
   * reorder and edit are all ONE op with an exact inverse (the previous list),
   * and the assistant can express "these five events" atomically. Items are
   * validated against the list's declared fields on apply.
   */
  | { op: 'setList'; id: NodeId; key: string; items: ListItem[] }
  | { op: 'rename'; name: string }
  /**
   * Set the document's design theme. `null` clears it back to the default.
   * An op rather than a direct write so a re-skin is undoable and marks the
   * document unsaved like any other edit.
   */
  | { op: 'setTheme'; theme: string | null }
  | { op: 'setPage'; page: PageBackground | null }

/** An op plus enough context to describe it in the undo history. */
export interface OpFrame {
  label: string
  forward: Op
  /** Present when the op is not its own inverse. */
  inverse?: Op
}

export interface Selection {
  ids: NodeId[]
}
