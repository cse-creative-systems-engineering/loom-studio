/**
 * The panel's data editors: a LIST as rows (a menu's items, a breadcrumb
 * trail) and a TABLE as cells (a grid's rows, a chart's labels and values).
 *
 * The easy thing made effortless: type, Enter for the next one, paste a column
 * or a whole sheet from a spreadsheet and it lands in cells. The delimited
 * text underneath (and its separator) is never the designer's problem: see
 * `model/data-tables.ts`. Every edit is ONE op batch, so one undo step.
 */

import React from 'react'
import { createPortal } from 'react-dom'
import type { EditorStore } from './state/store'
import type { Node, NodeId, Op, PropValue } from './model/types'
import { getComponent } from './model/registry'
import { itemsOf } from './model/lists'
import { column } from './model/grid'
import { joinList, joinTable, listKeysOf, PARALLEL_TABLES, parsePastedTable, splitList, splitTable, type ParallelColumn } from './model/data-tables'

const setProp = (id: NodeId, key: string, value: PropValue): Op => ({ op: 'setProp', id, key, value })

/** Keys the data editors own, so the property groups do not show them twice. */
export function dataEditorKeys(node: Node): Set<string> {
  const spec = getComponent(node.type)
  const out = new Set<string>()
  if (!spec) return out
  if (node.type === 'DataGrid') ['rows', 'rowSep', 'cellSep'].forEach((k) => out.add(k))
  for (const c of PARALLEL_TABLES[node.type] ?? []) {
    out.add(c.key)
    out.add(`${c.key}Sep`)
  }
  // A list's separator is chosen for it.
  for (const k of listKeysOf(spec)) out.add(`${k}Sep`)
  return out
}

/** True when `key` is a list property edited as rows (and not part of a table). */
export function isListKey(node: Node, key: string): boolean {
  const spec = getComponent(node.type)
  if (!spec || (PARALLEL_TABLES[node.type] ?? []).some((c) => c.key === key)) return false
  return listKeysOf(spec).includes(key)
}

/* ---------------------------------------------------------------- lists -- */

