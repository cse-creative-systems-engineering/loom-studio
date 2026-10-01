/**
 * Toolbox tooltips that are worth waiting for.
 *
 * The old tooltip was the component's name plus a noun phrase, which is the
 * same information twice: "Switch — Toggle switch." tells a designer nothing
 * they could not get by reading the name.
 *
 * A tooltip is the only documentation a designer always has, so it has to
 * answer the questions actually being asked while dragging a component onto a
 * canvas:
 *
 *   1. What does this DO when I use it?   -> its behaviour role, which we
 *      already declare as data. This was the most useful line and it was
 *      completely invisible.
 *   2. What do I set on it?              -> the few properties that change what
 *      the component IS, preferring the ones that can be bound to data.
 *   3. What will bite me?                -> parent requirements, list formats,
 *      and what happens with no children.
 *
 * All of it is DERIVED, so a tooltip cannot drift away from its component the
 * way a hand-written paragraph does.
 */

import { getComponent, unsupportedProps, type ComponentSpec, type PropSpec } from './registry'
import { REVEAL_OF, ROLE_OF } from '../render/behaviour'
import type { TargetId } from './types'
import { propLabel } from './inspector-view'

/** What each role does, in a designer's language rather than the role's name. */
const ROOT_PHRASE: Record<string, string> = {
  press: 'Presses on click.',
  toggle: 'Flips between on and off on click.',
  check: 'Toggles on click.',
  radio: 'Selects on click — one per group.',
  panel: 'Revealed when its tab is selected.',
  disclosure: 'Opens and closes on click.',
}

/** Item-level roles, phrased about the items rather than the container. */
const ITEM_PHRASE: Record<string, string> = {
  Tabs: 'Tabs switch on click and reveal their panels.',
  TabBar: 'Tabs switch on click.',
  DataGrid: 'Columns sort on click, search filters as you type, ticked rows swap the toolbar for bulk actions, and Export downloads a CSV.',
  Pagination: 'Page numbers change on click.',
  ProgressDots: 'Dots jump to that step on click.',
  Stepper: 'Advances on click.',
  TreeList: 'Rows expand on click.',
  Rating: 'Stars set the value on click.',
  AppShell: 'The ‹ button collapses the sidebar to an icon rail.',
}

/**
 * True only for a particular component, and otherwise discovered by breaking
 * something. Deliberately short: a tooltip nobody reads is a wasted hover.
 */
const CAVEATS: Record<string, string[]> = {
  TabPanel: ['Put this inside a Tabs — the Nth panel belongs to the Nth tab.'],
  AccordionItem: ['Put this inside an Accordion.'],
  SettingsRow: ['Put this inside a SettingsSection. Holds any control.'],
  AppShell: [
    'Slots are positional: first child is the sidebar, second is the top bar, the rest is content.',
    'HeaderBar and SidebarPanel still work alone — the shell just composes them.',
  ],
  DataGrid: [
    'Each column is a definition in the panel: its type (money, status, person, progress, date...) decides how it is drawn, sorted and totalled.',
    'Rows are a delimited table: paste from a spreadsheet, or set rowSep and cellSep.',
  ],
  Field: [
    'Any control drops inside and picks up the field’s validation state.',
    'For aligning a control in a list, use SettingsRow instead.',
  ],
  KpiCard: ['One number, one comparison, one visual — the enum will not let you take all three.'],
  CommandPalette: ['Indexes the controls in this design, so there are no items to maintain.'],
  Icon: ['Use a name from the house set, or a literal glyph for a brand mark.'],
  Stat: ['A bare number, for a table cell or a dense row. For the full card use KpiCard.'],
  Sparkline: ['A trend line with no number attached. For the full card use KpiCard.'],
  DataCard: ['A container for a metric — pair it with a Stat or a KpiCard.'],
  SidebarPanel: ['Collapses on its own; put it in an AppShell for the icon-rail behaviour.'],
  Input: ['A bare text input. Wrap it in a Field when it needs a label or validation.'],
  Select: ['A bare select. Wrap it in a Field when it needs a label or validation.'],
  TextArea: ['A bare text area. Wrap it in a Field when it needs a label or validation.'],
}

