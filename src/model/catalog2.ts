/**
 * Extended catalog, part 2: text + data + navigation + feedback.
 * Schema-driven: every prop here appears in the inspector with no extra code.
 * Together with toolbox.ts (10) + catalog1.ts (45) this reaches 111 total.
 *
 * THE RULE THIS FILE FOLLOWS, same as `toolbox.ts`: a property is declared only
 * when the renderer HONOURS it. Two mechanisms make that true:
 *
 *  1. The shared vocabulary in `./prop-vocab`. `applyCommonStyle` in
 *     `render/web.tsx` applies width, height, radius, background, border,
 *     borderWidth, shadow, padding, paddingX, paddingY, gap, direction, align,
 *     justify, wrap, fontSize, fontWeight, color, lineHeight, letterSpacing,
 *     maxWidth, disabled and overflow to ANY node that DECLARES them, with -1
 *     (or an empty string) meaning "not set" so the component keeps its own
 *     designed default. Flow alignment only applies to a box the component
 *     actually lays out with flex, which is why the fragments below are picked
 *     per component rather than sprayed everywhere.
 *  2. Whatever is genuinely a component's own — a chart's domain, a quote's
 *     accent bar, a nav item's active state — lives in that component's `case`
 *     in `render/web.tsx`, beside the drawing.
 *
 * A property that is declared but not honoured is worse than a missing one: the
 * designer sets it, the output does not move, and the tool loses their trust.
 * That is why a few obvious-looking options are absent, and commented where
 * they are absent (see Toast's `duration`, Skeleton's `animate`).
 *
 * Two fragments are NOT spread blindly, and the local helpers below say why:
 * `padding` with a zero default would erase a component's own inset, and
 * `textProps().align` / `flowProps().align` mean different things depending on
 * whether the box is a flex container or a text block.
 */
import { defineComponent, type PropSpec } from './registry'
import { boxProps, flowProps, listProps, spaceProps, textProps, thresholdProps } from './prop-vocab'

type Props = Record<string, PropSpec>

/**
 * The type fragment for a component that sets its OWN type scale.
 *
 * `align` and `maxWidth` are left out on purpose: a ring, an avatar and a chip
 * are not blocks of copy, so a measure and a text alignment are controls that
 * could not do anything. The scale itself stays, as the raw override.
 */
function scaleType(): Props {
  const t = textProps()
  return {
    fontSize: t.fontSize,
    fontWeight: t.fontWeight,
    color: t.color,
    lineHeight: t.lineHeight,
    letterSpacing: t.letterSpacing,
  }
}

/**
 * The surface fragment for a component whose box size IS another property.
 *
 * `width`/`height` are left out: for an Avatar, a ring or a chart, `size` is the
 * box, and a second box size beside it is a contradiction rather than an option.
 */
function surfaceProps(): Props {
  const b = boxProps()
  return {
    radius: b.radius,
    background: b.background,
    border: b.border,
    borderWidth: b.borderWidth,
    shadow: b.shadow,
  }
}

/** Inner spacing, with `padding` starting UNSET so a component keeps its own. */
function padProps(overrides: Partial<Props> = {}): Props {
  const s = spaceProps()
  return {
    padding: { type: 'number', default: -1, min: -1, max: 96, group: 'Layout' },
    paddingX: s.paddingX,
    paddingY: s.paddingY,
    ...overrides,
  }
}

/** Only the X/Y insets, for a component that sets its own padding outright. */
function insetProps(): Props {
  const s = spaceProps()
  return { paddingX: s.paddingX, paddingY: s.paddingY }
}

/**
 * Where a column stack's content sits.
 *
 * The two alignment axes are one control here, because for a stack they agree:
 * `start` is both a flex alignment and a text alignment, and `stretch` (the
 * default flex behaviour, and what these components already do) is a valid
 * alignment. The default is per component, because "centred" and "top aligned"
 * are the two designs a stack actually comes in.
 */
function stackAlign(defaultValue: 'stretch' | 'start' | 'center' | 'end'): Props {
  return {
    align: { type: 'enum', options: ['stretch', 'start', 'center', 'end'], default: defaultValue, group: 'Layout' },
  }
}

/** The two flow axes of a column stack, with no `direction` (it is a column). */
function stackFlow(): Props {
  const f = flowProps()
  return { justify: f.justify, wrap: f.wrap }
}

/* ---------------- Text (12) ---------------- */

