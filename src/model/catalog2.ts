/**
 * Extended catalog, part 2: text + data + navigation + feedback.
 * Schema-driven: every prop here appears in the inspector with no extra code.
 * Together with toolbox.ts (10) + catalog1.ts (45) this reaches 111 total.
 */
import { defineComponent } from './registry'

/* ---------------- Text (12) ---------------- */

defineComponent({ name: 'Paragraph', category: 'Text', icon: '¶', description: 'Body copy paragraph.', props: {
  text: { type: 'string', default: 'Lorem ipsum dolor sit amet.', group: 'Content', bindable: true },
  size: { type: 'enum', options: ['xs', 'sm', 'md', 'lg'], default: 'md', group: 'Style' },
  color: { type: 'color', default: '', group: 'Style' },
  align: { type: 'enum', options: ['left', 'center', 'right', 'justify'], default: 'left', group: 'Style' },
}})
defineComponent({ name: 'Caption', category: 'Text', icon: '©', description: 'Small muted caption.', props: {
  text: { type: 'string', default: 'Caption text', group: 'Content', bindable: true },
  color: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'Quote', category: 'Text', icon: '❝', description: 'Block quote with attribution.', props: {
  text: { type: 'string', default: 'Design is intelligence made visible.', group: 'Content', bindable: true },
  author: { type: 'string', default: '— Author', group: 'Content' },
  accent: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'CodeBlock', category: 'Text', icon: '</>', description: 'Preformatted code block.', props: {
  code: { type: 'string', default: 'const x = 1', group: 'Content', bindable: true },
  language: { type: 'enum', options: ['ts', 'js', 'css', 'html', 'json'], default: 'ts', group: 'Content' },
  showLineNumbers: { type: 'boolean', default: false, group: 'Style' },
}})
defineComponent({ name: 'InlineCode', category: 'Text', icon: '`', description: 'Inline code snippet.', props: {
  code: { type: 'string', default: 'npm run verify', group: 'Content', bindable: true },
}})
defineComponent({ name: 'Link', category: 'Text', icon: '🔗', description: 'Hyperlink.', props: {
  text: { type: 'string', default: 'Learn more', group: 'Content', bindable: true },
  href: { type: 'string', default: 'https://example.com', group: 'Logic' },
  underline: { type: 'boolean', default: true, group: 'Style' },
  color: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'BulletList', category: 'Text', icon: '•', description: 'Unordered list.', props: {
  items: { type: 'string', default: 'First,Second,Third', group: 'Content' },
  gap: { type: 'number', default: 6, min: 0, max: 32, group: 'Layout' },
  bullet: { type: 'enum', options: ['dot', 'dash', 'check', 'arrow'], default: 'dot', group: 'Style' },
}})
defineComponent({ name: 'NumberedList', category: 'Text', icon: '1.', description: 'Ordered list.', props: {
  items: { type: 'string', default: 'First,Second,Third', group: 'Content' },
  gap: { type: 'number', default: 6, min: 0, max: 32, group: 'Layout' },
  start: { type: 'number', default: 1, min: 1, max: 99, group: 'Content' },
}})
defineComponent({ name: 'Divider', category: 'Text', icon: '―', description: 'Horizontal rule.', props: {
  thickness: { type: 'number', default: 1, min: 1, max: 8, group: 'Style' },
  color: { type: 'color', default: '', group: 'Style' },
  style: { type: 'enum', options: ['solid', 'dashed', 'dotted'], default: 'solid', group: 'Style' },
  margin: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
}})
defineComponent({ name: 'Badge', category: 'Text', icon: '⬣', description: 'Status badge.', props: {
  text: { type: 'string', default: 'New', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'info', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md'], default: 'sm', group: 'Layout' },
}})
defineComponent({ name: 'Tag', category: 'Text', icon: '🏷', description: 'Removable tag chip.', props: {
  text: { type: 'string', default: 'beta', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['neutral', 'info', 'success', 'warning', 'danger'], default: 'neutral', group: 'Style' },
  removable: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Kbd', category: 'Text', icon: '⌨', description: 'Keyboard shortcut hint.', props: {
  keys: { type: 'string', default: 'Ctrl+K', group: 'Content' },
}})

/* ---------------- Data (20) ---------------- */

defineComponent({ name: 'Table', category: 'Data', icon: '▦', description: 'Data table.', props: {
  columns: { type: 'string', default: 'Name,Role,Status', group: 'Content' },
  rows: { type: 'string', default: 'Ada,Engineer,Active;Grace,Designer,Active;Alan,PM,Away', group: 'Content' },
  striped: { type: 'boolean', default: true, group: 'Style' },
  dense: { type: 'boolean', default: false, group: 'Layout' },
}})
defineComponent({ name: 'Stat', category: 'Data', icon: '📊', description: 'KPI stat with delta.', props: {
  label: { type: 'string', default: 'Revenue', group: 'Content' },
  value: { type: 'string', default: '$48.2k', group: 'Content', bindable: true },
  delta: { type: 'string', default: '+12.4%', group: 'Content' },
  trend: { type: 'enum', options: ['up', 'down', 'flat'], default: 'up', group: 'Data' },
  accent: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'ProgressBar', category: 'Data', icon: '▰', description: 'Linear progress.', props: {
  value: { type: 'number', default: 62, min: 0, max: 100, group: 'Data', bindable: true },
  max: { type: 'number', default: 100, min: 1, max: 1000, group: 'Data' },
  height: { type: 'number', default: 8, min: 2, max: 24, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
  showLabel: { type: 'boolean', default: true, group: 'Content' },
}})
defineComponent({ name: 'ProgressRing', category: 'Data', icon: '◍', description: 'Circular progress.', props: {
  value: { type: 'number', default: 72, min: 0, max: 100, group: 'Data', bindable: true },
  max: { type: 'number', default: 100, min: 1, max: 1000, group: 'Data' },
  size: { type: 'number', default: 72, min: 24, max: 240, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
}})
defineComponent({ name: 'Avatar', category: 'Data', icon: '👤', description: 'User avatar.', props: {
  initials: { type: 'string', default: 'AK', group: 'Content' },
  size: { type: 'number', default: 40, min: 16, max: 160, group: 'Layout' },
  tone: { type: 'enum', options: ['accent', 'neutral', 'success', 'warning'], default: 'accent', group: 'Style' },
  image: { type: 'string', default: '', group: 'Content' },
}})
defineComponent({ name: 'AvatarGroup', category: 'Data', icon: '👥', description: 'Stacked avatars.', props: {
  names: { type: 'string', default: 'Ada,Grace,Alan,+3', group: 'Content' },
  size: { type: 'number', default: 32, min: 16, max: 96, group: 'Layout' },
  max: { type: 'number', default: 4, min: 1, max: 12, group: 'Layout' },
}})
defineComponent({ name: 'Image', category: 'Data', icon: '🖼', description: 'Image block.', props: {
  src: { type: 'string', default: '', group: 'Content' },
  alt: { type: 'string', default: 'Image', group: 'Content' },
  radius: { type: 'number', default: 12, min: 0, max: 48, group: 'Style' },
  aspect: { type: 'enum', options: ['auto', '1:1', '16:9', '4:3'], default: '16:9', group: 'Layout' },
}})
defineComponent({ name: 'BarChart', category: 'Data', icon: '📶', description: 'Bar chart.', props: {
  values: { type: 'string', default: '12,30,22,48,41,66,58', group: 'Data', bindable: true },
  height: { type: 'number', default: 120, min: 40, max: 480, group: 'Layout' },
  accent: { type: 'color', default: '', group: 'Style' },
  showLabels: { type: 'boolean', default: false, group: 'Content' },
}})
defineComponent({ name: 'PieChart', category: 'Data', icon: '◵', description: 'Pie chart.', props: {
  values: { type: 'string', default: '40,30,20,10', group: 'Data', bindable: true },
  size: { type: 'number', default: 140, min: 48, max: 480, group: 'Layout' },
  showLegend: { type: 'boolean', default: true, group: 'Content' },
}})
defineComponent({ name: 'LineChart', category: 'Data', icon: '📈', description: 'Line chart with axes.', props: {
  points: { type: 'string', default: '12,30,22,48,41,66,58,80', group: 'Data', bindable: true },
  width: { type: 'number', default: 280, min: 80, max: 1200, group: 'Layout' },
  height: { type: 'number', default: 140, min: 40, max: 480, group: 'Layout' },
  accent: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'Timeline', category: 'Data', container: true, icon: '🕒', description: 'Vertical event timeline.', props: {
  gap: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
}})
defineComponent({ name: 'TimelineItem', category: 'Data', icon: '•', description: 'One timeline event.', props: {
  title: { type: 'string', default: 'Deployed v2.4', group: 'Content' },
  time: { type: 'string', default: '2h ago', group: 'Content' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger', 'neutral'], default: 'accent', group: 'Style' },
}})
defineComponent({ name: 'TreeList', category: 'Data', icon: '🌲', description: 'Indented tree list.', props: {
  items: { type: 'string', default: 'src,src/app.tsx,src/model,docs,package.json', group: 'Content' },
  gap: { type: 'number', default: 4, min: 0, max: 24, group: 'Layout' },
}})
defineComponent({ name: 'DataList', category: 'Data', icon: '☰', description: 'Divided data list.', props: {
  items: { type: 'string', default: 'Alpha:120,Beta:340,Gamma:210', group: 'Content' },
  gap: { type: 'number', default: 0, min: 0, max: 24, group: 'Layout' },
  divided: { type: 'boolean', default: true, group: 'Style' },
}})
defineComponent({ name: 'KeyValue', category: 'Data', icon: '⚖', description: 'Label/value pair.', props: {
  label: { type: 'string', default: 'Status', group: 'Content' },
  value: { type: 'string', default: 'Operational', group: 'Content', bindable: true },
  layout: { type: 'enum', options: ['row', 'column'], default: 'row', group: 'Layout' },
}})
defineComponent({ name: 'Calendar', category: 'Data', icon: '📅', description: 'Month calendar.', props: {
  month: { type: 'string', default: 'September 2026', group: 'Content' },
  selected: { type: 'string', default: '26', group: 'State' },
  accent: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'KanbanColumn', category: 'Data', container: true, icon: '🗂', description: 'Kanban swimlane.', props: {
  title: { type: 'string', default: 'In progress', group: 'Content' },
  count: { type: 'number', default: 3, min: 0, max: 99, group: 'Content' },
  tone: { type: 'enum', options: ['neutral', 'accent', 'success', 'warning'], default: 'accent', group: 'Style' },
}})
defineComponent({ name: 'EmptyState', category: 'Data', icon: '○', description: 'Empty placeholder.', props: {
  title: { type: 'string', default: 'No results', group: 'Content' },
  hint: { type: 'string', default: 'Try a different filter.', group: 'Content' },
  actionLabel: { type: 'string', default: 'Clear filters', group: 'Content' },
}})
defineComponent({ name: 'Skeleton', category: 'Data', icon: '▒', description: 'Loading skeleton lines.', props: {
  lines: { type: 'number', default: 3, min: 1, max: 12, group: 'Layout' },
  height: { type: 'number', default: 14, min: 8, max: 48, group: 'Layout' },
  animate: { type: 'boolean', default: true, group: 'Style' },
}})
defineComponent({ name: 'DataCard', category: 'Data', container: true, icon: '▣', description: 'Metric card container.', props: {
  title: { type: 'string', default: 'Metric', group: 'Content' },
  value: { type: 'string', default: '1,284', group: 'Content', bindable: true },
  hint: { type: 'string', default: '+4.2% vs last week', group: 'Content' },
}})

/* ---------------- Navigation (12) ---------------- */

defineComponent({ name: 'NavBar', category: 'Navigation', container: true, icon: '🧭', description: 'Top navigation bar.', props: {
  title: { type: 'string', default: 'Acme', group: 'Content' },
  height: { type: 'number', default: 56, min: 32, max: 120, group: 'Layout' },
}})
defineComponent({ name: 'NavLink', category: 'Navigation', icon: '🔗', description: 'Navigation link.', props: {
  label: { type: 'string', default: 'Dashboard', group: 'Content', bindable: true },
  active: { type: 'boolean', default: false, group: 'State' },
  href: { type: 'string', default: '#', group: 'Logic' },
}})
defineComponent({ name: 'SideNav', category: 'Navigation', container: true, icon: '▥', description: 'Vertical side navigation.', props: {
  width: { type: 'number', default: 220, min: 120, max: 480, group: 'Layout' },
  collapsed: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Breadcrumbs', category: 'Navigation', icon: '›', description: 'Breadcrumb trail.', props: {
  trail: { type: 'string', default: 'Home,Projects,Loom', group: 'Content' },
  separator: { type: 'string', default: '/', group: 'Content' },
}})
defineComponent({ name: 'Pagination', category: 'Navigation', icon: '⇄', description: 'Page pager.', props: {
  page: { type: 'number', default: 1, min: 1, max: 999, group: 'State' },
  total: { type: 'number', default: 12, min: 1, max: 999, group: 'Data' },
  size: { type: 'enum', options: ['sm', 'md'], default: 'md', group: 'Layout' },
}})
defineComponent({ name: 'Stepper', category: 'Navigation', icon: '👣', description: 'Multi-step progress.', props: {
  steps: { type: 'string', default: 'Details,Build,Review,Ship', group: 'Content' },
  current: { type: 'number', default: 1, min: 0, max: 20, group: 'State' },
}})
defineComponent({ name: 'Menu', category: 'Navigation', container: true, icon: '☰', description: 'Menu container.', props: {
  gap: { type: 'number', default: 2, min: 0, max: 24, group: 'Layout' },
}})
defineComponent({ name: 'MenuItem', category: 'Navigation', icon: '•', description: 'One menu row.', props: {
  label: { type: 'string', default: 'Settings', group: 'Content' },
  icon: { type: 'string', default: '⚙', group: 'Content' },
  active: { type: 'boolean', default: false, group: 'State' },
  danger: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'CommandBar', category: 'Navigation', container: true, icon: '⌘', description: 'Command/button strip.', props: {
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
defineComponent({ name: 'TabBar', category: 'Navigation', icon: '◫', description: 'Tab strip.', props: {
  tabs: { type: 'string', default: 'Overview,Activity,Settings', group: 'Content' },
  active: { type: 'number', default: 0, min: 0, max: 20, group: 'State' },
}})
defineComponent({ name: 'AnchorList', category: 'Navigation', icon: '⚓', description: 'In-page anchor list.', props: {
  links: { type: 'string', default: 'Top,Features,Pricing,FAQ', group: 'Content' },
  active: { type: 'string', default: 'Features', group: 'State' },
}})
defineComponent({ name: 'BackButton', category: 'Navigation', icon: '←', description: 'Back navigation.', props: {
  label: { type: 'string', default: 'Back', group: 'Content' },
}})

/* ---------------- Feedback (12) ---------------- */

defineComponent({ name: 'Alert', category: 'Feedback', icon: '⚠', description: 'Alert banner.', props: {
  title: { type: 'string', default: 'Heads up', group: 'Content' },
  body: { type: 'string', default: 'Something needs your attention.', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger'], default: 'warning', group: 'Style' },
  dismissible: { type: 'boolean', default: true, group: 'State' },
}})
defineComponent({ name: 'Toast', category: 'Feedback', icon: '💬', description: 'Transient toast.', props: {
  message: { type: 'string', default: 'Saved successfully', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger'], default: 'success', group: 'Style' },
  duration: { type: 'number', default: 4, min: 1, max: 30, group: 'Logic' },
}})
defineComponent({ name: 'Spinner', category: 'Feedback', icon: '◌', description: 'Loading spinner.', props: {
  size: { type: 'number', default: 24, min: 12, max: 96, group: 'Layout' },
  label: { type: 'string', default: 'Loading…', group: 'Content' },
  accent: { type: 'color', default: '', group: 'Style' },
}})
defineComponent({ name: 'LoadingBar', category: 'Feedback', icon: '▰', description: 'Indeterminate loading bar.', props: {
  progress: { type: 'number', default: 40, min: 0, max: 100, group: 'Data' },
  indeterminate: { type: 'boolean', default: false, group: 'State' },
  tone: { type: 'enum', options: ['accent', 'success', 'warning', 'danger'], default: 'accent', group: 'Style' },
}})
defineComponent({ name: 'ProgressDots', category: 'Feedback', icon: '•••', description: 'Dotted step progress.', props: {
  steps: { type: 'number', default: 4, min: 2, max: 12, group: 'Layout' },
  current: { type: 'number', default: 1, min: 0, max: 12, group: 'State' },
}})
defineComponent({ name: 'InlineMessage', category: 'Feedback', icon: 'ⓘ', description: 'Inline status line.', props: {
  text: { type: 'string', default: 'All systems operational', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger', 'neutral'], default: 'info', group: 'Style' },
}})
defineComponent({ name: 'ErrorSummary', category: 'Feedback', icon: '✖', description: 'Form error summary.', props: {
  title: { type: 'string', default: '2 fields need attention', group: 'Content' },
  items: { type: 'string', default: 'Email is required,Password is too short', group: 'Content' },
}})
defineComponent({ name: 'SuccessCheck', category: 'Feedback', icon: '✓', description: 'Success confirmation.', props: {
  label: { type: 'string', default: 'Done', group: 'Content' },
  size: { type: 'number', default: 40, min: 16, max: 120, group: 'Layout' },
}})
defineComponent({ name: 'WarningCallout', category: 'Feedback', icon: '⚠', description: 'Warning callout.', props: {
  title: { type: 'string', default: 'Check usage', group: 'Content' },
  body: { type: 'string', default: 'You are at 92% of quota.', group: 'Content' },
}})
defineComponent({ name: 'InfoCallout', category: 'Feedback', icon: 'ⓘ', description: 'Info callout.', props: {
  title: { type: 'string', default: 'Tip', group: 'Content' },
  body: { type: 'string', default: 'You can theme the whole document at once.', group: 'Content' },
}})
defineComponent({ name: 'ConfirmDialog', category: 'Feedback', container: true, icon: '◈', description: 'Confirmation dialog frame.', props: {
  title: { type: 'string', default: 'Delete project?', group: 'Content' },
  message: { type: 'string', default: 'This cannot be undone.', group: 'Content' },
  confirmLabel: { type: 'string', default: 'Delete', group: 'Content' },
  cancelLabel: { type: 'string', default: 'Cancel', group: 'Content' },
}})
defineComponent({ name: 'NotificationList', category: 'Feedback', container: true, icon: '🔔', description: 'Stack of notifications.', props: {
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
