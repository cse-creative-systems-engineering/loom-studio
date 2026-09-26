/**
 * Extended catalog, part 1: containers + controls.
 * Schema-driven: every prop here appears in the inspector with no extra code.
 */
import { defineComponent } from './registry'

defineComponent({ name: 'Card', category: 'Containers', container: true, icon: '▣', description: 'Elevated content card.', props: {
  title: { type: 'string', default: '', group: 'Content' },
  padding: { type: 'number', default: 16, min: 0, max: 64, group: 'Layout' },
  radius: { type: 'number', default: 12, min: 0, max: 32, group: 'Style' },
  elevation: { type: 'enum', options: ['none', 'sm', 'md', 'lg'], default: 'md', group: 'Style' },
}})
defineComponent({ name: 'Tabs', category: 'Containers', container: true, icon: '◫', description: 'Tabbed container.', props: {
  tabs: { type: 'string', default: 'One,Two,Three', group: 'Content' },
  active: { type: 'number', default: 0, min: 0, max: 20, group: 'State' },
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
defineComponent({ name: 'TabPanel', category: 'Containers', container: true, icon: '◧', description: 'Single tab page.', props: {
  title: { type: 'string', default: 'Tab', group: 'Content' },
  padding: { type: 'number', default: 12, min: 0, max: 64, group: 'Layout' },
}})
defineComponent({ name: 'Accordion', category: 'Containers', container: true, icon: '☰', description: 'Stack of collapsible sections.', props: {
  open: { type: 'number', default: 0, min: 0, max: 20, group: 'State' },
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
defineComponent({ name: 'AccordionItem', category: 'Containers', container: true, icon: '≡', description: 'One collapsible section.', props: {
  title: { type: 'string', default: 'Section', group: 'Content' },
  expanded: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Modal', category: 'Containers', container: true, icon: '◈', description: 'Dialog surface.', props: {
  title: { type: 'string', default: 'Dialog', group: 'Content' },
  open: { type: 'boolean', default: true, group: 'State' },
  width: { type: 'number', default: 480, min: 200, max: 1200, group: 'Layout' },
}})
defineComponent({ name: 'Drawer', category: 'Containers', container: true, icon: '▤', description: 'Side drawer.', props: {
  side: { type: 'enum', options: ['left', 'right'], default: 'right', group: 'Layout' },
  open: { type: 'boolean', default: true, group: 'State' },
  width: { type: 'number', default: 320, min: 160, max: 800, group: 'Layout' },
}})
defineComponent({ name: 'Section', category: 'Containers', container: true, icon: '§', description: 'Titled content section.', props: {
  title: { type: 'string', default: 'Section', group: 'Content' },
  padding: { type: 'number', default: 16, min: 0, max: 64, group: 'Layout' },
  gap: { type: 'number', default: 10, min: 0, max: 48, group: 'Layout' },
}})
defineComponent({ name: 'GroupBox', category: 'Containers', container: true, icon: '▢', description: 'Bordered field group.', props: {
  title: { type: 'string', default: 'Group', group: 'Content' },
  padding: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
}})
defineComponent({ name: 'ScrollView', category: 'Containers', container: true, icon: '↕', description: 'Scrollable region.', props: {
  height: { type: 'number', default: 300, min: 80, max: 1200, group: 'Layout' },
  direction: { type: 'enum', options: ['vertical', 'horizontal', 'both'], default: 'vertical', group: 'Layout' },
}})
defineComponent({ name: 'SplitH', category: 'Containers', container: true, icon: '◐', description: 'Horizontal split.', props: {
  ratio: { type: 'number', default: 50, min: 10, max: 90, group: 'Layout' },
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
defineComponent({ name: 'SplitV', category: 'Containers', container: true, icon: '◑', description: 'Vertical split.', props: {
  ratio: { type: 'number', default: 50, min: 10, max: 90, group: 'Layout' },
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
}})
defineComponent({ name: 'Toolbar', category: 'Containers', container: true, icon: '⛭', description: 'Action toolbar.', props: {
  gap: { type: 'number', default: 8, min: 0, max: 32, group: 'Layout' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Layout' },
}})
defineComponent({ name: 'StatusBar', category: 'Containers', container: true, icon: '⎯', description: 'Bottom status strip.', props: {
  text: { type: 'string', default: 'Ready', group: 'Content', bindable: true },
}})
defineComponent({ name: 'Hero', category: 'Containers', container: true, icon: '★', description: 'Hero banner block.', props: {
  title: { type: 'string', default: 'Hero title', group: 'Content' },
  subtitle: { type: 'string', default: 'Subtitle', group: 'Content' },
  padding: { type: 'number', default: 32, min: 0, max: 128, group: 'Layout' },
}})
defineComponent({ name: 'HeaderBar', category: 'Containers', container: true, icon: '⬒', description: 'App header bar.', props: {
  title: { type: 'string', default: 'App', group: 'Content' },
  height: { type: 'number', default: 56, min: 32, max: 120, group: 'Layout' },
}})
defineComponent({ name: 'FooterBar', category: 'Containers', container: true, icon: '⬓', description: 'App footer bar.', props: {
  text: { type: 'string', default: 'Footer', group: 'Content' },
  height: { type: 'number', default: 48, min: 24, max: 120, group: 'Layout' },
}})
defineComponent({ name: 'SidebarPanel', category: 'Containers', container: true, icon: '▥', description: 'Navigation sidebar.', props: {
  width: { type: 'number', default: 240, min: 120, max: 480, group: 'Layout' },
  collapsed: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'FormGrid', category: 'Containers', container: true, icon: '⊞', description: 'Two-column form grid.', props: {
  columns: { type: 'number', default: 2, min: 1, max: 6, group: 'Layout' },
  gap: { type: 'number', default: 12, min: 0, max: 48, group: 'Layout' },
}})
defineComponent({ name: 'BannerBox', category: 'Containers', container: true, icon: '📢', description: 'Announcement banner.', props: {
  text: { type: 'string', default: 'Announcement', group: 'Content', bindable: true },
  tone: { type: 'enum', options: ['info', 'success', 'warning', 'danger'], default: 'info', group: 'Style' },
}})

defineComponent({ name: 'IconButton', category: 'Controls', icon: '◉', description: 'Icon-only button.', props: {
  icon: { type: 'string', default: '★', group: 'Content' },
  variant: { type: 'enum', options: ['primary', 'secondary', 'ghost'], default: 'secondary', group: 'Style' },
  size: { type: 'enum', options: ['sm', 'md', 'lg'], default: 'md', group: 'Layout' },
  disabled: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Checkbox', category: 'Controls', icon: '☑', description: 'Checkbox with label.', props: {
  label: { type: 'string', default: 'Check me', group: 'Content' },
  checked: { type: 'boolean', default: false, group: 'State', bindable: true },
  disabled: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Radio', category: 'Controls', icon: '◯', description: 'Radio option.', props: {
  label: { type: 'string', default: 'Option', group: 'Content' },
  checked: { type: 'boolean', default: false, group: 'State', bindable: true },
  group: { type: 'string', default: 'g1', group: 'Logic' },
}})
defineComponent({ name: 'RadioGroup', category: 'Controls', container: true, icon: '◎', description: 'Grouped radio options.', props: {
  options: { type: 'string', default: 'A,B,C', group: 'Content' },
  value: { type: 'string', default: 'A', group: 'State', bindable: true },
}})
defineComponent({ name: 'Switch', category: 'Controls', icon: '◐', description: 'Toggle switch.', props: {
  label: { type: 'string', default: 'Enable', group: 'Content' },
  on: { type: 'boolean', default: false, group: 'State', bindable: true },
  disabled: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'Slider', category: 'Controls', icon: '—', description: 'Range slider.', props: {
  value: { type: 'number', default: 50, min: 0, max: 100, group: 'Data', bindable: true },
  min: { type: 'number', default: 0, group: 'Data' },
  max: { type: 'number', default: 100, group: 'Data' },
  step: { type: 'number', default: 1, min: 0.1, max: 10, group: 'Data' },
}})
defineComponent({ name: 'Select', category: 'Controls', icon: '▾', description: 'Dropdown select.', props: {
  options: { type: 'string', default: 'One,Two,Three', group: 'Content' },
  value: { type: 'string', default: 'One', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Choose…', group: 'Content' },
}})
defineComponent({ name: 'ComboBox', category: 'Controls', icon: '▿', description: 'Editable dropdown.', props: {
  options: { type: 'string', default: 'One,Two,Three', group: 'Content' },
  value: { type: 'string', default: '', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Type or choose…', group: 'Content' },
}})
defineComponent({ name: 'TextArea', category: 'Controls', icon: '≡', description: 'Multi-line text.', props: {
  value: { type: 'string', default: '', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Type here…', group: 'Content' },
  rows: { type: 'number', default: 4, min: 1, max: 20, group: 'Layout' },
  width: { type: 'number', default: 280, min: 80, max: 1200, group: 'Layout' },
}})
defineComponent({ name: 'SearchBox', category: 'Controls', icon: '⌕', description: 'Search field.', props: {
  value: { type: 'string', default: '', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Search…', group: 'Content' },
  width: { type: 'number', default: 220, min: 80, max: 800, group: 'Layout' },
}})
defineComponent({ name: 'NumberInput', category: 'Controls', icon: '#', description: 'Numeric field.', props: {
  value: { type: 'number', default: 0, group: 'State', bindable: true },
  min: { type: 'number', default: 0, group: 'Data' },
  max: { type: 'number', default: 100, group: 'Data' },
  step: { type: 'number', default: 1, group: 'Data' },
}})
defineComponent({ name: 'PasswordInput', category: 'Controls', icon: '●', description: 'Password field.', props: {
  value: { type: 'string', default: '', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Password', group: 'Content' },
  width: { type: 'number', default: 220, min: 80, max: 800, group: 'Layout' },
}})
defineComponent({ name: 'DatePicker', category: 'Controls', icon: '📅', description: 'Date picker.', props: {
  value: { type: 'string', default: '', group: 'State', bindable: true },
  min: { type: 'string', default: '', group: 'Data' },
  max: { type: 'string', default: '', group: 'Data' },
}})
defineComponent({ name: 'TimePicker', category: 'Controls', icon: '◷', description: 'Time picker.', props: {
  value: { type: 'string', default: '', group: 'State', bindable: true },
}})
defineComponent({ name: 'ColorInput', category: 'Controls', icon: '🎨', description: 'Color picker.', props: {
  value: { type: 'color', default: '#5b8cff', group: 'State', bindable: true },
}})
defineComponent({ name: 'FileUpload', category: 'Controls', icon: '⤴', description: 'File upload dropzone.', props: {
  label: { type: 'string', default: 'Drop files here', group: 'Content' },
  accept: { type: 'string', default: '', group: 'Logic' },
  multiple: { type: 'boolean', default: false, group: 'State' },
}})
defineComponent({ name: 'ButtonGroup', category: 'Controls', container: true, icon: '⋯', description: 'Grouped buttons.', props: {
  gap: { type: 'number', default: 0, min: 0, max: 24, group: 'Layout' },
}})
defineComponent({ name: 'DropdownButton', category: 'Controls', icon: '▾', description: 'Button with menu.', props: {
  label: { type: 'string', default: 'Actions', group: 'Content' },
  items: { type: 'string', default: 'Edit,Duplicate,Delete', group: 'Content' },
  variant: { type: 'enum', options: ['primary', 'secondary', 'ghost'], default: 'secondary', group: 'Style' },
}})
defineComponent({ name: 'Rating', category: 'Controls', icon: '★★', description: 'Star rating.', props: {
  value: { type: 'number', default: 3, min: 0, max: 5, group: 'State', bindable: true },
  max: { type: 'number', default: 5, min: 1, max: 10, group: 'Data' },
}})
defineComponent({ name: 'ToggleButton', category: 'Controls', icon: '◍', description: 'Two-state button.', props: {
  label: { type: 'string', default: 'Toggle', group: 'Content' },
  pressed: { type: 'boolean', default: false, group: 'State', bindable: true },
}})
defineComponent({ name: 'Segmented', category: 'Controls', icon: '◫', description: 'Segmented control.', props: {
  options: { type: 'string', default: 'Day,Week,Month', group: 'Content' },
  value: { type: 'string', default: 'Week', group: 'State', bindable: true },
}})
defineComponent({ name: 'SpinBox', category: 'Controls', icon: '↕', description: 'Stepper input.', props: {
  value: { type: 'number', default: 1, group: 'State', bindable: true },
  min: { type: 'number', default: 0, group: 'Data' },
  max: { type: 'number', default: 99, group: 'Data' },
}})
defineComponent({ name: 'Checklist', category: 'Controls', container: true, icon: '☰', description: 'List of checkboxes.', props: {
  items: { type: 'string', default: 'One,Two,Three', group: 'Content' },
  gap: { type: 'number', default: 6, min: 0, max: 24, group: 'Layout' },
}})
defineComponent({ name: 'TagInput', category: 'Controls', icon: '🏷', description: 'Tag editor.', props: {
  value: { type: 'string', default: 'alpha, beta', group: 'State', bindable: true },
  placeholder: { type: 'string', default: 'Add tag…', group: 'Content' },
}})
defineComponent({ name: 'OtpInput', category: 'Controls', icon: '🔢', description: 'One-time code input.', props: {
  length: { type: 'number', default: 6, min: 3, max: 8, group: 'Layout' },
  value: { type: 'string', default: '', group: 'State', bindable: true },
}})
