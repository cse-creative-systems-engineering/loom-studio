/**
 * The Properties panel's behaviour sections (`model/actions.ts`):
 *
 *  - "When clicked" on a pressable: what pressing it does, one row per action
 *    (Show / Hide / Toggle / Open / Close + a target).
 *  - "Each choice shows" on a choice control: which node each choice shows;
 *    choosing one hides the others' — the List/Table switch.
 *  - "Shown by" on anything a control acts on: the controls, a jump to each,
 *    and whether it starts hidden.
 *
 * A target is picked from a list or by clicking it on the canvas (pick mode).
 * Every change is one op, one undo step. A target that was deleted is flagged
 * here, never silently forgotten.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import type { Document, Node, NodeId } from './model/types'
import { ACTION_VERBS, VERB_LABELS, canClick, canSwitch, choicesOf, targetsOf, type Action, type ActionVerb, type NodeActions } from './model/actions'
import { Toggle } from './ui-primitives'

/** A node as a person recognises it: its layer name, or type and a hint of its words. */
export function nodeLabel(doc: Document, id: NodeId): string {
  const n = doc.nodes[id]
  if (!n) return 'Missing — it was deleted'
  if (n.name) return n.name
  const own = (x: Node) => ['title', 'label', 'text', 'heading'].map((k) => x.props[k]).find((v) => typeof v === 'string' && v.trim() !== '') as string | undefined
  // A container with no words of its own is known by its first words inside
  // ("Stack · List view"): two bare "Stack" entries could not be told apart.
  const inside = (x: Node, depth = 0): string | undefined => {
    for (const c of x.children) {
      const k = doc.nodes[c]
      if (!k) continue
      const w = own(k) ?? (depth < 3 ? inside(k, depth + 1) : undefined)
      if (w) return w
    }
    return undefined
  }
  const hint = own(n) ?? inside(n)
  return hint ? `${n.type} · ${hint.trim().slice(0, 28)}` : n.type
}

/** Every node in tree order with its depth, for the target list. */
function treeOrder(doc: Document): Array<{ id: NodeId; depth: number }> {
  const out: Array<{ id: NodeId; depth: number }> = []
  const walk = (id: NodeId, depth: number) => {
    const n = doc.nodes[id]
    if (!n) return
    out.push({ id, depth })
    n.children.forEach((c) => walk(c, depth + 1))
  }
  if (doc.root) walk(doc.root, 0)
  return out
}

function TargetPicker({ s, self, value, onPick, label }: { s: EditorStore; self: NodeId; value: NodeId | ''; onPick: (id: NodeId | '') => void; label: string }) {
  const missing = value !== '' && !s.doc.nodes[value]
  const picking = s.picking?.forLabel === label
  return (
    <div className="act-target">
      <div className={`select-wrap ${missing ? 'broken' : ''}`}>
        <select aria-label={label} value={value} onChange={(e) => onPick(e.target.value)}>
          <option value="">Choose…</option>
          {missing && <option value={value}>⚠ Missing — it was deleted</option>}
          {treeOrder(s.doc)
            .filter((o) => o.id !== self)
            .map((o) => (
              <option key={o.id} value={o.id}>
                {'  '.repeat(o.depth)}
                {nodeLabel(s.doc, o.id)}
              </option>
            ))}
        </select>
        <span className="chevron" aria-hidden="true" />
      </div>
      <button
        type="button"
        className={`mini act-pick ${picking ? 'on' : ''}`}
        aria-pressed={picking}
        title={picking ? 'Click a component on the canvas (Esc to cancel)' : 'Pick it on the canvas'}
        onClick={() => (picking ? s.endPick() : s.startPick(label, (id) => id !== self && onPick(id)))}
      >
        {picking ? 'Click one…' : 'Pick'}
      </button>
    </div>
  )
}

function VerbSelect({ value, label, onChange }: { value: ActionVerb; label: string; onChange: (v: ActionVerb) => void }) {
  return (
    <div className="select-wrap act-verb">
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as ActionVerb)}>
        {ACTION_VERBS.map((v) => (
          <option key={v} value={v}>
            {VERB_LABELS[v]}
          </option>
        ))}
      </select>
      <span className="chevron" aria-hidden="true" />
    </div>
  )
}

