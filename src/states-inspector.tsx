/**
 * The Interaction section of the properties panel: hover, focus and pressed.
 *
 * Two audiences, one panel. A newcomer clicks a preset and gets a complete,
 * tasteful set of states in one undoable step. A developer picks a state and
 * edits exactly what changes — and the canvas shows that state on the
 * selected node while they do, because styling a hover you cannot see is
 * guesswork.
 */

import React from 'react'
import type { EditorStore } from './state/store'
import { INTERACTION_STATES, type InteractionState, type Node, type Op, type StateStyle } from './model/types'
import { SHADOWS, STATE_FIELDS, STATE_LABELS, STATE_PRESETS, isSafeColor, type StateField } from './render/states'

interface Props {
  s: EditorStore
  node: Node
  /** The state being edited (and shown on the canvas), or null for the base look. */
  editing: InteractionState | null
  onEditing: (state: InteractionState | null) => void
}

export function StatesPanel({ s, node, editing, onEditing }: Props) {
  const styled = (st: InteractionState) => Object.keys(node.states?.[st] ?? {}).length > 0
  const anyStyled = INTERACTION_STATES.some(styled)

  const applyPreset = (presetId: string) => {
    const preset = STATE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    // A preset REPLACES the whole state set, so applying "Glow" after "Lift"
    // gives Glow, not a blend of both. One op per state, one undo step.
    const ops: Op[] = INTERACTION_STATES.map((st) => ({
      op: 'setStateStyle',
      id: node.id,
      state: st,
      patch: fullPatch(node.states?.[st], preset.states[st]),
    }))
    s.commitAll(ops, `Interaction: ${preset.label}`)
  }

  const clearAll = () => {
    const ops: Op[] = INTERACTION_STATES.filter(styled).map((st) => ({
      op: 'setStateStyle',
      id: node.id,
      state: st,
      patch: fullPatch(node.states?.[st], undefined),
    }))
    s.commitAll(ops, 'Clear interaction states')
    onEditing(null)
  }

  const setField = (state: InteractionState, key: keyof StateStyle, value: string | number | null) => {
    s.commit({ op: 'setStateStyle', id: node.id, state, patch: { [key]: value } }, `${STATE_LABELS[state]} ${key}`)
  }

  return (
    <section className="states-panel">
      <h3>Interaction</h3>
      <div className="state-tabs" role="tablist" aria-label="Interaction state to edit">
        <button
          type="button"
          role="tab"
          aria-selected={editing === null}
          className={`state-tab ${editing === null ? 'on' : ''}`}
          onClick={() => onEditing(null)}
        >
          Normal
        </button>
        {INTERACTION_STATES.map((st) => (
          <button
            key={st}
            type="button"
            role="tab"
            aria-selected={editing === st}
            className={`state-tab ${editing === st ? 'on' : ''}`}
            onClick={() => onEditing(st)}
            title={styled(st) ? `${STATE_LABELS[st]} is styled` : `Style the ${STATE_LABELS[st].toLowerCase()} state`}
          >
            {STATE_LABELS[st]}
            {styled(st) && <span className="state-dot" aria-label="styled" />}
          </button>
        ))}
      </div>

      {editing === null ? (
        <>
          <div className="state-presets">
            {STATE_PRESETS.map((p) => (
              <button key={p.id} type="button" className="mini" title={p.hint} onClick={() => applyPreset(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="row between">
            <span className="dim">
              {anyStyled ? 'Pick a state to fine-tune it.' : 'One click for a finished effect, or pick a state.'}
            </span>
            {anyStyled && (
              <button type="button" className="mini" onClick={clearAll} title="Remove hover, focus and pressed styling">
                Clear
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="dim state-note">Showing {STATE_LABELS[editing].toLowerCase()} on the canvas.</p>
          {STATE_FIELDS.map((f) => (
            <StateFieldRow
              key={f.key}
              field={f}
              value={node.states?.[editing]?.[f.key]}
              onChange={(v) => setField(editing, f.key, v)}
            />
          ))}
        </>
      )}
    </section>
  )
}

/** A patch that turns `current` into exactly `target` (null removes a key). */
function fullPatch(current: StateStyle | undefined, target: StateStyle | undefined): Record<string, string | number | null> {
  const patch: Record<string, string | number | null> = {}
  for (const k of Object.keys(current ?? {})) patch[k] = null
  for (const [k, v] of Object.entries(target ?? {})) patch[k] = v as string | number
  return patch
}

function StateFieldRow({
  field,
  value,
  onChange,
}: {
  field: StateField
  value: string | number | undefined
  onChange: (v: string | number | null) => void
}) {
  const set = value !== undefined
  return (
    <div className={`field ${set ? 'modified' : ''}`}>
      <div className="field-head">
        <label>
          {set && <span className="mod-dot" aria-label="Set for this state" />}
          {field.label}
        </label>
        {set && (
          <button
            type="button"
            className="prop-reset"
            onClick={() => onChange(null)}
            aria-label={`Clear ${field.label}`}
            title="Use the normal look"
          >
            ↺
          </button>
        )}
      </div>
      {field.kind === 'color' && (
        <ColorInput value={typeof value === 'string' ? value : ''} label={field.label} onChange={onChange} />
      )}
      {field.kind === 'shadow' && (
        <div className="select-wrap">
          <select
            aria-label={field.label}
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
          >
            <option value="">unchanged</option>
            {SHADOWS.map((sh) => (
              <option key={sh} value={sh}>
                {sh}
              </option>
            ))}
          </select>
          <span className="chevron" aria-hidden="true" />
        </div>
      )}
      {field.kind === 'number' && (
        <div className="num">
          <input
            type="number"
            aria-label={field.label}
            placeholder="unchanged"
            min={field.percent ? (field.min ?? 0) * 100 : field.min}
            max={field.percent ? (field.max ?? 1) * 100 : field.max}
            step={field.percent ? 1 : field.step}
            value={typeof value === 'number' ? (field.percent ? Math.round(value * 100) : value) : ''}
            onChange={(e) => {
              if (e.target.value === '') return onChange(null)
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(field.percent ? n / 100 : n)
            }}
          />
          <span className="num-unit">{field.percent ? '%' : field.unit}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Colour entry with a local draft. The model only accepts a real colour, so
 * a half-typed `#12` would be rejected and snap back if the input were bound
 * straight to the document; the draft lets a person finish typing, commits the
 * moment the text IS a colour, and reverts on blur if it never became one.
 */
export function ColorInput({ value, label, onChange }: { value: string; label: string; onChange: (v: string | null) => void }) {
  const [draft, setDraft] = React.useState(value)
  React.useEffect(() => setDraft(value), [value])
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
  const none = value === ''
  return (
    <div className="color-field">
      <span className={`swatch ${none ? 'none' : ''}`} style={none ? undefined : { background: value }} aria-hidden="true">
        <input type="color" value={hex} tabIndex={-1} onChange={(e) => onChange(e.target.value)} />
      </span>
      <input
        type="text"
        className="hex"
        aria-label={label}
        placeholder="unchanged"
        spellCheck={false}
        value={draft}
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          if (v.trim() === '') onChange(null)
          else if (isSafeColor(v)) onChange(v.trim())
        }}
        onBlur={() => setDraft(value)}
      />
    </div>
  )
}
