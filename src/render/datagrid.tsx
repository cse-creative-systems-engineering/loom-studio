/**
 * The DataGrid, drawn. A grid is judged against real ones (a CRM's customer
 * table, a billing console, a spreadsheet), so it is built like them:
 *
 *  - COLUMNS ARE DEFINITIONS (`lists.columns`): what a column holds decides
 *    how it is drawn (a person with an avatar, money in the grid's currency,
 *    a status pill, a usage bar, a date), aligned, sorted and totalled.
 *  - The header is its own band, never a row that looks like the data, and a
 *    sortable column SAYS it sorts before anyone clicks it.
 *  - Above it, a toolbar (title, live count, search, column picker, CSV
 *    export) that a selection swaps for the bulk bar; below it, totals and
 *    paging.
 *  - Loading, empty, no-match and failed are designed states, not blanks.
 *
 * Everything that moves (sort, search, paging, selection, column picking,
 * resizing, export) is the shared behaviour runtime's, so the canvas, Preview
 * and an exported page behave the same. This module draws the FIRST frame,
 * already correct with no script at all: the authored sort applied, the first
 * page shown, the totals computed.
 */

import React from 'react'
import type { ListItem, Node, PropValue } from '../model/types'
import { delimiterChar } from '../model/registry'
import { itemsOf } from '../model/lists'
import { behaviourAttrs, groupId } from './behaviour'
import type { Theme } from './theme'

type Part = (name: string | string[]) => Record<string, string>

export type ColumnType = 'text' | 'number' | 'currency' | 'percent' | 'change' | 'date' | 'status' | 'person' | 'progress' | 'check' | 'link' | 'tags'

export interface GridColumn {
  index: number
  label: string
  type: ColumnType
  width: number
  align: 'left' | 'center' | 'right'
  pinned: boolean
  wrap: boolean
  sortable: boolean
  hidden: boolean
  decimals: number
  total: 'none' | 'sum' | 'average' | 'min' | 'max' | 'count'
  tones: Record<string, Tone>
  help: string
}

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const s = (v: PropValue | undefined, d = ''): string => (typeof v === 'string' ? v : d)
const n = (v: PropValue | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)

const NUMERIC: ReadonlySet<ColumnType> = new Set(['number', 'currency', 'percent', 'change', 'progress'])

/** A column's definition, read leniently: a hand-written file may omit fields. */
export function gridColumns(node: Node): GridColumn[] {
  return itemsOf(node, 'columns').map((c: ListItem, index) => {
    const type = (s(c.type as PropValue, 'text') || 'text') as ColumnType
    const align = s(c.align as PropValue, 'auto')
    return {
      index,
      label: s(c.label as PropValue, `Column ${index + 1}`),
      type,
      width: n(c.width as PropValue, 0),
      align: align === 'left' || align === 'center' || align === 'right' ? align : NUMERIC.has(type) ? 'right' : type === 'check' ? 'center' : 'left',
      pinned: c.pinned === true,
      wrap: c.wrap === true,
      sortable: c.sortable !== false,
      hidden: c.hidden === true,
      decimals: n(c.decimals as PropValue, -1),
      total: (s(c.total as PropValue, 'none') || 'none') as GridColumn['total'],
      tones: parseTones(s(c.tones as PropValue)),
      help: s(c.help as PropValue),
    }
  })
}

/** The cells, split on the grid's OWN separators, so a comma inside a value is data. */
export function gridRows(node: Node): string[][] {
  return s(node.props.rows)
    .split(delimiterChar(node.props.rowSep))
    .map((r) => r.split(delimiterChar(node.props.cellSep)).map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''))
}

function parseTones(raw: string): Record<string, Tone> {
  const out: Record<string, Tone> = {}
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=').map((x) => x.trim())
    if (k && (v === 'success' || v === 'warning' || v === 'danger' || v === 'info' || v === 'neutral')) out[k.toLowerCase()] = v
  }
  return out
}

/** The words every product uses for a state, read as the tone a person expects. */
const TONE_WORDS: Array<[Tone, RegExp]> = [
  ['danger', /^(failed|fail|error|past due|overdue|blocked|cancel+ed|declined|rejected|churned|critical|down|offline|expired|suspended|unpaid|lost)$/],
  ['warning', /^(pending|trial|away|in review|review|draft|paused|waiting|scheduled|processing|at risk|expiring|due|on hold|partial|degraded)$/],
  ['success', /^(active|paid|done|complete|completed|approved|live|online|healthy|resolved|shipped|success|succeeded|enabled|won|verified|delivered|published)$/],
  ['info', /^(new|in progress|invited|beta|open|queued|planned|running)$/],
]

export function toneOf(value: string, col: Pick<GridColumn, 'tones'>): Tone {
  const k = value.trim().toLowerCase()
  if (col.tones[k]) return col.tones[k]
  return TONE_WORDS.find(([, re]) => re.test(k))?.[0] ?? 'neutral'
}

