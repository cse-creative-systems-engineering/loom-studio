/**
 * The Appearance panel: where any component, or any one of its parts, is
 * made physical (see model/look.ts and render/light.ts).
 *
 * Built so the easy thing is effortless and the deep thing is all there:
 *  - STYLES first: one click on a tile (each a live preview, lit by the real
 *    scene light) gives a complete look with its states and motion.
 *  - Then the layers, as a designer thinks of them: depth (height, bevel,
 *    wells, sheen), fills, strokes, glows, shape, texture, the travelling
 *    light, motion, and what a click plays.
 *  - A STATE tab edits that state's patch over the base, and shows the state
 *    on the canvas while it is open; a value the state does not change shows
 *    what it inherits, dimmed.
 *  - The scene light sits at the bottom: drag the sun, and every shadow in
 *    the design follows.
 *
 * Every change is one op (`setLook`, `setLight`); a slider drag is one undo
 * step (grouped commits).
 */

import React from 'react'
import type { EditorStore } from './state/store'
import type { Node } from './model/types'
import { partsOf } from './render/parts'
import {
  BEVEL_STYLES,
  BLENDS,
  BUILTIN_STYLES,
  CLICK_EFFECTS,
  DEFAULT_LIGHT,
  EASINGS,
  FILL_KINDS,
  LOOK_STATES,
  RANGES,
  STROKE_POSITIONS,
  STROKE_STYLES,
  mergeLook,
  lookStatesFromClassic,
  type Look,
  type LookFill,
  type LookGlow,
  type LookSet,
  type LookState,
  type LookStroke,
  type SceneLight,
} from './model/look'
import { compileLook } from './render/look'
import { lightOf, shadeFor } from './render/light'
import { resolveTheme } from './render/theme'
import { playClickEffect } from './render/click-fx'

type Tab = 'normal' | LookState

const STATE_LABEL: Record<Tab, string> = { normal: 'Normal', hover: 'Hover', focus: 'Focus', pressed: 'Pressed', selected: 'Selected', disabled: 'Disabled' }

/** Theme colours offered as one-click swatches (any colour can still be typed). */
const SWATCHES: Array<[string, string]> = [
  ['var(--loom-accent)', 'Accent'],
  ['var(--loom-success)', 'Success'],
  ['var(--loom-warning)', 'Warning'],
  ['var(--loom-danger)', 'Danger'],
  ['var(--loom-text)', 'Text'],
  ['var(--loom-border-strong)', 'Edge'],
  ['#ffffff', 'White'],
  ['#000000', 'Black'],
]