export function ListField({ s, node, name, label }: { s: EditorStore; node: Node; name: string; label: string }) {
  const sepKey = `${name}Sep`
  const stored = splitList(node.props[name], node.props[sepKey])
  // An empty list stores as "", so its first, still-blank item lives here
  // until it has words.
  const [pending, setPending] = React.useState(false)
  React.useEffect(() => setPending(false), [node.id])
  const items = stored.length === 0 && pending ? [''] : stored
  const [focus, setFocus] = React.useState<number | null>(null)
  const refs = React.useRef<Array<HTMLInputElement | null>>([])
  React.useEffect(() => {
    if (focus !== null) refs.current[focus]?.focus()
  }, [focus, items.length])

  const commit = (next: string[], what: string) => {
    const { value, sep } = joinList(next, String(node.props[sepKey] ?? 'comma'))
    const ops: Op[] = [setProp(node.id, name, value)]
    if (sep !== node.props[sepKey]) ops.push(setProp(node.id, sepKey, sep))
    s.commitAll(ops, what)
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    commit(next, `Move ${label.toLowerCase()} item`)
    setFocus(j)
  }

  return (
    <div className="data-list" role="list" aria-label={label}>
      {items.map((it, i) => (
        <div className="data-list-row" role="listitem" key={i}>
          <span className="data-list-n" aria-hidden="true">{i + 1}</span>
          <input
            ref={(el) => {
              refs.current[i] = el
            }}
            className="data-cell"
            aria-label={`${label} ${i + 1}`}
            value={it}
            spellCheck={false}
            onChange={(e) => commit(items.map((x, j) => (j === i ? e.target.value : x)), `Edit ${label.toLowerCase()}`)}
            onPaste={(e) => {
              // A pasted column (lines from a sheet or a document) becomes items.
              const text = e.clipboardData.getData('text')
              const lines = text.split(/\r?\n|\t/).map((l) => l.trim()).filter(Boolean)
              if (lines.length < 2) return
              e.preventDefault()
              commit([...items.slice(0, i), ...lines, ...items.slice(i + 1)], `Paste ${lines.length} items`)
              setFocus(i + lines.length - 1)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit([...items.slice(0, i + 1), '', ...items.slice(i + 1)], `Add ${label.toLowerCase()} item`)
                setFocus(i + 1)
              } else if (e.key === 'Backspace' && it === '' && items.length > 0) {
                e.preventDefault()
                commit(items.filter((_, j) => j !== i), `Remove ${label.toLowerCase()} item`)
                setFocus(Math.max(0, i - 1))
              } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                move(i, e.key === 'ArrowUp' ? -1 : 1)
              } else if (e.key === 'ArrowDown' && i < items.length - 1) {
                e.preventDefault()
                setFocus(i + 1)
              } else if (e.key === 'ArrowUp' && i > 0) {
                e.preventDefault()
                setFocus(i - 1)
              }
            }}
          />
          <button type="button" className="data-icon" aria-label={`Move ${label} ${i + 1} up`} title="Move up (Alt+↑)" disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button type="button" className="data-icon danger" aria-label={`Remove ${label} ${i + 1}`} title="Remove" onClick={() => commit(items.filter((_, j) => j !== i), `Remove ${label.toLowerCase()} item`)}>
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="mini data-add"
        onClick={() => {
          if (items.length === 0) setPending(true)
          else commit([...items, ''], `Add ${label.toLowerCase()} item`)
          setFocus(items.length)
        }}
      >
        + Add
      </button>
    </div>
  )
}

/* --------------------------------------------------------------- tables -- */

interface TableColumn {
  label: string
  kind: 'text' | 'number' | 'color'
}

function TableEditor({
  label,
  columns,
  rows,
  onChange,
  onAddColumns,
}: {
  label: string
  columns: TableColumn[]
  rows: string[][]
  onChange: (rows: string[][], what: string) => void
  /** A paste wider than the table: add this many columns first (the grid can; a chart cannot). */
  onAddColumns?: (n: number) => void
}) {
  const [focus, setFocus] = React.useState<{ r: number; c: number } | null>(null)
  const host = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (!focus) return
    host.current?.querySelector<HTMLInputElement>(`[data-cell="${focus.r}:${focus.c}"]`)?.focus()
  }, [focus, rows.length])
  const width = columns.length
  const norm = (r: string[]) => Array.from({ length: width }, (_, i) => r[i] ?? '')
  const grid = rows.map(norm)
  const set = (r: number, c: number, v: string) => onChange(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)), `Edit ${label.toLowerCase()}`)

  return (
    <div className="data-table-wrap" ref={host}>
      <table className="data-table" aria-label={label}>
        <thead>
          <tr>
            <th aria-hidden="true" />
            {columns.map((c, i) => (
              <th key={i} scope="col" className={c.kind === 'number' ? 'data-num' : undefined}>
                {c.label}
              </th>
            ))}
            <th aria-hidden="true" />
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              <td className="data-list-n" aria-hidden="true">{r + 1}</td>
              {row.map((v, c) => (
                <td key={c} className={columns[c]?.kind === 'color' ? 'color' : undefined}>
                  {columns[c]?.kind === 'color' && <span className="data-swatch" style={{ background: v || 'transparent' }} aria-hidden="true" />}
                  <input
                    className={`data-cell ${columns[c]?.kind === 'number' ? 'data-num' : ''}`}
                    data-cell={`${r}:${c}`}
                    aria-label={`${columns[c]?.label ?? 'Cell'}, row ${r + 1}`}
                    inputMode={columns[c]?.kind === 'number' ? 'decimal' : undefined}
                    value={v}
                    spellCheck={false}
                    onChange={(e) => set(r, c, e.target.value)}
                    onPaste={(e) => {
                      // A block from a spreadsheet lands with its top-left
                      // corner in this cell, adding rows (and grid columns) as needed.
                      const block = parsePastedTable(e.clipboardData.getData('text'))
                      if (block.length < 2 && (block[0]?.length ?? 0) < 2) return
                      e.preventDefault()
                      const need = c + Math.max(...block.map((b) => b.length))
                      if (need > width && onAddColumns) onAddColumns(need - width)
                      const w = Math.max(width, onAddColumns ? need : width)
                      const next = grid.map((rw) => Array.from({ length: w }, (_, i) => rw[i] ?? ''))
                      block.forEach((b, i) => {
                        const target = r + i
                        while (next.length <= target) next.push(Array.from({ length: w }, () => ''))
                        b.forEach((cell, j) => {
                          if (c + j < w) next[target]![c + j] = cell
                        })
                      })
                      onChange(next, `Paste ${block.length} rows`)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (r === grid.length - 1) onChange([...grid, norm([])], `Add ${label.toLowerCase()} row`)
                        setFocus({ r: r + 1, c })
                      } else if (e.key === 'ArrowDown' && r < grid.length - 1) {
                        e.preventDefault()
                        setFocus({ r: r + 1, c })
                      } else if (e.key === 'ArrowUp' && r > 0) {
                        e.preventDefault()
                        setFocus({ r: r - 1, c })
                      }
                    }}
                  />
                </td>
              ))}
              <td>
                <button type="button" className="data-icon danger" aria-label={`Remove row ${r + 1}`} title="Remove row" onClick={() => onChange(grid.filter((_, i) => i !== r), `Remove ${label.toLowerCase()} row`)}>
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row between data-foot">
        <button
          type="button"
          className="mini"
          onClick={() => {
            onChange([...grid, norm([])], `Add ${label.toLowerCase()} row`)
            setFocus({ r: grid.length, c: 0 })
          }}
        >
          + Add row
        </button>
        <span className="dim small">Paste from a spreadsheet into any cell</span>
      </div>
    </div>
  )
}