/** A number from what a person typed: "$12,400", "82%", "+3.1", "1 024". */
export function numberOf(raw: string): number | null {
  const cleaned = raw.replace(/[\s,$€£¥₹%+]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (cleaned === '' || cleaned === '-') return null
  const v = Number(cleaned)
  return Number.isFinite(v) ? v : null
}

/** An ISO date (2026-11-04), read in UTC so a date never shifts a day. */
export function dateOf(raw: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim())
  if (!m) return null
  const v = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isFinite(v) ? v : null
}

/** The sort key a cell carries, so a sort orders 9 before 10 and March before May. */
export function sortKey(raw: string, type: ColumnType): number | null {
  if (type === 'date') return dateOf(raw)
  if (type === 'check') return truthy(raw) ? 1 : 0
  if (NUMERIC.has(type)) return numberOf(raw)
  return null
}

const truthy = (raw: string): boolean => /^(true|yes|y|1|✓|✔|on|x)$/i.test(raw.trim())

/**
 * The formatting rules for a numeric column, as data: the renderer and the
 * runtime (which recomputes totals for a filtered grid) format with the SAME
 * rules, so a total never changes style when a search narrows it.
 */
export interface NumberFormat {
  type: ColumnType
  currency: string
  decimals: number
}

export function formatNumber(v: number, f: NumberFormat): string {
  const fixed = f.decimals >= 0 ? { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals } : { maximumFractionDigits: 2 }
  if (f.type === 'currency') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency || 'USD', ...(f.decimals >= 0 ? fixed : {}) }).format(v)
  }
  const body = new Intl.NumberFormat('en-US', fixed).format(Math.abs(v))
  if (f.type === 'percent' || f.type === 'progress') return `${v < 0 ? '-' : ''}${body}%`
  if (f.type === 'change') return `${v > 0 ? '+' : v < 0 ? '−' : ''}${body}%`
  return `${v < 0 ? '-' : ''}${body}`
}

export function formatDate(ms: number): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(ms)
}

/** "Name <address>": the visible words and the address behind them. */
function splitAngle(raw: string): { text: string; extra: string } {
  const m = /^(.*?)\s*<([^>]*)>\s*$/.exec(raw)
  return m ? { text: m[1]!.trim(), extra: m[2]!.trim() } : { text: raw, extra: '' }
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1]![0] : '')).toUpperCase() || '?'
}

