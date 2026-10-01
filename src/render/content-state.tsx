/**
 * Content states, drawn: what a data-bearing tool looks like while it LOADS,
 * when there is NOTHING to show, and when loading FAILED. A designer has to
 * design those screens too, and a blank box is not a design.
 *
 * One look for every tool (the DataGrid's, which set the bar): a skeleton in
 * the tool's own shape while loading (bars for a bar chart, a ring for a pie,
 * rows for a list), and a centred icon, message and, on failure, a "Try
 * again" that fires `loom:retry`. The tool's own frame (its size, surface and
 * padding) is kept, so the state sits exactly where the content will.
 */

import React from 'react'
import type { Node, PropValue } from '../model/types'
import type { Theme } from './theme'

export type LoadState = 'ready' | 'loading' | 'empty' | 'error'

type Part = (name: string | string[]) => Record<string, string>
type Glyph = (p: { value: string; size?: number; color?: string; title?: string }) => React.ReactElement

type Shape = 'bars' | 'line' | 'ring' | 'metric' | 'list' | 'timeline' | 'cards'

/** Each tool's loading silhouette and its empty icon. */
const SHAPES: Record<string, { shape: Shape; icon: string }> = {
  BarChart: { shape: 'bars', icon: 'activity' },
  LineChart: { shape: 'line', icon: 'trending' },
  Sparkline: { shape: 'line', icon: 'trending' },
  PieChart: { shape: 'ring', icon: 'circle' },
  Gauge: { shape: 'ring', icon: 'activity' },
  KpiCard: { shape: 'metric', icon: 'activity' },
  Stat: { shape: 'metric', icon: 'activity' },
  DataCard: { shape: 'metric', icon: 'database' },
  DataList: { shape: 'list', icon: 'list' },
  TreeList: { shape: 'list', icon: 'folder' },
  Timeline: { shape: 'timeline', icon: 'clock' },
  KanbanColumn: { shape: 'cards', icon: 'grid' },
}

export function loadStateOf(node: Node): LoadState {
  const v = node.props.loadState
  return v === 'loading' || v === 'empty' || v === 'error' ? v : 'ready'
}

const s = (v: PropValue | undefined, d: string): string => (typeof v === 'string' && v.trim() !== '' ? v : d)

/** The icon, message and action, the same in every tool (and in the DataGrid's own rows). */
export function StateMessage({
  kind,
  text,
  icon,
  t,
  part,
  IconGlyph,
  action,
  compact = false,
  inert = false,
}: {
  kind: 'empty' | 'error' | 'nomatch'
  text: string
  icon: string
  t: Theme
  part: Part
  IconGlyph: Glyph
  action?: React.ReactNode
  compact?: boolean
  inert?: boolean
}): React.ReactElement {
  const err = kind === 'error'
  const ring = compact ? 28 : 40
  return (
    <div
      {...part('message')}
      role={err ? 'alert' : 'status'}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: compact ? '4px' : '8px', textAlign: 'center', color: t.textMuted, fontSize: `${compact ? t.textXs : t.textSm}px` }}
      {...(inert ? { inert: true } : {})}
    >
      <span
        aria-hidden="true"
        {...part('messageIcon')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: `${ring}px`,
          height: `${ring}px`,
          borderRadius: '50%',
          flexShrink: 0,
          background: err ? `color-mix(in srgb, ${t.danger} 12%, transparent)` : `color-mix(in srgb, ${t.textPrimary} 6%, transparent)`,
          color: err ? t.danger : t.textMuted,
        }}
      >
        <IconGlyph value={err ? 'alert-triangle' : icon} size={compact ? 14 : 18} />
      </span>
      <span {...part('message')} style={{ color: err ? t.textPrimary : t.textSecondary, fontWeight: t.weightMedium }}>
        {text}
      </span>
      {action}
    </div>
  )
}

/** A placeholder bar, shimmering (the runtime's `data-loom-shimmer` rule). */
function Bar({ t, part, w, h = 10, round = 5, style }: { t: Theme; part: Part; w: string; h?: number; round?: number; style?: React.CSSProperties }) {
  return (
    <span
      data-loom-shimmer=""
      {...part('skeleton')}
      style={{ display: 'block', width: w, height: `${h}px`, borderRadius: `${round}px`, background: `color-mix(in srgb, ${t.textPrimary} 9%, transparent)`, flexShrink: 0, ...style }}
    />
  )
}

