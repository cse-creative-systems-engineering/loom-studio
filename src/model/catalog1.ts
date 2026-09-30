/**
 * Extended catalog, part 1: containers + controls.
 * Schema-driven: every prop here appears in the inspector with no extra code.
 *
 * Every component is composed from the SHARED vocabulary in `prop-vocab` plus
 * its own specifics, and the order below matters: a fragment is spread FIRST and
 * the handful of properties it would otherwise overwrite are declared AFTER
 * it. A spread placed after an explicit property silently wins, which is how a
 * component ends up with a `padding` slider that does nothing.
 */
import { defineComponent, type PropSpec } from './registry'
import {
  boxProps,
  controlProps,
  flowProps,
  listProps,
  spaceProps,
  textProps,
  toneProps,
} from './prop-vocab'

type Props = Record<string, PropSpec>

/** The same shapes `prop-vocab` builds, written out so a component stays a
 * handful of lines instead of a wall of type annotations. */
const str = (v: string, group = 'Content', extra: Partial<PropSpec> = {}): PropSpec => ({ type: 'string', default: v, group, ...extra })
const num = (v: number, group: string, min: number, max: number, extra: Partial<PropSpec> = {}): PropSpec => ({ type: 'number', default: v, group, min, max, ...extra })
const bool = (v: boolean, group = 'State', extra: Partial<PropSpec> = {}): PropSpec => ({ type: 'boolean', default: v, group, ...extra })
const en = (options: string[], v: string, group = 'Style', extra: Partial<PropSpec> = {}): PropSpec => ({ type: 'enum', options, default: v, group, ...extra })

/** A fragment minus the keys this component has already decided for itself. */
function omit(src: Props, ...keys: string[]): Props {
  const out: Props = { ...src }
  for (const k of keys) delete out[k]
  return out
}

/**
 * `spaceProps()` with `padding` starting unset (-1).
 *
 * For a container that already draws its own padding from the theme: the panel
 * gains the control, and a fresh drop keeps the proportions it has always had.
 * `paddingX`/`paddingY`/`gap` keep their fragment defaults.
 */
const insetProps = (): Props => ({ ...spaceProps(), padding: num(-1, 'Layout', -1, 96) })

/**
 * `textProps()` without `align`. On a container, `align` means how its children
 * are aligned INSIDE it (that is `flowProps`), and one name cannot carry both
 * meanings — so a container gets the flow meaning and this drops the other.
 */
const typeProps = (): Props => omit(textProps(), 'align')

/**
 * `boxProps()` without `shadow`, for a component that already has its own
 * elevation word (Card's `elevation`). Two controls for one decision is worse
 * than one decision.
 */
const surfaceProps = (): Props => omit(boxProps(), 'shadow')

/**
 * The same surface for a component that draws one of its OWN edges — the bars'
 * hairline rule, expressed as `divider` — so there is no second, conflicting
 * border control sitting next to it.
 */
const barProps = (): Props => omit(surfaceProps(), 'border', 'borderWidth')

/**
 * `controlProps()` for a control whose look comes from its own STATE rather
 * than from a treatment: a checkbox, a radio. There is no `variant` on a tick,
 * and HTML has no `readOnly` for one either.
 */
const fieldProps = (): Props => omit(controlProps(), 'variant', 'readOnly')

/**
 * `controlProps()` for a control that is never a form field. `required` and
 * `readOnly` on an icon button are fictions, so they are simply not offered.
 */
const pressProps = (options?: string[], defaultVariant = 'default'): Props => omit(controlProps(options, defaultVariant), 'required', 'readOnly')

/** The accessible name any component can be given, whatever its role. */
const named = (): Props => ({ ariaLabel: str('', 'Accessibility') })

defineComponent({
  name: 'Card',
  category: 'Containers',
  container: true,
  icon: '▣',
  description: 'Elevated content card.',
  props: {
    title: str(''),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    // Re-declared AFTER the fragments: the fragment's `-1` would throw away
    // the padding and the corner radius a Card has always had.
    padding: num(16, 'Layout', 0, 64),
    radius: num(12, 'Style', 0, 32),
    elevation: en(['none', 'sm', 'md', 'lg'], 'md'),
    gap: num(12, 'Layout', 0, 64),
    ...named(),
  },
})

