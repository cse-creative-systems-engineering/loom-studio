/**
 * The panel sections for what a component is MADE OF: its item lists (a
 * timeline's events, a menu's commands) and the children it creates itself
 * (a tab set's tabs).
 *
 * Both used to be separate tools a person had to find, drag in and stack by
 * hand; a TimelineItem dropped in a Timeline landed wherever the pointer was.
 * Here they are rows of the component that owns them. Every change is ONE op
 * (`setList` replaces the whole list, `insert` adds a child), so add, remove,
 * reorder and edit each undo in one step.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import type { ListItem, Node, PropValue } from './model/types'
import { getComponent, type ListSpec, type PropSpec } from './model/registry'
import { itemsOf } from './model/lists'

interface Props {
  s: EditorStore
  node: Node
  /** The app's own field control, so a list field looks and behaves like a property. */
  renderField: (key: string, ps: PropSpec, value: PropValue, onChange: (v: PropValue) => void) => React.ReactNode
}

export function ListsPanel({ s, node, renderField }: Props) {
  const spec = getComponent(node.type)
  if (!spec?.lists) return null
  return (
    <>
      {Object.entries(spec.lists).map(([key, ls]) => (
        <ListSection key={key} s={s} node={node} listKey={key} ls={ls} renderField={renderField} />
      ))}
    </>
  )
}

function ListSection({ s, node, listKey, ls, renderField }: Props & { listKey: string; ls: ListSpec }) {
  const items = itemsOf(node, listKey)
  const [open, setOpen] = React.useState<number | null>(null)
  const commit = (next: ListItem[], label: string) =>
    s.commit({ op: 'setList', id: node.id, key: listKey, items: next }, label)
  const title = (it: ListItem, i: number) => String(it[ls.titleField] ?? '').trim() || `${ls.itemLabel} ${i + 1}`
  const fresh = (): ListItem => {
    const base: ListItem = {}
    const last = items[items.length - 1]
    for (const [f, ps] of Object.entries(ls.fields)) {
      // A new row continues the list's LOOK (tone, marker shape: the choices)
      // but not its words: the last event's time is not the new one's.
      const carries = last !== undefined && (ps.type === 'enum' || ps.type === 'color')
      base[f] = carries ? last[f] : (ps.default as string | number | boolean)
    }
    return { ...base, [ls.titleField]: `${ls.itemLabel} ${items.length + 1}` }
  }
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    commit(next, `Move ${ls.itemLabel.toLowerCase()}`)
    if (open === i) setOpen(j)
  }

  return (
    <section className="list-panel">
      <div className="row between">
        <h3>
          {ls.label} <span className="count">{items.length}</span>
        </h3>
        <button
          type="button"
          className="mini"
          disabled={items.length >= ls.max}
          onClick={() => {
            commit([...items, fresh()], `Add ${ls.itemLabel.toLowerCase()}`)
            setOpen(items.length)
          }}
        >
          + Add {ls.itemLabel.toLowerCase()}
        </button>
      </div>
      {items.length === 0 && <p className="dim">No {ls.label.toLowerCase()} yet.</p>}
      <ol className="list-rows">
        {items.map((it, i) => (
          <li key={i} className={`list-row ${open === i ? 'open' : ''}`}>
            <div className="list-row-head">
              <button
                type="button"
                className="list-row-title"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
                title={`Edit this ${ls.itemLabel.toLowerCase()}`}
              >
                <span className="caret" aria-hidden="true">{open === i ? '▾' : '▸'}</span>
                {title(it, i)}
              </button>
              <span className="list-row-tools">
                <button type="button" className="icon-mini" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${title(it, i)} up`}>↑</button>
                <button type="button" className="icon-mini" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label={`Move ${title(it, i)} down`}>↓</button>
                <button
                  type="button"
                  className="icon-mini"
                  disabled={items.length >= ls.max}
                  onClick={() => commit([...items.slice(0, i + 1), { ...it }, ...items.slice(i + 1)], `Duplicate ${ls.itemLabel.toLowerCase()}`)}
                  aria-label={`Duplicate ${title(it, i)}`}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="icon-mini danger"
                  onClick={() => {
                    commit(items.filter((_, k) => k !== i), `Remove ${ls.itemLabel.toLowerCase()}`)
                    setOpen(null)
                  }}
                  aria-label={`Remove ${title(it, i)}`}
                >
                  ✕
                </button>
              </span>
            </div>
            {open === i && (
              <div className="list-row-fields">
                {Object.entries(ls.fields).map(([f, ps]) => (
                  <React.Fragment key={f}>
                    {renderField(f, ps, it[f] ?? (ps.default as PropValue), (v) => {
                      const next = items.map((row, k) => (k === i ? { ...row, [f]: v as string | number | boolean } : row))
                      commit(next, `${ls.itemLabel} ${f}`)
                    })}
                  </React.Fragment>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

/**
 * "Add tab", "Add section", "Add message": the children a component makes
 * itself, created in place, in flow. The owner stays selected, so adding
 * several is several clicks.
 */
export function AddsPanel({ s, node }: { s: EditorStore; node: Node }) {
  const spec = getComponent(node.type)
  if (!spec?.adds || spec.adds.length === 0) return null
  const count = (type: string) => node.children.filter((c) => s.doc.nodes[c]?.type === type).length
  return (
    <section className="adds-panel">
      <div className="adds-row">
        {spec.adds.map((a) => (
          <button
            key={a.type + a.label}
            type="button"
            className="mini"
            onClick={() => {
              const props = { ...(a.props ?? {}) }
              // A numbered title, so three new tabs are not three "Tab"s.
              for (const k of ['title', 'label']) {
                if (typeof props[k] === 'string' && (props[k] as string).includes('{n}')) props[k] = (props[k] as string).replace('{n}', String(count(a.type) + 1))
              }
              s.addComponent(a.type, node.id, 0, 0, props)
              // Stay on the owner: adding three tabs is three clicks, not
              // three round trips through the layers.
              s.select([node.id])
            }}
          >
            + {a.label}
          </button>
        ))}
      </div>
    </section>
  )
}