function Skeleton({ shape, t, part }: { shape: Shape; t: Theme; part: Part }): React.ReactElement {
  const fill = `color-mix(in srgb, ${t.textPrimary} 9%, transparent)`
  switch (shape) {
    case 'bars':
      return (
        <div {...part('placeholder')} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8%', padding: '6px 4px 0', minHeight: 0 }}>
          {[55, 80, 40, 95, 65, 75, 35].map((h, i) => (
            <Bar key={i} t={t} part={part} w="100%" h={0} round={3} style={{ height: `${h}%`, flex: 1 }} />
          ))}
        </div>
      )
    case 'line':
      return (
        <div {...part('placeholder')} style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <svg data-loom-shimmer="" {...part('skeleton')} viewBox="0 0 100 40" preserveAspectRatio="none" style={{ flex: 1, width: '100%', minHeight: 0, display: 'block', color: fill }} aria-hidden="true">
          <path d="M0 30 C 12 22, 20 26, 30 18 S 50 24, 60 14 S 82 10, 100 6" fill="none" stroke="currentColor" strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinecap="round" />
          <path d="M0 39.5 H100" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        </div>
      )
    case 'ring':
      return (
        <div {...part('placeholder')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
          <span data-loom-shimmer="" {...part('skeleton')} style={{ width: '70%', maxWidth: '100%', aspectRatio: '1 / 1', borderRadius: '50%', border: `10px solid ${fill}`, boxSizing: 'border-box' }} />
        </div>
      )
    case 'metric':
      return (
        <div {...part('placeholder')} style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
          <Bar t={t} part={part} w="42%" h={9} />
          <Bar t={t} part={part} w="64%" h={24} round={6} />
          <Bar t={t} part={part} w="30%" h={9} />
        </div>
      )
    case 'list':
    case 'timeline':
      return (
        <div {...part('placeholder')} style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
          {[72, 54, 64, 46].map((w, i) => (
            <div {...part('placeholder')} key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Bar t={t} part={part} w={shape === 'timeline' ? '10px' : '24px'} h={shape === 'timeline' ? 10 : 24} round={12} />
              <div {...part('placeholder')} style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                <Bar t={t} part={part} w={`${w}%`} h={9} />
                <Bar t={t} part={part} w={`${w - 24}%`} h={7} />
              </div>
            </div>
          ))}
        </div>
      )
    case 'cards':
      return (
        <div {...part('placeholder')} style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
          {[0, 1, 2].map((i) => (
            <Bar key={i} t={t} part={part} w="100%" h={56} round={8} />
          ))}
        </div>
      )
  }
}

/**
 * The body of a tool in a content state, inside the tool's own frame (`style`
 * is the frame the tool computed for itself). Returns null when the tool is
 * ready, or does not carry the states.
 */
export function contentStateBody({
  node,
  style,
  reactKey,
  t,
  part,
  IconGlyph,
  inert,
}: {
  node: Node
  style: React.CSSProperties
  reactKey: string | number | undefined
  t: Theme
  part: Part
  IconGlyph: Glyph
  inert: boolean
}): React.ReactElement | null {
  const meta = SHAPES[node.type]
  const state = loadStateOf(node)
  if (!meta || state === 'ready') return null
  const p = node.props
  // Small frames (a sparkline, a KPI tile) get the compact message.
  const h = typeof p.height === 'number' ? p.height : typeof p.h === 'number' ? p.h : 999
  const compact = h < 120 || node.type === 'Sparkline' || node.type === 'Stat'
  const frame: React.CSSProperties = {
    ...style,
    display: 'flex',
    flexDirection: 'column',
    alignItems: state === 'loading' ? 'stretch' : 'center',
    justifyContent: state === 'loading' && meta.shape !== 'bars' && meta.shape !== 'line' && meta.shape !== 'ring' ? 'flex-start' : 'center',
    gap: '8px',
    // A tool that sizes to its content keeps a floor, so a state is never a sliver.
    minHeight: style.height === undefined && style.minHeight === undefined ? (compact ? 64 : 140) : style.minHeight,
    // ...and a width floor: a list sized by its rows has no rows yet.
    minWidth: style.width === undefined && style.minWidth === undefined ? (compact ? 160 : 240) : style.minWidth,
  }
  return (
    <div key={reactKey} style={frame} data-loom-load={state} {...(state === 'loading' ? { 'aria-busy': true, role: 'status', 'aria-label': 'Loading' } : {})}>
      {state === 'loading' ? (
        <Skeleton shape={meta.shape} t={t} part={part} />
      ) : (
        <StateMessage
          kind={state}
          text={state === 'error' ? s(p.errorMessage, 'Could not load this data') : s(p.emptyMessage, 'Nothing to show yet')}
          icon={meta.icon}
          t={t}
          part={part}
          IconGlyph={IconGlyph}
          compact={compact}
          action={
            state === 'error' ? (
              <button
                type="button"
                data-loom-b="press"
                data-loom-action="retry"
                {...part('action')}
                {...(inert ? { inert: true } : {})}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  height: compact ? '24px' : '30px',
                  padding: '0 10px',
                  marginTop: compact ? 0 : '2px',
                  borderRadius: `${t.radiusSm}px`,
                  border: `1px solid ${t.border}`,
                  background: t.surface,
                  color: t.textSecondary,
                  fontSize: `${t.textXs + 1}px`,
                  fontWeight: t.weightMedium,
                  cursor: 'pointer',
                }}
              >
                <IconGlyph value="refresh" size={13} />
                Try again
              </button>
            ) : undefined
          }
        />
      )}
    </div>
  )
}
