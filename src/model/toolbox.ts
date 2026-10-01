/**
 * The initial toolbox: the spine of the catalogue.
 *
 * Deliberately small in COUNT and complete in OPTIONS. A handful of containers
 * and leaves that exercise every structural feature (containers, free
 * positioning, flow, bindable props, target-gated props) — each of them
 * carrying the full property surface a professional expects, because a
 * six-property Button is a prototype, not a component.
 *
 * THE RULE THIS FILE FOLLOWS: a property is only declared when the renderer
 * HONOURS it. Two mechanisms make that true, and between them they cover
 * everything below:
 *
 *  1. The shared vocabulary in `./prop-vocab`. `applyCommonStyle` in
 *     `render/web.tsx` applies `width, height, radius, background, border,
 *     borderWidth, shadow, padding, paddingX, paddingY, gap, direction, align,
 *     justify, wrap, fontSize, fontWeight, color, lineHeight, letterSpacing,
 *     maxWidth, disabled, overflow` to ANY node that DECLARES them, and `-1`
 *     (or an empty string) means "not set" so the component keeps its own
 *     designed default. So composing `...boxProps()` is a real feature, not a
 *     promise: one line of schema, no renderer branch.
 *  2. Whatever is genuinely specific to a component — an input's `variant`
 *     treatment, a button's `loading`, a field's `size`, a heading's
 *     `truncate` — is implemented in that component's own `case` in
 *     `render/web.tsx`, where the behaviour lives next to the drawing.
 *
 * A property that is declared but not honoured is worse than a missing one: the
 * designer sets it, the output does not move, and the tool loses their trust.
 * That is why some obvious-looking options are absent and commented where they
 * are absent (see Gauge, Sparkline, Field).
 *
 * Every list-valued property ships its `delimiter` companion, so where a list
 * splits is the document's decision rather than a convention in the renderer.
 */

import { defineComponent, getComponent, type PropSpec } from '../model/registry'
import { boxProps, contentStateParts, contentStateProps, CONTENT_STATE_TOOLS, controlProps, flowProps, listProps, scrollProps, spaceProps, textProps } from './prop-vocab'
import { GROUP_ORDER } from './prop-groups'
import './catalog1'
import './catalog2'
import './conversation'

type Props = Record<string, PropSpec>

/**
 * The control vocabulary for something you PRESS rather than fill in.
 *
 * `controlProps` also carries `required` and `readOnly`, which are input
 * states: a button cannot be required or read-only, and offering them would be
 * two controls in the panel that look real and do nothing. Everything else —
 * size, variant, disabled — is exactly what a button has.
 */
function pressProps(options: string[], defaultVariant: string): Props {
  const props = controlProps(options, defaultVariant)
  delete props.required
  delete props.readOnly
  return props
}

defineComponent({
  name: 'Panel',
  category: 'Containers',
  container: true,
  icon: '▦',
  description: 'A surface container. Accepts children.',
  props: {
    title: { type: 'string', default: '', group: 'Content' },
    ...spaceProps(),
    ...flowProps(),
    ...boxProps(),
    ...scrollProps(),
    // The panel's OWN defaults, which win over the fragments' neutral ones. A
    // panel is a designed surface: it has padding, a radius, gaps and an
    // elevation out of the box, and those are the numbers a drop starts from.
    padding: { type: 'number', default: 16, min: 0, max: 96, group: 'Layout' },
    gap: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
    radius: { type: 'number', default: 14, min: 0, max: 48, group: 'Style' },
    // 'md' rather than 'none': the panel really does ship with an elevation,
    // so the default has to name it. 'none' stays available, and is honoured in
    // the panel's own case — the generic pass deliberately ignores it.
    shadow: { type: 'enum', options: ['none', 'sm', 'md', 'lg', 'glow'], default: 'md', group: 'Style' },
    surface: {
      type: 'enum',
      options: ['solid', 'glass', 'gradient'],
      // Glass is the default material (desktop output is Chromium, decided
      // 2026-09-28): over an aurora page it carries the colour through, over
      // a plain page it reads as a quiet, lit surface. Solid stays a choice.
      default: 'glass',
      group: 'Style',
    },
    glass: {
      type: 'boolean',
      default: false,
      group: 'Style',
    },
    // A container is only announced as a group when it is NAMED: `role=group`
    // with no accessible name is noise in a screen reader.
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
    // `stickyHeader` (from the scroll fragment) pins the title while the content
    // scrolls under it, exactly as `position: sticky` does in CSS: it needs a
    // title to pin and an `overflow` of auto or scroll to pin it against. Both
    // halves are the designer's to set, which is why neither is implied here.
  },
})

