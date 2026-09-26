/**
 * Demo document seeder.
 *
 * Builds a representative scene so the canvas is never empty during review:
 * nested containers, flow layout, bound data, a web-only effect, and
 * components that are portable across both targets.
 *
 * This goes through the SAME store path a toolbox drop does. It never
 * hand-writes a props object or pre-links children on an insert — doing that
 * bypasses schema normalisation and double-links every child, which is
 * exactly how the first version of this file produced a document that
 * rendered 24 labels for 9 nodes.
 */

import type { EditorStore } from './state/store'
import type { NodeId, PropValue } from './model/types'

/** Drop a component under `parent`, the same way the toolbox does. */
function drop(
  s: EditorStore,
  parent: NodeId,
  type: string,
  props: Record<string, PropValue> = {},
  opts: { flow?: boolean; x?: number; y?: number } = {},
): NodeId | undefined {
  return s.addComponent(
    type,
    parent,
    opts.x ?? 0,
    opts.y ?? 0,
    props,
    opts.flow === undefined ? {} : { flow: opts.flow },
  )
}

export function seedDemo(s: EditorStore) {
  const root = s.doc.root

  // Root is a flow column; children stack and `gap` applies.
  s.commitAll(
    [
      { op: 'setFlow', id: root, flow: true },
      { op: 'setProp', id: root, key: 'padding', value: 28 },
      { op: 'setProp', id: root, key: 'gap', value: 20 },
      { op: 'setProp', id: root, key: 'direction', value: 'column' },
      { op: 'rename', name: 'Telemetry Console' },
    ],
    'Seed document',
  )

  // ---- header -------------------------------------------------------
  const header = drop(s, root, 'Panel', { padding: 0, gap: 6, surface: 'solid' }, { flow: true })
  if (header) {
    drop(s, header, 'Label', { text: 'Telemetry Console', size: 'xl', weight: '700', color: '#f2f5fa' })
    drop(
      s,
      header,
      'Label',
      {
        text: 'Live system state · 4 sources · updated 2s ago',
        size: 'sm',
        weight: '400',
        color: '#8a94a8',
      },
    )
  }

  // ---- stats row: a 3-up grid of glass cards ------------------------
  const stats = drop(s, root, 'Panel', { padding: 20, gap: 18 }, { flow: true })
  if (!stats) return
  const row = drop(s, stats, 'Grid', { columns: 3, gap: 18 }, { flow: true })
  if (!row) return

  const gaugeCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (gaugeCard) {
    drop(s, gaugeCard, 'Label', { text: 'CPU LOAD', size: 'xs', weight: '600', color: '#8a94a8' })
    const gauge = drop(s, gaugeCard, 'Gauge', { value: 73.4, size: 150 })
    drop(s, gaugeCard, 'Label', { text: '8 of 16 cores active', size: 'xs', color: '#6b7488' })
    if (gauge) s.select([gauge])
  }

  const trendCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (trendCard) {
    drop(s, trendCard, 'Label', { text: 'MEMORY · 60s', size: 'xs', weight: '600', color: '#8a94a8' })
    drop(s, trendCard, 'Sparkline', {
      points: '38,44,41,52,49,61,58,66,72,69,81,78,88',
      width: 240,
      height: 72,
      accent: '#5b8cff',
      shader: true,
    })
    drop(s, trendCard, 'Label', { text: '6.2 GB / 16 GB', size: 'xs', color: '#6b7488' })
  }

  const actionsCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (actionsCard) {
    drop(s, actionsCard, 'Label', { text: 'ACTIONS', size: 'xs', weight: '600', color: '#8a94a8' })
    drop(s, actionsCard, 'Input', { placeholder: 'Filter sources…', width: 240 })
    drop(s, actionsCard, 'Button', { label: 'Apply', variant: 'primary', glow: true, action: 'apply.filter' })
    drop(s, actionsCard, 'Button', { label: 'Reset', variant: 'ghost', action: 'filter.reset' })
  }

  // ---- footer note ---------------------------------------------------
  // Parented to a flow root, so it JOINS the flow rather than floating.
  // Free positioning is exercised by the drag tests, not by the fixture.
  drop(s, root, 'Label', {
    text: 'Sparkline shader is web-only — switch the target to see it flagged',
    size: 'xs',
    color: '#4a5266',
  })
}
