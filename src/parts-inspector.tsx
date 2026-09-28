/**
 * The Parts section of the properties panel: type and box for the named
 * inner parts of a composite (a grid's header, a KPI's number).
 *
 * Pick a part, edit what that part accepts. Pointing at a part's name outlines
 * it on the canvas, because "Cells" means nothing until you see which pixels
 * it is. The canvas always carries part hooks, so this works before the part
 * is styled.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import type { Node, Op, PartStyle } from './model/types'
import type { ComponentSpec } from './model/registry'
import { fieldsFor, partSelector, partStyled, type PartField } from './render/parts'
import { ColorInput } from './states-inspector'

interface Props {
  s: EditorStore
  node: Node
  parts: NonNullable<ComponentSpec['parts']>
}

export function PartsPanel({ s, node, parts }: Props) {
  const names = Object.keys(parts)
  const [picked, setPicked] = React.useState(names[0])
  const [pointing, setPointing] = React.useState<string | null>(null)
  // A different node, or a component with different parts: start at its first.
  const current = names.includes(picked) ? picked : names[0]
  const spec = parts[current]
  const style = (node.parts?.[current] ?? {}) as PartStyle

  const setField = (key: keyof PartStyle, value: string | number | null) => {
    s.commit({ op: 'setPartStyle', id: node.id, part: current, patch: { [key]: value } }, `${spec.label} ${key}`)
  }
  const clearPart = () => {
    const patch = Object.fromEntries(Object.keys(style).map((k) => [k, null]))
    s.commit({ op: 'setPartStyle', id: node.id, part: current, patch }, `Clear ${spec.label}`)
  }
  const clearAll = () => {
    const ops: Op[] = names.filter((n) => partStyled(node, n)).map((n) => ({
      op: 'setPartStyle',
      id: node.id,
      part: n,
      patch: Object.fromEntries(Object.keys(node.parts?.[n] ?? {}).map((k) => [k, null])),
    }))
    s.commitAll(ops, 'Clear part styling')
  }
  const anyStyled = names.some((n) => partStyled(node, n))

  return (
    <section className="parts-panel">
      {/* Editor chrome only: outlines the part being pointed at. */}
      {pointing && (
        <style>{`${partSelector(node.id, pointing)}{outline:1px dashed var(--select) !important;outline-offset:1px}`}</style>
      )}
      <div className="row between">
        <h3>Parts</h3>
        {anyStyled && (
          <button type="button" className="mini" onClick={clearAll} title="Remove the styling from every part">
            Clear all
          </button>
        )}
      </div>
      <div className="state-tabs" role="tablist" aria-label="Part to style">
        {names.map((n) => (
          <button
            key={n}
            type="button"
            role="tab"
            aria-selected={n === current}
            className={`state-tab ${n === current ? 'on' : ''}`}
            onClick={() => setPicked(n)}
            onPointerEnter={() => setPointing(n)}
            onPointerLeave={() => setPointing(null)}
            onFocus={() => setPointing(n)}
            onBlur={() => setPointing(null)}
            title={parts[n].hint}
          >
            {parts[n].label}
            {partStyled(node, n) && <span className="state-dot" aria-label="styled" />}
          </button>
        ))}
      </div>
      <div className="row between">
        <span className="dim">{spec.hint}</span>
        {partStyled(node, current) && (
          <button type="button" className="mini" onClick={clearPart} title={`Remove the styling from ${spec.label}`}>
            Clear
          </button>
        )}
      </div>
      {fieldsFor(spec.fields).map((f) => (
        <PartFieldRow key={f.key} field={f} value={style[f.key]} onChange={(v) => setField(f.key, v)} />
      ))}
    </section>
  )
}

function PartFieldRow({
  field,
  value,
  onChange,
}: {
  field: PartField
  value: string | number | undefined
  onChange: (v: string | number | null) => void
}) {
  const set = value !== undefined
  return (
    <div className={`field ${set ? 'modified' : ''}`}>
      <div className="field-head">
        <label>
          {set && <span className="mod-dot" aria-label="Set for this part" />}
          {field.label}
        </label>
        {set && (
          <button type="button" className="prop-reset" onClick={() => onChange(null)} aria-label={`Clear ${field.label}`} title="Use the component's own look">
            ↺
          </button>
        )}
      </div>
      {field.kind === 'color' && <ColorInput value={typeof value === 'string' ? value : ''} label={field.label} onChange={onChange} />}
      {field.kind === 'enum' && (
        <div className="select-wrap">
          <select aria-label={field.label} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
            <option value="">unchanged</option>
            {(field.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {field.kind === 'number' && <NumberDraft field={field} value={typeof value === 'number' ? value : undefined} onChange={onChange} />}
    </div>
  )
}

/**
 * A number with a local draft. Committing every keystroke would clamp a
 * half-typed value: "1" on the way to "14" is below a 6px minimum, snaps to 6,
 * and the next keystroke makes 64. The draft commits only an in-range number,
 * and reverts on blur if the text never became one.
 */
function NumberDraft({ field, value, onChange }: { field: PartField; value: number | undefined; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = React.useState(value === undefined ? '' : String(value))
  React.useEffect(() => setDraft(value === undefined ? '' : String(value)), [value])
  return (
    <div className="num">
      <input
        type="number"
        aria-label={field.label}
        placeholder="unchanged"
        min={field.min}
        max={field.max}
        step={field.step}
        value={draft}
        onChange={(e) => {
          const text = e.target.value
          setDraft(text)
          if (text === '') return onChange(null)
          const n = Number(text)
          if (Number.isFinite(n) && n >= (field.min ?? -Infinity) && n <= (field.max ?? Infinity)) onChange(n)
        }}
        onBlur={() => setDraft(value === undefined ? '' : String(value))}
      />
      {field.unit && <span className="num-unit">{field.unit}</span>}
    </div>
  )
}
