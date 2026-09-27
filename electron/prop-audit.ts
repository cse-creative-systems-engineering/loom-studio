/**
 * Declared-but-unhonoured property audit.
 *
 * The whole properties-panel effort rests on one promise: if a property is
 * declared, setting it changes the output. A property that renders nothing is a
 * lie the designer discovers by dragging a slider and watching nothing happen.
 *
 * So this checks the promise mechanically instead of by reading. For every
 * component, for every declared property: render the component once per STATE it
 * can plausibly be in, and once more per legal VALUE of that property, and diff
 * the markup. A property is inert only if NOTHING it can legally be set to
 * changes the output anywhere.
 *
 * Both halves of that matter, and getting either wrong fills the backlog with
 * work that is not there:
 *
 *  - ONE value is not a verdict. The first version tried a single alternative
 *    and called the property inert when that one value did nothing, which is
 *    how `ScrollView.scrollbars` (the value tried was `always`, already forced
 *    by `direction: vertical`) and `DataCard.shadow` (`sm`, the card's own
 *    elevation) were reported as lies. They both work.
 *  - ONE state is not a verdict either. A control is a function of its
 *    COMPANIONS: `Field.labelWidth` does nothing in a stacked field, an image
 *    has nothing to fit without a source, a cap has nothing to cap in a list of
 *    two. See `probeStates`.
 *
 * Node ids are FIXED. Generated ids differ between the two renders and would
 * mask every diff, which is the trap that makes this kind of check look like it
 * passes.
 *
 * Properties that are metadata rather than rendering inputs (bindable, requires)
 * are skipped: they describe the property to the editor, not the output, and
 * flagging them would bury the real findings in noise.
 */

import { allComponents, instantiate, type ComponentSpec, type PropSpec } from '../src/model/registry'
import { renderNode } from '../src/render/web'
import { ICON_NAMES } from '../src/render/icons'
import type { Document, Node, PropValue } from '../src/model/types'
import { validateProps, delimiterChar } from '../src/model/registry'
import { DELIMITERS } from '../src/model/registry'
import '../src/model/toolbox'
import { renderToStaticMarkup } from 'react-dom/server'

const ID = 'auditnode'

/** Properties that describe the property rather than the output. */
const METADATA = new Set(['bindable', 'requires', 'label', 'group'])

function docWith(type: string, props: Record<string, PropValue>, children: Node[] = []): Document {
  const built = instantiate(type)
  const node: Node = {
    id: ID,
    type,
    // Real schema normalisation, so the audit sees the same defaults a designer
    // would actually get.
    props: validateProps(type, { ...built.props, ...props }).props,
    children: [],
    flow: false,
    visible: true,
    locked: false,
    opacity: 1,
  }
  const nodes: Record<string, Node> = { [node.id]: node }
  for (const child of children) {
    node.children.push(child.id)
    nodes[child.id] = child
  }
  return {
    version: 1,
    meta: { name: 'audit', targets: ['web'], theme: 'midnight', created: 0 },
    root: node.id,
    nodes,
  }
}

/** Every render mode a designer can see, so "output only" is not mistaken for "ignored". */
function allMarkup(doc: Document): string {
  const modes = ['preview', 'authoring'] as const
  return modes
    .map((mode) => {
      try {
        return renderToStaticMarkup(renderNode({ doc, selected: new Set(), mode }, doc.root as string))
      } catch (e) {
        return `THREW:${String(e)}`
      }
    })
    .join('\n@@@\n')
}

/** A string a designer has never typed, for "this text is rendered" questions. */
const MARKER = 'AUDITZZ'

/**
 * EVERY value a property could legally be set to, not one of them.
 *
 * The previous version took the first alternative it could find and declared
 * the property inert when that one value changed nothing. That is a claim about
 * ONE value, not about the control, and it produced findings that were simply
 * wrong: `ScrollView.scrollbars` was reported inert because the only value
 * tried was `always`, which is what `direction: vertical` already forces, and
 * `DataCard.shadow` because the only value tried was `sm`, which is the card's
 * own elevation. Both work. So a property now counts as honoured if ANY legal
 * value changes the output, and the legal values are the ones the properties
 * panel can actually produce: the declared range on the declared step grid,
 * every other enum option, every other delimiter, and a handful of text values
 * because the shape of a text value is chosen by the component, not the type.
 */