/** A compiled look as an inline style, for the live style tiles. */
function previewStyle(look: Look, light: SceneLight, dark: boolean): React.CSSProperties {
  const out: Record<string, string> = {}
  for (const d of compileLook(look, light, shadeFor(dark ? 'dark' : 'light')).decls) {
    const i = d.indexOf(':')
    const prop = d.slice(0, i).trim()
    const value = d.slice(i + 1).replace(/\s*!important\s*$/, '').trim()
    out[prop.startsWith('-') ? prop : prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return out as React.CSSProperties
}

/* --------------------------------------------------------------- controls -- */

function Row({ label, set, onClear, children, title }: { label: string; set: boolean; onClear?: () => void; children: React.ReactNode; title?: string }) {
  return (
    <div className={`ap-row ${set ? 'set' : ''}`} title={title}>
      <span className="ap-label">{label}</span>
      <div className="ap-control">{children}</div>
      {set && onClear ? (
        <button type="button" className="ap-clear" aria-label={`Clear ${label}`} title="Clear (back to inherited)" onClick={onClear}>
          ↺
        </button>
      ) : (
        <span className="ap-clear-gap" />
      )}
    </div>
  )
}

function Slider({ label, value, inherited, range, step, unit, onChange }: { label: string; value: number | undefined; inherited?: number; range: readonly [number, number]; step: number; unit?: string; onChange: (v: number) => void }) {
  const shown = value ?? inherited ?? range[0]
  return (
    <span className={`ap-slider ${value === undefined ? 'inherited' : ''}`}>
      <input type="range" aria-label={label} min={range[0]} max={range[1]} step={step} value={shown} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        type="number"
        className="ap-num"
        aria-label={`${label} value`}
        min={range[0]}
        max={range[1]}
        step={step}
        value={Number.isInteger(step) ? Math.round(shown) : Math.round(shown * 100) / 100}
        onChange={(e) => e.target.value !== '' && Number.isFinite(Number(e.target.value)) && onChange(Number(e.target.value))}
      />
      {unit && <span className="ap-unit">{unit}</span>}
    </span>
  )
}

function Choice<T extends string>({ label, value, options, onChange, names }: { label: string; value: T | undefined; options: readonly T[]; onChange: (v: T) => void; names?: Partial<Record<T, string>> }) {
  return (
    <span className="select-wrap ap-select">
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
        {value === undefined && <option value="">—</option>}
        {options.map((o) => (
          <option key={o} value={o}>
            {names?.[o] ?? o}
          </option>
        ))}
      </select>
      <span className="chevron" aria-hidden="true" />
    </span>
  )
}

function Color({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false)
  const hex = value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#5b8cff'
  return (
    <span className="ap-color">
      <button type="button" className="ap-swatch" aria-label={`${label}: ${value ?? 'none'}. Choose`} aria-expanded={open} onClick={() => setOpen(!open)} style={{ background: value || 'transparent' }} />
      <input className="ap-hex" aria-label={label} value={value ?? ''} placeholder="colour" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      {open && (
        <span className="ap-palette" role="group" aria-label={`${label} swatches`}>
          {SWATCHES.map(([c, name]) => (
            <button key={c} type="button" className="ap-swatch sm" title={name} aria-label={name} style={{ background: c }} onClick={() => (onChange(c), setOpen(false))} />
          ))}
          <input type="color" aria-label={`${label}, any colour`} value={hex} onChange={(e) => onChange(e.target.value)} />
        </span>
      )}
    </span>
  )
}

function Section({ title, children, action, open: initial = true }: { title: string; children: React.ReactNode; action?: React.ReactNode; open?: boolean }) {
  const [open, setOpen] = React.useState(initial)
  // Content arriving (a style applied, a layer added) opens the section; the
  // person closing it again is respected until the next arrival.
  React.useEffect(() => {
    if (initial) setOpen(true)
  }, [initial])
  return (
    <div className={`ap-section ${open ? 'open' : ''}`}>
      <div className="ap-section-head">
        <button type="button" className="ap-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="ap-caret" aria-hidden="true">▸</span>
          {title}
        </button>
        {action}
      </div>
      {open && <div className="ap-section-body">{children}</div>}
    </div>
  )
}

/* ------------------------------------------------------------ light dial -- */

/** The scene light as a dial: drag the sun; the centre is overhead, the rim is the horizon. */
export function LightDial({ s }: { s: EditorStore }) {
  const light = lightOf(s.doc.meta)
  const R = 46
  const r = ((90 - light.height) / 85) * (R - 6)
  const a = (light.angle * Math.PI) / 180
  const sx = R + Math.sin(a) * r
  const sy = R - Math.cos(a) * r
  const set = (next: Partial<SceneLight>, label: string) => s.commit({ op: 'setLight', light: { ...light, ...next } }, label, `light:${label}`)
  const drag = (e: React.PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const dx = e.clientX - box.left - R
    const dy = e.clientY - box.top - R
    const dist = Math.min(R - 6, Math.hypot(dx, dy))
    const angle = (Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360))
    const height = Math.round(Math.max(5, Math.min(90, 90 - (dist / (R - 6)) * 85)))
    set({ angle, height }, 'Move the light')
  }
  return (
    <div className="ap-light">
      <svg
        width={R * 2}
        height={R * 2}
        viewBox={`0 0 ${R * 2} ${R * 2}`}
        className="ap-dial"
        role="slider"
        tabIndex={0}
        aria-label="Scene light direction"
        aria-valuetext={`from ${light.angle} degrees, ${light.height} degrees high`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && drag(e)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 5
          if (e.key === 'ArrowLeft') set({ angle: (light.angle + 360 - step) % 360 }, 'Move the light')
          else if (e.key === 'ArrowRight') set({ angle: (light.angle + step) % 360 }, 'Move the light')
          else if (e.key === 'ArrowUp') set({ height: Math.min(90, light.height + step) }, 'Raise the light')
          else if (e.key === 'ArrowDown') set({ height: Math.max(5, light.height - step) }, 'Lower the light')
          else return
          e.preventDefault()
        }}
      >
        <circle cx={R} cy={R} r={R - 1} className="ap-dial-ground" />
        <circle cx={R} cy={R} r={(R - 6) / 2} className="ap-dial-ring" />
        <circle cx={R} cy={R} r={3} className="ap-dial-centre" />
        <line x1={R} y1={R} x2={sx} y2={sy} className="ap-dial-ray" />
        <circle cx={sx} cy={sy} r={7} className="ap-dial-sun" />
      </svg>
      <div className="ap-light-fields">
        <Row label="Softness" set={false}>
          <Slider label="Shadow softness" value={light.softness} range={RANGES.unit} step={0.05} onChange={(v) => set({ softness: v }, 'Soften shadows')} />
        </Row>
        <Row label="Strength" set={false}>
          <Slider label="Shadow strength" value={light.strength} range={RANGES.unit} step={0.05} onChange={(v) => set({ strength: v }, 'Shadow strength')} />
        </Row>
        <div className="ap-light-meta dim">
          From {light.angle}° · {light.height}° high
          {s.doc.meta.light && (
            <button type="button" className="mini" onClick={() => s.commit({ op: 'setLight', light: null }, 'Reset the light')}>
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** Outline one part (or the whole component) on the canvas while its chip is pointed at. */
function markPart(id: string, part: string, on: boolean): void {
  const sel = part ? `.surface [data-loom-part~="${CSS.escape(`${id}/${part}`)}"]` : `.surface [data-loom-id="${CSS.escape(id)}"]`
  document.querySelectorAll('.surface [data-loom-point]').forEach((el) => el.removeAttribute('data-loom-point'))
  if (on) document.querySelectorAll(sel).forEach((el) => el.setAttribute('data-loom-point', ''))
}

/** "Save as style": name the current look and keep it in this document. */
function SaveStyle({ s, set }: { s: EditorStore; set: LookSet }) {
  const [name, setName] = React.useState<string | null>(null)
  if (name === null)
    return (
      <button type="button" className="mini ap-save" onClick={() => setName('')}>
        Save as style
      </button>
    )
  const save = () => {
    const label = name.trim()
    if (!label) return setName(null)
    const id = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'style'}-${Math.random().toString(36).slice(2, 6)}`
    s.commit({ op: 'setStyles', styles: [...(s.doc.meta.styles ?? []), { id, label, hint: 'Saved in this document', set: JSON.parse(JSON.stringify(set)) as LookSet }] }, `Save style ${label}`)
    setName(null)
  }
  return (
    <span className="ap-save-row">
      <input
        autoFocus
        className="ap-hex"
        aria-label="Style name"
        placeholder="Name this style"
        value={name}
        maxLength={40}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') setName(null)
        }}
      />
      <button type="button" className="mini" onClick={save}>
        Save
      </button>
    </span>
  )
}

/* ----------------------------------------------------------------- panel -- */

export function AppearancePanel({ s, node, editing, onEditing }: { s: EditorStore; node: Node; editing: string | null; onEditing: (state: LookState | null) => void }) {
  const [target, setTarget] = React.useState('')
  React.useEffect(() => setTarget(''), [node.id])
  const parts = partsOf(node.type) ?? {}
  const tab: Tab = (LOOK_STATES as readonly string[]).includes(editing ?? '') ? (editing as LookState) : 'normal'
  const set: LookSet = node.looks?.[target] ?? { base: {} }
  const current: Look = tab === 'normal' ? set.base : set.states?.[tab] ?? {}
  const effective: Look = tab === 'normal' ? set.base : mergeLook(set.base, set.states?.[tab])
  const light = lightOf(s.doc.meta)
  const dark = resolveTheme(s.doc.meta.theme).colorScheme === 'dark'

  const commitSet = (next: LookSet, label: string, group?: string) =>
    s.commit({ op: 'setLook', id: node.id, target, set: next }, label, group ? `look:${node.id}:${target}:${tab}:${group}` : undefined)
  /** Change the look being edited (the base, or this state's patch). */
  const edit = (fn: (l: Look) => Look, label: string, group?: string) => {
    if (tab === 'normal') commitSet({ ...set, base: fn({ ...set.base }) }, label, group)
    else {
      const patch = fn({ ...(set.states?.[tab] ?? {}) })
      const states = { ...(set.states ?? {}) }
      if (Object.keys(patch).length) states[tab] = patch
      else delete states[tab]
      commitSet({ ...set, states: Object.keys(states).length ? states : undefined }, label, group)
    }
  }
  const setField = <K extends keyof Look>(k: K, v: Look[K], label: string) => edit((l) => ({ ...l, [k]: v }), label, String(k))
  const clear = (k: keyof Look) =>
    edit((l) => {
      const n = { ...l }
      delete n[k]
      return n
    }, `Clear ${String(k)}`)
  /** Lists (fills, strokes, glows): a state edits its own copy, seeded from what it inherits. */
  const listOf = <K extends 'fills' | 'strokes' | 'glows'>(k: K): NonNullable<Look[K]> => (current[k] ?? effective[k] ?? []) as NonNullable<Look[K]>

  const num = (k: keyof Look, label: string, range: readonly [number, number], step = 1, unit?: string) => (
    <Row label={label} set={current[k] !== undefined} onClear={() => clear(k)}>
      <Slider label={label} value={current[k] as number | undefined} inherited={effective[k] as number | undefined} range={range} step={step} unit={unit} onChange={(v) => setField(k, v as never, `Set ${label.toLowerCase()}`)} />
    </Row>
  )

  const fills = listOf('fills')
  const strokes = listOf('strokes')
  const glows = listOf('glows')
  const setList = <K extends 'fills' | 'strokes' | 'glows'>(k: K, list: NonNullable<Look[K]>, label: string, group?: string) => edit((l) => ({ ...l, [k]: list }), label, group)

  const styled = Object.keys(node.looks ?? {})

  return (
    <section className="ap-panel" aria-label="Appearance">
      <div className="row between">
        <h3>Appearance</h3>
        {node.looks?.[target] && (
          <button type="button" className="mini" onClick={() => s.commit({ op: 'setLook', id: node.id, target, set: null }, 'Reset look')} title="Remove this look entirely">
            Reset
          </button>
        )}
      </div>

      {target === '' && node.states && Object.keys(node.states).length > 0 && (
        <div className="ap-classic">
          <span>This component uses the classic Interaction styles (below).</span>
          <button
            type="button"
            className="mini"
            onClick={() => {
              const moved = lookStatesFromClassic(node.states as never)
              const merged: LookSet = { ...set, states: { ...(set.states ?? {}), ...moved }, motion: set.motion ?? { duration: 160, easing: 'smooth' } }
              const clear = (['hover', 'focus', 'pressed'] as const)
                .filter((st) => node.states?.[st])
                .map((st) => ({ op: 'setStateStyle' as const, id: node.id, state: st, patch: Object.fromEntries(Object.keys(node.states![st]!).map((k) => [k, null])) }))
              s.commitAll([{ op: 'setLook', id: node.id, target: '', set: merged }, ...clear], 'Move into Appearance')
            }}
          >
            Move into Appearance
          </button>
        </div>
      )}

      {Object.keys(parts).length > 0 && (
        <div className="ap-targets" role="tablist" aria-label="What to style">
          {['', ...Object.keys(parts)].map((p) => (
            <button
              key={p || 'whole'}
              type="button"
              role="tab"
              aria-selected={target === p}
              className={`ap-target ${target === p ? 'on' : ''} ${styled.includes(p) ? 'styled' : ''}`}
              title={p ? parts[p]?.hint : 'The whole component'}
              onClick={() => setTarget(p)}
              // Point at it on the canvas, so "Header" is never a guess.
              onPointerEnter={() => markPart(node.id, p, true)}
              onPointerLeave={() => markPart(node.id, p, false)}
              onFocus={() => markPart(node.id, p, true)}
              onBlur={() => markPart(node.id, p, false)}
            >
              {p ? parts[p]?.label ?? p : 'Whole'}
            </button>
          ))}
        </div>
      )}

      {tab === 'normal' && (
        <div className="ap-styles" role="group" aria-label="Styles">
          {[...BUILTIN_STYLES, ...(s.doc.meta.styles ?? [])].map((st) => {
            const own = !BUILTIN_STYLES.includes(st)
            return (
              <span key={st.id} className={`ap-style-wrap ${own ? 'own' : ''}`}>
                <button type="button" className="ap-style" title={st.hint} onClick={() => commitSet(JSON.parse(JSON.stringify(st.set)) as LookSet, `Style: ${st.label}`)}>
                  <span className="ap-style-chip" style={{ ...previewStyle(st.set.base, light, dark), ...(st.id === 'traced' ? { boxShadow: 'inset 0 0 0 1.5px var(--accent)' } : {}) }} aria-hidden="true" />
                  <span className="ap-style-name">{st.label}</span>
                </button>
                {own && (
                  <button
                    type="button"
                    className="ap-style-x"
                    aria-label={`Delete the style ${st.label}`}
                    title="Delete this saved style"
                    onClick={() => s.commit({ op: 'setStyles', styles: (s.doc.meta.styles ?? []).filter((x) => x.id !== st.id) }, `Delete style ${st.label}`)}
                  >
                    ✕
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}
      {tab === 'normal' && node.looks?.[target] && <SaveStyle s={s} set={set} />}

      <div className="ap-states" role="tablist" aria-label="State">
        {(['normal', ...LOOK_STATES] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            className={`ap-state ${tab === t ? 'on' : ''} ${t !== 'normal' && set.states?.[t] ? 'has' : ''}`}
            onClick={() => onEditing(t === 'normal' ? null : t)}
          >
            {STATE_LABEL[t]}
          </button>
        ))}
      </div>
      {tab !== 'normal' && <p className="dim ap-note">Changes here apply only while {STATE_LABEL[tab].toLowerCase()}. The canvas shows it now.</p>}

      <Section title="Depth">
        {num('z', 'Height', RANGES.z, 1, 'px')}
        <Row label="Bevel" set={current.bevel !== undefined} onClear={() => clear('bevel')}>
          <Choice
            label="Bevel"
            value={(current.bevel ?? effective.bevel)?.style ?? ('none' as never)}
            options={['none', ...BEVEL_STYLES] as const}
            onChange={(v) => (v === ('none' as never) ? setField('bevel', { size: 0, strength: 0, style: 'raised' }, 'Remove bevel') : setField('bevel', { size: (current.bevel ?? effective.bevel)?.size || 2, strength: (current.bevel ?? effective.bevel)?.strength || 0.5, style: v as never }, 'Set bevel'))}
          />
        </Row>
        {(current.bevel ?? effective.bevel)?.size ? (
          <>
            <Row label="Bevel size" set={false}>
              <Slider label="Bevel size" value={(current.bevel ?? effective.bevel)!.size} range={RANGES.bevelSize} step={1} unit="px" onChange={(v) => setField('bevel', { ...(current.bevel ?? effective.bevel)!, size: v }, 'Bevel size')} />
            </Row>
            <Row label="Bevel light" set={false}>
              <Slider label="Bevel strength" value={(current.bevel ?? effective.bevel)!.strength} range={RANGES.bevelStrength} step={0.05} onChange={(v) => setField('bevel', { ...(current.bevel ?? effective.bevel)!, strength: v }, 'Bevel strength')} />
            </Row>
          </>
        ) : null}
        {num('inset', 'Pressed in', RANGES.inset, 1, 'px')}
        {num('sheen', 'Sheen', RANGES.sheen, 0.05)}
      </Section>

      <Section
        title={`Fill${fills.length ? ` · ${fills.length}` : ''}`}
        open={fills.length > 0}
        action={
          <button type="button" className="mini" onClick={() => setList('fills', [...fills, { kind: 'linear', colors: ['var(--loom-accent)', '#9b6bff'], angle: 135, opacity: 1, blend: 'normal' }], 'Add fill')}>
            + Fill
          </button>
        }
      >
        {fills.length === 0 && <p className="dim ap-note">The component's own colour. Add a fill to paint over it, gradients included.</p>}
        {fills.map((f, i) => {
          const put = (next: Partial<LookFill>, label: string) => setList('fills', fills.map((x, j) => (j === i ? { ...x, ...next } : x)), label, `fill${i}`)
          return (
            <div key={i} className="ap-layer">
              <div className="ap-layer-head">
                <Choice label={`Fill ${i + 1} kind`} value={f.kind} options={FILL_KINDS} onChange={(v) => put({ kind: v, colors: v === 'solid' ? f.colors.slice(0, 1) : f.colors.length > 1 ? f.colors : [f.colors[0]!, '#9b6bff'] }, 'Fill kind')} />
                <button type="button" className="ap-x" aria-label={`Remove fill ${i + 1}`} onClick={() => setList('fills', fills.filter((_, j) => j !== i), 'Remove fill')}>
                  ✕
                </button>
              </div>
              {f.colors.map((c, k) => (
                <Row key={k} label={f.kind === 'solid' ? 'Colour' : `Stop ${k + 1}`} set={false}>
                  <Color label={`Fill ${i + 1} colour ${k + 1}`} value={c} onChange={(v) => put({ colors: f.colors.map((x, m) => (m === k ? v : x)) }, 'Fill colour')} />
                </Row>
              ))}
              {f.kind !== 'solid' && f.colors.length < 4 && (
                <button type="button" className="mini ap-indent" onClick={() => put({ colors: [...f.colors, f.colors[f.colors.length - 1]!] }, 'Add stop')}>
                  + Stop
                </button>
              )}
              {(f.kind === 'linear' || f.kind === 'conic') && (
                <Row label="Angle" set={false}>
                  <Slider label="Fill angle" value={f.angle} range={RANGES.angle} step={1} unit="°" onChange={(v) => put({ angle: v }, 'Fill angle')} />
                </Row>
              )}
              <Row label="Opacity" set={false}>
                <Slider label="Fill opacity" value={f.opacity} range={RANGES.fillOpacity} step={0.05} onChange={(v) => put({ opacity: v }, 'Fill opacity')} />
              </Row>
              <Row label="Blend" set={false}>
                <Choice label="Fill blend" value={f.blend} options={BLENDS} onChange={(v) => put({ blend: v }, 'Fill blend')} />
              </Row>
            </div>
          )
        })}
      </Section>

      <Section
        title={`Stroke${strokes.length ? ` · ${strokes.length}` : ''}`}
        open={strokes.length > 0}
        action={
          <button type="button" className="mini" onClick={() => setList('strokes', [...strokes, { color: 'var(--loom-accent)', width: 2, position: 'outside', style: 'solid', opacity: 1 }], 'Add stroke')}>
            + Stroke
          </button>
        }
      >
        {strokes.map((st, i) => {
          const put = (next: Partial<LookStroke>, label: string) => setList('strokes', strokes.map((x, j) => (j === i ? { ...x, ...next } : x)), label, `stroke${i}`)
          return (
            <div key={i} className="ap-layer">
              <div className="ap-layer-head">
                <Choice label={`Stroke ${i + 1} position`} value={st.position} options={STROKE_POSITIONS} onChange={(v) => put({ position: v }, 'Stroke position')} />
                <Choice label={`Stroke ${i + 1} style`} value={st.style} options={STROKE_STYLES} onChange={(v) => put({ style: v }, 'Stroke style')} />
                <button type="button" className="ap-x" aria-label={`Remove stroke ${i + 1}`} onClick={() => setList('strokes', strokes.filter((_, j) => j !== i), 'Remove stroke')}>
                  ✕
                </button>
              </div>
              <Row label="Colour" set={false}>
                <Color label={`Stroke ${i + 1} colour`} value={st.color} onChange={(v) => put({ color: v }, 'Stroke colour')} />
              </Row>
              <Row label="Gradient to" set={!!st.color2} onClear={() => put({ color2: undefined }, 'Solid stroke')}>
                <Color label={`Stroke ${i + 1} second colour`} value={st.color2} onChange={(v) => put({ color2: v || undefined }, 'Gradient stroke')} />
              </Row>
              <Row label="Width" set={false}>
                <Slider label="Stroke width" value={st.width} range={RANGES.strokeWidth} step={0.5} unit="px" onChange={(v) => put({ width: v }, 'Stroke width')} />
              </Row>
              <Row label="Opacity" set={false}>
                <Slider label="Stroke opacity" value={st.opacity} range={RANGES.unit} step={0.05} onChange={(v) => put({ opacity: v }, 'Stroke opacity')} />
              </Row>
            </div>
          )
        })}
      </Section>

      <Section
        title={`Glow${glows.length ? ` · ${glows.length}` : ''}`}
        open={glows.length > 0}
        action={
          <button type="button" className="mini" onClick={() => setList('glows', [...glows, { color: 'var(--loom-accent)', size: 18, strength: 0.7, inner: false }], 'Add glow')}>
            + Glow
          </button>
        }
      >
        {glows.map((g, i) => {
          const put = (next: Partial<LookGlow>, label: string) => setList('glows', glows.map((x, j) => (j === i ? { ...x, ...next } : x)), label, `glow${i}`)
          return (
            <div key={i} className="ap-layer">
              <div className="ap-layer-head">
                <Choice label={`Glow ${i + 1} side`} value={g.inner ? 'inside' : 'outside'} options={['outside', 'inside'] as const} onChange={(v) => put({ inner: v === 'inside' }, 'Glow side')} />
                <button type="button" className="ap-x" aria-label={`Remove glow ${i + 1}`} onClick={() => setList('glows', glows.filter((_, j) => j !== i), 'Remove glow')}>
                  ✕
                </button>
              </div>
              <Row label="Colour" set={false}>
                <Color label={`Glow ${i + 1} colour`} value={g.color} onChange={(v) => put({ color: v }, 'Glow colour')} />
              </Row>
              <Row label="Size" set={false}>
                <Slider label="Glow size" value={g.size} range={RANGES.glowSize} step={1} unit="px" onChange={(v) => put({ size: v }, 'Glow size')} />
              </Row>
              <Row label="Strength" set={false}>
                <Slider label="Glow strength" value={g.strength} range={RANGES.glowStrength} step={0.05} onChange={(v) => put({ strength: v }, 'Glow strength')} />
              </Row>
            </div>
          )
        })}
      </Section>

      <Section title="Shape" open={current.radius !== undefined || current.corners !== undefined}>
        {num('radius', 'Corners', [0, 64], 1, 'px')}
        <Row label="Each corner" set={current.corners !== undefined} onClear={() => clear('corners')}>
          <span className="ap-corners">
            {(['↖', '↗', '↘', '↙'] as const).map((g, k) => {
              const cs = current.corners ?? effective.corners ?? ([0, 1, 2, 3].map(() => current.radius ?? effective.radius ?? 8) as [number, number, number, number])
              return (
                <label key={g} className="ap-corner" title={['Top left', 'Top right', 'Bottom right', 'Bottom left'][k]}>
                  <span aria-hidden="true">{g}</span>
                  <input type="number" className="ap-num" min={0} max={999} aria-label={`${['Top left', 'Top right', 'Bottom right', 'Bottom left'][k]} corner`} value={cs[k]} onChange={(e) => setField('corners', cs.map((x, m) => (m === k ? Math.max(0, Number(e.target.value) || 0) : x)) as [number, number, number, number], 'Set corner')} />
                </label>
              )
            })}
          </span>
        </Row>
      </Section>

      <Section title="Texture & glass" open={['noise', 'blur', 'backdrop', 'translucency'].some((k) => current[k as keyof Look] !== undefined)}>
        {target === '' && num('translucency', 'See-through', RANGES.unit, 0.05)}
        {num('backdrop', 'Frost behind', RANGES.backdrop, 1, 'px')}
        {num('noise', 'Grain', RANGES.noise, 0.05)}
        {num('blur', 'Blur', RANGES.blur, 1, 'px')}
      </Section>

      <Section
        title="Travelling light"
        open={current.trace !== undefined}
        action={
          !(current.trace ?? effective.trace) ? (
            <button type="button" className="mini" onClick={() => setField('trace', { color: 'var(--loom-accent)', width: 2, speed: 3, arc: 0.22 }, 'Add travelling light')}>
              + Add
            </button>
          ) : undefined
        }
      >
        {(current.trace ?? effective.trace) ? (
          <>
            <Row label="Colour" set={current.trace !== undefined} onClear={() => clear('trace')}>
              <Color label="Travelling light colour" value={(current.trace ?? effective.trace)!.color} onChange={(v) => setField('trace', { ...(current.trace ?? effective.trace)!, color: v }, 'Light colour')} />
            </Row>
            <Row label="Width" set={false}>
              <Slider label="Travelling light width" value={(current.trace ?? effective.trace)!.width} range={RANGES.traceWidth} step={0.5} unit="px" onChange={(v) => setField('trace', { ...(current.trace ?? effective.trace)!, width: v }, 'Light width')} />
            </Row>
            <Row label="Lap" set={false}>
              <Slider label="Seconds per lap" value={(current.trace ?? effective.trace)!.speed} range={RANGES.traceSpeed} step={0.1} unit="s" onChange={(v) => setField('trace', { ...(current.trace ?? effective.trace)!, speed: v }, 'Light speed')} />
            </Row>
            <Row label="Length" set={false}>
              <Slider label="Lit length" value={(current.trace ?? effective.trace)!.arc} range={RANGES.traceArc} step={0.01} onChange={(v) => setField('trace', { ...(current.trace ?? effective.trace)!, arc: v }, 'Light length')} />
            </Row>
          </>
        ) : (
          <p className="dim ap-note">A light that runs around the edge, forever. Respects reduced motion.</p>
        )}
      </Section>

      <Section title="Adjust" open={tab !== 'normal'}>
        {num('opacity', 'Opacity', RANGES.opacity, 0.01)}
        {num('scale', 'Scale', RANGES.scale, 0.005)}
        {num('lift', 'Move up', RANGES.lift, 1, 'px')}
        {num('brightness', 'Brightness', RANGES.brightness, 0.01)}
        <Row label="Text colour" set={current.ink !== undefined} onClear={() => clear('ink')}>
          <Color label="Text colour" value={current.ink ?? effective.ink} onChange={(v) => setField('ink', v, 'Text colour')} />
        </Row>
        <Row label="Border colour" set={current.edge !== undefined} onClear={() => clear('edge')}>
          <Color label="Border colour" value={current.edge ?? effective.edge} onChange={(v) => setField('edge', v, 'Border colour')} />
        </Row>
      </Section>

      {target === '' && (
        <Section title="Motion & click" open={!!set.click?.length || !!set.motion}>
          <Row label="Duration" set={!!set.motion}>
            <Slider label="Transition duration" value={set.motion?.duration} inherited={180} range={RANGES.duration} step={10} unit="ms" onChange={(v) => commitSet({ ...set, motion: { duration: v, easing: set.motion?.easing ?? 'smooth' } }, 'Motion duration', 'motion')} />
          </Row>
          <Row label="Easing" set={!!set.motion}>
            <Choice label="Easing" value={set.motion?.easing ?? 'smooth'} options={EASINGS} onChange={(v) => commitSet({ ...set, motion: { duration: set.motion?.duration ?? 180, easing: v } }, 'Motion easing')} />
          </Row>
          <div className="ap-clicks" role="group" aria-label="On click">
            <span className="ap-label">On click</span>
            {CLICK_EFFECTS.map((c) => {
              const on = set.click?.includes(c) ?? false
              return (
                <button key={c} type="button" className={`ap-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => commitSet({ ...set, click: on ? set.click!.filter((x) => x !== c) : [...(set.click ?? []), c] }, on ? `No ${c}` : `Click: ${c}`)}>
                  {c}
                </button>
              )
            })}
            <button
              type="button"
              className="mini"
              disabled={!set.click?.length}
              title="Play the click effect on the canvas"
              onClick={() => {
                const el = document.querySelector<HTMLElement>(`.surface [data-loom-id="${CSS.escape(node.id)}"]`)
                if (el) playClickEffect(el)
              }}
            >
              ▶ Play
            </button>
          </div>
          {!!set.click?.length && (
            <Row label="Click colour" set={!!set.clickColor} onClear={() => commitSet({ ...set, clickColor: undefined }, 'Click colour')}>
              <Color label="Click colour" value={set.clickColor} onChange={(v) => commitSet({ ...set, clickColor: v || undefined }, 'Click colour', 'clickColor')} />
            </Row>
          )}
        </Section>
      )}

      <Section title="Scene light · whole design" open={false}>
        <LightDial s={s} />
        <p className="dim ap-note">One sun for everything: drag it and every shadow, bevel and sheen in the design follows.</p>
      </Section>
    </section>
  )
}