/** A short, readable type name for a property. */
function typeName(ps: PropSpec): string {
  if (ps.type === 'delimiter') return 'separator'
  if (ps.type === 'enum') return 'choice'
  return ps.type
}

/** A property's default, shown only when it is worth the characters. */
function defaultHint(ps: PropSpec): string {
  const v = ps.default
  if (v === '' || v === false || v === 0 || v === undefined || v === null) return ''
  const text = String(v)
  return text.length > 18 ? '' : ` = ${text}`
}

/**
 * The properties worth mentioning: the ones that change what the component IS,
 * not the ones that nudge it. Bound properties first (a real interface needs
 * them), then content-bearing ones.
 */
/**
 * Property names that carry the CONTENT of a component — the ones a designer
 * actually types into. Scoring by type alone ranked DataGrid's separators above
 * its columns, which is exactly backwards: a separator is set once and then
 * forgotten, and it is also already called out in the caveats.
 */
const CONTENT_NAMES = /^(columns|rows|items|options|labels?|title|text|value|values|points|steps|tabs|names|trail|links|steps|code|keys|href|placeholder|delta|label)$/

function keyPropEntries(spec: ComponentSpec, limit = 3): Array<[string, PropSpec]> {
  const score = ([key, ps]: [string, PropSpec]): number => {
    let s = 0
    if (ps.bindable) s += 100
    if (CONTENT_NAMES.test(key)) s += 60
    if (ps.group === 'Content') s += 25
    if (ps.type === 'enum') s += 20
    // A separator is a setting, not content: it belongs in the caveats.
    if (ps.type === 'delimiter') s -= 40
    if (ps.type === 'boolean') s -= 20
    if (ps.group === 'Layout') s -= 10
    return s
  }
  return Object.entries(spec.props)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit)
}

/** The properties worth reaching for, with their types (for tests, and the AI). */
function keyProps(spec: ComponentSpec, limit = 3): string[] {
  return keyPropEntries(spec, limit).map(([key, ps]) => `${key} (${typeName(ps)}${defaultHint(ps)})`)
}

export interface Tooltip {
  /** One line: what this component is FOR. */
  summary: string
  /** What it does when used — or an honest "nothing". */
  behaviour: string
  /** The properties worth reaching for. */
  properties: string[]
  /** Parent requirements, list formats, target gating. */
  caveats: string[]
}

/** Build the structured tooltip for a component. */
export function buildTooltip(spec: ComponentSpec, target: TargetId = 'web'): Tooltip {
  const root = spec.name in ROLE_OF ? ROOT_PHRASE[ROLE_OF[spec.name]] : undefined
  const item = spec.name in ITEM_PHRASE ? ITEM_PHRASE[spec.name] : undefined
  const behaviour =
    root ??
    item ??
    (spec.name in REVEAL_OF ? 'Opens and closes.' : 'Presentational — it has no interaction of its own.')

  const caveats = [...(CAVEATS[spec.name] ?? [])]
  if (spec.container) caveats.push('A container — drop any control inside it.')
  const gated = unsupportedProps(spec, target)
  if (gated.length > 0) caveats.push(`Not portable to ${target}: ${gated.join(', ')}.`)

  return { summary: spec.description, behaviour, properties: keyProps(spec), caveats }
}

/** The plain-text tooltip, for a toolbox button's `title`. */
export function tooltipText(spec: ComponentSpec, target: TargetId = 'web'): string {
  const t = buildTooltip(spec, target)
  const lines = [t.summary, '', t.behaviour]
  // In the inspector's own words. The typed form ("variant (choice =
  // underline)") read as a schema dump to anyone who is not writing code.
  const names = keyPropEntries(spec).map(([key, ps]) => propLabel(key, ps).toLowerCase())
  if (names.length > 0) lines.push('', `You can set its ${names.join(', ')}.`)
  if (t.caveats.length > 0) lines.push('', t.caveats.join('\n'))
  return lines.join('\n')
}

/** Convenience for callers that only have a name. */
export function tooltipFor(name: string, target: TargetId = 'web'): string {
  const spec = getComponent(name)
  return spec ? tooltipText(spec, target) : name
}