/** A stable hue per name, so the same person is the same colour on every row. */
function hueOf(name: string): number {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function aggregate(values: number[], how: GridColumn['total']): number | null {
  if (how === 'count') return values.length
  if (!values.length) return null
  if (how === 'sum') return values.reduce((a, b) => a + b, 0)
  if (how === 'average') return values.reduce((a, b) => a + b, 0) / values.length
  if (how === 'min') return Math.min(...values)
  if (how === 'max') return Math.max(...values)
  return null
}

const TOTAL_WORD: Record<GridColumn['total'], string> = { none: '', sum: 'Total', average: 'Avg', min: 'Min', max: 'Max', count: 'Count' }

interface Args {
  node: Node
  t: Theme
  style: React.CSSProperties
  reactKey: string | number | undefined
  part: Part
  /** Authoring canvas: the grid's own controls are a picture, the grid is selected by clicking it. */
  inert: boolean
  ControlBox: (p: { kind: 'check' | 'radio' }) => React.ReactElement
  IconGlyph: (p: { value: string; size?: number; color?: string; title?: string }) => React.ReactElement
}

export function DataGridView({ node, t, style, reactKey, part, inert, ControlBox, IconGlyph }: Args): React.ReactElement {
  const p = node.props
  const cols = gridColumns(node)
  const rows = gridRows(node)
  const status = s(p.loadState, 'ready') || 'ready'
  const currency = s(p.currency, 'USD') || 'USD'
  const density = s(p.density, 'normal') || 'normal'
  const padY = density === 'compact' ? 5 : density === 'roomy' ? 14 : 9
  const padX = t.space3
  const selectable = p.selectable === true
  const sortable = p.sortable !== false
  const rowActions = p.rowActions === true
  const showHeader = p.showHeader !== false
  const borderless = p.borderless === true
  const sticky = p.stickyHeader !== false
  const resizable = p.resizable !== false
  const lines = s(p.gridLines, 'rows') || 'rows'
  const headerStyle = s(p.headerStyle, 'band') || 'band'
  const upper = s(p.headerCase) === 'uppercase'
  const pageSize = Math.max(0, Math.round(n(p.pageSize, 0)))
  const title = s(p.title)
  const bulk = s(p.bulkActions).split(delimiterChar(p.bulkActionsSep)).map((x) => x.trim()).filter(Boolean)
  const menuItems = s(p.rowMenu).split(delimiterChar(p.rowMenuSep)).map((x) => x.trim()).filter(Boolean)
  const ctl = inert ? { inert: true } : {}

  const rule = `1px solid ${t.border}`
  const ruleStrong = `1px solid ${t.borderStrong}`
  const rowRule = lines === 'none' || borderless ? 'none' : rule
  const colRule = lines === 'all' ? rule : 'none'
  // The header band: lifted off the data by its own fill and a heavier rule.
  // `color-mix` keeps it derived from the theme, in every theme.
  const headBg =
    headerStyle === 'plain' ? t.surface : headerStyle === 'bold' ? `color-mix(in srgb, ${t.textPrimary} 10%, ${t.surface})` : `color-mix(in srgb, ${t.textPrimary} 5%, ${t.surface})`
  const headInk = headerStyle === 'bold' ? t.textPrimary : t.textSecondary
  const stripe = `color-mix(in srgb, ${t.textPrimary} 2.5%, ${t.surface})`

  // The order the grid opens in: the authored sort, applied by the same keys
  // the runtime sorts by.
  const sortCol = Math.round(n(p.sortColumn, -1))
  const sortDir = s(p.sortDirection, 'none') || 'none'
  const sortBy = sortCol >= 0 && sortDir !== 'none' ? cols[sortCol] : undefined
  const ordered = sortBy
    ? [...rows].sort((a, b) => {
      const av = a[sortBy.index] ?? ''
      const bv = b[sortBy.index] ?? ''
      const ak = sortKey(av, sortBy.type)
      const bk = sortKey(bv, sortBy.type)
      const cmp = ak !== null && bk !== null ? ak - bk : av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'desc' ? -cmp : cmp
    })
    : rows

  // Pinned columns stick at the left edge in order, after the checkbox. Only
  // a width that is KNOWN can be stacked on, so the static offsets use the
  // declared widths and the runtime measures the rest once laid out.
  const SELECT_W = 40
  let pinLeft = selectable ? SELECT_W : 0
  const pinAt = new Map<number, number>()
  for (const c of cols) {
    if (!c.pinned || c.hidden) continue
    pinAt.set(c.index, pinLeft)
    pinLeft += c.width > 0 ? c.width : 160
  }
  const anyPinned = pinAt.size > 0
  const lastPinned = Math.max(-1, ...pinAt.keys())

  const totals = cols.some((c) => c.total !== 'none')
  const bodyCols = cols.length + (selectable ? 1 : 0) + (rowActions ? 1 : 0)
  const fontSize = density === 'compact' ? t.textXs + 1 : t.textSm

  const align = (c: GridColumn): React.CSSProperties['textAlign'] => c.align
  const pinStyle = (c: GridColumn, bg: string): React.CSSProperties =>
    pinAt.has(c.index)
      ? {
        position: 'sticky',
        left: pinAt.get(c.index),
        zIndex: 1,
        background: bg,
        ...(c.index === lastPinned ? { boxShadow: `inset -1px 0 0 ${t.border}` } : {}),
      }
      : {}

  const cell = (c: GridColumn, raw: string): React.ReactNode => {
    if (raw === '') return <span {...part('content')} style={{ color: t.textMuted }}>—</span>
    const f: NumberFormat = { type: c.type, currency, decimals: c.decimals }
    switch (c.type) {
      case 'number':
      case 'currency':
      case 'percent': {
        const v = numberOf(raw)
        return v === null ? raw : formatNumber(v, f)
      }
      case 'change': {
        const v = numberOf(raw)
        if (v === null) return raw
        const ink = v > 0 ? t.success : v < 0 ? t.danger : t.textMuted
        return (
          <span {...part('content')} style={{ color: ink, fontWeight: t.weightMedium, display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <span aria-hidden="true" style={{ fontSize: '0.75em' }}>{v > 0 ? '▲' : v < 0 ? '▼' : '•'}</span>
            {formatNumber(v, f)}
          </span>
        )
      }
      case 'progress': {
        const v = numberOf(raw)
        if (v === null) return raw
        const pct = Math.max(0, Math.min(100, v))
        return (
          <span {...part('content')} style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'flex-end' }}>
            <span
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`${c.label} ${pct}%`}
              {...part('bar')}
              style={{ flex: 1, minWidth: '48px', height: '6px', borderRadius: '3px', background: `color-mix(in srgb, ${t.textPrimary} 10%, transparent)`, overflow: 'hidden' }}
            >
              <span {...part('barFill')} style={{ display: 'block', width: `${pct}%`, height: '100%', borderRadius: '3px', background: pct >= 90 ? t.warning : t.accent }} />
            </span>
            <span {...part('content')} style={{ minWidth: '3ch', color: t.textSecondary, fontSize: '0.92em' }}>{formatNumber(v, { ...f, decimals: f.decimals })}</span>
          </span>
        )
      }
      case 'date': {
        const v = dateOf(raw)
        return v === null ? raw : <time dateTime={raw}>{formatDate(v)}</time>
      }
      case 'status': {
        const tone = toneOf(raw, c)
        const ink = tone === 'success' ? t.success : tone === 'warning' ? t.warning : tone === 'danger' ? t.danger : tone === 'info' ? t.accent : t.textSecondary
        return (
          <span
            data-loom-tone={tone}
            {...part('pill')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '2px 9px 2px 7px',
              borderRadius: `${t.radiusFull}px`,
              fontSize: '0.88em',
              fontWeight: t.weightMedium,
              color: ink,
              background: `color-mix(in srgb, ${ink} 13%, transparent)`,
              border: `1px solid color-mix(in srgb, ${ink} 28%, transparent)`,
              lineHeight: 1.5,
            }}
          >
            <span aria-hidden="true" {...part('dot')} style={{ width: '6px', height: '6px', borderRadius: '50%', background: ink }} />
            {raw}
          </span>
        )
      }
      case 'person': {
        const { text, extra } = splitAngle(raw)
        return (
          <span {...part('content')} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <span
              aria-hidden="true"
              {...part('avatar')}
              style={{
                flexShrink: 0,
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '11px',
                fontWeight: t.weightSemibold,
                color: '#fff',
                background: `hsl(${hueOf(text)} 52% 44%)`,
              }}
            >
              {initials(text)}
            </span>
            <span {...part('content')} style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.3 }}>
              <span {...part('content')} style={{ fontWeight: t.weightMedium, color: t.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
              {extra ? <span {...part('content')} style={{ fontSize: '0.86em', color: t.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>{extra}</span> : null}
            </span>
          </span>
        )
      }
      case 'check':
        return truthy(raw) ? (
          <span role="img" aria-label="Yes" {...part('content')} style={{ display: 'inline-flex', color: t.success }}>
            <IconGlyph value="check" size={16} />
          </span>
        ) : (
          <span role="img" aria-label="No" {...part('content')} style={{ color: t.textMuted }}>—</span>
        )
      case 'link': {
        const { text, extra } = splitAngle(raw)
        return (
          <a href={extra || '#'} data-loom-grid-link="" {...part('content')} style={{ color: t.accent, textDecoration: 'none', fontWeight: t.weightMedium }}>
            {text}
          </a>
        )
      }
      case 'tags':
        return (
          <span {...part('content')} style={{ display: 'inline-flex', flexWrap: c.wrap ? 'wrap' : 'nowrap', gap: '4px' }}>
            {raw.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => (
              <span
                key={tag}
                {...part('pill')}
                style={{
                  padding: '1px 8px',
                  borderRadius: `${t.radiusSm}px`,
                  fontSize: '0.86em',
                  color: t.textSecondary,
                  background: `color-mix(in srgb, ${t.textPrimary} 7%, transparent)`,
                  border: `1px solid ${t.border}`,
                  whiteSpace: 'nowrap',
                }}
              >
                {tag}
              </span>
            ))}
          </span>
        )
      default:
        return raw
    }
  }

  const totalOf = (c: GridColumn): string => {
    if (c.total === 'none') return ''
    if (c.total === 'count') return String(rows.filter((r) => (r[c.index] ?? '') !== '').length)
    const vals = rows.map((r) => sortKey(r[c.index] ?? '', NUMERIC.has(c.type) ? c.type : 'number')).filter((v): v is number => v !== null)
    const v = aggregate(vals, c.total)
    return v === null ? '—' : formatNumber(v, { type: c.type === 'progress' ? 'percent' : NUMERIC.has(c.type) ? c.type : 'number', currency, decimals: c.decimals >= 0 ? c.decimals : c.total === 'average' ? 1 : -1 })
  }

  const visibleRows = pageSize > 0 ? ordered.slice(0, pageSize) : ordered
  const pages = pageSize > 0 ? Math.max(1, Math.ceil(ordered.length / pageSize)) : 1
  const btn: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '30px',
    padding: '0 10px',
    borderRadius: `${t.radiusSm}px`,
    border: `1px solid ${t.border}`,
    background: t.surface,
    color: t.textSecondary,
    fontSize: `${t.textXs + 1}px`,
    fontWeight: t.weightMedium,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
  const hasToolbar = title !== '' || p.search === true || p.columnPicker === true || p.exportCsv === true
  const menuPanel: React.CSSProperties = {
    position: 'absolute',
    zIndex: 40,
    minWidth: '168px',
    display: 'none',
    flexDirection: 'column',
    padding: '4px',
    borderRadius: `${t.radiusMd}px`,
    background: t.surface,
    border: `1px solid ${t.borderStrong}`,
    boxShadow: t.shadowLg,
    textAlign: 'left',
  }

  const frame: React.CSSProperties = {
    ...style,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: style.borderRadius ?? `${t.radiusLg}px`,
    border: style.border ?? (borderless ? 'none' : rule),
    background: style.background ?? t.surface,
    // Clips the corners; the menus are placed by the runtime on top of it.
    overflow: 'hidden',
    fontSize: `${fontSize}px`,
    color: t.textPrimary,
    ...(p.hoverable === false ? { ['--loom-row-hover' as string]: 'transparent' } : {}),
    ['--loom-grid-pick' as string]: `color-mix(in srgb, ${t.accent} 11%, ${t.surface})`,
    ['--loom-grid-stripe' as string]: stripe,
  }

  return (
    <div
      key={reactKey}
      style={frame}
      data-loom-grid={node.id}
      data-loom-visible={String(Math.min(ordered.length, 1))}
      data-loom-selected="0"
      data-loom-page="1"
      data-loom-page-size={pageSize || undefined}
      data-loom-status={status}
      data-loom-title={title || undefined}
      data-loom-currency={currency}
    >
      {hasToolbar && (
        <div
          data-loom-grid-toolbar=""
          {...part('toolbar')}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: `${t.space2}px`, minHeight: '52px', padding: `${t.space2}px ${t.space3}px`, borderBottom: borderless ? 'none' : rule }}
        >
          {title !== '' && (
            <div {...part('title')} style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginRight: 'auto', minWidth: 0 }}>
              <span {...part('title')} style={{ fontSize: `${t.textMd}px`, fontWeight: t.weightSemibold, color: t.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
              {p.showCount !== false && (
                <span
                  data-loom-grid-count=""
                  {...part('count')}
                  style={{ fontSize: `${t.textXs}px`, fontWeight: t.weightSemibold, color: t.textMuted, padding: '1px 7px', borderRadius: `${t.radiusFull}px`, background: `color-mix(in srgb, ${t.textPrimary} 7%, transparent)`, fontVariantNumeric: 'tabular-nums' }}
                >
                  {status === 'ready' ? rows.length : status === 'empty' ? 0 : '–'}
                </span>
              )}
            </div>
          )}
          {title === '' && <span style={{ marginRight: 'auto' }} />}
          {p.search === true && (
            <label
              {...ctl}
              {...part('search')}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '220px', maxWidth: '40%', height: '30px', padding: '0 10px', borderRadius: `${t.radiusSm}px`, border: rule, background: `color-mix(in srgb, ${t.textPrimary} 3%, ${t.surface})`, color: t.textMuted }}
            >
              <IconGlyph value="search" size={14} />
              <input
                type="search"
                data-loom-filter={node.id}
                {...part('search')}
                placeholder={s(p.searchPlaceholder) || 'Search'}
                aria-label={s(p.searchPlaceholder) || 'Search'}
                style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: t.textPrimary, fontSize: `${t.textXs + 1}px` }}
              />
            </label>
          )}
          {p.columnPicker === true && cols.length > 0 && (
            <div data-loom-menu={groupId(node.id, 'cols')} style={{ position: 'relative' }} {...ctl}>
              <button type="button" data-loom-menu-trigger={groupId(node.id, 'cols')} aria-haspopup="true" aria-expanded="false" {...part('tool')} style={btn}>
                <IconGlyph value="eye" size={14} />
                Columns
              </button>
              <div role="menu" aria-label="Show columns" data-loom-menu-panel={groupId(node.id, 'cols')} data-loom-open="0" data-loom-float="" {...(inert ? {} : { popover: 'manual' as const })} {...part('menu')} style={{ ...menuPanel, right: 0, top: '36px' }}>
                {cols.map((c) => (
                  <label key={c.index} {...part('menuItem')} role="menuitemcheckbox" aria-checked={!c.hidden} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: `${t.radiusSm}px`, fontSize: `${t.textSm}px`, color: t.textPrimary, cursor: 'pointer' }}>
                    <input type="checkbox" data-loom-ctl="" data-loom-col-toggle={c.index} defaultChecked={!c.hidden} />
                    <ControlBox kind="check" />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          )}
          {p.exportCsv === true && (
            <button type="button" data-loom-grid-csv={node.id} {...part('tool')} style={btn} {...ctl}>
              <IconGlyph value="download" size={14} />
              Export
            </button>
          )}

          {/* A selection swaps the toolbar for the bulk bar, in place. */}
          {selectable && (
            <div
              data-loom-bulk={groupId(node.id, 'bulk')}
              {...ctl}
              {...part('bulk')}
              style={{ position: 'absolute', inset: 0, display: 'none', alignItems: 'center', gap: `${t.space2}px`, padding: `0 ${t.space3}px`, background: `color-mix(in srgb, ${t.accent} 9%, ${t.surface})` }}
            >
              <span data-loom-bulk-count="" {...part('bulk')} style={{ fontSize: `${t.textSm}px`, fontWeight: t.weightSemibold, color: t.accent, marginRight: 'auto' }}>
                0 selected
              </span>
              {bulk.map((b) => (
                <button key={b} type="button" data-loom-b="press" data-loom-action={b.toLowerCase()} {...part('tool')} style={{ ...btn, color: /^(delete|remove)$/i.test(b) ? t.danger : t.textPrimary }}>
                  {b}
                </button>
              ))}
              <button type="button" data-loom-grid-clear={node.id} aria-label="Clear selection" {...part('tool')} style={{ ...btn, border: 'none', background: 'transparent' }}>
                <IconGlyph value="x" size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      <div
        data-loom-grid-scroll=""
        style={{ overflow: 'auto', flex: 1, minHeight: 0, ...(n(p.height, 0) > 0 ? { maxHeight: `${n(p.height, 0)}px` } : {}) }}
      >
        <table
          aria-label={s(p.ariaLabel) || title || undefined}
          aria-busy={status === 'loading' ? true : undefined}
          style={{ width: '100%', minWidth: 'max-content', borderCollapse: 'separate', borderSpacing: 0, fontVariantNumeric: 'var(--loom-numeric)' as string }}
        >
          <colgroup>
            {selectable && <col style={{ width: `${SELECT_W}px` }} />}
            {cols.map((c) => (
              <col key={c.index} data-loom-col={c.index} style={{ ...(c.width > 0 ? { width: `${c.width}px` } : {}), ...(c.hidden ? { visibility: 'collapse' } : {}) }} />
            ))}
            {rowActions && <col style={{ width: '44px' }} />}
          </colgroup>
          {showHeader && (
            <thead>
              <tr>
                {selectable && (
                  <th
                    scope="col"
                    {...part('header')}
                    style={{ position: sticky || anyPinned ? 'sticky' : 'static', top: 0, left: anyPinned ? 0 : undefined, zIndex: 3, background: headBg, padding: `0 0 0 ${padX}px`, borderBottom: ruleStrong, textAlign: 'left' }}
                  >
                    <label style={{ display: 'inline-flex', cursor: 'pointer' }} {...ctl}>
                      <input type="checkbox" data-loom-ctl="" data-loom-select-all={node.id} aria-label="Select all rows" />
                      <ControlBox kind="check" />
                    </label>
                  </th>
                )}
                {cols.map((c) => {
                  const on = sortBy?.index === c.index
                  const canSort = sortable && c.sortable
                  return (
                    <th
                      key={c.index}
                      scope="col"
                      data-loom-col={c.index}
                      data-loom-type={c.type}
                      {...part('header')}
                      aria-sort={canSort ? (on ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                      {...(canSort ? { ...behaviourAttrs({ role: 'sort', group: node.id, index: c.index }), tabIndex: 0 } : {})}
                      {...(on ? { 'data-loom-sort': sortDir } : {})}
                      style={{
                        position: sticky ? 'sticky' : 'relative',
                        top: 0,
                        zIndex: pinAt.has(c.index) ? 3 : 2,
                        background: headBg,
                        textAlign: align(c),
                        padding: `${Math.max(padY, 8)}px ${padX}px`,
                        borderBottom: ruleStrong,
                        borderRight: colRule,
                        color: on ? t.textPrimary : headInk,
                        fontSize: `${upper ? t.textXs - 1 : t.textXs + 1}px`,
                        fontWeight: headerStyle === 'bold' ? t.weightBold : t.weightSemibold,
                        textTransform: upper ? 'uppercase' : 'none',
                        letterSpacing: upper ? '0.6px' : '0.1px',
                        whiteSpace: 'nowrap',
                        cursor: canSort ? 'pointer' : 'default',
                        userSelect: 'none',
                        ...(c.width > 0 ? { width: `${c.width}px`, minWidth: `${c.width}px` } : {}),
                        ...(c.hidden ? { display: 'none' } : {}),
                        ...pinStyle(c, headBg),
                      }}
                    >
                      <span {...part('columnTitle')} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexDirection: c.align === 'right' ? 'row-reverse' : 'row' }}>
                        <span>{c.label}</span>
                        {c.help && (
                          <span title={c.help} aria-label={c.help} role="img" {...part('marks')} style={{ display: 'inline-flex', color: t.textMuted }}>
                            <IconGlyph value="info" size={12} />
                          </span>
                        )}
                        {canSort && (
                          <span data-loom-sort-mark="" aria-hidden="true" {...part('marks')} style={{ display: 'inline-flex', flexDirection: 'column', gap: '1px', color: t.accent }}>
                            <svg data-loom-up="" width="8" height="5" viewBox="0 0 8 5"><path d="M4 0 8 5H0z" fill="currentColor" /></svg>
                            <svg data-loom-down="" width="8" height="5" viewBox="0 0 8 5"><path d="M4 5 0 0h8z" fill="currentColor" /></svg>
                          </span>
                        )}
                      </span>
                      {resizable && <span data-loom-col-resize={c.index} aria-hidden="true" />}
                    </th>
                  )
                })}
                {rowActions && (
                  <th scope="col" aria-label="Actions" {...part('header')} style={{ position: sticky ? 'sticky' : 'static', top: 0, zIndex: 2, background: headBg, borderBottom: ruleStrong }}>
                  </th>
                )}
              </tr>
            </thead>
          )}

          <tbody data-loom-rows="">
            {status === 'loading' &&
              Array.from({ length: Math.min(pageSize || 5, 8) }, (_, i) => (
                <tr key={`sk${i}`} data-loom-skeleton="">
                  {selectable && <td {...part('cell')} style={{ padding: `${padY}px ${padX}px`, borderBottom: rowRule }} />}
                  {cols.map((c) => (
                    <td key={c.index} {...part('cell')} style={{ padding: `${padY + 3}px ${padX}px`, borderBottom: rowRule, ...(c.hidden ? { display: 'none' } : {}) }}>
                      <span
                        data-loom-shimmer=""
                        {...part('skeleton')}
                        style={{ display: 'block', height: '10px', borderRadius: '5px', width: `${45 + ((i * 17 + c.index * 23) % 45)}%`, marginLeft: c.align === 'right' ? 'auto' : undefined, background: `color-mix(in srgb, ${t.textPrimary} 9%, transparent)` }}
                      />
                    </td>
                  ))}
                  {rowActions && <td style={{ borderBottom: rowRule }} />}
                </tr>
              ))}

            {status === 'ready' &&
              ordered.map((r, i) => {
                const hiddenByPage = pageSize > 0 && i >= pageSize
                const rowBg = p.striped === true && i % 2 === 1 ? stripe : t.surface
                return (
                  <tr
                    key={i}
                    data-loom-row=""
                    data-loom-filter-text={cols.map((c) => r[c.index] ?? '').join(' ')}
                    {...(hiddenByPage ? { 'data-loom-paged': '1' } : {})}
                    {...part('row')}
                    style={{ background: rowBg, ...(hiddenByPage ? { display: 'none' } : {}) }}
                  >
                    {selectable && (
                      <td {...part('cell')} style={{ padding: `0 0 0 ${padX}px`, borderBottom: rowRule, ...(anyPinned ? { position: 'sticky', left: 0, zIndex: 1, background: 'inherit' } : {}) }}>
                        <label style={{ display: 'inline-flex', cursor: 'pointer' }} {...ctl}>
                          <input type="checkbox" data-loom-ctl="" data-loom-select={node.id} aria-label={`Select ${r[cols.find((c) => !c.hidden)?.index ?? 0] || `row ${i + 1}`}`} />
                          <ControlBox kind="check" />
                        </label>
                      </td>
                    )}
                    {cols.map((c) => {
                      const raw = r[c.index] ?? ''
                      const key = sortKey(raw, c.type)
                      return (
                        <td
                          key={c.index}
                          // Addressed BY COLUMN, not by position: a selectable
                          // grid has a checkbox cell first, so child N is not
                          // column N.
                          data-loom-cell={c.index}
                          data-loom-col={c.index}
                          data-loom-raw={raw}
                          {...(key !== null ? { 'data-loom-v': String(key) } : {})}
                          {...part('cell')}
                          title={!c.wrap && c.type === 'text' && raw.length > 28 ? raw : undefined}
                          style={{
                            padding: `${padY}px ${padX}px`,
                            borderBottom: rowRule,
                            borderRight: colRule,
                            textAlign: align(c),
                            color: c.type === 'text' && c.index !== 0 ? t.textSecondary : t.textPrimary,
                            whiteSpace: c.wrap ? 'normal' : 'nowrap',
                            ...(c.wrap ? { minWidth: '160px' } : c.type === 'text' && c.width === 0 ? { maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
                            ...(c.hidden ? { display: 'none' } : {}),
                            ...pinStyle(c, 'inherit'),
                          }}
                        >
                          {cell(c, raw)}
                        </td>
                      )
                    })}
                    {rowActions && (
                      <td {...part('cell')} style={{ padding: `0 ${t.space2}px`, borderBottom: rowRule, textAlign: 'right' }}>
                        {menuItems.length > 0 && (
                          <div data-loom-menu={groupId(node.id, 'row' + i)} style={{ display: 'inline-block', position: 'relative' }} {...ctl}>
                            <button
                              type="button"
                              aria-label={`Actions for ${r[0] || `row ${i + 1}`}`}
                              aria-haspopup="true"
                              aria-expanded="false"
                              data-loom-menu-trigger={groupId(node.id, 'row' + i)}
                              data-loom-row-more=""
                              {...part('tool')}
                              style={{ background: 'transparent', border: 'none', borderRadius: `${t.radiusSm}px`, color: t.textMuted, cursor: 'pointer', width: '28px', height: '28px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                            >
                              <IconGlyph value="more" size={16} />
                            </button>
                            <div role="menu" data-loom-menu-panel={groupId(node.id, 'row' + i)} data-loom-open="0" data-loom-float="" {...(inert ? {} : { popover: 'manual' as const })} {...part('menu')} style={{ ...menuPanel, right: 0, top: '32px' }}>
                              {menuItems.map((item) => (
                                <div
                                  key={item}
                                  role="menuitem"
                                  {...part('menuItem')}
                                  tabIndex={0}
                                  data-loom-b="press"
                                  data-loom-action={item.toLowerCase()}
                                  style={{ padding: '7px 10px', borderRadius: `${t.radiusSm}px`, fontSize: `${t.textSm}px`, color: /^(delete|remove)$/i.test(item) ? t.danger : t.textPrimary, cursor: 'pointer' }}
                                >
                                  {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}

            {/* No data, no match, or a failed load: a designed message in the
                grid's own frame, never a blank box. */}
            {(status === 'empty' || status === 'error' || status === 'ready') && (
              <tr data-loom-nomatch="" style={{ display: status === 'ready' && rows.length > 0 ? 'none' : undefined }}>
                <td colSpan={bodyCols} {...part('cell')} style={{ padding: `${t.space6}px ${t.space4}px`, textAlign: 'center' }}>
                  <div {...part('message')} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: t.textMuted, fontSize: `${t.textSm}px` }}>
                    <span
                      aria-hidden="true"
                      {...part('messageIcon')}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '50%', background: status === 'error' ? `color-mix(in srgb, ${t.danger} 12%, transparent)` : `color-mix(in srgb, ${t.textPrimary} 6%, transparent)`, color: status === 'error' ? t.danger : t.textMuted }}
                    >
                      <IconGlyph value={status === 'error' ? 'alert-triangle' : status === 'empty' || rows.length === 0 ? 'database' : 'search'} size={18} />
                    </span>
                    <span data-loom-nomatch-text="" {...part('message')} style={{ color: status === 'error' ? t.textPrimary : t.textSecondary, fontWeight: t.weightMedium }}>
                      {status === 'error' ? s(p.errorMessage) || 'Could not load this data' : status === 'empty' || rows.length === 0 ? s(p.emptyMessage) || 'Nothing to show yet' : 'No rows match your search'}
                    </span>
                    {status === 'error' ? (
                      <button type="button" data-loom-b="press" data-loom-action="retry" {...part('tool')} style={btn} {...ctl}>
                        <IconGlyph value="refresh" size={14} />
                        Try again
                      </button>
                    ) : status === 'ready' && rows.length > 0 ? (
                      <button type="button" data-loom-grid-unfilter={node.id} {...part('tool')} style={btn} {...ctl}>
                        Clear search
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            )}
          </tbody>

          {totals && status === 'ready' && rows.length > 0 && (
            <tfoot>
              <tr>
                {selectable && <td {...part('footer')} style={{ background: headBg, borderTop: ruleStrong, ...(anyPinned ? { position: 'sticky', left: 0, zIndex: 1 } : {}) }} />}
                {cols.map((c) => (
                  <td
                    key={c.index}
                    data-loom-col={c.index}
                    {...part('footer')}
                    {...(c.total !== 'none'
                      ? { 'data-loom-total': c.total, 'data-loom-fmt': JSON.stringify({ type: c.type === 'progress' ? 'percent' : NUMERIC.has(c.type) ? c.type : 'number', currency, decimals: c.decimals >= 0 ? c.decimals : c.total === 'average' ? 1 : -1 }) }
                      : {})}
                    style={{
                      padding: `${Math.max(padY, 8)}px ${padX}px`,
                      background: headBg,
                      borderTop: ruleStrong,
                      borderRight: colRule,
                      textAlign: align(c),
                      whiteSpace: 'nowrap',
                      fontWeight: t.weightSemibold,
                      color: t.textPrimary,
                      ...(c.hidden ? { display: 'none' } : {}),
                      ...pinStyle(c, headBg),
                    }}
                  >
                    {c.total !== 'none' && (
                      <>
                        <span {...part('footer')} style={{ fontSize: `${t.textXs - 1}px`, fontWeight: t.weightSemibold, textTransform: 'uppercase', letterSpacing: '0.5px', color: t.textMuted, marginRight: '6px' }}>
                          {TOTAL_WORD[c.total]}
                        </span>
                        <span data-loom-sum="">{totalOf(c)}</span>
                      </>
                    )}
                  </td>
                ))}
                {rowActions && <td {...part('footer')} style={{ background: headBg, borderTop: ruleStrong }} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {pageSize > 0 && status === 'ready' && (
        <div
          data-loom-grid-pager=""
          {...part('footer')}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: `${t.space3}px`, padding: `${t.space2}px ${t.space3}px`, borderTop: borderless ? 'none' : rule, fontSize: `${t.textXs + 1}px`, color: t.textMuted }}
        >
          <span data-loom-page-label="" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {ordered.length === 0 ? '0 of 0' : `1–${visibleRows.length} of ${ordered.length}`}
          </span>
          <span style={{ display: 'inline-flex', gap: '4px' }} {...ctl}>
            <button type="button" data-loom-page-step="-1" aria-label="Previous page" disabled {...part('tool')} style={{ ...btn, padding: '0 6px' }}>
              <IconGlyph value="chevron-left" size={16} />
            </button>
            <button type="button" data-loom-page-step="1" aria-label="Next page" disabled={pages <= 1} {...part('tool')} style={{ ...btn, padding: '0 6px' }}>
              <IconGlyph value="chevron-right" size={16} />
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