export { DEFAULT_LIGHT }

/**
 * The sun, on the canvas: the scene light as something you grab. A ring over
 * the design; the sun sits on it at the light's direction, closer to the
 * centre the higher it stands (the centre is straight overhead). Drag it and
 * every shadow, bevel and sheen in the design follows, live. One undo step
 * per drag. Arrow keys move it too.
 */
export function SunOverlay({ s, onClose }: { s: EditorStore; onClose: () => void }) {
  const host = React.useRef<HTMLDivElement>(null)
  const [box, setBox] = React.useState({ w: 0, h: 0 })
  React.useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [])
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const light = lightOf(s.doc.meta)
  const cx = box.w / 2
  const cy = box.h / 2
  const R = Math.max(60, Math.min(box.w, box.h) * 0.38)
  const r = ((90 - light.height) / 85) * R
  const a = (light.angle * Math.PI) / 180
  const sx = cx + Math.sin(a) * r
  const sy = cy - Math.cos(a) * r
  const move = (clientX: number, clientY: number) => {
    const b = host.current!.getBoundingClientRect()
    const dx = clientX - b.left - cx
    const dy = clientY - b.top - cy
    const dist = Math.min(R, Math.hypot(dx, dy))
    const angle = Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360)
    const height = Math.round(Math.max(5, Math.min(90, 90 - (dist / R) * 85)))
    s.commit({ op: 'setLight', light: { ...light, angle, height } }, 'Move the light', 'light:canvas-sun')
  }
  const nudge = (next: Partial<SceneLight>) => s.commit({ op: 'setLight', light: { ...light, ...next } }, 'Move the light', 'light:canvas-sun')
  return (
    <div className="sun-overlay" ref={host} aria-label="Scene light">
      {box.w > 0 && (
        <svg width={box.w} height={box.h} aria-hidden="true" className="sun-ring">
          <circle cx={cx} cy={cy} r={R} />
          <circle cx={cx} cy={cy} r={R / 2} className="inner" />
          <line x1={cx} y1={cy} x2={sx} y2={sy} />
          <circle cx={cx} cy={cy} r={3} className="centre" />
        </svg>
      )}
      <button
        type="button"
        className="sun-handle"
        style={{ left: sx, top: sy }}
        aria-label={`Scene light: from ${light.angle} degrees, ${light.height} degrees high. Drag, or use the arrow keys.`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          move(e.clientX, e.clientY)
        }}
        onPointerMove={(e) => e.buttons === 1 && move(e.clientX, e.clientY)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 15 : 5
          if (e.key === 'ArrowLeft') nudge({ angle: (light.angle + 360 - step) % 360 })
          else if (e.key === 'ArrowRight') nudge({ angle: (light.angle + step) % 360 })
          else if (e.key === 'ArrowUp') nudge({ height: Math.min(90, light.height + step) })
          else if (e.key === 'ArrowDown') nudge({ height: Math.max(5, light.height - step) })
          else return
          e.preventDefault()
        }}
      />
      <div className="sun-caption">
        <strong>Scene light</strong> from {light.angle}° · {light.height}° high
        <span className="dim"> · drag the sun · Esc to close</span>
        <button type="button" className="mini" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
