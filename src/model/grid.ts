/**
 * DataGrid columns from plain text: the shorthand a person (or an assistant)
 * types — "Name,Role,Amount" — and the form old files stored them in, turned
 * into column DEFINITIONS. The type of each column is read from its data, so
 * a column of "$1,200" values arrives as money and a column of "Active" /
 * "Past due" arrives as status pills, without anyone declaring it.
 */

import type { ListItem, PropValue } from './types'
import { delimiterChar } from './registry'

const STATUS = /^(active|inactive|paid|unpaid|done|complete|completed|approved|live|online|offline|healthy|resolved|shipped|failed|error|past due|overdue|blocked|cancel+ed|declined|rejected|pending|trial|away|draft|paused|waiting|scheduled|processing|open|closed|new|in progress|invited|expired|suspended)$/i

export function inferColumnType(values: string[]): string {
  const vals = values.map((v) => v.trim()).filter((v) => v !== '')
  if (!vals.length) return 'text'
  const all = (re: RegExp) => vals.every((v) => re.test(v))
  if (all(/^\d{4}-\d{2}-\d{2}/)) return 'date'
  if (all(/^[+-]?[$€£¥₹]?\s?[\d,]+(\.\d+)?\s?%?$/)) {
    if (vals.some((v) => /[$€£¥₹]/.test(v))) return 'currency'
    if (vals.every((v) => /^[+-]/.test(v) && v.endsWith('%'))) return 'change'
    if (vals.some((v) => v.endsWith('%'))) return 'percent'
    return 'number'
  }
  if (all(STATUS)) return 'status'
  if (all(/^(true|false|yes|no)$/i)) return 'check'
  if (all(/<[^>]*@[^>]*>$/)) return 'person'
  return 'text'
}

export function column(label: string, type = 'text'): ListItem {
  return { label, type, width: 0, align: 'auto', pinned: false, wrap: false, sortable: true, hidden: false, decimals: -1, total: 'none', tones: '', help: '' }
}

/** "Name,Role,Amount" (on its declared separator) plus the rows, as definitions. */
export function columnsFromText(labels: string, sep: PropValue | undefined, rows: string, rowSep: PropValue | undefined, cellSep: PropValue | undefined): ListItem[] {
  const names = labels.split(delimiterChar(sep ?? 'comma')).map((s) => s.trim()).filter((s) => s !== '')
  const table = rows
    .split(delimiterChar(rowSep ?? 'semicolon'))
    .map((r) => r.split(delimiterChar(cellSep ?? 'pipe')).map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''))
  return names.map((name, i) => column(name, inferColumnType(table.map((r) => r[i] ?? ''))))
}

/** Props that are SHORTHAND for a list, per component: accepted on the way in, never stored. */
export const LIST_SHORTHAND: Record<string, string[]> = { DataGrid: ['columns', 'columnsSep'] }

/**
 * Turn a node's shorthand props into its lists, in place: every path that
 * builds a node (a drop, a starter, the assistant, a file) calls this, so
 * "columns: 'Name,Role'" means the same thing wherever it is written.
 */
export function takeShorthand(type: string, props: Record<string, PropValue>): Record<string, ListItem[]> | undefined {
  if (type !== 'DataGrid' || typeof props.columns !== 'string') return undefined
  const columns = columnsFromText(props.columns, props.columnsSep, String(props.rows ?? ''), props.rowSep, props.cellSep)
  if (props.freezeFirst === true && columns[0]) columns[0].pinned = true
  delete props.columns
  delete props.columnsSep
  delete props.freezeFirst
  return { columns }
}
