/**
 * Snap engine.
 *
 * Ported from Atelier's drag handler, which is the best part of that file:
 * while dragging, test the moving box's left/center/right and top/middle/bottom
 * against every OTHER element's same three lines, and when one is within a
 * threshold, snap to it and publish a guide so the user can see WHY it snapped.
 *
 * This is strictly better than "drop into the deepest container": snapping
 * answers "where exactly" rather than "which parent", and it works between
 * arbitrary siblings, not just a hierarchy.
 */

export interface SnapBox {
  id: string
  x: number
  y: number
  w: number
  h: number
}

/** A published guide line, in artboard coordinates. */
export interface Guide {
  axis: 'x' | 'y'
  /** The line's position on that axis. */
  at: number
  /** Human-readable delta, e.g. "← 12px". */
  label?: string
}

export interface SnapResult {
  x: number
  y: number
  guides: Guide[]
}

export interface SnapOptions {
  /** Pixel grid; 0 disables grid snapping. */
  grid?: number
  /** Distance within which edges snap. */
  threshold?: number
  /** Ids to ignore (the moving selection itself). */
  exclude?: Set<string>
  /** Extra static lines (e.g. the artboard centre). */
  anchors?: Array<{ axis: 'x' | 'y'; at: number }>
  /**
   * Only consider a neighbour whose OTHER axis overlaps the moving box by at
   * least this many pixels. Without it, axis-only matching snaps a header to a
   * panel 500px below it, which is technically "aligned" and visually absurd.
   * Pass Infinity to disable the gate.
   */
  crossOverlap?: number
}

const DEFAULT_THRESHOLD = 6
/** How much a neighbour must overlap the mover on the other axis to count. */
const DEFAULT_CROSS_OVERLAP = 12

/** Candidate lines on each axis for a box's own geometry. */
function lines(box: SnapBox, axis: 'x' | 'y') {
  return axis === 'x'
    ? [
        { at: box.x, kind: 'start' as const },
        { at: box.x + box.w / 2, kind: 'center' as const },
        { at: box.x + box.w, kind: 'end' as const },
      ]
    : [
        { at: box.y, kind: 'start' as const },
        { at: box.y + box.h / 2, kind: 'center' as const },
        { at: box.y + box.h, kind: 'end' as const },
      ]
}

/**
 * Snap a moving box against its neighbours.
 *
 * The moving box's ORIGIN is adjusted so that whichever of its own three lines
 * lands nearest a neighbour's line wins. Testing all nine pairs and taking the
 * smallest delta is what makes centre-snapping work.
 */
export function snapMove(
  moving: SnapBox,
  others: SnapBox[],
  opts: SnapOptions = {},
): SnapResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const grid = opts.grid ?? 0
  const exclude = opts.exclude ?? new Set<string>()
  const crossOverlap = opts.crossOverlap ?? DEFAULT_CROSS_OVERLAP

  let bestX: { delta: number; at: number; label: string } | null = null
  let bestY: { delta: number; at: number; label: string } | null = null

  for (const other of others) {
    if (exclude.has(other.id)) continue

    // Gate on 2D proximity before matching lines: a neighbour that is nowhere
    // near the mover vertically cannot sensibly constrain its horizontal edge.
    const xOverlap = Math.min(moving.x + moving.w, other.x + other.w) - Math.max(moving.x, other.x)
    const yOverlap = Math.min(moving.y + moving.h, other.y + other.h) - Math.max(moving.y, other.y)
    const nearInY = yOverlap >= crossOverlap
    const nearInX = xOverlap >= crossOverlap

    for (const axis of ['x', 'y'] as const) {
      // For the x axis, require vertical proximity (and vice versa).
      if (axis === 'x' && !nearInY) continue
      if (axis === 'y' && !nearInX) continue

      const mine = lines(moving, axis)
      const theirs = lines(other, axis)
      for (const m of mine) {
        for (const o of theirs) {
          // `delta` is how far to move the moving ORIGIN so that its line `m`
          // coincides with `o.at`.
          const delta = o.at - m.at
          if (Math.abs(delta) > threshold) continue

          if (axis === 'x') {
            const better = !bestX || Math.abs(delta) < Math.abs(bestX.delta)
            if (better) {
              bestX = {
                delta,
                at: o.at,
                label: `${m.kind === 'start' ? '←' : m.kind === 'center' ? '↔ center' : '→'} ${Math.abs(Math.round(delta))}px`,
              }
            }
          } else {
            const better = !bestY || Math.abs(delta) < Math.abs(bestY.delta)
            if (better) {
              bestY = {
                delta,
                at: o.at,
                label: `${m.kind === 'start' ? '↑' : m.kind === 'center' ? '↕ center' : '↓'} ${Math.abs(Math.round(delta))}px`,
              }
            }
          }
        }
      }
    }
  }

  // Artboard anchors (centre lines) participate on equal footing.
  for (const a of opts.anchors ?? []) {
    for (const m of lines(moving, a.axis)) {
      const delta = a.at - m.at
      if (Math.abs(delta) > threshold) continue
      if (a.axis === 'x' && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
        bestX = { delta, at: a.at, label: '↔ center' }
      }
      if (a.axis === 'y' && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
        bestY = { delta, at: a.at, label: '↕ center' }
      }
    }
  }

  let x = moving.x + (bestX?.delta ?? 0)
  let y = moving.y + (bestY?.delta ?? 0)

  // Grid snapping is the fallback: only when no edge snap claimed the axis,
  // so a deliberate edge alignment is never overridden by the grid.
  if (grid > 0) {
    if (!bestX) x = Math.round(x / grid) * grid
    if (!bestY) y = Math.round(y / grid) * grid
  }

  const guides: Guide[] = []
  if (bestX) guides.push({ axis: 'x', at: bestX.at, label: bestX.label })
  if (bestY) guides.push({ axis: 'y', at: bestY.at, label: bestY.label })

  return { x: Math.round(x), y: Math.round(y), guides }
}

/** Convenience: the artboard's centre lines as snap anchors. */
export function artboardAnchors(w: number, h: number): Array<{ axis: 'x' | 'y'; at: number }> {
  return [
    { axis: 'x' as const, at: Math.round(w / 2) },
    { axis: 'y' as const, at: Math.round(h / 2) },
  ]
}
