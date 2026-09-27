/**
 * The shared property vocabulary.
 *
 * 117 components had 333 declared properties between them, and almost every one
 * of them was a bespoke noun: this control has `variant`, that one has `tone`,
 * a third has `style`. That is why the properties panel felt thin — there was
 * no shared language to hang the obvious options on, so each component had to
 * be re-invented from scratch, and most were left minimal.
 *
 * These fragments are that language. A component composes the fragments it
 * needs:
 *
 *   props: { label: ..., ...boxProps(), ...controlProps(), ...textProps() }
 *
 * and the RENDERER honours them generically (see `applyCommonStyle` in
 * `render/web.tsx`): a declared property is applied, an undeclared one does not
 * exist. So adding the shared vocabulary to a component is a one-line schema
 * change, not a renderer branch — which is what makes it possible to give all
 * 117 components a real properties panel.
 *
 * Naming rules, so the panel reads like one product:
 *   - `size` is always sm | md | lg
 *   - `variant` is always the visual treatment of a control
 *   - `tone` is always semantic colour (info/success/warning/danger)
 *   - `align` is content alignment, `justify` is distribution within a box
 *   - `state` is a control's own condition; `status` is a record's condition
 */

import type { PropSpec } from './registry'

type Props = Record<string, PropSpec>

const str = (defaultValue: string, group = 'Content', extra: Partial<PropSpec> = {}): PropSpec => ({
  type: 'string',
  default: defaultValue,
  group,
  ...extra,
})
const num = (defaultValue: number, group: string, min: number, max: number, extra: Partial<PropSpec> = {}): PropSpec => ({
  type: 'number',
  default: defaultValue,
  group,
  min,
  max,
  ...extra,
})
const bool = (defaultValue: boolean, group = 'State', extra: Partial<PropSpec> = {}): PropSpec => ({
  type: 'boolean',
  default: defaultValue,
  group,
  ...extra,
})
const choice = (options: string[], defaultValue: string, group = 'Style', extra: Partial<PropSpec> = {}): PropSpec => ({
  type: 'enum',
  options,
  default: defaultValue,
  group,
  ...extra,
})
const color = (defaultValue = '', group = 'Style', extra: Partial<PropSpec> = {}): PropSpec => ({
  type: 'color',
  default: defaultValue,
  group,
  ...extra,
})

/** Inner spacing. `padding` is the shorthand the renderer expands to all sides. */
export const spaceProps = (): Props => ({
  padding: num(0, 'Layout', 0, 96),
  paddingX: num(-1, 'Layout', -1, 96),
  paddingY: num(-1, 'Layout', -1, 96),
  gap: num(0, 'Layout', 0, 64),
})

/** How children are arranged inside a container. */
export const flowProps = (): Props => ({
  direction: choice(['row', 'column'], 'column', 'Layout'),
  align: choice(['stretch', 'start', 'center', 'end', 'baseline'], 'stretch', 'Layout'),
  justify: choice(['start', 'center', 'end', 'between', 'around', 'evenly'], 'start', 'Layout'),
  wrap: bool(false, 'Layout'),
})

/** The box itself: size, surface, edge. */
export const boxProps = (): Props => ({
  width: num(-1, 'Layout', -1, 4000),
  height: num(-1, 'Layout', -1, 4000),
  radius: num(-1, 'Style', -1, 64),
  background: color('', 'Style'),
  border: color('', 'Style'),
  borderWidth: num(-1, 'Style', -1, 8),
  shadow: choice(['none', 'sm', 'md', 'lg', 'glow'], 'none', 'Style'),
})

/** Text inside a component. */
export const textProps = (): Props => ({
  fontSize: num(-1, 'Type', -1, 96),
  fontWeight: num(-1, 'Type', -1, 900),
  color: color('', 'Type'),
  align: choice(['left', 'center', 'right', 'justify'], 'left', 'Type'),
  lineHeight: num(-1, 'Type', 0, 4),
  letterSpacing: num(-1, 'Type', -4, 12),
  maxWidth: num(-1, 'Type', -1, 2000),
})

/** Every interactive control: size, treatment, and the conditions it can be in. */
export const controlProps = (options?: string[], defaultVariant = 'default'): Props => ({
  size: choice(['sm', 'md', 'lg'], 'md', 'Size'),
  variant: options
    ? choice(options, defaultVariant, 'Style')
    : choice(['default', 'primary', 'secondary', 'ghost', 'danger'], defaultVariant, 'Style'),
  disabled: bool(false, 'State'),
  required: bool(false, 'State'),
  readOnly: bool(false, 'State'),
})

/** Semantic colour, for anything that reports a condition. */
export const toneProps = (): Props => ({
  tone: choice(['neutral', 'info', 'success', 'warning', 'danger'], 'neutral', 'State'),
})

/** A value plus the things you need to display a number honestly. */
export const valueProps = (): Props => ({
  value: str('', 'Content', { bindable: true }),
  unit: str('', 'Content'),
  precision: num(-1, 'Content', -1, 6),
  max: num(100, 'Content', -1, 1e9),
  min: num(0, 'Content', -1, 1e9),
  showLabel: bool(true, 'Content'),
})

/** Containers that can hold a scrollable region. */
export const scrollProps = (): Props => ({
  overflow: choice(['visible', 'auto', 'scroll', 'hidden'], 'visible', 'Layout'),
  stickyHeader: bool(false, 'Layout'),
})

/** A list of items, with the separator that parses it. */
export function listProps(listKey: string, defaultValue: string, delimiter = 'comma'): Props {
  return {
    [listKey]: str(defaultValue, 'Content', { bindable: true }),
    [`${listKey}Sep`]: { type: 'delimiter', default: delimiter, group: 'Content' },
  }
}

/** State thresholds, for a value that changes colour as it moves. */
export const thresholdProps = (): Props => ({
  warnAt: num(-1, 'Content', -1, 1e9),
  dangerAt: num(-1, 'Content', -1, 1e9),
})

/**
 * Positioning and docking — properties EVERY component gets.
 *
 * These are not per-category options, they are true of anything you can place,
 * so they are injected into the registry rather than repeated 120 times. That
 * is the difference between "every control can dock" and "every control can
 * dock, until someone forgets".
 *
 * `anchor` pins a FREE (absolutely positioned) node to an edge or corner of its
 * parent so it stays put when the parent resizes — the difference between a
 * header that scrolls away and one that does not. It deliberately overrides the
 * numeric x/y, because "pin to the top right" and "be at 40,12" are different
 * intentions and only one can win.
 */
export const ANCHORS = [
  'top-left', 'top', 'top-right',
  'right', 'bottom-right', 'bottom',
  'bottom-left', 'left', 'center', 'fill',
] as const

export type Anchor = (typeof ANCHORS)[number]

/** The positioning options every component carries. */
export const positionProps = (): Props => ({
  // 'none' is an explicit unset rather than an empty string: an enum property's
  // value must be one of its options, or the loader "repairs" a perfectly good
  // document on every save.
  anchor: { type: 'enum', options: ['none', ...ANCHORS], default: 'none', group: 'Position' },
  rotate: num(0, 'Position', -180, 180),
  sticky: bool(false, 'Position'),
})