/**
 * A table in the panel, with Expand: a seven-column grid does not fit a
 * 200px panel, so the same editor opens wide over the canvas (Esc closes).
 */
function TableSection({ title, count, children }: { title: string; count: number; children: (wide: boolean) => React.ReactNode }) {
  const [wide, setWide] = React.useState(false)
  React.useEffect(() => {
    if (!wide) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setWide(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide])
  return (
    <section className="data-panel">
      <div className="row between">
        <h3>{title}</h3>
        <span className="row" style={{ gap: 6 }}>
          <span className="dim small">{count} rows</span>
          <button type="button" className="mini" onClick={() => setWide(true)} title="Edit in a wide table">
            Expand
          </button>
        </span>
      </div>
      {!wide && children(false)}
      {wide && createPortal(
        <div className="data-wide-scrim" onPointerDown={(e) => e.target === e.currentTarget && setWide(false)}>
          <div className="data-wide" role="dialog" aria-modal="true" aria-label={title}>
            <div className="row between">
              <h3>{title}</h3>
              <button type="button" className="mini" onClick={() => setWide(false)}>
                Done
              </button>
            </div>
            {children(true)}
          </div>
        </div>,
        document.querySelector('.loom') ?? document.body,
      )}
    </section>
  )
}

/** The Data section: a component's table, when it has one. */
export function DataPanel({ s, node }: { s: EditorStore; node: Node }) {
  if (node.type === 'DataGrid') {
    const columns = itemsOf(node, 'columns').map((c) => ({ label: String(c.label ?? ''), kind: ['number', 'currency', 'percent', 'change', 'progress'].includes(String(c.type)) ? ('number' as const) : ('text' as const) }))
    const rows = splitTable(node.props.rows, node.props.rowSep, node.props.cellSep)
    const write = (next: string[][], what: string, extra: Op[] = []) => {
      const t = joinTable(next, String(node.props.rowSep ?? 'semicolon'), String(node.props.cellSep ?? 'pipe'))
      s.commitAll([...extra, setProp(node.id, 'rows', t.value), setProp(node.id, 'rowSep', t.rowSep), setProp(node.id, 'cellSep', t.cellSep)], what)
    }
    return (
      <TableSection title="Rows" count={rows.length}>
        {() => (
          <TableEditor
            label="Rows"
            columns={columns}
            rows={rows}
            onChange={write}
            onAddColumns={(n) => {
              const cols = itemsOf(node, 'columns')
              s.commit({ op: 'setList', id: node.id, key: 'columns', items: [...cols, ...Array.from({ length: n }, (_, i) => column(`Column ${cols.length + i + 1}`))] }, `Add ${n} columns`)
            }}
          />
        )}
      </TableSection>
    )
  }
  const cols: ParallelColumn[] | undefined = PARALLEL_TABLES[node.type]
  if (!cols) return null
  const lists = cols.map((c) => splitList(node.props[c.key], node.props[`${c.key}Sep`]))
  const n = Math.max(0, ...lists.map((l) => l.length))
  const rows = Array.from({ length: n }, (_, r) => lists.map((l) => l[r] ?? ''))
  const write = (next: string[][], what: string) => {
    const ops: Op[] = []
    cols.forEach((c, i) => {
      const { value, sep } = joinList(next.map((r) => r[i] ?? ''), String(node.props[`${c.key}Sep`] ?? 'comma'))
      ops.push(setProp(node.id, c.key, value))
      if (sep !== node.props[`${c.key}Sep`]) ops.push(setProp(node.id, `${c.key}Sep`, sep))
    })
    s.commitAll(ops, what)
  }
  return (
    <TableSection title="Values" count={n}>
      {() => <TableEditor label="Values" columns={cols} rows={rows} onChange={write} />}
    </TableSection>
  )
}

export type { TableColumn }