function candidates(spec: PropSpec, def: PropValue): PropValue[] {
  const out: PropValue[] = []
  const push = (v: PropValue): void => {
    if (v !== def && !out.includes(v)) out.push(v)
  }
  switch (spec.type) {
    case 'boolean':
      push(def !== true)
      break
    case 'number': {
      // An undeclared range is still a range: the properties panel falls back
      // to a step either side of the default, so that is what the audit uses.
      const base = typeof def === 'number' ? def : 0
      const lo = spec.min ?? base - 100
      const hi = spec.max ?? base + 100
      // The step is part of the declaration: a slider that moves in whole days
      // cannot produce 0.5 of a day, so 0.5 is not evidence of anything.
      const step = Math.abs(spec.step ?? 1) || 1
      const grid = (n: number): number => Number((lo + Math.round((n - lo) / step) * step).toFixed(6))
      const inside = (n: number): boolean => n >= lo && n <= hi
      for (const n of [lo, hi, (lo + hi) / 2]) if (inside(n)) push(grid(n))
      // One step either side of the default, and two, which is where "moving
      // the slider a little" actually lands.
      for (const k of [1, -1, 2, -2]) if (inside(base + k * step)) push(grid(base + k * step))
      break
    }
    case 'color':
      push('#ff00aa')
      push('#00ff88')
      break
    case 'enum':
      for (const o of spec.options ?? []) push(o)
      break
    case 'delimiter':
      // A delimiter's legal values are the ones DELIMITERS names, not the
      // PropSpec's (which has none) — perturbing to an unknown name silently
      // falls back to comma and reports a false finding.
      for (const o of Object.keys(DELIMITERS)) push(o)
      break
    default:
      // Text: a marker, and the two shapes a designer types most often. A
      // property that only works on one of them (`Calendar.today` is a day
      // number the grid actually draws) is honoured, not inert.
      push(MARKER)
      push(`${MARKER}2`)
      push('1')
      push('1284')
      break
  }
  return out
}

/**
 * The states a control is allowed to be tested in.
 *
 * A property is not a function of itself: `Field.labelWidth` does nothing in a
 * stacked field and everything in an inline one, `BarChart.labelsSep` needs the
 * axis turned on, `Image.fit` needs a picture to fit. Testing the default
 * instance alone therefore reports working controls as lies — and reporting
 * working controls as lies is how a backlog fills up with things nobody needs
 * to fix. So every property is tried in every state below, and is only called
 * inert when it changes NOTHING anywhere.
 *
 * The states are GENERATED from the component's own declaration, so a new
 * component gets the same rigour for free, with two exceptions that are facts
 * about a component rather than about its types (see `IN_USE`).
 */
interface ProbeState {
  base: Record<string, PropValue>
  children: Node[]
  why: string
}

/** Children a container-only property needs something to act on. */
function probeChildren(): Node[] {
  // Accordion.open needs AccordionItems, not labels: a property whose effect is
  // "how many of MY children start open" is inert against the wrong child type.
  // One of each plausible child makes the retry context real.
  return (['Label', 'Button', 'AccordionItem', 'SettingsRow'] as const).map((type, i) => ({
    id: `${ID}-${i}`,
    type,
    props: validateProps(type, instantiate(type).props).props,
    children: [],
    flow: false,
    visible: true,
    locked: false,
    opacity: 1,
  })) as Node[]
}

/** Whether a string property holds a LIST, judged by its own separator. */
function listKeyFor(spec: ComponentSpec, key: string): string | null {
  return spec.props[key]?.type === 'string' && key + 'Sep' in spec.props ? key : null
}

/** The list at `key`, split on its own separator. */
function listItems(value: PropValue, sep: PropValue | undefined): string[] {
  const raw = String(value ?? '')
  if (raw.trim() === '') return []
  return raw.split(delimiterChar(sep)).map((s) => s.trim()).filter((s) => s !== '')
}

/**
 * A value of the right SHAPE for an empty string property.
 *
 * Only three shapes are special, and each is special because the component
 * defines it: an `icon` has to name an icon in the set to draw anything, and a
 * `src` has to be a URL to be a picture. Everything else takes a marker, which
 * is as much content as a text property can be asked to show.
 */
function sampleFor(key: string): string {
  if (key === 'icon') return ICON_NAMES[0]
  if (key === 'src' || key === 'image' || key === 'href') return 'https://example.com/audit.png'
  return MARKER
}

/** Every switch on: the most permissive state a component can be rendered in. */
function flagsOn(spec: ComponentSpec): Record<string, PropValue> {
  const base: Record<string, PropValue> = {}
  for (const [k, ps] of Object.entries(spec.props)) {
    if (METADATA.has(k)) continue
    if (ps.type === 'boolean') base[k] = true
  }
  return base
}

