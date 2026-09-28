/**
 * "Run on desktop": where the design's window goes on the real screen.
 *
 * A sidebar docked left in the design is meant to be docked left on the
 * DESKTOP, not left inside a preview box. The top-level node's dock decides
 * the window: a left dock is a window the node's width wide and the usable
 * screen's full height, flush with the left edge; a corner dock a window of
 * the node's size in that corner; fill the whole usable screen; no dock the
 * node's size at its own x/y from the usable screen's origin.
 *
 * "Usable" is the display's work area: the screen minus the taskbar/panel,
 * so a docked sidebar never sits under it.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface RunTarget {
  /** The top-level node's dock (`anchor`), `none` when it has none. */
  anchor: string
  /** The node's drawn size, in design pixels. */
  w: number
  h: number
  /** The node's own position, for an undocked node. */
  x: number
  y: number
}

export function desktopBounds(t: RunTarget, work: Rect): Rect {
  const w = Math.max(1, Math.min(work.width, Math.round(t.w)))
  const h = Math.max(1, Math.min(work.height, Math.round(t.h)))
  const left = work.x
  const right = work.x + work.width - w
  const top = work.y
  const bottom = work.y + work.height - h
  switch (t.anchor) {
    case 'left':
      return { x: left, y: top, width: w, height: work.height }
    case 'right':
      return { x: work.x + work.width - w, y: top, width: w, height: work.height }
    case 'top':
      return { x: left, y: top, width: work.width, height: h }
    case 'bottom':
      return { x: left, y: work.y + work.height - h, width: work.width, height: h }
    case 'top-left':
      return { x: left, y: top, width: w, height: h }
    case 'top-right':
      return { x: right, y: top, width: w, height: h }
    case 'bottom-left':
      return { x: left, y: bottom, width: w, height: h }
    case 'bottom-right':
      return { x: right, y: bottom, width: w, height: h }
    case 'center':
      return { x: Math.round(work.x + (work.width - w) / 2), y: Math.round(work.y + (work.height - h) / 2), width: w, height: h }
    case 'fill':
      return { ...work }
    default: {
      // Not docked: its own place, kept on the screen.
      const x = Math.min(right, Math.max(left, work.x + Math.round(t.x)))
      const y = Math.min(bottom, Math.max(top, work.y + Math.round(t.y)))
      return { x, y, width: w, height: h }
    }
  }
}