defineComponent({
  name: 'Stack',
  category: 'Containers',
  container: true,
  icon: '≡',
  description: 'Tight vertical/horizontal stack of children.',
  props: {
    ...spaceProps(),
    ...flowProps(),
    ...boxProps(),
    // `overflow` without the fragment's `stickyHeader`: a stack has no header
    // of its own, and a sticky setting with nothing to stick is a dead control.
    overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
    gap: { type: 'number', default: 8, min: 0, max: 64, group: 'Layout' },
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  },
})

defineComponent({
  name: 'Grid',
  category: 'Containers',
  container: true,
  icon: '⊞',
  description: 'Uniform grid of children.',
  props: {
    columns: { type: 'number', default: 2, min: 1, max: 24, step: 1, group: 'Layout' },
    ...spaceProps(),
    // NOT `...flowProps()`: a grid is laid out by tracks, not by flex
    // direction, so `direction` would be a control that cannot do anything.
    // These two are the grid's own alignment axes and are honoured as
    // `align-items` / `justify-content` in the Grid case.
    align: { type: 'enum', options: ['stretch', 'start', 'center', 'end'], default: 'stretch', group: 'Layout' },
    justify: {
      type: 'enum',
      options: ['start', 'center', 'end', 'between', 'around', 'evenly'],
      default: 'start',
      group: 'Layout',
    },
    ...boxProps(),
    overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  },
})

defineComponent({
  name: 'Button',
  category: 'Controls',
  icon: '⬢',
  description: 'Clickable button with an optional action binding.',
  props: {
    label: { type: 'string', default: 'Button', group: 'Content', bindable: true },
    // A named icon from the house set, or any literal glyph for a brand mark.
    icon: { type: 'string', default: '', group: 'Content' },
    iconPosition: { type: 'enum', options: ['start', 'end'], default: 'start', group: 'Content' },
    // The accessible name for a button whose label is an icon, or whose visible
    // text is abbreviated ("…"). Emitted as `aria-label` on the real element.
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
    ...pressProps(['primary', 'secondary', 'outline', 'ghost', 'danger'], 'primary'),
    // Busy: the button stops accepting presses and says so to assistive tech
    // (`aria-busy`) instead of silently doing nothing. The dimmed label is the
    // visible half; the state is the real half.
    loading: { type: 'boolean', default: false, group: 'State' },
    // The three real HTML button types. Inside a form, `submit` is the whole
    // difference between a button that works and a button that looks like it
    // does.
    type: { type: 'enum', options: ['button', 'submit', 'reset'], default: 'button', group: 'Behaviour' },
    // A stable hook name, emitted as `data-loom-action`, so an exported page
    // can dispatch one semantic event per intent without Loom owning the wiring.
    action: { type: 'string', default: '', group: 'Behaviour' },
    fullWidth: { type: 'boolean', default: false, group: 'Layout' },
    width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
    height: { type: 'number', default: -1, min: -1, max: 600, group: 'Layout' },
    // Not `...spaceProps()`: a button's padding is what its SIZE means. These
    // two default to unset so sm/md/lg keep their own padding, and setting
    // either overrides it in the Button case.
    paddingX: { type: 'number', default: -1, min: -1, max: 96, group: 'Layout' },
    paddingY: { type: 'number', default: -1, min: -1, max: 96, group: 'Layout' },
    ...textProps(),
    glow: { type: 'boolean', default: false, group: 'Style', requires: ['css-filter'] },
    radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
    background: { type: 'color', default: '', group: 'Style' },
    border: { type: 'color', default: '', group: 'Style' },
    borderWidth: { type: 'number', default: -1, min: -1, max: 8, group: 'Style' },
    shadow: { type: 'enum', options: ['none', 'sm', 'md', 'lg', 'glow'], default: 'none', group: 'Style' },
  },
})