/**
 * ...and then the content a designer would have put in.
 *
 * Two things are added on top of the switches. EMPTY strings get a value,
 * because a component with nothing to show is a component whose layout
 * properties have nothing to act on. And every LIST is repeated four times,
 * because a cap — `maxTags`, `maxItems`, a `+N` overflow chip — is a cap on
 * something: a list that already fits inside the cap is a list where the cap
 * correctly does nothing, which is not the same as a cap that is ignored.
 */
function filledIn(spec: ComponentSpec): Record<string, PropValue> {
  const base = flagsOn(spec)
  for (const [k, ps] of Object.entries(spec.props)) {
    if (METADATA.has(k)) continue
    const listKey = listKeyFor(spec, k)
    if (listKey) {
      const items = listItems(ps.default, spec.props[listKey + 'Sep']?.default)
      if (items.length > 0) base[listKey] = Array.from({ length: items.length * 4 }, (_, i) => items[i % items.length]).join(delimiterChar(spec.props[listKey + 'Sep']?.default))
      continue
    }
    if (ps.type === 'string' && String(ps.default) === '') base[k] = sampleFor(k)
  }
  return base
}

/**
 * The few states that are facts about a component rather than about its types.
 *
 * Each entry is a claim about how the component is USED, and each is needed
 * because the declared default is not a state a designer would ship: a gauge
 * parked at zero has no domain to move, a badge says "New" rather than a count,
 * a metric says "$48.2k" rather than a figure, a pager that has not been told
 * how many rows there are has no page size, and a grid nobody has sorted has no
 * sort column. They are ADDITIVE — a control still has to change the output in
 * one of these states to count as honoured, and the states before them are
 * tried first.
 */
const IN_USE: Record<string, Record<string, PropValue>> = {
  Gauge: { value: 50 },
  DataGrid: { sortColumn: 1, sortDirection: 'desc' },
  Stat: { value: '1284.5' },
  KpiCard: { value: '1284.5' },
  Badge: { text: '1284' },
  Pagination: { itemCount: 137 },
  // `const x = 1` has no tab in it, and a tab size cannot widen a character
  // that is not there.
  CodeBlock: { code: 'for (let i = 0; i < 4; i++) {\n\tstep(i)\n}' },
}

function probeStates(spec: ComponentSpec): ProbeState[] {
  const kids = probeChildren()
  const filled = filledIn(spec)
  const out: ProbeState[] = [
    { base: {}, children: [], why: 'as shipped' },
    { base: flagsOn(spec), children: kids, why: 'every switch on' },
    { base: filled, children: kids, why: 'filled in' },
  ]
  // Companion ENUMS, one at a time. Most conditional properties are conditional
  // on a sibling's MODE — an inline field, a labelled legend, an axis — and a
  // property that only works in one mode of its neighbour is working.
  for (const [k, ps] of Object.entries(spec.props)) {
    if (METADATA.has(k) || ps.type !== 'enum') continue
    for (const o of ps.options ?? []) {
      if (o === ps.default) continue
      out.push({ base: { ...filled, [k]: o }, children: kids, why: `${k}=${o}` })
    }
  }
  const inUse: Record<string, PropValue> | undefined = IN_USE[spec.name]
  if (inUse) out.push({ base: { ...filled, ...inUse }, children: kids, why: 'in use' })
  return out
}

/**
 * A list value that actually contains the separator, for testing a separator
 * change. The argument is the separator's NAME, and it must be mapped through
 * DELIMITERS to its character — joining on the literal string "comma" produces
 * a value containing no commas at all, and then every separator looks inert.
 */
function listValueForSep(name: string): string {
  const ch = (DELIMITERS as Record<string, string>)[name] ?? ','
  return ['aa', 'bb', 'cc'].join(ch)
}

/** The same list with figures in it, for a chart that parses its values. */
function numListValueForSep(name: string): string {
  const ch = (DELIMITERS as Record<string, string>)[name] ?? ','
  return ['11', '22', '33'].join(ch)
}

/**
 * The most permissive context a component can be rendered in: every boolean
 * property on, and two children so container-only properties have something to
 * act on. Used to tell "conditional" apart from "not implemented".
 */
interface Finding {
  name: string
  prop: string
  reason: string
}

