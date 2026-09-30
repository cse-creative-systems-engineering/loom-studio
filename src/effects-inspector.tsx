/**
 * Effects inspector panel.
 *
 * The whole point of declaring effects as data is that this file needs no
 * per-effect code: controls are generated from `EFFECT_FIELDS`, and every
 * change goes through the single `setEffects` op so a multi-field tweak is one
 * undo step.
 */

import { DEFAULT_EFFECTS, type EffectValues } from './render/effects'
import { Toggle } from './ui-primitives'

/** One editable field, declared once. */
interface EffectField {
  /** Key into EffectValues. */
  key: keyof EffectValues & string
  label: string
  /** Only shown when the effect's toggle is on. */
  of?: keyof EffectValues & string
  kind: 'number' | 'color' | 'select'
  min?: number
  max?: number
  step?: number
  options?: string[]
  suffix?: string
}

/** The eight toggles, in the order they read best. */
const TOGGLES: Array<{ key: keyof EffectValues & string; label: string; blurb: string }> = [
  { key: 'glass', label: 'Glass', blurb: 'Frosted translucent surface' },
  { key: 'aurora', label: 'Aurora', blurb: 'Drifting colour orbs behind' },
  { key: 'grain', label: 'Grain', blurb: 'Fine noise so fills are not flat' },
  { key: 'spotlight', label: 'Spotlight', blurb: 'Highlight that follows the pointer' },
  { key: 'shimmer', label: 'Shimmer', blurb: 'Light sweep across the border' },
  { key: 'glow', label: 'Glow', blurb: 'Coloured bloom underneath' },
  { key: 'tilt', label: 'Tilt', blurb: '3D tilt on pointer move' },
  { key: 'chromatic', label: 'Chromatic', blurb: 'Split-fringe text shadow' },
]

const FIELDS: EffectField[] = [
  { key: 'glassBlur', label: 'Blur', of: 'glass', kind: 'number', min: 0, max: 60, suffix: 'px' },
  { key: 'glassSaturation', label: 'Saturation', of: 'glass', kind: 'number', min: 100, max: 300, suffix: '%' },
  { key: 'innerGlowColor', label: 'Inner glow', of: 'glass', kind: 'color' },
  { key: 'auroraFrom', label: 'From', of: 'aurora', kind: 'color' },
  { key: 'auroraVia', label: 'Via', of: 'aurora', kind: 'color' },
  { key: 'auroraTo', label: 'To', of: 'aurora', kind: 'color' },
  { key: 'auroraSpeed', label: 'Speed', of: 'aurora', kind: 'number', min: 1, max: 30, suffix: 's' },
  { key: 'auroraBlur', label: 'Softness', of: 'aurora', kind: 'number', min: 0, max: 120, suffix: 'px' },
  { key: 'grainIntensity', label: 'Intensity', of: 'grain', kind: 'number', min: 0, max: 1, step: 0.01 },
  { key: 'spotlightColor', label: 'Colour', of: 'spotlight', kind: 'color' },
  { key: 'spotlightSize', label: 'Radius', of: 'spotlight', kind: 'number', min: 60, max: 800, suffix: 'px' },
  { key: 'shimmerSpeed', label: 'Speed', of: 'shimmer', kind: 'number', min: 0.5, max: 12, suffix: 's' },
  { key: 'shimmerBorderWidth', label: 'Border', of: 'shimmer', kind: 'number', min: 1, max: 6, suffix: 'px' },
  { key: 'glowColor', label: 'Colour', of: 'glow', kind: 'color' },
  { key: 'glowSpread', label: 'Spread', of: 'glow', kind: 'number', min: 0, max: 120, suffix: 'px' },
  { key: 'tiltMax', label: 'Max angle', of: 'tilt', kind: 'number', min: 1, max: 24, suffix: '°' },
  {
    key: 'motion',
    label: 'Hover motion',
    kind: 'select',
    options: ['none', 'fade', 'scale', 'blur'],
  },
  { key: 'hoverScale', label: 'Hover scale', of: 'motion', kind: 'number', min: 1, max: 1.2, step: 0.01 },
]

export function EffectsPanel({
  effects,
  onChange,
  onCommit,
}: {
  effects: EffectValues
  /** Live update during a drag of a slider. */
  onChange: (patch: Record<string, unknown>) => void
  /** Commit the gesture. */
  onCommit: () => void
}) {
  const active = TOGGLES.filter((t) => effects[t.key] === true).length

  return (
    <section className="eff">
      <h3>
        Effects
        {active > 0 && <span className="eff-count">{active} on</span>}
      </h3>

      <div className="eff-toggles">
        {TOGGLES.map((t) => (
          <div className="eff-row" key={t.key} title={t.blurb}>
            <div className="eff-label">
              <span>{t.label}</span>
            </div>
            <Toggle
              label={t.label}
              checked={effects[t.key] === true}
              onChange={(v) => {
                // One op, one undo step: patch the toggle and seal together.
                onChange({ [t.key]: v })
                onCommit()
              }}
            />
          </div>
        ))}
      </div>

      {active > 0 && (
        <div className="eff-fields">
          {FIELDS.filter((f) => !f.of || effects[f.of] === true).map((f) => (
            <EffectControl
              key={f.key}
              field={f}
              value={effects[f.key]}
              onChange={onChange}
              onCommit={onCommit}
            />
          ))}
          <button
            type="button"
            className="eff-reset"
            onClick={() => {
              onChange({ ...DEFAULT_EFFECTS })
              onCommit()
            }}
          >
            Reset all effects
          </button>
        </div>
      )}
    </section>
  )
}

function EffectControl({
  field,
  value,
  onChange,
  onCommit,
}: {
  field: EffectField
  value: EffectValues[keyof EffectValues]
  onChange: (patch: Record<string, unknown>) => void
  onCommit: () => void
}) {
  if (field.kind === 'select') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <select
          value={String(value)}
          onChange={(e) => {
            onChange({ [field.key]: e.target.value })
            onCommit()
          }}
        >
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (field.kind === 'color') {
    return (
      <div className="field">
        <label>{field.label}</label>
        <div className="eff-color">
          <input
            type="color"
            value={hexOnly(String(value))}
            onChange={(e) => {
              onChange({ [field.key]: e.target.value })
              onCommit()
            }}
          />
          <input
            type="text"
            className="eff-color-text"
            value={String(value)}
            onChange={(e) => onChange({ [field.key]: e.target.value })}
            onBlur={onCommit}
          />
        </div>
      </div>
    )
  }

  const n = Number(value) || 0
  return (
    <div className="field">
      <label>
        {field.label}
        <span className="dim eff-num">
          {step(n, field.step ?? 1)}
          {field.suffix ?? ''}
        </span>
      </label>
      <input
        type="range"
        min={field.min ?? 0}
        max={field.max ?? 100}
        step={field.step ?? 1}
        value={n}
        onChange={(e) => onChange({ [field.key]: Number(e.target.value) })}
        onPointerUp={onCommit}
        onBlur={onCommit}
      />
    </div>
  )
}

/** `<input type=color>` only accepts #rrggbb, so rgba values need converting. */
function hexOnly(v: string): string {
  if (/^#[0-9a-f]{6}$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v)
  if (m) {
    const hex = (n: string) => Number(n).toString(16).padStart(2, '0')
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`
  }
  return '#888888'
}

function step(n: number, s: number): string {
  return s < 1 ? n.toFixed(2) : String(Math.round(n))
}