defineComponent({
  name: 'Label',
  category: 'Text',
  icon: 'T',
  description: "A short piece of text attached to a control, or a caption beside one.",
  props: {
    text: { type: 'string', default: 'Text', group: 'Content', bindable: true },
    // The real type scale, and the raw escape hatch for when the scale is not
    // the size you need. Both are honoured; the scale is what a drop starts on.
    size: { type: 'enum', options: ['xs', 'sm', 'md', 'lg', 'xl'], default: 'md', group: 'Style' },
    weight: { type: 'enum', options: ['400', '500', '600', '700'], default: '500', group: 'Style' },
    // Unset: the theme's text colour. A literal near-white here made every
    // Label dropped on a daylight page all but invisible.
    color: { type: 'color', default: '', group: 'Style' },
    fontSize: { type: 'number', default: -1, min: -1, max: 96, group: 'Type' },
    uppercase: { type: 'boolean', default: false, group: 'Type' },
    align: { type: 'enum', options: ['left', 'center', 'right', 'justify'], default: 'left', group: 'Type' },
    // Width and max-width are how a caption is centred or kept to a measure.
    width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
    maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
    lineHeight: { type: 'number', default: -1, min: 0, max: 4, group: 'Type' },
    letterSpacing: { type: 'number', default: -1, min: -4, max: 12, group: 'Type' },
  },
})