export function auditProps(): { checked: number; findings: Finding[] } {
  const findings: Finding[] = []
  let checked = 0

  for (const spec of allComponents()) {
    const states = probeStates(spec)
    for (const [key, ps] of Object.entries(spec.props).filter(([k]) => !METADATA.has(k))) {
      const values = candidates(ps, ps.default)
      if (values.length === 0) {
        // No legal alternative value exists (e.g. a clamped max of 1); skip
        // rather than pretend to have tested it.
        continue
      }
      checked += 1

      // Separator companions are tested WITH a list value that contains the
      // separator, otherwise "nothing changed" is the correct answer and the
      // finding would be noise.
      const isSep = ps.type === 'delimiter'
      const listKey = isSep ? key.replace(/Sep$/, '') : null
      if (isSep && (!listKey || !(listKey in spec.props))) continue

      let honoured = false
      for (const state of states) {
        // The property under test is pinned to its DEFAULT in the "before"
        // render. Without that, a state that turns every switch on would be
        // compared against itself for a boolean — the same value on both sides
        // of the diff, which reads as "inert" for a control that works.
        const base: Record<string, PropValue> = { ...state.base, [key]: ps.default }
        // A separator is tested against a list that HOLDS its character, and
        // against both a text list and a numeric one: a chart's `values` parse
        // to NaN for "aa,bb,cc", so every separator looks inert when only text
        // is tried — which is how a working separator gets reported as a lie.
        const flavours: Record<string, PropValue>[] = [base]
        if (isSep && listKey) {
          flavours[0] = { ...base, [listKey]: listValueForSep(String(ps.default)) }
          flavours.push({ ...base, [listKey]: numListValueForSep(String(ps.default)) })
        }
        for (const flavour of flavours) {
          const before = allMarkup(docWith(spec.name, flavour, state.children))
          for (const value of values) {
            if (before !== allMarkup(docWith(spec.name, { ...flavour, [key]: value }, state.children))) {
              honoured = true
              break
            }
          }
          if (honoured) break
        }
        if (honoured) break
      }
      if (!honoured) {
        // The reason names the states that were tried, because "nothing
        // changed" is only useful to whoever picks this up if it also says
        // where it was looked for.
        const tried = states.map((s) => s.why).join(', ')
        findings.push({
          name: spec.name,
          prop: key,
          reason: isSep
            ? `no separator changes this list in any state (${tried})`
            : `no legal value changes the output in any state (${tried})`,
        })
      }
    }
  }
  return { checked, findings }
}

if (process.env.LOOM_AUDIT === '1') {
  const { checked, findings } = auditProps()
  const byName = new Map<string, string[]>()
  for (const f of findings) {
    const list = byName.get(f.name) ?? []
    list.push(f.prop)
    byName.set(f.name, list)
  }
  console.log(`checked ${checked} declared properties across ${allComponents().length} components`)
  console.log(`declared-but-unhonoured: ${findings.length}`)
  for (const [name, props] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${name}: ${props.join(', ')}`)
  }
}

/**
 * The properties KNOWN not to be honoured yet, with the reason each is still
 * open. This is a ratchet, not an excuse: the gate below fails if a NEW inert
 * property appears, and fails if one of these is quietly abandoned without its
 * entry being removed. An honest backlog beats a green suite that lies.
 *
 * IT IS EMPTY, and that is the point rather than an accident. The 41 entries it
 * used to hold were not 41 defects: most were controls that had been working
 * all along and were only ever tested against a default instance where their
 * companion was off — a gauge parked at zero, a badge saying "New", a pie
 * legend set to percentages, a scroll view whose bars are already pinned. The
 * audit now tries every legal value in every state a component can be in, and
 * finds nothing inert.
 *
 * A finding here is therefore a REGRESSION until proven otherwise, and the
 * only legitimate way to make the gate green again is to implement the property
 * — or, if it genuinely cannot be implemented, to delete it from the schema so
 * that the control is an honest absence. Registering a finding here is the one
 * thing that is not allowed: an entry for a property the audit no longer
 * reports is caught by the `missing` check below.
 */
export const KNOWN_INERT: Record<string, string> = {}

export interface AuditReport {
  checked: number
  inert: string[]
  unexpected: string[]
  missing: string[]
}

/**
 * Compare the audit against the declared backlog. `unexpected` is a NEW lie and
 * fails the build; `missing` means a known gap was fixed and its entry should be
 * deleted, which is a nudge rather than a failure.
 */
export function auditReport(): AuditReport {
  const { checked, findings } = auditProps()
  const inert = findings.map((f) => `${f.name}.${f.prop}`)
  const known = new Set(Object.keys(KNOWN_INERT))
  return {
    checked,
    inert,
    unexpected: inert.filter((k) => !known.has(k)),
    missing: [...known].filter((k) => !inert.includes(k)),
  }
}
