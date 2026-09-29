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
  parent: NodeId | null,
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
  // The demo CREATES the root, exactly like a user's first drop: nothing is
  // pre-existing. Seeding onto an empty document is the honest path and it
  // keeps the fixture honest about the rootless model.
  const root = drop(s, s.doc.root, 'Panel')
  if (root === undefined) return

  // Root is a flow column; children stack and `gap` applies.
  s.commitAll(
    [
      { op: 'setFlow', id: root, flow: true },
      { op: 'setProp', id: root, key: 'padding', value: 28 },
      { op: 'setProp', id: root, key: 'gap', value: 20 },
      { op: 'setProp', id: root, key: 'direction', value: 'column' },
      { op: 'rename', name: 'Telemetry Console' },
      // The premium look is glass over colour: the page is the aurora, and
      // every panel on it is glass by default.
      { op: 'setPage', page: { background: 'aurora' } },
    ],
    'Seed document',
  )

  // ---- header -------------------------------------------------------
  // Type on the page, not a box: no fill, no edge, no shadow. No colour is
  // written anywhere in the demo: text takes the theme's, so the same scene
  // is right in every theme.
  const header = drop(s, root, 'Panel', { padding: 0, gap: 4, surface: 'solid', background: 'transparent', borderWidth: 0, shadow: 'none' }, { flow: true })
  if (header) {
    drop(s, header, 'Label', { text: 'Telemetry Console', size: 'xl', weight: '700' })
    drop(s, header, 'Caption', { text: 'Live system state · 4 sources · updated 2s ago', size: 'md' })
  }

  // ---- stats row: a 3-up grid of glass cards ------------------------
  const stats = drop(s, root, 'Panel', { padding: 20, gap: 18 }, { flow: true })
  if (!stats) return
  const row = drop(s, stats, 'Grid', { columns: 3, gap: 18 }, { flow: true })
  if (!row) return

  const gaugeCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (gaugeCard) {
    drop(s, gaugeCard, 'Caption', { text: 'CPU load', uppercase: true, fontWeight: 600, letterSpacing: 0.6 })
    const gauge = drop(s, gaugeCard, 'Gauge', { value: 73.4, size: 150 })
    drop(s, gaugeCard, 'Caption', { text: '8 of 16 cores active' })
    if (gauge) s.select([gauge])
  }

  const trendCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (trendCard) {
    drop(s, trendCard, 'Caption', { text: 'Memory · 60s', uppercase: true, fontWeight: 600, letterSpacing: 0.6 })
    drop(s, trendCard, 'Sparkline', {
      points: '38,44,41,52,49,61,58,66,72,69,81,78,88',
      width: 240,
      height: 72,
      accent: '#5b8cff',
    })
    drop(s, trendCard, 'Caption', { text: '6.2 GB of 16 GB' })
  }

  const actionsCard = drop(s, row, 'Panel', { padding: 18, gap: 10 }, { flow: true })
  if (actionsCard) {
    drop(s, actionsCard, 'Caption', { text: 'Actions', uppercase: true, fontWeight: 600, letterSpacing: 0.6 })
    drop(s, actionsCard, 'Input', { placeholder: 'Filter sources…', width: 240 })
    drop(s, actionsCard, 'Button', { label: 'Apply', variant: 'primary', glow: true, action: 'apply.filter' })
    drop(s, actionsCard, 'Button', { label: 'Reset', variant: 'ghost', action: 'filter.reset' })
  }

  // ---- footer note ---------------------------------------------------
  // Parented to a flow root, so it JOINS the flow rather than floating.
  // (Free positioning is exercised by the drag tests, not by this fixture.)
  drop(s, root, 'Caption', { text: 'Streaming from 4 sources · p95 latency 48 ms' })
}
