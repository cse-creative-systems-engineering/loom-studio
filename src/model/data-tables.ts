/**
 * Data, edited as data. A list ("Home,Docs,Pricing") and a table (a grid's
 * rows, a chart's labels and values) are stored as delimited text, which is
 * what a file, a paste from a spreadsheet and a binding all speak. But typing
 * "Ada|Engineer|128,400;Grace|..." is the opposite of effortless, so the panel
 * edits them as rows and cells, and the SEPARATOR stops being the designer's
 * problem: when a value contains it, another one is chosen.
 */

import type { ComponentSpec } from './registry'
import { delimiterChar } from './registry'
import type { PropValue } from './types'

/** Separators in the order they are tried. Newline last: it reads worst in a file. */
const CANDIDATES = ['comma', 'pipe', 'semicolon', 'tab', 'newline'] as const

/** The keys of a component's list properties: a string with a `<key>Sep` delimiter beside it. */
export function listKeysOf(spec: ComponentSpec): string[] {
  return Object.keys(spec.props).filter((k) => spec.props[k]?.type === 'string' && spec.props[`${k}Sep`]?.type === 'delimiter')
}

export function splitList(value: PropValue | undefined, sep: PropValue | undefined): string[] {
  const raw = typeof value === 'string' ? value : ''
  if (raw.trim() === '') return []
  return raw.split(delimiterChar(sep)).map((v) => v.trim())
}

/**
 * The separator to store `items` with: the current one when no item contains
 * it, otherwise the first that none contains. `avoid` are separators already
 * in use at another level (a table's row separator, for its cells).
 */
export function chooseSep(items: string[], current: string, avoid: string[] = []): string {
  const clean = (name: string) => !avoid.includes(name) && items.every((i) => !i.includes(delimiterChar(name)))
  if (clean(current)) return current
  return CANDIDATES.find(clean) ?? current
}

/** A list back to text, with the separator it needs. */
export function joinList(items: string[], currentSep: string): { value: string; sep: string } {
  const kept = items.map((i) => i.trim())
  const sep = chooseSep(kept, currentSep)
  return { value: kept.join(delimiterChar(sep)), sep }
}

/** A table's rows back to text, choosing row and cell separators that its cells do not contain. */
export function joinTable(rows: string[][], rowSep: string, cellSep: string): { value: string; rowSep: string; cellSep: string } {
  const cells = rows.flat().map((c) => c.trim())
  const cs = chooseSep(cells, cellSep)
  const rs = chooseSep(cells, rowSep, [cs])
  return { value: rows.map((r) => r.map((c) => c.trim()).join(delimiterChar(cs))).join(delimiterChar(rs)), rowSep: rs, cellSep: cs }
}

export function splitTable(value: PropValue | undefined, rowSep: PropValue | undefined, cellSep: PropValue | undefined): string[][] {
  const raw = typeof value === 'string' ? value : ''
  if (raw.trim() === '') return []
  return raw.split(delimiterChar(rowSep)).map((r) => r.split(delimiterChar(cellSep)).map((c) => c.trim()))
}

/**
 * Text pasted from a spreadsheet (tab-separated lines) or a CSV, as rows of
 * cells. Quoted CSV fields keep their commas and newlines.
 */
export function parsePastedTable(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  if (lines.includes('\t')) return lines.split('\n').map((l) => l.split('\t').map((c) => c.trim()))
  const rows: string[][] = [[]]
  let cell = ''
  let quoted = false
  for (let i = 0; i < lines.length; i++) {
    const ch = lines[i]!
    if (quoted) {
      if (ch === '"' && lines[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      rows[rows.length - 1]!.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      rows[rows.length - 1]!.push(cell.trim())
      rows.push([])
      cell = ''
    } else cell += ch
  }
  rows[rows.length - 1]!.push(cell.trim())
  return rows
}

/**
 * Parallel lists that are really ONE table: a chart's labels and values (and
 * a pie's colours) must stay the same length and in step, so they are edited
 * as columns of one table instead of three unrelated lists.
 */
export interface ParallelColumn {
  key: string
  label: string
  kind: 'text' | 'number' | 'color'
}

export const PARALLEL_TABLES: Readonly<Record<string, ParallelColumn[]>> = {
  BarChart: [
    { key: 'labels', label: 'Label', kind: 'text' },
    { key: 'values', label: 'Value', kind: 'number' },
  ],
  PieChart: [
    { key: 'labels', label: 'Label', kind: 'text' },
    { key: 'values', label: 'Value', kind: 'number' },
    { key: 'palette', label: 'Colour', kind: 'color' },
  ],
}
