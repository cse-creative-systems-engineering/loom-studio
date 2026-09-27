/**
 * Reparent index probe.
 *
 * Reproduces the bug the functionality review demonstrated: reparenting to the
 * END of the current parent landed one slot short. Kept as a separate probe
 * because reparent index conventions are the easiest thing in this codebase to
 * get subtly wrong and the hardest to notice by eye.
 */

import { apply, invert } from '../src/model/ops'
import type { Document, Op } from '../src/model/types'

function mk(kids: string[], extra: Record<string, string[]> = {}): Document {
  const nodes: Document['nodes'] = {
    r: { id: 'r', type: 'Panel', props: {}, children: kids, flow: true, visible: true, locked: false, opacity: 1 },
    a: { id: 'a', type: 'Label', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 },
    b: { id: 'b', type: 'Label', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 },
    c: { id: 'c', type: 'Label', props: {}, children: [], flow: false, visible: true, locked: false, opacity: 1 },
    p1: { id: 'p1', type: 'Panel', props: {}, children: [], flow: true, visible: true, locked: false, opacity: 1 },
  }
  for (const [id, cs] of Object.entries(extra)) {
    nodes[id] = { id, type: 'Panel', props: {}, children: cs, flow: true, visible: true, locked: false, opacity: 1 }
  }
  return { version: 1, meta: { name: 't', targets: ['web'], created: 0 }, root: 'r', nodes }
}

interface Case {
  case: string
  got?: string[]
  restored?: string[]
  want: string[]
  inverse?: Op
}

/** Apply `op` then its inverse; the list must come back EXACTLY as it was. */
function roundTrip(
  out: Case[],
  d: Document,
  op: Op,
  label: string,
  want: string[],
  read: (x: Document) => string[],
) {
  const inv = invert(d, op)
  if (!inv) {
    // A missing inverse is a FAILURE, not a pass. An earlier version of this
    // probe silently returned the original document when the inverse was
    // undefined, which made a broken invert look correct.
    out.push({ case: label, got: ['<no inverse>'], want })
    return
  }
  const back = apply(apply(d, op), inv)
  out.push({ case: label, restored: read(back), want, inverse: inv })
}

export function reparentProbe(): Case[] {
  const out: Case[] = []

  // 1. reparent to END, index omitted — the most common reorder.
  {
    const d = mk(['a', 'b', 'c'])
    const after = apply(d, { op: 'reparent', id: 'a', parent: 'r' })
    out.push({ case: 'reparent a -> end (no index)', got: after.nodes.r.children, want: ['b', 'c', 'a'] })
  }

  // 2. forward move to an explicit drop-target index.
  {
    const d = mk(['a', 'b', 'c'])
    const after = apply(d, { op: 'reparent', id: 'a', parent: 'r', index: 2 })
    out.push({ case: 'reparent a -> index 2', got: after.nodes.r.children, want: ['b', 'c', 'a'] })
  }

  // 3. backward move.
  {
    const d = mk(['a', 'b', 'c'])
    const after = apply(d, { op: 'reparent', id: 'c', parent: 'r', index: 0 })
    out.push({ case: 'reparent c -> index 0', got: after.nodes.r.children, want: ['c', 'a', 'b'] })
  }

  // 4. middle-of-same-parent move.
  {
    const d = mk(['a', 'b', 'c'])
    const after = apply(d, { op: 'reparent', id: 'c', parent: 'r', index: 1 })
    out.push({ case: 'reparent c -> index 1', got: after.nodes.r.children, want: ['a', 'c', 'b'] })
  }

  // 5. round-trips: undo must restore the list EXACTLY.
  roundTrip(out, mk(['a', 'b', 'c']), { op: 'reparent', id: 'a', parent: 'r', index: 2 },
    'round-trip reparent a->2', ['a', 'b', 'c'], (x) => x.nodes.r.children)
  roundTrip(out, mk(['a', 'b', 'c']), { op: 'reparent', id: 'c', parent: 'r', index: 0 },
    'round-trip reparent c->0', ['a', 'b', 'c'], (x) => x.nodes.r.children)
  roundTrip(out, mk(['a', 'b', 'c']), { op: 'reparent', id: 'a', parent: 'r' },
    'round-trip reparent a->end', ['a', 'b', 'c'], (x) => x.nodes.r.children)
  roundTrip(out, mk(['a', 'p1'], { p1: [] }), { op: 'reparent', id: 'a', parent: 'p1' },
    'round-trip cross-parent a->p1', ['a', 'p1', '|'],
    (x) => [...x.nodes.r.children, '|', ...x.nodes.p1.children])

  // 6. reorder within a list, exercising another slot.
  roundTrip(out, mk(['a', 'b', 'c']), { op: 'reparent', id: 'b', parent: 'r', index: 0 },
    'round-trip reparent b->0', ['a', 'b', 'c'], (x) => x.nodes.r.children)

  // 7. cross-parent reparent empties the source and fills the target.
  {
    const d = mk(['a', 'p1'], { p1: [] })
    const after = apply(d, { op: 'reparent', id: 'a', parent: 'p1' })
    out.push({
      case: 'cross-parent a -> p1',
      got: [...after.nodes.r.children, '|', ...after.nodes.p1.children],
      want: ['p1', '|', 'a'],
    })
  }

  return out
}
