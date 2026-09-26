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
   * Atmosphere layer (grain / glass / aurora / spotlight / shimmer / glow /
   * tilt / chromatic). Declared once in `render/effects.ts`; the inspector
   * generates controls from the same declaration. Ported from Atelier's
   * effects bag, which was a better model than hard-coded CSS per component.
   */
  effects?: Record<string, unknown>
  /**
   * Explicit z-order; higher paints later. Optional on purpose: fixtures,
   * older files, and hand-written documents may omit it, and `cloneNode`
   * normalises it to 0 on the way in rather than making every construction
   * site carry it.
   */
  z?: number
}

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
  created: number
}

export interface Document {
  version: 1
  meta: DocMeta
  root: NodeId
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
      parent: NodeId
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
  | { op: 'setFlow'; id: NodeId; flow: boolean }
  | { op: 'setVisible'; id: NodeId; visible: boolean }
  | { op: 'setLocked'; id: NodeId; locked: boolean }
  | { op: 'reparent'; id: NodeId; parent: NodeId; index?: number }
  | { op: 'rename'; name: string }

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
