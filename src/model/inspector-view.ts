/**
 * What the properties panel shows for one node.
 *
 * Kept pure and out of the React tree so the rules are testable without
 * rendering the editor. The rules exist to make one panel serve both a
 * newcomer and a developer:
 *
 *  - A component's own options are always shown. `advanced` properties (the
 *    universal styling every component carries) wait behind "More properties".
 *  - A CHANGED advanced property is always shown, toggle or not. Hiding a value
 *    the designer set would make the output unexplainable from the panel — the
 *    same reason a locked node stays selectable.
 *  - A search looks through everything, advanced included: someone typing
 *    "shadow" is asking for it, whatever the toggle says.
 */

import type { ComponentSpec, PropSpec } from './registry'
import type { PropValue } from './types'

export interface PropRow {
  key: string
  spec: PropSpec
  value: PropValue
  /** The value differs from the schema default. */
  modified: boolean
}

export interface PropGroup {
  name: string
  rows: PropRow[]
}

export interface InspectorView {
  groups: PropGroup[]
  /** Advanced properties currently hidden by the toggle (0 while searching). */
  hiddenAdvanced: number
}

/** `paddingX` -> `Padding X`, `fontSize` -> `Font size`, `aria-label` -> `Aria label`. */
export function humanize(key: string): string {
  const words = key
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
  // A single letter is an axis or a name (`paddingX`), so it stays a capital.
  return words
    .map((w, i) => (w.length === 1 ? w.toUpperCase() : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(' ')
}

/** The label a person reads. The raw key stays available as a tooltip. */
export function propLabel(key: string, spec: PropSpec): string {
  return spec.label ?? humanize(key)
}

export function isModified(spec: PropSpec, value: PropValue): boolean {
  return value !== spec.default
}

function matches(query: string, key: string, spec: PropSpec, group: string): boolean {
  const hay = `${key} ${propLabel(key, spec)} ${group}`.toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word))
}

export function inspectorView(
  spec: ComponentSpec,
  props: Record<string, PropValue>,
  opts: { query: string; showAdvanced: boolean },
): InspectorView {
  const searching = opts.query.trim() !== ''
  const groups = new Map<string, PropRow[]>()
  let hiddenAdvanced = 0
  for (const [key, ps] of Object.entries(spec.props)) {
    // Docking has its own picture in the Position section; a dropdown of the
    // same ten words beside it would be the same control twice.
    if (key === 'anchor') continue
    const group = ps.group ?? 'General'
    // A missing key renders as its real default rather than a misleading 0.
    const value = Object.prototype.hasOwnProperty.call(props, key) ? props[key] : ps.default
    const modified = isModified(ps, value)
    if (searching) {
      if (!matches(opts.query, key, ps, group)) continue
    } else if (ps.advanced && !opts.showAdvanced && !modified) {
      hiddenAdvanced += 1
      continue
    }
    const rows = groups.get(group) ?? []
    rows.push({ key, spec: ps, value, modified })
    groups.set(group, rows)
  }
  return {
    groups: [...groups.entries()].map(([name, rows]) => ({ name, rows })),
    hiddenAdvanced,
  }
}