defineComponent({
  name: 'Tabs',
  category: 'Containers',
  container: true,
  // Tabs stack under their strip; free-positioned panels would sit on it.
  defaultFlow: true,
  icon: '◫',
  description: 'Tabbed container. Add tabs from its panel; each tab\'s title is its label in the strip.',
  // A tab set holds tabs, and the strip reads its labels FROM them: one source,
  // where a separate "tabs" list used to disagree with the panels it named.
  childTypes: ['TabPanel'],
  adds: [{ type: 'TabPanel', label: 'Add tab', props: { title: 'Tab {n}' } }],
  // Dropped with three tabs: without them the strip had nothing to draw and
  // the tab set landed as an empty box.
  seed: [
    { type: 'TabPanel', props: { title: 'Overview' } },
    { type: 'TabPanel', props: { title: 'Activity' } },
    { type: 'TabPanel', props: { title: 'Settings' } },
  ],
  props: {
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    // The strip's treatment, and whether the tabs share the panel's width or
    // sit at their natural size. `justify` aligns the strip.
    variant: en(['underline', 'pills', 'enclosed'], 'underline'),
    fullWidth: bool(false),
    active: num(0, 'State', 0, 20),
    gap: num(8, 'Layout', 0, 32),
  },
})

defineComponent({
  name: 'TabPanel',
  category: 'Containers',
  container: true,
  icon: '◧',
  description: 'Single tab page.',
  props: {
    title: str('Tab'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    padding: num(12, 'Layout', 0, 64),
    gap: num(8, 'Layout', 0, 64),
    ...named(),
  },
})

defineComponent({
  name: 'Accordion',
  category: 'Containers',
  container: true,
  defaultFlow: true,
  icon: '☰',
  description: 'Stack of collapsible sections. Add sections from its panel.',
  childTypes: ['AccordionItem'],
  adds: [{ type: 'AccordionItem', label: 'Add section', props: { title: 'Section {n}' } }],
  // Dropped with three sections, as an FAQ (the canonical accordion):
  // empty, it drew nothing at all.
  seed: [
    { type: 'AccordionItem', props: { title: 'What is included?' } },
    { type: 'AccordionItem', props: { title: 'How does billing work?' } },
    { type: 'AccordionItem', props: { title: 'Can I cancel at any time?' } },
  ],
  props: {
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    // How many sections start expanded. 0 leaves them all shut, which is what
    // an unanswered FAQ looks like; 1 is the "expand the first" accordion.
    open: num(0, 'State', 0, 20),
    gap: num(8, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'AccordionItem',
  category: 'Containers',
  container: true,
  icon: '≡',
  description: 'One collapsible section.',
  props: {
    title: str('Section'),
    // Only `gap` here: the summary and the body carry their own padding, and a
    // second padding control on the same box would double it.
    ...omit(spaceProps(), 'padding', 'paddingX', 'paddingY'),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    // The disclosure affordance. `caret` rotates as it opens, `plus` does not.
    icon: en(['caret', 'plus', 'none'], 'caret'),
    expanded: bool(false),
  },
})

defineComponent({
  name: 'Modal',
  category: 'Containers',
  container: true,
  icon: '◈',
  description: 'Dialog surface.',
  props: {
    title: str('Dialog'),
    ...listProps('actions', 'Cancel,Save'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    // `size` is a scale decision before `width` is a size one: `sm` is a
    // confirm, `lg` is a form.
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    width: num(480, 'Layout', 200, 1200),
    // A dialog that cannot be dismissed has no close button and no scrim, and
    // Escape does not take it away either.
    dismissible: bool(true, 'Behaviour'),
    open: bool(true),
    // Where the footer actions sit. Right is what a dialog does by default.
    justify: en(['start', 'center', 'end', 'between', 'around', 'evenly'], 'end', 'Layout'),
    ...named(),
  },
})

defineComponent({
  name: 'Drawer',
  category: 'Containers',
  container: true,
  icon: '▤',
  description: "Slides in over the content. Use it for a secondary panel that should not take the page.",
  props: {
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    side: en(['left', 'right'], 'right', 'Layout'),
    open: bool(true),
    width: num(320, 'Layout', 160, 800),
    ...named(),
  },
})

defineComponent({
  name: 'Section',
  category: 'Containers',
  container: true,
  icon: '§',
  description: 'A titled block of content inside a page.',
  props: {
    title: str('Section'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    padding: num(16, 'Layout', 0, 64),
    gap: num(10, 'Layout', 0, 48),
    ...named(),
  },
})

defineComponent({
  name: 'GroupBox',
  category: 'Containers',
  container: true,
  icon: '▢',
  description: 'A bordered group with a legend, for a related set of radio options.',
  props: {
    title: str('Group'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    padding: num(12, 'Layout', 0, 48),
    ...named(),
  },
})

defineComponent({
  name: 'ScrollView',
  category: 'Containers',
  container: true,
  icon: '↕',
  description: 'Scrollable region.',
  props: {
    ...insetProps(),
    // `direction` is this component's own scroll AXIS, so flowProps' copy of
    // it is dropped rather than fighting it.
    ...omit(flowProps(), 'direction'),
    ...surfaceProps(),
    // Whether a bar is drawn: pinned, only when needed, hidden (the content
    // still scrolls), or not at all.
    scrollbars: en(['auto', 'always', 'hidden', 'none'], 'auto', 'Layout'),
    stickyHeader: bool(false, 'Layout'),
    direction: en(['vertical', 'horizontal', 'both'], 'vertical', 'Layout'),
    height: num(300, 'Layout', 80, 1200),
    gap: num(8, 'Layout', 0, 64),
    ...named(),
  },
})

defineComponent({
  name: 'SplitH',
  category: 'Containers',
  container: true,
  icon: '◐',
  description: 'Two panes side by side with a draggable divider. Use it for list/detail.',
  props: {
    ...insetProps(),
    ...omit(flowProps(), 'direction'),
    ...surfaceProps(),
    // The first pane's share of the box, before anything has been dragged.
    ratio: num(50, 'Layout', 10, 90),
    // A drawn rule between the panes, or only the gap.
    divider: en(['none', 'line', 'strong'], 'none', 'Style'),
    gap: num(8, 'Layout', 0, 32),
  },
})

defineComponent({
  name: 'SplitV',
  category: 'Containers',
  container: true,
  icon: '◑',
  description: 'Two panes stacked with a draggable divider.',
  props: {
    ...insetProps(),
    ...omit(flowProps(), 'direction'),
    ...surfaceProps(),
    ratio: num(50, 'Layout', 10, 90),
    divider: en(['none', 'line', 'strong'], 'none', 'Style'),
    gap: num(8, 'Layout', 0, 32),
  },
})

defineComponent({
  name: 'Toolbar',
  category: 'Containers',
  container: true,
  icon: '⛭',
  description: "A strip of grouped actions above a surface. Use it for per-view actions, not navigation.",
  seed: [
    { type: 'IconButton', props: { icon: 'plus', variant: 'ghost' } },
    { type: 'IconButton', props: { icon: 'copy', variant: 'ghost' } },
    { type: 'IconButton', props: { icon: 'trash', variant: 'ghost' } },
    { type: 'IconButton', props: { icon: 'more', variant: 'ghost' } },
  ],
  props: {
    ...insetProps(),
    ...flowProps(),
    // A bar reads across: its tools in a row. The shared flow default (a
    // column) stacked them out of the bar.
    direction: en(['row', 'column'], 'row', 'Layout'),
    ...barProps(),
    ...typeProps(),
    // One scale for the whole strip: padding and type together, the way a size
    // is supposed to work.
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    gap: num(8, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'StatusBar',
  category: 'Containers',
  container: true,
  icon: '⎯',
  description: 'A strip at the bottom for persistent state — counts, mode, connection.',
  props: {
    text: str('Ready', 'Content', { bindable: true }),
    ...insetProps(),
    ...flowProps(),
    ...barProps(),
    ...typeProps(),
    // A status bar reports a condition, so it has a tone; `live` is what makes
    // a screen reader hear the change instead of reading the old value.
    ...toneProps(),
    live: bool(false, 'Accessibility'),
    divider: bool(true, 'Style'),
    gap: num(8, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'Hero',
  category: 'Containers',
  container: true,
  icon: '★',
  description: 'Hero banner block.',
  props: {
    title: str('Hero title'),
    subtitle: str('Subtitle'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    padding: num(32, 'Layout', 0, 128),
    gap: num(12, 'Layout', 0, 64),
    // A hero is centred unless the designer says otherwise.
    align: en(['stretch', 'start', 'center', 'end', 'baseline'], 'center', 'Layout'),
    ...named(),
  },
})

defineComponent({
  name: 'HeaderBar',
  category: 'Containers',
  container: true,
  icon: '⬒',
  description: 'App header bar.',
  props: {
    title: str('App'),
    ...insetProps(),
    ...flowProps(),
    ...barProps(),
    ...typeProps(),
    divider: bool(true, 'Style'),
    height: num(56, 'Layout', 32, 120),
    gap: num(12, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'FooterBar',
  category: 'Containers',
  container: true,
  icon: '⬓',
  description: 'App footer bar.',
  props: {
    text: str('Footer'),
    ...insetProps(),
    ...flowProps(),
    ...barProps(),
    ...typeProps(),
    divider: bool(true, 'Style'),
    height: num(48, 'Layout', 24, 120),
    ...named(),
  },
})

// AppShell is ADDITIVE. It does not replace HeaderBar or SidebarPanel — both are
// still useful alone (a top-only marketing nav, a sidebar in a drawer) — but
// composing them correctly, and collapsing the sidebar to an icon rail, is the
// single most-repeated chore in real app UI. That chore is what this removes.
//
// Slots are POSITIONAL and the order is the contract: first child is the
// sidebar, second is the top bar, the rest is content. Positional rather than
// type-sniffing on purpose: a shell that silently swallowed your SidebarPanel
// because of its type would be a trap, and a designer can see and reorder the
// assignment in Layers like any other structure.
// Icon is the PLACEABLE form of an icon. Every control's `icon` property also
// accepts a name from the same set, so this is the general case rather than a
// duplicate: a control's icon decorates that control, this stands alone (in a
// list row, a nav item, a stat card) at any size.
defineComponent({
  name: 'Icon',
  category: 'Text',
  icon: '◈',
  description: 'An icon from the house set, at any size.',
  props: {
    name: str('check'),
    size: num(20, 'Layout', 8, 96),
    label: str('', 'Accessibility'),
    // A named colour beats a tone here: an icon is a drawing, not a label, and
    // designers reach for exact values far more often than for signal words.
    color: { type: 'color', default: '', group: 'Style' },
    tone: en(['inherit', 'accent', 'muted', 'success', 'warning', 'danger'], 'inherit'),
  },
})

// The settings pattern, as two levels — the same shape as Tabs/TabPanel and
// Accordion/AccordionItem, because a section and a row are different things at
// different depths of the hierarchy and pretending otherwise is what makes a
// settings page take an afternoon instead of a minute.
//
// NOT a duplicate of `Field`, and the difference is deliberate: a Field is about
// VALIDATING an input (it owns error/success/warning and a message), while a
// SettingsRow is about ALIGNING a control in a list (right-aligned control,
// fixed label column, divider above, optionally destructive). They compose — a
// Field inside a SettingsRow is the common case for anything that validates.
defineComponent({
  name: 'SettingsSection',
  category: 'Containers',
  container: true,
  defaultFlow: true,
  icon: '⚙',
  description: 'Settings section: title, description, rows, optional save bar. Add rows from its panel.',
  adds: [{ type: 'SettingsRow', label: 'Add row', props: { label: 'Setting {n}' } }],
  seed: [
    // A row is a label AND its control: without one it is a floating caption.
    { type: 'SettingsRow', props: { label: 'Email notifications', description: 'A summary of activity, once a day.' }, seed: [{ type: 'Switch', props: { label: '', on: true } }] },
    { type: 'SettingsRow', props: { label: 'Two-factor authentication', description: 'Ask for a code when signing in.' }, seed: [{ type: 'Switch', props: { label: '' } }] },
    { type: 'SettingsRow', props: { label: 'Language' }, seed: [{ type: 'Select', props: { options: 'English,Deutsch,Français,Español', value: 'English' } }] },
  ],
  props: {
    title: str('Section'),
    description: str(''),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    // A settings page is a document, not a sidebar: a capped measure is the
    // difference between readable and a line of text that runs for a mile.
    maxWidth: num(-1, 'Type', -1, 2000),
    dividers: bool(true, 'Style'),
    danger: bool(false, 'Style'),
    saveBar: bool(false, 'Behaviour'),
    saveLabel: str('Save changes'),
    dirty: bool(false),
    gap: num(8, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'SettingsRow',
  category: 'Containers',
  container: true,
  icon: '☰',
  description: 'One settings row: label + description on the left, control on the right.',
  props: {
    label: str('Setting'),
    description: str(''),
    // `align` here is where the CONTROL sits, so flowProps' copy is dropped:
    // a settings row's job is that two-column alignment, not a third axis.
    ...omit(spaceProps(), 'padding'),
    ...omit(surfaceProps(), 'shadow'),
    ...typeProps(),
    labelWidth: num(220, 'Layout', 80, 480),
    align: en(['left', 'right'], 'right', 'Layout'),
    destructive: bool(false, 'Style'),
    // A locked setting is a real thing: the control is still there, greyed.
    disabled: bool(false),
    gap: num(16, 'Layout', 0, 48),
    paddingY: num(12, 'Layout', 0, 64),
    ...named(),
  },
})

// CommandPalette indexes the DOCUMENT it is placed in: every pressable control
// and link is a command, grouped by where it lives, searchable and keyboard
// driven. There is no `items` prop on purpose — a command list you maintain by
// hand is a second copy of the interface that goes stale immediately, and the
// whole point of a palette is that it already knows what the product can do.
defineComponent({
  name: 'CommandPalette',
  category: 'Navigation',
  icon: '⌘',
  description: "Cmd+K palette that indexes this design's own controls.",
  props: {
    placeholder: str('Search commands…'),
    emptyHint: str('No matching commands'),
    hotkey: str('mod+k', 'Behaviour'),
    trigger: bool(true, 'Behaviour'),
    // The panel is sized by the designer: a palette that is 560px wide on a
    // large screen is a palette nobody can read.
    width: num(560, 'Layout', 240, 1200),
    listHeight: num(320, 'Layout', 120, 900),
    // The ↑↓ / ↵ / esc key legend. Some palettes are better without it.
    footer: bool(true, 'Style'),
    label: str('Command palette', 'Accessibility'),
  },
})

defineComponent({
  name: 'AppShell',
  category: 'Containers',
  container: true,
  icon: '▥▬',
  description: 'App shell: sidebar + top bar + content. First child is the sidebar, second is the top bar.',
  props: {
    ...boxProps(),
    // The CONTENT region is the one place a shell needs an inset: padding the
    // shell itself would squeeze the sidebar and the top bar too, which is
    // never what "room to breathe" means.
    contentPadding: num(0, 'Layout', 0, 96),
    sidebarWidth: num(240, 'Layout', 120, 480),
    railWidth: num(64, 'Layout', 40, 120),
    topbarHeight: num(56, 'Layout', 32, 120),
    // Collapsing to an icon rail is the default; a shell that collapses to
    // nothing is the other real choice.
    railOnCollapse: bool(true, 'Behaviour'),
    collapsed: bool(false),
    ...named(),
  },
})

defineComponent({
  name: 'SidebarPanel',
  category: 'Containers',
  container: true,
  icon: '▥',
  description: 'Navigation sidebar.',
  props: {
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    ...typeProps(),
    width: num(240, 'Layout', 120, 480),
    collapsed: bool(false),
    gap: num(8, 'Layout', 0, 32),
    ...named(),
  },
})

defineComponent({
  name: 'FormGrid',
  category: 'Containers',
  container: true,
  icon: '⊞',
  description: "A two-column grid for form fields. Switch to one column on narrow screens.",
  props: {
    ...boxProps(),
    // A grid's two alignment axes, minus the flex-only ones.
    ...omit(flowProps(), 'direction', 'wrap'),
    columns: num(2, 'Layout', 1, 6),
    gap: num(12, 'Layout', 0, 48),
  },
})

defineComponent({
  name: 'BannerBox',
  category: 'Containers',
  container: true,
  icon: '📢',
  description: 'Announcement banner.',
  props: {
    text: str('Announcement', 'Content', { bindable: true }),
    icon: str('megaphone'),
    ...insetProps(),
    ...flowProps(),
    // A banner reads across: its icon BESIDE its message, centred on it. The
    // shared flow default (a column) stacked the icon above the text.
    direction: en(['row', 'column'], 'row', 'Layout'),
    align: en(['stretch', 'start', 'center', 'end', 'baseline'], 'center', 'Layout'),
    ...surfaceProps(),
    ...typeProps(),
    tone: en(['info', 'success', 'warning', 'danger'], 'info', 'State'),
    // A banner that appears unasked is a live region; without it a
    // screen-reader user is told nothing has happened at all.
    live: bool(false, 'Accessibility'),
    gap: num(8, 'Layout', 0, 32),
  },
})

defineComponent({
  name: 'IconButton',
  category: 'Controls',
  icon: '◉',
  description: 'Icon-only button.',
  props: {
    icon: str('star'),
    ...pressProps(['primary', 'secondary', 'ghost', 'danger'], 'secondary'),
    ...boxProps(),
    // The derived name ("trash") is right most of the time and wrong the rest;
    // an icon with no name at all is the case worth being able to fix by hand.
    ...named(),
  },
})

defineComponent({
  name: 'Checkbox',
  category: 'Controls',
  icon: '☑',
  description: 'Checkbox with label.',
  props: {
    label: str('Check me'),
    ...fieldProps(),
    // The accent the tick is drawn in. The native control themes its own
    // check mark, so this is a real colour control.
    tone: en(['inherit', 'accent', 'neutral', 'info', 'success', 'warning', 'danger'], 'inherit', 'State'),
    checked: bool(false, 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'RadioGroup',
  category: 'Controls',
  icon: '◎',
  description: 'Grouped radio options.',
  props: {
    // The legend. A set of radios with no name is a set of radios.
    label: str(''),
    ...omit(flowProps(), 'justify'),
    value: str('A', 'State', { bindable: true }),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    // These three lay their options out in a ROW, the way a control strip is
    // read; `wrap` is on by default so a long list does not run off the box.
    direction: en(['row', 'column'], 'row', 'Layout'),
    wrap: bool(true, 'Layout'),
    gap: num(8, 'Layout', 0, 32),
    disabled: bool(false),
    required: bool(false, 'State'),
    // Tints every option's control; `accent-color` inherits, so one value on
    // the group reaches each radio.
    tone: en(['inherit', 'accent', 'info', 'success', 'warning', 'danger'], 'inherit', 'State'),
    ...named(),
  },
  // Options are rows in the group's panel, not Radio tools dropped in: a
  // single radio on its own is never a choice.
  lists: {
    options: {
      label: 'Options',
      itemLabel: 'Option',
      titleField: 'label',
      max: 50,
      fields: {
        label: { type: 'string', default: 'Option', group: 'Content' },
        value: { type: 'string', default: '', group: 'Content' },
        disabled: { type: 'boolean', default: false, group: 'State' },
      },
      default: [
        { label: 'A', value: 'A', disabled: false },
        { label: 'B', value: 'B', disabled: false },
        { label: 'C', value: 'C', disabled: false },
      ],
    },
  },
  parts: {
    legend: { label: 'Label', hint: 'The group\'s label above the options', fields: ['text', 'box'] },
    option: { label: 'Options', hint: 'Every option', fields: ['text', 'box', 'layout'] },
  },
})

defineComponent({
  name: 'Switch',
  category: 'Controls',
  icon: '◐',
  description: "An on/off setting that takes effect immediately. Use it for preferences, not for form submits.",
  props: {
    label: str('Enable'),
    // `size` is the LABEL scale: the track's knob travel is fixed by the shared
    // behaviour stylesheet, so a bigger track would be a broken one.
    ...omit(fieldProps(), 'required'),
    on: bool(false, 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'Slider',
  category: 'Controls',
  icon: '—',
  description: "A value on a range, dragged. Pairs with a readout so the number is visible while dragging.",
  props: {
    value: num(50, 'Data', -1e9, 1e9, { bindable: true }),
    min: num(0, 'Data', -1e9, 1e9),
    max: num(100, 'Data', -1e9, 1e9),
    step: num(1, 'Data', 0.1, 10),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    tone: en(['inherit', 'accent', 'neutral', 'info', 'success', 'warning', 'danger'], 'inherit', 'State'),
    // The live number beside the thumb. Off for a slider that sits inside a
    // panel which already prints the value.
    showValue: bool(true, 'Content'),
    disabled: bool(false),
    ...boxProps(),
    ...named(),
  },
})

defineComponent({
  name: 'Select',
  category: 'Controls',
  icon: '▾',
  description: "One choice from a fixed list. Reach for ComboBox when the list is long or typed.",
  props: {
    ...listProps('options', 'One,Two,Three'),
    placeholder: str('Choose…'),
    // `readOnly` is dropped: HTML has none for a select, and offering a control
    // that cannot do anything is worse than not offering it.
    ...omit(controlProps(), 'readOnly'),
    ...boxProps(),
    multiple: bool(false, 'State'),
    value: str('One', 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'ComboBox',
  category: 'Controls',
  icon: '▿',
  description: 'Editable dropdown.',
  props: {
    ...listProps('options', 'One,Two,Three'),
    placeholder: str('Type or choose…'),
    ...controlProps(),
    ...boxProps(),
    value: str('', 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'TextArea',
  category: 'Controls',
  icon: '≡',
  description: "Multiple lines of text. Wrap it in a Field when it needs a label or validation.",
  props: {
    value: str('', 'State', { bindable: true }),
    placeholder: str('Type here…'),
    ...controlProps(),
    ...boxProps(),
    rows: num(4, 'Layout', 1, 20),
    width: num(280, 'Layout', 80, 1200),
    maxLength: num(-1, 'Data', -1, 100000),
    // A text area the user cannot drag taller is a text area with a fixed size;
    // one they can is a layout hazard. Both are legitimate choices.
    resize: en(['none', 'vertical', 'both'], 'vertical', 'Style'),
    ...named(),
  },
})

defineComponent({
  name: 'SearchBox',
  category: 'Controls',
  icon: '⌕',
  description: "A search field with a clear affordance. Pair it with a DataGrid to filter rows.",
  props: {
    value: str('', 'State', { bindable: true }),
    placeholder: str('Search…'),
    // The leading glyph. Empty draws no icon at all, which is a real choice for
    // a compact toolbar.
    icon: str('search'),
    ...omit(controlProps(), 'required'),
    ...boxProps(),
    width: num(220, 'Layout', 80, 800),
    ...named(),
  },
})

defineComponent({
  name: 'NumberInput',
  category: 'Controls',
  icon: '#',
  description: "A numeric field that rejects non-numbers and steps with the arrow keys.",
  props: {
    value: num(0, 'Data', -1e9, 1e9, { bindable: true }),
    min: num(0, 'Data', -1e9, 1e9),
    max: num(100, 'Data', -1e9, 1e9),
    step: num(1, 'Data', 0.1, 1000),
    ...controlProps(),
    ...boxProps(),
    ...named(),
  },
})

defineComponent({
  name: 'PasswordInput',
  category: 'Controls',
  icon: '●',
  description: "A masked field. Add a reveal toggle and a strength meter before shipping it.",
  props: {
    value: str('', 'State', { bindable: true }),
    placeholder: str('Password'),
    ...controlProps(),
    ...boxProps(),
    // Whether the field MASKS its content — a real design decision, and the
    // shipped input type, rather than a toggle button with nothing behind it.
    reveal: bool(false, 'State'),
    // A password field that guesses wrong is a real accessibility failure.
    autocomplete: en(['off', 'current-password', 'new-password'], 'current-password', 'Behaviour'),
    width: num(220, 'Layout', 80, 800),
    ...named(),
  },
})

defineComponent({
  name: 'DatePicker',
  category: 'Controls',
  icon: '📅',
  description: 'Date picker.',
  props: {
    value: str('', 'State', { bindable: true }),
    ...controlProps(),
    ...boxProps(),
    min: str('', 'Data'),
    max: str('', 'Data'),
    ...named(),
  },
})

defineComponent({
  name: 'TimePicker',
  category: 'Controls',
  icon: '◷',
  description: 'Time picker.',
  props: {
    value: str('', 'State', { bindable: true }),
    ...controlProps(),
    ...boxProps(),
    min: str('', 'Data'),
    max: str('', 'Data'),
    // 60s is minutes; 900 is quarter-hours. A time field on a 1-second step is
    // almost never what anyone means.
    step: num(60, 'Data', 1, 3600),
    ...named(),
  },
})

defineComponent({
  name: 'ColorInput',
  category: 'Controls',
  icon: '🎨',
  description: 'Color picker.',
  props: {
    value: { type: 'color', default: '#5b8cff', group: 'State', bindable: true },
    ...omit(controlProps(), 'readOnly'),
    ...boxProps(),
    // The hex beside the swatch. A colour well with no value is unreadable and
    // un-copyable.
    showValue: bool(true, 'Content'),
    ...named(),
  },
})

defineComponent({
  name: 'FileUpload',
  category: 'Controls',
  icon: '⤴',
  description: 'File upload dropzone.',
  props: {
    label: str('Drop files here'),
    // The constraint line, in the designer's words: "up to 10 MB, JPG or PNG".
    hint: str(''),
    accept: str('', 'Behaviour'),
    ...insetProps(),
    // A dashed edge says "drop here"; a solid one is a button that opens a
    // picker. Both are legitimate, so both are offered.
    variant: en(['outline', 'solid'], 'outline'),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    ...surfaceProps(),
    multiple: bool(false),
    disabled: bool(false),
    ...named(),
  },
})

defineComponent({
  name: 'ButtonGroup',
  category: 'Controls',
  container: true,
  icon: '⋯',
  description: 'Grouped buttons.',
  seed: [
    { type: 'Button', props: { label: 'Left', variant: 'secondary' } },
    { type: 'Button', props: { label: 'Center', variant: 'secondary' } },
    { type: 'Button', props: { label: 'Right', variant: 'secondary' } },
  ],
  props: {
    ...insetProps(),
    ...flowProps(),
    ...boxProps(),
    // Buttons in a row are the point of the component, and a strip that wraps
    // rather than overflowing is the other half of the point.
    direction: en(['row', 'column'], 'row', 'Layout'),
    wrap: bool(true, 'Layout'),
    gap: num(0, 'Layout', 0, 24),
    ...named(),
  },
})

defineComponent({
  name: 'DropdownButton',
  category: 'Controls',
  icon: '▾',
  description: 'Button with menu.',
  props: {
    ...listProps('items', 'Edit,Duplicate,Delete'),
    label: str('Actions'),
    ...pressProps(['primary', 'secondary', 'ghost', 'danger'], 'secondary'),
    ...boxProps(),
    // Which side the panel opens toward: a menu wider than its trigger has to
    // be told, or it hangs off the edge of the viewport.
    align: en(['start', 'end'], 'end', 'Layout'),
    ...named(),
  },
})

defineComponent({
  name: 'Rating',
  category: 'Controls',
  icon: '★★',
  description: "A score out of five. Clicking a star sets it.",
  props: {
    value: num(3, 'State', 0, 10, { bindable: true }),
    max: num(5, 'Data', 1, 10),
    // The star scale. `tone` recolours the filled stars; `inherit` is the
    // warning gold they have always been.
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    tone: en(['inherit', 'accent', 'neutral', 'success', 'warning', 'danger'], 'inherit', 'State'),
    showValue: bool(true, 'Content'),
    // A rating you can only READ is a different component: no pointer, no
    // stars that look pressable and then do nothing.
    readOnly: bool(false, 'State'),
    ...named(),
  },
})

defineComponent({
  name: 'ToggleButton',
  category: 'Controls',
  icon: '◍',
  description: 'Two-state button.',
  props: {
    label: str('Toggle'),
    icon: str(''),
    // `background` and `border` are deliberately NOT offered: they would
    // quietly win over the pressed state, which is the whole point of a
    // toggle. The ON state IS the variant.
    ...pressProps(['primary', 'secondary', 'ghost', 'danger'], 'secondary'),
    ...omit(boxProps(), 'background', 'border', 'borderWidth'),
    pressed: bool(false, 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'Segmented',
  category: 'Controls',
  icon: '◫',
  description: "Two to four mutually exclusive options shown as one control. Use it for a small, switching choice.",
  props: {
    ...listProps('options', 'Day,Week,Month'),
    ...boxProps(),
    // The options SHARE the control's width, which is the difference between a
    // segmented control and a row of buttons.
    fullWidth: bool(false, 'Layout'),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    // Tints the SELECTED option; `inherit` leaves it the neutral surface.
    tone: en(['inherit', 'accent', 'neutral', 'info', 'success', 'warning', 'danger'], 'inherit', 'State'),
    value: str('Week', 'State', { bindable: true }),
    ...named(),
  },
})

defineComponent({
  name: 'SpinBox',
  category: 'Controls',
  icon: '↕',
  description: 'Stepper input.',
  props: {
    value: num(1, 'Data', -1e9, 1e9, { bindable: true }),
    min: num(0, 'Data', -1e9, 1e9),
    max: num(99, 'Data', -1e9, 1e9),
    step: num(1, 'Data', 0.1, 1000),
    // A spinbox with no stepper is a number in a box; both are useful.
    showButtons: bool(true, 'Style'),
    ...omit(controlProps(), 'readOnly', 'required'),
    ...boxProps(),
    ...named(),
  },
})

defineComponent({
  name: 'Checklist',
  category: 'Controls',
  container: true,
  icon: '☰',
  description: 'List of checkboxes.',
  props: {
    ...listProps('items', 'One,Two,Three'),
    ...insetProps(),
    ...flowProps(),
    ...surfaceProps(),
    // A column of items is the default, and it is the only direction in which
    // `align` means anything else, so `align` is re-declared with the values
    // that make sense here.
    direction: en(['row', 'column'], 'column', 'Layout'),
    align: en(['stretch', 'start', 'center', 'end', 'baseline'], 'stretch', 'Layout'),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    wrap: bool(false, 'Layout'),
    gap: num(6, 'Layout', 0, 24),
    disabled: bool(false),
    ...named(),
  },
})

defineComponent({
  name: 'TagInput',
  category: 'Controls',
  icon: '🏷',
  description: 'Tag editor.',
  props: {
    // The tag list, with the separator that parses it: a tag containing a
    // comma is a real thing (a name, a date) and only the document knows.
    ...listProps('value', 'alpha, beta'),
    placeholder: str('Add tag…'),
    ...boxProps(),
    // A cap on what is SHOWN, not a truncation of the value: the rest still
    // round-trips in the document.
    maxTags: num(-1, 'Content', -1, 100),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    tone: en(['inherit', 'accent', 'neutral', 'info', 'success', 'warning', 'danger'], 'inherit', 'State'),
    disabled: bool(false),
    readOnly: bool(false),
    ...named(),
  },
})

defineComponent({
  name: 'OtpInput',
  category: 'Controls',
  icon: '🔢',
  description: 'One-time code input.',
  props: {
    value: str('', 'State', { bindable: true }),
    length: num(6, 'Layout', 3, 8),
    // The cells are the control, so the frame around them is transparent
    // unless a surface is asked for: only the box keys are offered.
    ...omit(boxProps(), 'width', 'height', 'shadow'),
    ...omit(spaceProps(), 'paddingX', 'paddingY'),
    size: en(['sm', 'md', 'lg'], 'md', 'Size'),
    mask: bool(false, 'State'),
    disabled: bool(false),
    ...named(),
  },
})