defineComponent({
  name: 'Input',
  category: 'Controls',
  icon: '▭',
  description: "A single line of text. Wrap it in a Field when it needs a label or validation.",
  props: {
    placeholder: { type: 'string', default: 'Type here…', group: 'Content' },
    value: { type: 'string', default: '', group: 'State', bindable: true },
    ...controlProps(),
    // What the control IS to the browser: keyboard, autofill, and the mobile
    // keypad all key off this, which is why it is a property and not a guess.
    type: {
      type: 'enum',
      options: ['text', 'email', 'password', 'search', 'tel', 'url', 'number'],
      default: 'text',
      group: 'Behaviour',
    },
    // Form plumbing, so an exported document submits and a test can find the
    // field without depending on its position.
    name: { type: 'string', default: '', group: 'Behaviour' },
    maxLength: { type: 'number', default: -1, min: -1, max: 10000, group: 'Behaviour' },
    // Not `...spaceProps()`: the input's own padding IS its size, so these two
    // default to unset and the size scale keeps it.
    width: { type: 'number', default: 200, min: 40, max: 1200, group: 'Layout' },
    maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
    paddingX: { type: 'number', default: -1, min: -1, max: 96, group: 'Layout' },
    paddingY: { type: 'number', default: -1, min: -1, max: 96, group: 'Layout' },
    fontSize: { type: 'number', default: -1, min: -1, max: 96, group: 'Type' },
    color: { type: 'color', default: '', group: 'Type' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left', group: 'Type' },
    radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
    background: { type: 'color', default: '', group: 'Style' },
    border: { type: 'color', default: '', group: 'Style' },
    borderWidth: { type: 'number', default: -1, min: -1, max: 8, group: 'Style' },
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  },
})

// Field REPLACES FormField, which was removed rather than kept alongside.
//
// FormField drew its OWN text input, which made it a closed control: you could
// not put a Select, a Switch, a DatePicker or anything else inside a form
// field, so every non-text input in a real form had to be rebuilt from scratch
// outside it. Field is a CONTAINER — any control drops inside it — and owns the
// things a field actually owns: label, description, required marker, and
// validation state.
defineComponent({
  name: 'Field',
  category: 'Controls',
  container: true,
  icon: '⌸',
  description: 'Label + description + any control + validation state.',
  props: {
    label: { type: 'string', default: 'Label', group: 'Content' },
    description: { type: 'string', default: '', group: 'Content' },
    message: { type: 'string', default: '', group: 'State' },
    state: { type: 'enum', options: ['default', 'error', 'success', 'warning'], default: 'default', group: 'State' },
    required: { type: 'boolean', default: false, group: 'State' },
    layout: { type: 'enum', options: ['stacked', 'inline'], default: 'stacked', group: 'Layout' },
    labelWidth: { type: 'number', default: 180, min: 60, max: 480, group: 'Layout' },
    width: { type: 'number', default: 280, min: 80, max: 800, group: 'Layout' },
    ...spaceProps(),
    // The field's rhythm is part of its layout (`inline` is a row with a real
    // gap, `stacked` is tight), so `gap` starts unset and the layout keeps it.
    gap: { type: 'number', default: -1, min: -1, max: 64, group: 'Layout' },
    // The field's OWN type scale. Deliberately scoped: it sizes the label, the
    // description and the message, and NOT the control inside — a form where
    // the field and its input disagree about size is a form nobody can read.
    // The control keeps its own `size`.
    size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
    // Overrides the visible label as the field's accessible name, for the case
    // where the visible one is abbreviated or duplicated elsewhere on screen.
    ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  },
  parts: {
    label: { label: 'Label', hint: 'The field name', fields: ['text', 'box'] },
    description: { label: 'Help text', hint: 'The description under the label', fields: ['text', 'box'] },
    message: { label: 'Message', hint: 'The validation message', fields: ['text', 'box'] },
  },
})

defineComponent({
  name: 'Heading',
  category: 'Text',
  icon: 'H',
  description: "A section title on the real type scale. One H1 per view; the level sets the size.",
  props: {
    text: { type: 'string', default: 'Heading', group: 'Content', bindable: true },
    level: { type: 'enum', options: ['1', '2', '3'], default: '1', group: 'Style' },
    color: { type: 'color', default: '', group: 'Style' },
    align: { type: 'enum', options: ['left', 'center', 'right'], default: 'left', group: 'Style' },
    // The level sets the size; these are the overrides for the cases where it
    // should not — a display heading that has to fit a card, an eyebrow that
    // has to shout. All honoured in the Heading case, in preview and authoring.
    fontSize: { type: 'number', default: -1, min: -1, max: 96, group: 'Type' },
    lineHeight: { type: 'number', default: -1, min: 0, max: 4, group: 'Type' },
    letterSpacing: { type: 'number', default: -1, min: -4, max: 12, group: 'Type' },
    uppercase: { type: 'boolean', default: false, group: 'Type' },
    // One line, ellipsis at the end. The difference between a title that fits
    // its row and a title that wraps to three and pushes the layout apart.
    truncate: { type: 'boolean', default: false, group: 'Type' },
    width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
    maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  },
})

defineComponent({
  name: 'Gauge',
  category: 'Data',
  icon: '◔',
  description: 'Radial value gauge with a real scale and colour-by-value. Bound to a data source.',
  props: {
    value: { type: 'number', default: 0, min: 0, max: 100, step: 0.1, group: 'Data', bindable: true },
    min: { type: 'number', default: 0, group: 'Data' },
    max: { type: 'number', default: 100, group: 'Data' },
    unit: { type: 'string', default: '%', group: 'Data' },
    size: { type: 'number', default: 140, min: 48, max: 480, group: 'Layout' },
    warnAt: { type: 'number', default: 65, min: 0, max: 100, group: 'Data' },
    dangerAt: { type: 'number', default: 85, min: 0, max: 100, group: 'Data' },
    // The surface the dial sits on. A gauge is nearly always on a card, and
    // the card is the thing the designer is actually building — so these are
    // the shared box vocabulary, applied to the box around the dial.
    //
    // `width`/`height` are deliberately NOT in that vocabulary here: `size` is
    // the dial's diameter, and a second box size beside it is a contradiction
    // rather than an option. `padding` is out for the same reason it is out on
    // the Sparkline: the box is `size` square with `box-sizing: border-box`, so
    // padding would clip the dial instead of framing it.
    radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
    background: { type: 'color', default: '', group: 'Style' },
    border: { type: 'color', default: '', group: 'Style' },
    borderWidth: { type: 'number', default: -1, min: -1, max: 8, group: 'Style' },
    shadow: { type: 'enum', options: ['none', 'sm', 'md', 'lg', 'glow'], default: 'none', group: 'Style' },
    //
    // What is deliberately NOT here: `precision`, a `tone` override, a caption,
    // or an `ariaLabel`. The dial is drawn by a shared chart component that
    // owns the scale, the thresholds and the accessible name, and a property
    // this file declared but that component ignored would be a lie with a
    // number next to it.
  },
})

defineComponent({
  name: 'Sparkline',
  category: 'Data',
  icon: '∿',
  description: 'Trend line with an area fill and end-point marker.',
  props: {
    // The series, and the separator that splits it. The renderer reads BOTH:
    // a sparkline fed real data with a comma inside a reading was three
    // broken points and no way to say so.
    ...listProps('points', '12,30,22,48,41,66,58,80,74,92'),
    // The surface the trace sits on — the same shared box vocabulary the gauge
    // uses, and for the same reason: a chart on a card is the common case. A
    // `fill`, a `dots` toggle or a `baseline` would belong to the shared chart
    // component that draws the trace, not to a property here.
    ...boxProps(),
    // AFTER the fragment, never before: the chart's own box IS its width and
    // height, and the fragment's "unset" defaults must not win over them.
    width: { type: 'number', default: 220, min: 60, max: 1200, group: 'Layout' },
    height: { type: 'number', default: 60, min: 20, max: 400, group: 'Layout' },
    accent: { type: 'color', default: '', group: 'Style' },
    /**
     * Animate the trace.
     *
     * Real, and deliberately not a style: the draw-in is a keyframes rule in
     * the behaviour stylesheet, driven by an attribute the renderer emits, and
     * the exported document carries the same rule. The trace is normalised with
     * `pathLength=1` so the animation needs no measurement at run time.
     */
    animate: { type: 'boolean', default: true, group: 'Style' },
    /**
     * There WAS a `shader` here: a declared, web-only WebGL trace effect that
     * the renderer never read. It is gone rather than left as a switch that
     * does nothing — an unimplemented effect is an honest absence, and a dead
     * control in the panel is worse than a missing one. A document that still
     * carries `shader: true` loads with the key dropped and an
     * "undeclared prop" issue, which is the truth about it.
     */
  },
})

// Content states (loading, empty, failed) on every data-bearing tool: the
// same three properties and the same parts everywhere, added in one place so
// no tool can drift from the vocabulary (see render/content-state.tsx).
for (const [name, empty] of Object.entries(CONTENT_STATE_TOOLS)) {
  const spec = getComponent(name)
  if (!spec) throw new Error(`content states: no tool "${name}"`)
  // Filed into the panel's group order (State before Style...), never
  // tacked on after the last group.
  const merged = Object.entries({ ...spec.props, ...contentStateProps(empty) })
  const rank = (g: string | undefined) => {
    const i = (GROUP_ORDER as readonly string[]).indexOf(g ?? '')
    return i < 0 ? GROUP_ORDER.length : i
  }
  merged.sort((a, b) => rank(a[1].group) - rank(b[1].group))
  for (const k of Object.keys(spec.props)) delete spec.props[k]
  Object.assign(spec.props, Object.fromEntries(merged))
  spec.parts = { ...(spec.parts ?? {}), ...contentStateParts() }
}
