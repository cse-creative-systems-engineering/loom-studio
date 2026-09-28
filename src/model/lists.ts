/**
 * Item lists: validation and access, shared by the op, the file loader, the
 * renderer and the panel so no path treats a list differently.
 *
 * A list item is checked field by field against the list's declaration with
 * the SAME predicate a property uses (`valueMatches`): a wrong value becomes
 * that field's default, an unknown field is dropped, and each is reported.
 * Missing fields take their defaults, so a row written by hand (or by an
 * assistant) with only a title is complete once it lands.
 */

import type { ListItem, Node } from './types'
import { getComponent, valueMatches, type ListSpec } from './registry'

export function listSpecOf(type: string, key: string): ListSpec | undefined {
  return getComponent(type)?.lists?.[key]
}

/** Clean one raw list against its declaration. Unknown list: nothing survives. */
export function cleanList(type: string, key: string, raw: unknown): { items: ListItem[]; dropped: string[] } {
  const spec = listSpecOf(type, key)
  const dropped: string[] = []
  if (!spec) return { items: [], dropped: [`${key} (not a list ${type} declares)`] }
  if (!Array.isArray(raw)) return { items: spec.default.map((it) => ({ ...it })), dropped: [`${key} (not a list)`] }
  const items: ListItem[] = []
  raw.forEach((row, i) => {
    if (items.length >= spec.max) {
      if (i === spec.max) dropped.push(`${key} (more than ${spec.max} items; the rest dropped)`)
      return
    }
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      dropped.push(`${key}[${i}] (not an item)`)
      return
    }
    const item: ListItem = {}
    for (const [field, ps] of Object.entries(spec.fields)) {
      const v = (row as Record<string, unknown>)[field]
      if (v === undefined) item[field] = ps.default as string | number | boolean
      else if (valueMatches(ps, v) && v !== null) item[field] = v as string | number | boolean
      else {
        item[field] = ps.default as string | number | boolean
        dropped.push(`${key}[${i}].${field} (invalid, reset)`)
      }
    }
    for (const field of Object.keys(row as Record<string, unknown>)) {
      if (!(field in spec.fields)) dropped.push(`${key}[${i}].${field} (unknown field)`)
    }
    items.push(item)
  })
  return { items, dropped }
}

/** The items of one list on a node: its own, or the declared default. */
export function itemsOf(node: Node, key: string): ListItem[] {
  const own = node.lists?.[key]
  if (own) return own
  return listSpecOf(node.type, key)?.default ?? []
}

/** Every list a node's component declares, cleaned, with defaults for missing ones. */
export function normalizeLists(node: Node): Node['lists'] {
  const spec = getComponent(node.type)
  if (!spec?.lists) return undefined
  const out: Record<string, ListItem[]> = {}
  for (const key of Object.keys(spec.lists)) {
    out[key] = node.lists?.[key] ? cleanList(node.type, key, node.lists[key]).items : spec.lists[key].default.map((it) => ({ ...it }))
  }
  return out
}