export function ActionsPanel({ s, node }: { s: EditorStore; node: Node }) {
  const commit = (next: NodeActions, label: string) =>
    s.commit({ op: 'setActions', id: node.id, actions: next.click?.length || (next.views && Object.keys(next.views).length) ? next : null }, label)
  const current = node.actions ?? {}
  const [draft, setDraft] = React.useState<ActionVerb | null>(null)
  React.useEffect(() => setDraft(null), [node.id])
  const shownBy = targetsOf(s.doc).get(node.id) ?? []

  return (
    <>
      {canClick(node.type) && (
        <section className="act-panel">
          <div className="row between">
            <h3>When clicked</h3>
            <button type="button" className="mini" disabled={draft !== null} onClick={() => setDraft('toggle')}>
              + Add action
            </button>
          </div>
          {(current.click ?? []).length === 0 && draft === null && (
            <p className="dim act-empty">Nothing yet. Add an action to show, hide, open or close something.</p>
          )}
          {(current.click ?? []).map((a, i) => {
            const set = (next: Partial<Action>) => {
              const list = [...(current.click ?? [])]
              list[i] = { ...a, ...next }
              commit({ ...current, click: list }, 'Change action')
            }
            return (
              <div key={i} className="act-row">
                <VerbSelect value={a.verb} label={`Action ${i + 1}`} onChange={(verb) => set({ verb })} />
                <TargetPicker s={s} self={node.id} value={a.target} label={`Target of action ${i + 1}`} onPick={(id) => id && set({ target: id })} />
                <button
                  type="button"
                  className="mini act-remove"
                  aria-label={`Remove action ${i + 1}`}
                  onClick={() => commit({ ...current, click: (current.click ?? []).filter((_, j) => j !== i) }, 'Remove action')}
                >
                  ✕
                </button>
              </div>
            )
          })}
          {/* A new action exists once it has a target: until then it is a
              row in the panel, not a half-made action in the document. */}
          {draft !== null && (
            <div className="act-row draft">
              <VerbSelect value={draft} label="New action" onChange={setDraft} />
              <TargetPicker
                s={s}
                self={node.id}
                value=""
                label="Target of the new action"
                onPick={(id) => {
                  if (!id) return
                  commit({ ...current, click: [...(current.click ?? []), { verb: draft, target: id }] }, `${VERB_LABELS[draft]} on click`)
                  setDraft(null)
                }}
              />
              <button type="button" className="mini act-remove" aria-label="Cancel the new action" onClick={() => setDraft(null)}>
                ✕
              </button>
            </div>
          )}
        </section>
      )}

      {canSwitch(node.type) && (
        <section className="act-panel">
          <h3>Each choice shows</h3>
          <p className="dim act-empty">Choosing one shows its component and hides the others — a real view switch.</p>
          {(choicesOf(node) ?? []).map((choice) => (
            <div key={choice} className="act-row">
              <span className="act-choice" title={choice}>
                {choice}
              </span>
              <TargetPicker
                s={s}
                self={node.id}
                value={current.views?.[choice] ?? ''}
                label={`What ${choice} shows`}
                onPick={(id) => {
                  const views = { ...(current.views ?? {}) }
                  if (id) views[choice] = id as NodeId
                  else delete views[choice]
                  commit({ ...current, views }, `${choice} shows`)
                }}
              />
            </div>
          ))}
        </section>
      )}

      {shownBy.length > 0 && (
        <section className="act-panel">
          <h3>Shown by</h3>
          {shownBy.map((id) => (
            <div key={id} className="row between">
              <button type="button" className="act-link" onClick={() => s.select([id])} title="Select that control">
                {nodeLabel(s.doc, id)}
              </button>
            </div>
          ))}
          <Toggle
            label="Starts hidden"
            checked={node.startsHidden === true}
            onChange={(on) => s.commit({ op: 'setStartsHidden', id: node.id, on }, on ? 'Starts hidden' : 'Starts shown')}
          />
        </section>
      )}
    </>
  )
}

/**
 * The wiring, drawn on the canvas: with a wired control selected, a line to
 * each thing it acts on (and each target outlined and labelled); with a
 * target selected, a line from each control that shows it. Visible at a
 * glance, never in the output, never catching a click.
 */
export function ActionLinks({ s, host, scroller }: { s: EditorStore; host: React.RefObject<HTMLElement | null>; scroller: React.RefObject<HTMLElement | null> }) {
  const [, redraw] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    const el = scroller.current
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => redraw()) : null
    if (el) {
      el.addEventListener('scroll', redraw, { passive: true })
      ro?.observe(el)
    }
    return () => {
      el?.removeEventListener('scroll', redraw)
      ro?.disconnect()
    }
  }, [scroller])
  // After every render of the document, measure again (the canvas has drawn).
  React.useLayoutEffect(() => {
    const id = requestAnimationFrame(() => redraw())
    return () => cancelAnimationFrame(id)
  }, [s.doc, s.selection])

  const wrap = host.current
  if (!wrap || s.selection.length !== 1) return null
  const sel = s.selection[0]!
  const node = s.doc.nodes[sel]
  if (!node) return null
  const links: Array<{ from: NodeId; to: NodeId; label: string }> = []
  for (const a of node.actions?.click ?? []) links.push({ from: sel, to: a.target, label: VERB_LABELS[a.verb] })
  for (const [k, t] of Object.entries(node.actions?.views ?? {})) links.push({ from: sel, to: t, label: k })
  for (const c of targetsOf(s.doc).get(sel) ?? []) {
    const ctl = s.doc.nodes[c]
    const verb = ctl?.actions?.click?.find((a) => a.target === sel)?.verb
    const choice = Object.entries(ctl?.actions?.views ?? {}).find(([, t]) => t === sel)?.[0]
    links.push({ from: c, to: sel, label: verb ? VERB_LABELS[verb] : choice ?? '' })
  }
  if (!links.length) return null
  const origin = wrap.getBoundingClientRect()
  const box = (id: NodeId) => {
    const el = wrap.querySelector(`.surface [data-loom-id="${CSS.escape(id)}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height }
  }
  return (
    <svg className="act-links" aria-hidden="true" width={origin.width} height={origin.height}>
      {links.map((l, i) => {
        const a = box(l.from)
        const b = box(l.to)
        if (!a || !b) return null
        const x1 = a.x + a.w / 2
        const y1 = a.y + a.h / 2
        const x2 = b.x + b.w / 2
        const y2 = b.y + Math.min(b.h / 2, 24)
        const bend = Math.max(40, Math.abs(y2 - y1) / 2)
        return (
          <g key={i}>
            <rect className="act-links-target" x={b.x - 2} y={b.y - 2} width={b.w + 4} height={b.h + 4} rx={6} />
            <path className="act-links-line" d={`M ${x1} ${y1} C ${x1} ${y1 + bend}, ${x2} ${y2 - bend}, ${x2} ${y2}`} />
            <circle className="act-links-dot" cx={x2} cy={y2} r={3.5} />
            {l.label && (
              <text className="act-links-label" x={b.x + 6} y={b.y - 7}>
                {l.label}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}