defineComponent({ name: 'Paragraph', category: 'Text', icon: '¶', description: 'Body copy paragraph.', props: {
  text: { type: 'string', default: 'Lorem ipsum dolor sit amet.', group: 'Content', bindable: true },
  size: { type: 'enum', options: ['xs', 'sm', 'md', 'lg'], default: 'md', group: 'Type' },
  // The shared type fragment: the raw override on top of the scale, plus the
  // measure (`maxWidth`) and the four text alignments.
  ...textProps(),
  // Display caps, for a paragraph that is really a display line.
  uppercase: { type: 'boolean', default: false, group: 'Type' },
  // A first-line indent, because the alternative is four spaces in the text.
  indent: { type: 'number', default: 0, min: 0, max: 64, group: 'Type' },
  // Line clamp. -1 is "as many lines as it takes"; set to 2 for a teaser, 3 for
  // a card summary. This is the difference between a card that grows and one
  // that does not, and it cannot be done with `maxHeight` (which clips mid-line).
  clamp: { type: 'number', default: -1, min: -1, max: 20, group: 'Type' },
}})
defineComponent({ name: 'Caption', category: 'Text', icon: '©', description: 'Small muted caption.', props: {
  text: { type: 'string', default: 'Caption text', group: 'Content', bindable: true },
  size: { type: 'enum', options: ['xs', 'sm', 'md'], default: 'xs', group: 'Type' },
  ...textProps(),
  uppercase: { type: 'boolean', default: false, group: 'Type' },
  clamp: { type: 'number', default: -1, min: -1, max: 20, group: 'Type' },
}})
defineComponent({ name: 'Quote', category: 'Text', icon: '❝', description: "A quotation with its attribution. Use Quote for a person, CodeBlock for code.", props: {
  text: { type: 'string', default: 'Design is intelligence made visible.', group: 'Content', bindable: true },
  author: { type: 'string', default: '— Author', group: 'Content' },
  // Attribution on or off: a pull quote inside a testimonial already sits next
  // to the person, and a repeated name is noise.
  showAuthor: { type: 'boolean', default: true, group: 'Content' },
  accent: { type: 'color', default: '', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Type' },
  // Roman by default is the odd one out: quotes are italic by convention, and a
  // designer sometimes needs the other answer.
  italic: { type: 'boolean', default: true, group: 'Type' },
  ...textProps(),
  // NOT `...surfaceProps()`: a quote's `borderLeft` IS the accent rule, and the
  // generic `border` shorthand would erase it. The surface, though, is fair
  // game — a quote on a tinted card is a normal thing to want.
  radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
  background: { type: 'color', default: '', group: 'Style' },
  shadow: { type: 'enum', options: ['none', 'sm', 'md', 'lg', 'glow'], default: 'none', group: 'Style' },
  ...padProps(),
}})
defineComponent({ name: 'CodeBlock', category: 'Text', icon: '</>', description: 'Preformatted code block.', props: {
  code: { type: 'string', default: 'const x = 1', group: 'Content', bindable: true },
  language: { type: 'enum', options: ['ts', 'js', 'css', 'html', 'json'], default: 'ts', group: 'Content' },
  // Line numbers, and the number the first line carries: a 40-line excerpt
  // pulled out of a 900-line file is meaningless without them.
  showLineNumbers: { type: 'boolean', default: false, group: 'Content' },
  startLine: { type: 'number', default: 1, min: 0, max: 100000, group: 'Content' },
  // Tabs are real characters, and a block that honours neither the file's tabs
  // nor a fixed width is a block whose columns do not line up.
  tabSize: { type: 'number', default: 2, min: 1, max: 8, group: 'Content' },
  showLanguage: { type: 'boolean', default: false, group: 'Content' },
  // Wrapping soft lines vs scrolling them. A short snippet wants to wrap; an
  // excerpt you have to read sideways wants to scroll.
  wrapLines: { type: 'boolean', default: true, group: 'Content' },
  ...boxProps(),
  ...textProps(),
  ...padProps(),
  overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
  // NOT here: syntax highlighting. It needs a tokeniser, not a property, and a
  // property that painted nothing would be the worst kind of lie.
}})
defineComponent({ name: 'InlineCode', category: 'Text', icon: '`', description: 'Inline code snippet.', props: {
  code: { type: 'string', default: 'npm run verify', group: 'Content', bindable: true },
  accent: { type: 'color', default: '', group: 'Style' },
  ...scaleType(),
  ...boxProps(),
  ...padProps(),
}})
defineComponent({ name: 'Link', category: 'Text', icon: '🔗', description: "Navigation to somewhere else. For an action that changes state, use a Button.", props: {
  text: { type: 'string', default: 'Learn more', group: 'Content', bindable: true },
  href: { type: 'string', default: 'https://example.com', group: 'Logic' },
  underline: { type: 'boolean', default: true, group: 'Style' },
  // Where the browser sends it, and the relationship that follows from that:
  // a `_blank` link without `noopener` hands the opened page a reference to
  // this one, which is a real security decision, not a style.
  target: { type: 'enum', options: ['_self', '_blank', '_parent', '_top'], default: '_self', group: 'Behaviour' },
  rel: { type: 'string', default: '', group: 'Behaviour' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  icon: { type: 'string', default: '', group: 'Content' },
  iconPosition: { type: 'enum', options: ['start', 'end'], default: 'end', group: 'Content' },
  disabled: { type: 'boolean', default: false, group: 'State' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  ...textProps(),
}})
defineComponent({ name: 'BulletList', category: 'Text', icon: '•', description: 'Unordered list.', props: {
  ...listProps('items', 'First,Second,Third'),
  gap: { type: 'number', default: 6, min: 0, max: 32, group: 'Layout' },
  bullet: { type: 'enum', options: ['dot', 'dash', 'check', 'arrow'], default: 'dot', group: 'Style' },
  // The distance between the marker and the text, and the marker's own colour:
  // a list whose markers are the same grey as the text has no structure.
  markerGap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
  markerColor: { type: 'color', default: '', group: 'Style' },
  indent: { type: 'number', default: 24, min: 0, max: 96, group: 'Layout' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
  ...textProps(),
}})
defineComponent({ name: 'NumberedList', category: 'Text', icon: '1.', description: 'Ordered list.', props: {
  ...listProps('items', 'First,Second,Third'),
  gap: { type: 'number', default: 6, min: 0, max: 32, group: 'Layout' },
  start: { type: 'number', default: 1, min: 1, max: 99, group: 'Content' },
  // How the numbers are drawn. An ordered list of release notes and one of
  // setup steps want different markers, and both are one property.
  format: { type: 'enum', options: ['decimal', 'lower-alpha', 'upper-alpha', 'lower-roman', 'upper-roman'], default: 'decimal', group: 'Style' },
  reversed: { type: 'boolean', default: false, group: 'Content' },
  indent: { type: 'number', default: 24, min: 0, max: 96, group: 'Layout' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
  ...textProps(),
  // NOT `markerColor`, which a bullet list does have: a real `<ol>` draws its
  // markers in the `::marker` pseudo-element, which an inline style cannot
  // reach. The marker takes the list's colour instead, so `color` above is the
  // way to change it — one colour for the marker and the text, as the platform
  // intends.
}})
defineComponent({ name: 'Divider', category: 'Text', icon: '―', description: 'Horizontal rule.', props: {
  thickness: { type: 'number', default: 1, min: 1, max: 8, group: 'Style' },
  color: { type: 'color', default: '', group: 'Style' },
  style: { type: 'enum', options: ['solid', 'dashed', 'dotted'], default: 'solid', group: 'Style' },
  margin: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
  // A vertical rule is a real thing (between two panes of a settings screen),
  // and it cannot be a horizontal `<hr>` with a rotation.
  orientation: { type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal', group: 'Layout' },
  // The length of a VERTICAL rule. Unset means "as tall as the row it sits in".
  height: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
  // A divider with a word in the middle of it. Both rules then grow to fill,
  // which is the whole look.
  label: { type: 'string', default: '', group: 'Content' },
  labelAlign: { type: 'enum', options: ['start', 'center', 'end'], default: 'center', group: 'Layout' },
  // A bare rule is decoration and is hidden from assistive tech; naming it is
  // what makes it a real separator.
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'Badge', category: 'Text', icon: '⬣', description: "A small count or status marker. Keep it to a word or a number — a badge is not a label.", props: {
  text: { type: 'string', default: 'New', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'info', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md'], default: 'sm', group: 'Layout' },
  // The three treatments a chip is drawn in. `soft` is the tinted default;
  // `solid` is for a badge on a busy surface, `outline` for a quiet one.
  variant: { type: 'enum', options: ['soft', 'solid', 'outline'], default: 'soft', group: 'Style' },
  // A status dot instead of (or before) the word, for "live" and "new" marks.
  dot: { type: 'boolean', default: false, group: 'Style' },
  // A count that stops counting: 1,284 notifications becomes "99+", which is the
  // difference between a badge and a column of digits.
  max: { type: 'number', default: -1, min: -1, max: 1000000, group: 'Content' },
  uppercase: { type: 'boolean', default: false, group: 'Type' },
  ...scaleType(),
  ...padProps(),
}})
defineComponent({ name: 'Tag', category: 'Text', icon: '🏷', description: "A short chip for a category or a filter. Use Badge for counts, Tag for values.", props: {
  text: { type: 'string', default: 'beta', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'neutral', group: 'Style' },
  removable: { type: 'boolean', default: false, group: 'State' },
  size: { type: 'enum', options: ['sm', 'md'], default: 'sm', group: 'Size' },
  variant: { type: 'enum', options: ['soft', 'solid', 'outline'], default: 'soft', group: 'Style' },
  uppercase: { type: 'boolean', default: false, group: 'Type' },
  ...scaleType(),
  ...padProps(),
}})
defineComponent({ name: 'Kbd', category: 'Text', icon: '⌨', description: "The key combination for an action, shown as keys. Keep the real chord in sync with the app.", props: {
  // A chord, not a string: "Ctrl,K" draws two key caps with a gap between them,
  // which is how a shortcut reads in a menu. One item is one cap, so the
  // default is unchanged.
  ...listProps('keys', 'Ctrl+K'),
  ...boxProps(),
  ...scaleType(),
  ...padProps(),
}})

/* ---------------- Data (20) ---------------- */

// DataGrid REPLACES the old `Table`, which was removed rather than kept
// alongside: every Table capability is a DataGrid prop switched off, so two
// tools doing one job is exactly the toolbox bloat we do not ship. (The old
// Table was also subtly broken — its default rows were comma-separated while
// its renderer split on `|`, so it rendered one column per row.)
defineComponent({ name: 'DataGrid', category: 'Data', icon: '▦', description: 'Sortable, filterable data grid with selection and bulk actions.', props: {
  // The headers split on the SAME separator as the row data, and the default
  // data now matches its own default separator: the old default was
  // pipe-separated while the separator defaulted to a comma, so a dropped grid
  // rendered ONE column called "Name|Role|Amount|Status".
  columns: { type: 'string', default: 'Name,Role,Amount,Status', group: 'Content', bindable: true },
  rows: { type: 'string', default: 'Ada|Engineer|128,400|Active;Grace|Designer|96,100|Active;Alan|PM|74,900|Away;Edsger|Engineer|151,300|Active', group: 'Content', bindable: true },
  columnsSep: { type: 'delimiter', default: 'comma', group: 'Content' },
  selectable: { type: 'boolean', default: true, group: 'Behaviour' },
  sortable: { type: 'boolean', default: true, group: 'Behaviour' },
  search: { type: 'boolean', default: true, group: 'Behaviour' },
  rowActions: { type: 'boolean', default: true, group: 'Behaviour' },
  // Row hover, and the rules that go with a table: which header row exists,
  // and whether the frame is drawn at all.
  hoverable: { type: 'boolean', default: true, group: 'Behaviour' },
  showHeader: { type: 'boolean', default: true, group: 'Content' },
  borderless: { type: 'boolean', default: false, group: 'Style' },
  // The state a grid OPENS in. Sorting is re-done by the behaviour runtime on
  // click, so this is the authored initial order, not a second mechanism.
  sortColumn: { type: 'number', default: -1, min: -1, max: 64, group: 'State' },
  sortDirection: { type: 'enum', options: ['none', 'asc', 'desc'], default: 'none', group: 'State' },
  // What the filter field says, and what an empty result says. Both are copy,
  // and both are the ones a designer is asked to change first.
  searchPlaceholder: { type: 'string', default: 'Filter rows', group: 'Content' },
  emptyMessage: { type: 'string', default: 'No rows match this filter', group: 'Content' },
  striped: { type: 'boolean', default: true, group: 'Style' },
  freezeFirst: { type: 'boolean', default: false, group: 'Layout' },
  density: { type: 'enum', options: ['compact', 'normal', 'roomy'], default: 'normal', group: 'Layout' },
  height: { type: 'number', default: 0, group: 'Layout' },
  // A grid that scrolls keeps its header on screen. Off by default would be a
  // lie in the other direction, so it matches what the renderer draws.
  stickyHeader: { type: 'boolean', default: true, group: 'Layout' },
  bulkActions: { type: 'string', default: 'Archive,Export,Delete', group: 'Content' },
  bulkActionsSep: { type: 'delimiter', default: 'comma', group: 'Content' },
  rowSep: { type: 'delimiter', default: 'semicolon', group: 'Content' },
  cellSep: { type: 'delimiter', default: 'pipe', group: 'Content' },
  // The frame. NOT `...textProps()`: every cell sets its own size and colour,
  // so a `fontSize` here would be inherited and then overridden — a control
  // that appears to work and does not.
  ...boxProps(),
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}, parts: {
  header: { label: 'Header', hint: 'The column titles', fields: ['text', 'box'], lines: true },
  row: { label: 'Rows', hint: 'Each data row, behind its cells', fields: ['surface'] },
  cell: { label: 'Cells', hint: 'Every data cell', fields: ['text', 'box'], lines: true },
}})
defineComponent({ name: 'Stat', category: 'Data', icon: '📊', description: 'KPI stat with delta.', props: {
  label: { type: 'string', default: 'Revenue', group: 'Content' },
  value: { type: 'string', default: '$48.2k', group: 'Content', bindable: true },
  delta: { type: 'string', default: '+12.4%', group: 'Content' },
  trend: { type: 'enum', options: ['up', 'down', 'flat'], default: 'up', group: 'Data' },
  accent: { type: 'color', default: '', group: 'Style' },
  // Value formatting. A value that does not PARSE as a number is shown exactly
  // as typed — "$48.2k" is a designer's shorthand, not something to reformat.
  unit: { type: 'string', default: '', group: 'Content' },
  precision: { type: 'number', default: -1, min: -1, max: 6, group: 'Content' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
  showDelta: { type: 'boolean', default: true, group: 'Content' },
  // A metric is not always better when it goes up: churn down, errors down.
  goodDirection: { type: 'enum', options: ['up', 'down'], default: 'up', group: 'Data' },
  // How the comparison is marked: an arrow, a bar, a chip, or nothing but the
  // number. Four designs every product picks between.
  trendStyle: { type: 'enum', options: ['plain', 'arrow', 'bar', 'badge'], default: 'plain', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('start'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  // NOT `...textProps()`: the label, the value and the delta each set their own
  // size and colour, so the fragment's type controls would be inherited and
  // immediately overridden. `size` is the scale that does reach all three.
  // Their own type is reached through the parts below.
}, parts: {
  label: { label: 'Label', hint: 'The small caption above the number', fields: ['text', 'box'] },
  value: { label: 'Value', hint: 'The number itself', fields: ['text', 'box'] },
  delta: { label: 'Delta', hint: 'The comparison under the number', fields: ['text', 'box'] },
}})
defineComponent({ name: 'KpiCard', category: 'Data', icon: '◧', description: 'KPI card: one number, one comparison, one visual.', props: {
  label: { type: 'string', default: 'Monthly revenue', group: 'Content' },
  value: { type: 'string', default: '$48.2k', group: 'Content', bindable: true },
  delta: { type: 'string', default: '+12.4%', group: 'Content' },
  deltaLabel: { type: 'string', default: 'vs last month', group: 'Content' },
  trend: { type: 'enum', options: ['up', 'down', 'flat'], default: 'up', group: 'Data' },
  goodDirection: { type: 'enum', options: ['up', 'down'], default: 'up', group: 'Data' },
  visual: { type: 'enum', options: ['sparkline', 'bars', 'none'], default: 'sparkline', group: 'Data' },
  ...listProps('points', '12,30,22,48,41,66,58,74'),
  unit: { type: 'string', default: '', group: 'Content' },
  precision: { type: 'number', default: -1, min: -1, max: 6, group: 'Content' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
  showDelta: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...boxProps(),
  // AFTER the fragment, never before: the card's own width IS its design, and
  // the fragment's "unset" default must not win over it.
  width: { type: 'number', default: 220, min: 120, max: 520, group: 'Layout' },
  ...stackAlign('start'),
  ...padProps(),
  accent: { type: 'color', default: '', group: 'Style' },
}, parts: {
  label: { label: 'Label', hint: 'The small caption above the number', fields: ['text', 'box'] },
  value: { label: 'Value', hint: 'The number itself', fields: ['text', 'box'] },
  delta: { label: 'Delta', hint: 'The change, with its arrow', fields: ['text', 'box'] },
  caption: { label: 'Comparison', hint: 'What the change is measured against', fields: ['text', 'box'] },
}})
defineComponent({ name: 'ProgressBar', category: 'Data', icon: '▰', description: "Progress towards a known total. If the total is unknown, use LoadingBar.", props: {
  value: { type: 'number', default: 62, min: 0, max: 100, group: 'Data', bindable: true },
  max: { type: 'number', default: 100, min: 1, max: 1000, group: 'Data' },
  // The floor of the scale, so "62 of 100" and "8 of 10" both read right.
  min: { type: 'number', default: 0, min: -1e9, max: 1e9, group: 'Data' },
  height: { type: 'number', default: 8, min: 2, max: 24, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
  unit: { type: 'string', default: '%', group: 'Content' },
  // A bar that goes amber as it approaches the limit and red when it is over.
  // The thresholds are absolute values on the same scale as `value`.
  ...thresholdProps(),
  radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
  trackColor: { type: 'color', default: '', group: 'Style' },
  width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
  ...stackAlign('stretch'),
}})
defineComponent({ name: 'ProgressRing', category: 'Data', icon: '◍', description: 'Circular progress.', props: {
  value: { type: 'number', default: 72, min: 0, max: 100, group: 'Data', bindable: true },
  max: { type: 'number', default: 100, min: 1, max: 1000, group: 'Data' },
  min: { type: 'number', default: 0, min: -1e9, max: 1e9, group: 'Data' },
  size: { type: 'number', default: 72, min: 24, max: 240, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
  ...thresholdProps(),
  // The three things a ring is drawn from: how fat the arc is, whether the ends
  // are rounded, and whether the number is inside it at all.
  thickness: { type: 'number', default: 6, min: 1, max: 40, group: 'Style' },
  cap: { type: 'enum', options: ['round', 'butt'], default: 'round', group: 'Style' },
  showValue: { type: 'boolean', default: true, group: 'Content' },
  unit: { type: 'string', default: '', group: 'Content' },
  trackColor: { type: 'color', default: '', group: 'Style' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  // NOT `...boxProps()`: `size` IS the box, in both directions. A second width
  // beside it would be a contradiction, not an option.
}})
defineComponent({ name: 'Avatar', category: 'Data', icon: '👤', description: "A person, shown as an image or their initials.", props: {
  initials: { type: 'string', default: 'AK', group: 'Content' },
  size: { type: 'number', default: 40, min: 16, max: 160, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'neutral', 'success', 'warning'], default: 'accent', group: 'Style' },
  image: { type: 'string', default: '', group: 'Content' },
  // How the picture fills the circle, and the crop it takes — a face photo and
  // a logo want different answers to both.
  imageFit: { type: 'enum', options: ['cover', 'contain', 'fill'], default: 'cover', group: 'Style' },
  // What stands in when there is no image: initials, or a person glyph. (Not a
  // broken-image handler: a load failure cannot be caught in a static export,
  // so a fallback that only worked in the editor would be a lie.)
  fallback: { type: 'enum', options: ['initials', 'icon'], default: 'initials', group: 'Content' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  ...scaleType(),
  ...surfaceProps(),
}})
defineComponent({ name: 'AvatarGroup', category: 'Data', icon: '👥', description: 'Stacked avatars.', props: {
  ...listProps('names', 'Ada,Grace,Alan,+3'),
  size: { type: 'number', default: 32, min: 16, max: 96, group: 'Layout' },
  max: { type: 'number', default: 4, min: 1, max: 12, group: 'Layout' },
  // What happens past `max`: fold the rest into a "+3" chip, or show them all.
  overflow: { type: 'boolean', default: true, group: 'Content' },
  // `alternate` is the two-colour stack these have always been drawn as.
  tone: { type: 'enum', options: ['alternate', 'accent', 'neutral', 'success', 'warning'], default: 'alternate', group: 'Style' },
  // The ring that separates two stacked circles, and the colour it takes.
  ring: { type: 'number', default: 2, min: 0, max: 8, group: 'Style' },
  ringColor: { type: 'color', default: '', group: 'Style' },
  radius: { type: 'number', default: -1, min: -1, max: 999, group: 'Style' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'Image', category: 'Data', icon: '🖼', description: "A picture with alternative text. Always fill `alt` — it is the text a screen reader reads.", props: {
  src: { type: 'string', default: '', group: 'Content' },
  alt: { type: 'string', default: 'Image', group: 'Content' },
  radius: { type: 'number', default: 12, min: 0, max: 48, group: 'Style' },
  aspect: { type: 'enum', options: ['auto', '1:1', '16:9', '4:3'], default: '16:9', group: 'Layout' },
  // Fit is whether the picture fills the frame or fits inside it; the alignment
  // is which part of the picture survives when it has to crop.
  fit: { type: 'enum', options: ['cover', 'contain', 'fill'], default: 'cover', group: 'Style' },
  align: { type: 'enum', options: ['center', 'top', 'bottom'], default: 'center', group: 'Style' },
  loading: { type: 'enum', options: ['eager', 'lazy'], default: 'lazy', group: 'Behaviour' },
  ...surfaceProps(),
  width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
  // `align` here is the picture's crop, not text alignment — which is the same
  // idea (where the content sits in its box) applied to an image instead of a
  // paragraph, so the name is shared and the options are the ones that mean
  // something for a picture.
}})
defineComponent({ name: 'BarChart', category: 'Data', icon: '📶', description: 'Bar chart.', props: {
  ...listProps('values', '12,30,22,48,41,66,58'),
  // The category names under the bars, which are a different list from the
  // values: "Mon,Tue" is one list, "12,30" is another, and they are paired by
  // position rather than by a shared separator.
  ...listProps('labels', 'Mon,Tue,Wed,Thu,Fri,Sat,Sun'),
  // `showLabels` draws each bar's value; `showAxis` draws the category names.
  // Two questions, two switches.
  showLabels: { type: 'boolean', default: false, group: 'Content' },
  showAxis: { type: 'boolean', default: false, group: 'Content' },
  unit: { type: 'string', default: '', group: 'Content' },
  precision: { type: 'number', default: -1, min: -1, max: 6, group: 'Content' },
  // The domain. -1 fits the data, which is the honest default: a chart that
  // starts at an arbitrary number is a chart that lies about its bars.
  min: { type: 'number', default: -1, min: -1, max: 1e9, group: 'Data' },
  max: { type: 'number', default: -1, min: -1, max: 1e9, group: 'Data' },
  // Bars that cross a line change colour, so one bar can say "over quota"
  // without a second chart.
  ...thresholdProps(),
  colorBy: { type: 'enum', options: ['uniform', 'value'], default: 'uniform', group: 'Style' },
  showGrid: { type: 'boolean', default: false, group: 'Style' },
  barRadius: { type: 'number', default: 4, min: 0, max: 24, group: 'Style' },
  height: { type: 'number', default: 120, min: 40, max: 480, group: 'Layout' },
  width: { type: 'number', default: 280, min: 80, max: 1200, group: 'Layout' },
  gap: { type: 'number', default: 6, min: 0, max: 64, group: 'Layout' },
  accent: { type: 'color', default: '', group: 'Style' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  // NOT `animate`: nothing in the renderer can move these bars, and a toggle
  // that does not move them is worse than no toggle. (Sparkline's `animate` in
  // toolbox.ts carries the same note.)
}})
defineComponent({ name: 'PieChart', category: 'Data', icon: '◵', description: 'Pie chart.', props: {
  ...listProps('values', '40,30,20,10'),
  // Slice names, and the colours to draw them in. A palette is a LIST, so it
  // brings its own separator like every other list here.
  ...listProps('labels', 'Search,Social,Email,Direct'),
  ...listProps('palette', ''),
  size: { type: 'number', default: 140, min: 48, max: 480, group: 'Layout' },
  showLegend: { type: 'boolean', default: true, group: 'Content' },
  // What the legend says: a share, the raw number, the name, or name + share.
  legendFormat: { type: 'enum', options: ['percent', 'value', 'label', 'label-percent'], default: 'percent', group: 'Content' },
  unit: { type: 'string', default: '%', group: 'Content' },
  precision: { type: 'number', default: -1, min: -1, max: 6, group: 'Content' },
  // A ring instead of a disc: the hole is what makes a donut chart readable,
  // and how thick the ring is a design decision, not a coincidence.
  donut: { type: 'boolean', default: false, group: 'Style' },
  thickness: { type: 'number', default: 24, min: 4, max: 120, group: 'Style' },
  // Where the first slice starts, in degrees clockwise from twelve o'clock.
  startAngle: { type: 'number', default: 0, min: -360, max: 360, group: 'Style' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'LineChart', category: 'Data', icon: '📈', description: 'Line chart with axes.', props: {
  ...listProps('points', '12,30,22,48,41,66,58,80'),
  min: { type: 'number', default: -1, min: -1, max: 1e9, group: 'Data' },
  max: { type: 'number', default: -1, min: -1, max: 1e9, group: 'Data' },
  showGrid: { type: 'boolean', default: true, group: 'Style' },
  showPoints: { type: 'boolean', default: true, group: 'Style' },
  // The filled area under the trace: it reads as "volume" where a bare line
  // reads as "value", and one is not a substitute for the other.
  showArea: { type: 'boolean', default: false, group: 'Style' },
  strokeWidth: { type: 'number', default: 2, min: 1, max: 12, group: 'Style' },
  curve: { type: 'enum', options: ['linear', 'smooth'], default: 'linear', group: 'Style' },
  // A horizontal reference line at a value — a target, a quota, last week.
  referenceAt: { type: 'number', default: -1, min: -1, max: 1e9, group: 'Data' },
  unit: { type: 'string', default: '', group: 'Content' },
  precision: { type: 'number', default: -1, min: -1, max: 6, group: 'Content' },
  width: { type: 'number', default: 280, min: 80, max: 1200, group: 'Layout' },
  height: { type: 'number', default: 140, min: 40, max: 480, group: 'Layout' },
  accent: { type: 'color', default: '', group: 'Style' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
// Events are DATA, edited as rows in the Timeline's own panel. They used to
// be TimelineItem nodes: a separate tool that meant nothing on its own and
// landed wherever the pointer was when dropped. Old files fold them in.
defineComponent({ name: 'Timeline', category: 'Data', icon: '🕒', description: 'Vertical event timeline. Add and order its events in the panel.', props: {
  gap: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
  // The rail the markers sit on, and how far the markers are inset from it.
  rail: { type: 'boolean', default: false, group: 'Style' },
  indent: { type: 'number', default: 16, min: 0, max: 96, group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  markerSize: { type: 'number', default: 10, min: 4, max: 32, group: 'Layout' },
  overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
  ...stackFlow(),
  // NOT `...padProps()`: the timeline's own left inset IS the rail's position,
  // and a `padding` shorthand would land on top of it.
}, lists: {
  events: {
    label: 'Events',
    itemLabel: 'Event',
    titleField: 'title',
    max: 200,
    fields: {
      title: { type: 'string', default: 'Deployed v2.4', group: 'Content', bindable: true },
      time: { type: 'string', default: '2h ago', group: 'Content' },
      description: { type: 'string', default: '', group: 'Content' },
      tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger', 'neutral'], default: 'accent', group: 'Style' },
      // A ring is the "this one is still running" mark; a dot alone cannot say that.
      markerStyle: { type: 'enum', options: ['dot', 'ring', 'square'], default: 'dot', group: 'Style' },
    },
    default: [
      { title: 'Deployed v2.4', time: '2h ago', description: 'Billing page and faster search', tone: 'success', markerStyle: 'dot' },
      { title: 'Review requested', time: 'Yesterday', description: '', tone: 'accent', markerStyle: 'ring' },
      { title: 'Incident resolved', time: 'Mon', description: '', tone: 'neutral', markerStyle: 'dot' },
    ],
  },
}, parts: {
  event: { label: 'Event', hint: 'Each event as a whole', fields: ['text', 'box', 'layout'] },
  head: { label: 'Head', hint: 'The marker and title line', fields: ['layout'] },
  marker: { label: 'Marker', hint: 'The dot, ring or square; its background overrides the tone', fields: ['box'] },
  title: { label: 'Title', hint: 'What happened', fields: ['text', 'box'] },
  time: { label: 'Time', hint: 'When it happened', fields: ['text', 'box'] },
  description: { label: 'Detail', hint: 'The line under the title', fields: ['text', 'box'] },
}})
defineComponent({ name: 'TreeList', category: 'Data', icon: '🌲', description: 'Indented tree list.', props: {
  ...listProps('items', 'src,src/app.tsx,src/model,docs,package.json'),
  gap: { type: 'number', default: 4, min: 0, max: 24, group: 'Layout' },
  // Indent per level, how many levels start open, and the guide lines that make
  // depth readable without counting spaces.
  indent: { type: 'number', default: 16, min: 0, max: 64, group: 'Layout' },
  expandDepth: { type: 'number', default: 1, min: 0, max: 12, group: 'State' },
  guides: { type: 'boolean', default: false, group: 'Style' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
  // Rows inherit every one of these from the container — none of them set their
  // own — so this fragment is honoured rather than decorative.
  ...scaleType(),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
}})
defineComponent({ name: 'DataList', category: 'Data', icon: '☰', description: 'Divided data list.', props: {
  ...listProps('items', 'Alpha:120,Beta:340,Gamma:210'),
  // The separator BETWEEN a label and its value, which is a second level of
  // parsing: "12:30" is a time, and a list that splits it on a colon has lost
  // the value it was given. A plain character rather than a named delimiter,
  // because the shared delimiter vocabulary has no colon and the default data
  // below is colon-separated.
  pairSep: { type: 'string', default: ':', group: 'Content' },
  gap: { type: 'number', default: 0, min: 0, max: 24, group: 'Layout' },
  divided: { type: 'boolean', default: true, group: 'Style' },
  // `row` pairs a label with its value on one line; `column` stacks them,
  // which is the only thing that works in a narrow column.
  layout: { type: 'enum', options: ['row', 'column'], default: 'row', group: 'Layout' },
  density: { type: 'enum', options: ['compact', 'normal', 'roomy'], default: 'normal', group: 'Layout' },
  // How the label and the value share the row. `between` (the default) is the
  // definition list everybody draws; the row reads it, not the container.
  align: { type: 'enum', options: ['start', 'center', 'end', 'between'], default: 'between', group: 'Layout' },
  labelWidth: { type: 'number', default: 0, min: 0, max: 480, group: 'Layout' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
}})
defineComponent({ name: 'KeyValue', category: 'Data', icon: '⚖', description: 'Label/value pair.', props: {
  label: { type: 'string', default: 'Status', group: 'Content' },
  value: { type: 'string', default: 'Operational', group: 'Content', bindable: true },
  layout: { type: 'enum', options: ['row', 'column'], default: 'row', group: 'Layout' },
  // Where the pair sits on the line. The row reads this as its distribution, so
  // `between` pushes the value to the far edge of the row.
  align: { type: 'enum', options: ['start', 'center', 'end', 'between'], default: 'start', group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // The eyebrow treatment on the label. On by default because that is how a
  // definition list reads; off for a sentence-case label.
  uppercase: { type: 'boolean', default: true, group: 'Type' },
  gap: { type: 'number', default: 8, min: 0, max: 48, group: 'Layout' },
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
}})
defineComponent({ name: 'Calendar', category: 'Data', icon: '📅', description: "A month grid for picking a date. For a single date entry, use DatePicker.", props: {
  month: { type: 'string', default: 'September 2026', group: 'Content' },
  selected: { type: 'string', default: '26', group: 'State' },
  // A second marker, for "today" in a month that is not the selected one.
  today: { type: 'string', default: '', group: 'State' },
  accent: { type: 'color', default: '', group: 'Style' },
  // Which day the week starts on, how many days the month has, and how many
  // blank cells sit before the 1st. Without the last two a month grid is a
  // grid of the wrong number of days in the wrong places.
  weekStart: { type: 'enum', options: ['mon', 'sun'], default: 'mon', group: 'Content' },
  days: { type: 'number', default: 30, min: 28, max: 31, group: 'Content' },
  offset: { type: 'number', default: 0, min: 0, max: 6, group: 'Content' },
  showNav: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
}})
defineComponent({ name: 'KanbanColumn', category: 'Data', container: true, icon: '🗂', description: 'Kanban swimlane.', props: {
  title: { type: 'string', default: 'In progress', group: 'Content' },
  count: { type: 'number', default: 3, min: 0, max: 99, group: 'Content' },
  tone: { type: 'enum', options: ['neutral', 'accent', 'success', 'warning'], default: 'accent', group: 'Style' },
  showCount: { type: 'boolean', default: true, group: 'Content' },
  // A swimlane whose cards are its whole point needs its header; a collapsed
  // one is a drop target, and that is a different thing to want.
  showHeader: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // The floor a lane keeps so an empty column still reads as a column.
  minHeight: { type: 'number', default: 120, min: 0, max: 2000, group: 'Layout' },
  width: { type: 'number', default: -1, min: -1, max: 800, group: 'Layout' },
  gap: { type: 'number', default: 8, min: 0, max: 48, group: 'Layout' },
  overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
  ...stackFlow(),
  ...padProps(),
  ...surfaceProps(),
}})
defineComponent({ name: 'EmptyState', category: 'Data', icon: '○', description: "What to show when there is nothing yet. Say what to do next, not just that it is empty.", props: {
  title: { type: 'string', default: 'No results', group: 'Content' },
  hint: { type: 'string', default: 'Try a different filter.', group: 'Content' },
  actionLabel: { type: 'string', default: 'Clear filters', group: 'Content' },
  actionVariant: { type: 'enum', options: ['default', 'primary', 'ghost', 'danger'], default: 'default', group: 'Style' },
  // A named icon from the house set, or any glyph for a brand mark.
  icon: { type: 'string', default: 'search', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('center'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'Skeleton', category: 'Data', icon: '▒', description: "The shape of content that is still arriving. Prefer it to a spinner for page loads.", rendersText: false, props: {
  lines: { type: 'number', default: 3, min: 1, max: 12, group: 'Layout' },
  height: { type: 'number', default: 14, min: 8, max: 48, group: 'Layout' },
  // The three shapes a placeholder is drawn in: a paragraph of lines, one
  // block (a card that has not arrived), and a circle (an avatar).
  variant: { type: 'enum', options: ['lines', 'block', 'circle'], default: 'lines', group: 'Style' },
  // The placeholder fill, and the shape it takes.
  color: { type: 'color', default: '', group: 'Style' },
  radius: { type: 'number', default: -1, min: -1, max: 999, group: 'Style' },
  width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
  gap: { type: 'number', default: 8, min: 0, max: 48, group: 'Layout' },
  // HONEST LIMIT, same as Sparkline's `animate`: this reads as "settled
  // placeholders" versus "pulsing ones", but a real shimmer needs a keyframes
  // rule in the behaviour stylesheet, which is not this file's to change. It
  // stays because a saved document may already carry it, and dropping a
  // property is worse than one that does less than its name suggests.
  animate: { type: 'boolean', default: true, group: 'Style' },
}})
defineComponent({ name: 'DataCard', category: 'Data', container: true, icon: '▣', description: 'Metric card container.', props: {
  title: { type: 'string', default: 'Metric', group: 'Content' },
  value: { type: 'string', default: '1,284', group: 'Content', bindable: true },
  hint: { type: 'string', default: '+4.2% vs last week', group: 'Content' },
  // Where the value breaks into pieces, so a figure can read as
  // "1,284 orders" rather than as one run-on number. The default is a PIPE,
  // not a comma: a comma here would split every thousands-grouped figure in
  // half, which is how this property used to be a no-op with a comma default.
  valueSep: { type: 'delimiter', default: 'pipe', group: 'Content' },
  showTitle: { type: 'boolean', default: true, group: 'Content' },
  showHint: { type: 'boolean', default: true, group: 'Content' },
  // The hint's tone. `success` is the default because a metric card's hint is
  // usually a movement — but "92% of quota" is a warning wearing a green shirt,
  // and this is the property that fixes that.
  hintTone: { type: 'enum', options: ['neutral', 'success', 'warning', 'danger'], default: 'success', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('stretch'),
  gap: { type: 'number', default: 8, min: 0, max: 48, group: 'Layout' },
  ...padProps(),
  ...surfaceProps(),
}})

/* ---------------- Navigation (12) ---------------- */

defineComponent({ name: 'NavBar', category: 'Navigation', container: true, icon: '🧭', description: 'Top navigation bar. Its links are rows in its panel; drop buttons in for actions.', props: {
  title: { type: 'string', default: 'Acme', group: 'Content' },
  showTitle: { type: 'boolean', default: true, group: 'Content' },
  height: { type: 'number', default: 56, min: 32, max: 120, group: 'Layout' },
  // Three bars: a surface, a surface with a shadow, and no bar at all for a
  // bar that sits on a page background.
  variant: { type: 'enum', options: ['solid', 'elevated', 'transparent'], default: 'solid', group: 'Style' },
  gap: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
  // A nav row is the one place `justify` earns its keep: `end` for actions on
  // the right, `between` for a brand on the left and a menu in the middle.
  ...flowProps(),
  // A nav BAR is a row. The shared flow fragment defaults to a column, which
  // stacked the title over the links and spilled them out of the bar.
  direction: { type: 'enum', options: ['row', 'column'], default: 'row', group: 'Layout' },
  // AFTER the fragment: a bar centres its contents vertically, which is not the
  // flow fragment's neutral `stretch` default.
  align: { type: 'enum', options: ['stretch', 'start', 'center', 'end', 'baseline'], default: 'center', group: 'Layout' },
  ...padProps(),
  ...surfaceProps(),
  // A `<nav>` with no accessible name is two landmarks with one name, which is
  // worse than one.
  ariaLabel: { type: 'string', default: 'Main', group: 'Accessibility' },
  // How every link is drawn; which link is where is the list below.
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  iconPosition: { type: 'enum', options: ['start', 'end'], default: 'start', group: 'Content' },
  underline: { type: 'boolean', default: false, group: 'Style' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
}, lists: {
  links: {
    label: 'Links',
    itemLabel: 'Link',
    titleField: 'label',
    max: 40,
    fields: {
      label: { type: 'string', default: 'Link', group: 'Content', bindable: true },
      href: { type: 'string', default: '#', group: 'Logic' },
      icon: { type: 'string', default: '', group: 'Content' },
      active: { type: 'boolean', default: false, group: 'State' },
      disabled: { type: 'boolean', default: false, group: 'State' },
    },
    default: [
      { label: 'Overview', href: '#', icon: 'home', active: true, disabled: false },
      { label: 'Projects', href: '#', icon: '', active: false, disabled: false },
      { label: 'Team', href: '#', icon: '', active: false, disabled: false },
    ],
  },
}, parts: {
  title: { label: 'Title', hint: 'The product name at the start', fields: ['text', 'box'] },
  link: { label: 'Links', hint: 'Every link', fields: ['text', 'box', 'layout'] },
  active: { label: 'Current', hint: 'The link for the page you are on', fields: ['text', 'box'] },
}})

defineComponent({ name: 'SideNav', category: 'Navigation', container: true, icon: '▥', description: 'Vertical side navigation. Its links are rows in its panel.', props: {
  width: { type: 'number', default: 220, min: 120, max: 480, group: 'Layout' },
  // Collapsed is a RAIL: the authored width is swapped for the rail width and
  // the labels are clipped away, so collapsing is a real collapse rather than a
  // squeeze. It is not a way to un-collapse at runtime — the runtime owns that
  // for an AppShell's sidebar.
  collapsed: { type: 'boolean', default: false, group: 'State' },
  railWidth: { type: 'number', default: 64, min: 40, max: 160, group: 'Layout' },
  gap: { type: 'number', default: 4, min: 0, max: 32, group: 'Layout' },
  ...stackAlign('stretch'),
  ...padProps(),
  ...surfaceProps(),
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  // How every link is drawn; which link is where is the list below.
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  iconPosition: { type: 'enum', options: ['start', 'end'], default: 'start', group: 'Content' },
  underline: { type: 'boolean', default: false, group: 'Style' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
}, lists: {
  links: {
    label: 'Links',
    itemLabel: 'Link',
    titleField: 'label',
    max: 60,
    fields: {
      label: { type: 'string', default: 'Link', group: 'Content', bindable: true },
      href: { type: 'string', default: '#', group: 'Logic' },
      icon: { type: 'string', default: '', group: 'Content' },
      active: { type: 'boolean', default: false, group: 'State' },
      disabled: { type: 'boolean', default: false, group: 'State' },
    },
    default: [
      { label: 'Home', href: '#', icon: 'home', active: true, disabled: false },
      { label: 'Projects', href: '#', icon: 'folder', active: false, disabled: false },
      { label: 'Team', href: '#', icon: 'users', active: false, disabled: false },
      { label: 'Settings', href: '#', icon: 'settings', active: false, disabled: false },
    ],
  },
}, parts: {
  link: { label: 'Links', hint: 'Every link', fields: ['text', 'box', 'layout'] },
  active: { label: 'Current', hint: 'The link for the page you are on', fields: ['text', 'box'] },
}})

defineComponent({ name: 'Breadcrumbs', category: 'Navigation', icon: '›', description: "The path to where you are. Show it past the second level.", props: {
  ...listProps('trail', 'Home,Projects,Loom'),
  separator: { type: 'string', default: '/', group: 'Content' },
  // Past a certain depth, keep the first crumb and the last few and elide the
  // middle — the alternative is a trail that wraps onto three lines.
  maxItems: { type: 'number', default: 0, min: 0, max: 20, group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  truncate: { type: 'boolean', default: false, group: 'Type' },
  ...flowProps(),
  // AFTER the fragment: crumbs sit on one line, centred against each other.
  align: { type: 'enum', options: ['stretch', 'start', 'center', 'end', 'baseline'], default: 'center', group: 'Layout' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'Pagination', category: 'Navigation', icon: '⇄', description: 'Page pager.', props: {
  page: { type: 'number', default: 1, min: 1, max: 999, group: 'State' },
  // `total` is the LAST PAGE NUMBER. `itemCount` and `pageSize` are the honest
  // alternative when the designer knows how many rows there are: a pager built
  // on a total the designer guessed is a pager with the wrong number of pages.
  total: { type: 'number', default: 12, min: 1, max: 999, group: 'Data' },
  itemCount: { type: 'number', default: 0, min: 0, max: 1e9, group: 'Data' },
  pageSize: { type: 'number', default: 10, min: 1, max: 999, group: 'Data' },
  // How many page numbers sit either side of the current one.
  siblings: { type: 'number', default: 1, min: 0, max: 6, group: 'Layout' },
  // The ‹ and › buttons. Off for a pager that is just a row of numbers.
  showEdges: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md'], default: 'md', group: 'Size' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'Stepper', category: 'Navigation', icon: '👣', description: "Progress through an ordered sequence of steps.", props: {
  ...listProps('steps', 'Details,Build,Review,Ship'),
  current: { type: 'number', default: 1, min: 0, max: 20, group: 'State' },
  // A stepper runs down the page as often as across it, and the connector has
  // to turn with it.
  orientation: { type: 'enum', options: ['horizontal', 'vertical'], default: 'horizontal', group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // Show the number on the current and upcoming steps, and show a check on the
  // ones already done.
  showNumbers: { type: 'boolean', default: true, group: 'Content' },
  // The built-in behaviour role. Off means the steps are a readout, not a
  // control, and the runtime's click-to-advance is not wired to them.
  interactive: { type: 'boolean', default: true, group: 'Behaviour' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'Menu', category: 'Navigation', container: true, icon: '☰', description: "A list of commands, edited as rows in its panel. A DropdownButton is the usual trigger.", props: {
  gap: { type: 'number', default: 2, min: 0, max: 24, group: 'Layout' },
  // A menu's own width, which is how a context menu becomes a narrow one.
  width: { type: 'number', default: -1, min: -1, max: 800, group: 'Layout' },
  ...stackAlign('stretch'),
  ...stackFlow(),
  ...padProps(),
  ...surfaceProps(),
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
}, lists: {
  items: {
    label: 'Commands',
    itemLabel: 'Command',
    titleField: 'label',
    max: 60,
    fields: {
      label: { type: 'string', default: 'Command', group: 'Content', bindable: true },
      icon: { type: 'string', default: '', group: 'Content' },
      // The chord on the right: it tells you the shortcut before you press it.
      shortcut: { type: 'string', default: '', group: 'Content' },
      active: { type: 'boolean', default: false, group: 'State' },
      danger: { type: 'boolean', default: false, group: 'State' },
      disabled: { type: 'boolean', default: false, group: 'State' },
    },
    default: [
      { label: 'Profile', icon: 'user', shortcut: '', active: false, danger: false, disabled: false },
      { label: 'Settings', icon: 'settings', shortcut: '⌘,', active: false, danger: false, disabled: false },
      { label: 'Sign out', icon: 'x', shortcut: '', active: false, danger: true, disabled: false },
    ],
  },
}, parts: {
  item: { label: 'Commands', hint: 'Every row', fields: ['text', 'box', 'layout'] },
  active: { label: 'Current', hint: 'The row marked active', fields: ['text', 'box'] },
  danger: { label: 'Danger', hint: 'Rows marked as destructive', fields: ['text', 'box'] },
  icon: { label: 'Icon', hint: 'The icon at the start of a row; colour and size', fields: ['text'] },
  shortcut: { label: 'Shortcut', hint: 'The key chord on the right', fields: ['text', 'box'] },
}})

defineComponent({ name: 'CommandBar', category: 'Navigation', container: true, icon: '⌘', description: "A strip of tools for the current surface.", props: {
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
  // A toolbar is a row, and the two flow axes are what turn a row of buttons
  // into "actions right, filters left".
  ...flowProps(),
  // AFTER the fragment: a strip of tools centres on its cross axis.
  align: { type: 'enum', options: ['stretch', 'start', 'center', 'end', 'baseline'], default: 'center', group: 'Layout' },
  ...padProps(),
  ...surfaceProps(),
  // A `role="toolbar"` with no name is an unlabelled landmark.
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'TabBar', category: 'Navigation', icon: '◫', description: 'Tab strip.', props: {
  ...listProps('tabs', 'Overview,Activity,Settings'),
  active: { type: 'number', default: 0, min: 0, max: 20, group: 'State' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // The two strips: raised pills in a track, or an underline under the active
  // tab. They are different components wearing the same name.
  variant: { type: 'enum', options: ['segmented', 'underline'], default: 'segmented', group: 'Style' },
  // Tabs that share the width with the strip, for a full-width page header.
  stretch: { type: 'boolean', default: false, group: 'Layout' },
  overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'AnchorList', category: 'Navigation', icon: '⚓', description: "In-page jump links. Use it to summarise a long single page.", props: {
  ...listProps('links', 'Top,Features,Pricing,FAQ'),
  active: { type: 'string', default: 'Features', group: 'State' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // The rule down the left of the active item, and the inset it sits in.
  marker: { type: 'enum', options: ['bar', 'none'], default: 'bar', group: 'Style' },
  indent: { type: 'number', default: 10, min: 0, max: 48, group: 'Layout' },
  ...stackAlign('stretch'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
}})
defineComponent({ name: 'BackButton', category: 'Navigation', icon: '←', description: 'Back navigation.', props: {
  label: { type: 'string', default: 'Back', group: 'Content' },
  icon: { type: 'string', default: 'arrow-left', group: 'Content' },
  iconPosition: { type: 'enum', options: ['start', 'end'], default: 'start', group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  // Bare text (the default, and what a page header wants), a quiet surface, or
  // a border when the control has to survive on an image.
  variant: { type: 'enum', options: ['ghost', 'surface', 'outline'], default: 'ghost', group: 'Style' },
  disabled: { type: 'boolean', default: false, group: 'State' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  ...textProps(),
}})

/* ---------------- Feedback (12) ---------------- */

defineComponent({ name: 'Alert', category: 'Feedback', icon: '⚠', description: "A persistent, in-page message about the state of the thing above it. For something transient, use Toast.", props: {
  title: { type: 'string', default: 'Heads up', group: 'Content' },
  body: { type: 'string', default: 'Something needs your attention.', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger'], default: 'warning', group: 'Style' },
  dismissible: { type: 'boolean', default: true, group: 'State' },
  // The three treatments: a tinted wash, a solid fill, or an outline. `soft` is
  // the default because an alert that shouts is an alert people stop reading.
  variant: { type: 'enum', options: ['soft', 'solid', 'outline'], default: 'soft', group: 'Style' },
  // A named icon instead of the tone dot — the difference between "this failed"
  // and "this will fail at 3am".
  icon: { type: 'string', default: '', group: 'Content' },
  // The one action an alert may offer. An alert with three actions is a dialog.
  actionLabel: { type: 'string', default: '', group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('start'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'Toast', category: 'Feedback', icon: '💬', description: "A transient confirmation that disappears on its own. Never put required information in one.", props: {
  message: { type: 'string', default: 'Saved successfully', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger'], default: 'success', group: 'Style' },
  // HOW LONG IT STAYS, in seconds. HONEST LIMIT, same as Sparkline's
  // `animate`: the auto-dismiss needs a keyframes/animation rule in the
  // behaviour stylesheet, which is not this file's to change, so today this is
  // carried by the document and read by whatever runtime owns the toast. It
  // stays declared because dropping a property is worse than one that does
  // less than its name promises.
  duration: { type: 'number', default: 4, min: 1, max: 30, group: 'Logic' },
  // PLACEMENT is the universal `anchor`: a toast is a leaf, so pinning it to a
  // corner of its parent is exactly what `anchor` does, and inventing a second
  // placement vocabulary here would give the panel two controls for one intent.
  dismissible: { type: 'boolean', default: false, group: 'State' },
  icon: { type: 'string', default: '', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  variant: { type: 'enum', options: ['soft', 'solid', 'outline'], default: 'solid', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('center'),
  ...boxProps(),
  ...padProps(),
}})
defineComponent({ name: 'Spinner', category: 'Feedback', icon: '◌', description: "Indeterminate waiting. If you know how long it takes, use ProgressBar instead.", props: {
  size: { type: 'number', default: 24, min: 12, max: 96, group: 'Layout' },
  // The ring's stroke weight. A 2px ring at 96px is a hairline, not a spinner.
  thickness: { type: 'number', default: 2, min: 1, max: 12, group: 'Style' },
  label: { type: 'string', default: 'Loading…', group: 'Content' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
  accent: { type: 'color', default: '', group: 'Style' },
  ...stackAlign('center'),
  // A spinner with no label is announced by nothing, so this is the name a
  // screen reader reads while it waits.
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
  // NOT `speed`: a real spin is a keyframes animation, and a `speed` slider that
  // does not change the speed is the worst property in a panel.
}})
defineComponent({ name: 'LoadingBar', category: 'Feedback', icon: '▰', description: "Indeterminate progress. Use ProgressBar when you know the total.", props: {
  progress: { type: 'number', default: 40, min: 0, max: 100, group: 'Data' },
  indeterminate: { type: 'boolean', default: false, group: 'State' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
  height: { type: 'number', default: 6, min: 2, max: 24, group: 'Layout' },
  // The caption, and the shape of the bar. `radius` is the corner of the track
  // and the fill together, because a rounded fill in a square track reads as
  // two different bars.
  label: { type: 'string', default: '', group: 'Content' },
  radius: { type: 'number', default: -1, min: -1, max: 64, group: 'Style' },
  trackColor: { type: 'color', default: '', group: 'Style' },
  width: { type: 'number', default: -1, min: -1, max: 2000, group: 'Layout' },
  ...stackAlign('stretch'),
}})
defineComponent({ name: 'ProgressDots', category: 'Feedback', icon: '•••', description: 'Dotted step progress.', props: {
  steps: { type: 'number', default: 4, min: 2, max: 12, group: 'Layout' },
  current: { type: 'number', default: 1, min: 0, max: 12, group: 'State' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
  // The built-in behaviour role again: off means the dots are a readout.
  interactive: { type: 'boolean', default: true, group: 'Behaviour' },
  ...stackAlign('center'),
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
defineComponent({ name: 'InlineMessage', category: 'Feedback', icon: 'ⓘ', description: "A one-line status note that sits inside the content it describes.", props: {
  text: { type: 'string', default: 'All systems operational', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger', 'neutral'], default: 'info', group: 'Style' },
  // A named icon from the house set, or any glyph. Empty draws no mark at all,
  // which is a real answer for a message that is only a colour.
  icon: { type: 'string', default: 'info', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  variant: { type: 'enum', options: ['plain', 'soft'], default: 'plain', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('center'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'ErrorSummary', category: 'Feedback', icon: '✖', description: 'Form error summary.', props: {
  title: { type: 'string', default: '2 fields need attention', group: 'Content' },
  ...listProps('items', 'Email is required|Password is too short'),
  // The severity is the tone, and the shape is the variant: a solid red block
  // for a page you cannot submit, an outline for a panel you can.
  tone: { type: 'enum', options: ['danger', 'warning'], default: 'danger', group: 'Style' },
  variant: { type: 'enum', options: ['soft', 'solid', 'outline'], default: 'soft', group: 'Style' },
  // Numbered, because "the third field" is what a form summary is read as.
  ordered: { type: 'boolean', default: false, group: 'Content' },
  // Cap the list and say how many were left out, rather than scrolling a form
  // summary off the screen.
  maxItems: { type: 'number', default: 0, min: 0, max: 50, group: 'Content' },
  icon: { type: 'string', default: 'alert-triangle', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('start'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'SuccessCheck', category: 'Feedback', icon: '✓', description: 'Success confirmation.', props: {
  label: { type: 'string', default: 'Done', group: 'Content' },
  size: { type: 'number', default: 40, min: 16, max: 120, group: 'Layout' },
  // The check is a glyph by default and can be a name from the house set. The
  // colour is the tone, so a "done" mark can also be "this is not done yet".
  tone: { type: 'enum', options: ['success', 'accent', 'neutral'], default: 'success', group: 'Style' },
  icon: { type: 'string', default: 'check', group: 'Content' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
  ...stackAlign('center'),
}})
defineComponent({ name: 'WarningCallout', category: 'Feedback', icon: '⚠', description: 'Warning callout.', props: {
  title: { type: 'string', default: 'Check usage', group: 'Content' },
  body: { type: 'string', default: 'You are at 92% of quota.', group: 'Content', bindable: true },
  // The bar down the side is the tone, and `accent` overrides it. A `tone`
  // property is deliberately absent: the tone IS this component's identity,
  // and a switch that could turn a warning into a tip is one click away from
  // doing exactly that. Use Alert when the tone has to be a property.
  accent: { type: 'color', default: '', group: 'Style' },
  variant: { type: 'enum', options: ['outline', 'soft', 'solid'], default: 'outline', group: 'Style' },
  icon: { type: 'string', default: '', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  // The one action a callout may carry ("Reduce usage"), and never a second.
  actionLabel: { type: 'string', default: '', group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('stretch'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'InfoCallout', category: 'Feedback', icon: 'ⓘ', description: 'Info callout.', props: {
  title: { type: 'string', default: 'Tip', group: 'Content' },
  body: { type: 'string', default: 'You can theme the whole document at once.', group: 'Content', bindable: true },
  accent: { type: 'color', default: '', group: 'Style' },
  variant: { type: 'enum', options: ['outline', 'soft', 'solid'], default: 'outline', group: 'Style' },
  icon: { type: 'string', default: '', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  actionLabel: { type: 'string', default: '', group: 'Content' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  ...stackAlign('stretch'),
  maxWidth: { type: 'number', default: -1, min: -1, max: 2000, group: 'Type' },
  ...padProps(),
}})
defineComponent({ name: 'ConfirmDialog', category: 'Feedback', container: true, icon: '◈', description: 'Confirmation dialog frame.', props: {
  title: { type: 'string', default: 'Delete project?', group: 'Content' },
  message: { type: 'string', default: 'This cannot be undone.', group: 'Content', bindable: true },
  confirmLabel: { type: 'string', default: 'Delete', group: 'Content' },
  cancelLabel: { type: 'string', default: 'Cancel', group: 'Content' },
  // How serious the action is. `danger` is the default because a confirm dialog
  // with a neutral confirm button is how people delete the wrong thing.
  tone: { type: 'enum', options: ['danger', 'accent', 'neutral'], default: 'danger', group: 'Style' },
  icon: { type: 'string', default: '', group: 'Content' },
  showIcon: { type: 'boolean', default: true, group: 'Content' },
  // The footer, and where its buttons sit. `end` is the platform answer.
  showFooter: { type: 'boolean', default: true, group: 'Content' },
  buttonAlign: { type: 'enum', options: ['start', 'center', 'end'], default: 'end', group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Size' },
  width: { type: 'number', default: 400, min: 240, max: 1200, group: 'Layout' },
  gap: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
  ...padProps(),
  ...surfaceProps(),
}})
defineComponent({ name: 'NotificationList', category: 'Feedback', container: true, icon: '🔔', description: 'Stack of notifications.', props: {
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
  // What an empty stack says. A notification centre with nothing in it and no
  // explanation is the most common dead end in a product.
  emptyHint: { type: 'string', default: '', group: 'Content' },
  // The full flow vocabulary: a notification stack is a column, but a rail of
  // toasts down the side of a screen is a row, and both are real layouts.
  ...flowProps(),
  ...insetProps(),
  overflow: { type: 'enum', options: ['visible', 'auto', 'scroll', 'hidden'], default: 'visible', group: 'Layout' },
  ariaLabel: { type: 'string', default: '', group: 'Accessibility' },
}})
