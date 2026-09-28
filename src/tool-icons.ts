/**
 * Tool glyphs: one small drawing per component, for the Studio's toolbox and
 * inspector header.
 *
 * These were Unicode characters (◧ ▣ ⊞ ☰ …) from whatever font the OS had,
 * each a different size, weight and baseline: the toolbox read as a character
 * map. These are one family on the icon set's grid (24px, stroke, round
 * caps), each a tiny diagram of what the tool looks like.
 *
 * Studio chrome only. They are not user-pickable icons (that set lives in
 * `render/icons.ts` and ships in exports); the few shared shapes are reused
 * from it so the two never drift.
 */

import { ICONS } from './render/icons'

const F = 'fill="currentColor" stroke="none"'
const soft = 'opacity=".4"'
const dot = (x: number, y: number) => `M${x} ${y}h.01`

const GLYPHS: Record<string, string> = {
  // --- containers ---
  Panel: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
  Stack: '<rect x="4" y="4" width="16" height="4" rx="1"/><rect x="4" y="10" width="16" height="4" rx="1"/><rect x="4" y="16" width="16" height="4" rx="1"/>',
  Grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  Card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 10h7M7 14h10"/>',
  Tabs: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M3 8V5h7v3M12 8V5h6v3"/>',
  Accordion: '<rect x="3" y="4" width="18" height="4" rx="1"/><rect x="3" y="10" width="18" height="10" rx="1"/><path d="M15.5 5.5 17 7l1.5-1.5"/>',
  Modal: `<rect x="2" y="3" width="20" height="18" rx="2" ${soft}/><rect x="6" y="7" width="12" height="10" rx="1.5"/><path d="M9 10.5h6"/>`,
  Drawer: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16M16.5 8h2M16.5 11h2"/>',
  Section: '<path d="M4 5h8" stroke-width="2.2"/><rect x="4" y="9" width="16" height="11" rx="1.5"/>',
  GroupBox: '<path d="M8.5 6H4.5A1.5 1.5 0 0 0 3 7.5v11A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-11A1.5 1.5 0 0 0 19.5 6h-4"/><path d="M11 6h2"/>',
  ScrollView: `<rect x="3" y="3" width="14" height="18" rx="1.5"/><rect x="19.25" y="5" width="1.5" height="6" rx=".75" ${F}/>`,
  SplitH: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M12 4v16"/>',
  SplitV: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 12h18"/>',
  Toolbar: `<rect x="3" y="8" width="18" height="8" rx="2"/><path d="${dot(7, 12)}${dot(11, 12)}${dot(15, 12)}" stroke-width="2.4"/>`,
  StatusBar: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 16h18M6 18h4"/>',
  Hero: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M7 10h10" stroke-width="2.2"/><path d="M9 13.5h6"/><rect x="10" y="16" width="4" height="1.6" rx=".8"/>',
  HeaderBar: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 8.5h18M6 6.25h3"/>',
  FooterBar: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 15.5h18M6 17.75h3"/>',
  SettingsSection: '<path d="M4 5h7" stroke-width="2.2"/><rect x="4" y="9" width="16" height="4.5" rx="1"/><rect x="4" y="15.5" width="16" height="4.5" rx="1"/><path d="M15.5 11.25h2M15.5 17.75h2"/>',
  SettingsRow: '<rect x="3" y="8" width="18" height="8" rx="1.5"/><path d="M6 12h6"/><rect x="14.5" y="10.25" width="4" height="3.5" rx="1.75"/>',
  AppShell: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 8h18M8 8v12"/>',
  SidebarPanel: `<rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="3" y="4" width="7" height="16" rx="1.5" ${F} ${soft}/>`,
  FormGrid: '<path d="M4 4.5h3M13 4.5h3M4 12.5h3M13 12.5h3"/><rect x="4" y="7" width="7" height="3.5" rx="1"/><rect x="13" y="7" width="7" height="3.5" rx="1"/><rect x="4" y="15" width="7" height="3.5" rx="1"/><rect x="13" y="15" width="7" height="3.5" rx="1"/>',
  BannerBox: `<rect x="3" y="7" width="18" height="10" rx="1.5"/><path d="M7 12h10"/><path d="${dot(5.5, 12)}" stroke-width="2.4"/>`,
  TabPanel: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M3 8V5h7v3"/>',
  AccordionItem: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M6 12h7M15.5 11l1.5 1.5 1.5-1.5"/>',

  // --- controls ---
  Button: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M9 12h6"/>',
  Input: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6.5 10v4"/>',
  Field: `<path d="M4 4.5h6"/><rect x="3" y="7.5" width="18" height="8" rx="2"/><path d="M4 19.5h8" ${soft}/>`,
  IconButton: '<rect x="5" y="5" width="14" height="14" rx="3.5"/><path d="M12 9v6M9 12h6"/>',
  Checkbox: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="m8 12 3 3 5-6"/>',
  RadioGroup: `<circle cx="7" cy="7" r="2.5"/><circle cx="7" cy="17" r="2.5"/><circle cx="7" cy="7" r="1" ${F}/><path d="M12 7h8M12 17h8"/>`,
  Switch: `<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.5" ${F}/>`,
  Slider: '<path d="M3 12h3.5M11.5 12H21"/><circle cx="9" cy="12" r="2.5"/>',
  Select: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6.5 12h5M15.5 11l1.5 1.5 1.5-1.5"/>',
  ComboBox: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6.5 10v4M15.5 11l1.5 1.5 1.5-1.5"/>',
  TextArea: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h7M16.5 17.5l1.5-1.5"/>',
  SearchBox: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="9" cy="11.75" r="2.25"/><path d="m10.7 13.45 1.3 1.3"/>',
  NumberInput: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6.5 10v4M15.5 10.5 17 9l1.5 1.5M15.5 13.5 17 15l1.5-1.5"/>',
  PasswordInput: `<rect x="3" y="7" width="18" height="10" rx="2"/><path d="${dot(7.5, 12)}${dot(10.5, 12)}${dot(13.5, 12)}" stroke-width="2.4"/>`,
  DatePicker: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3v4M16 3v4M9 14.5h6"/>',
  TimePicker: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  ColorInput: `<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" ${F} ${soft}/>`,
  FileUpload: '<path d="M12 15V5M8 9l4-4 4 4M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  ButtonGroup: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M9 8v8M15 8v8"/>',
  DropdownButton: '<rect x="3" y="8" width="18" height="8" rx="2"/><path d="M15 8v8M6.5 12h5M16.8 11.4l1.2 1.2 1.2-1.2"/>',
  Rating: ICONS.star!,
  ToggleButton: `<rect x="3" y="8" width="18" height="8" rx="2"/><rect x="3" y="8" width="9" height="8" rx="2" ${F} ${soft}/>`,
  Segmented: `<rect x="3" y="8" width="18" height="8" rx="2"/><rect x="9" y="8" width="6" height="8" ${F} ${soft}/><path d="M9 8v8M15 8v8"/>`,
  SpinBox: '<rect x="3" y="7" width="13" height="10" rx="2"/><path d="M6.5 12h5M18.5 10.5 20 9l1.5 1.5M18.5 13.5 20 15l1.5-1.5"/>',
  Checklist: '<path d="m4 7 1.5 1.5L8 6M11 7h9M4 16.5 5.5 18 8 15.5M11 17h9"/>',
  TagInput: '<rect x="3" y="7" width="18" height="10" rx="2"/><rect x="5.5" y="9.5" width="6" height="5" rx="1.5"/><path d="M14.5 10v4"/>',
  OtpInput: '<rect x="3" y="8" width="3.5" height="8" rx="1"/><rect x="8" y="8" width="3.5" height="8" rx="1"/><rect x="13" y="8" width="3.5" height="8" rx="1"/><rect x="18" y="8" width="3.5" height="8" rx="1"/>',

  // --- text ---
  Label: '<path d="m6 18 6-13 6 13M8.5 13h7"/>',
  Heading: '<path d="M6 5v14M18 5v14M6 12h12"/>',
  Icon: '<path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/>',
  Paragraph: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
  Caption: '<rect x="4" y="4" width="16" height="10" rx="1.5"/><path d="M6 17.5h12M8 20.5h8"/>',
  Quote: '<path d="M5 5v14" stroke-width="2.2"/><path d="M9 8h10M9 12h10M9 16h6"/>',
  CodeBlock: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m9 10-2 2 2 2M15 10l2 2-2 2"/>',
  InlineCode: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>',
  Link: ICONS.link!,
  BulletList: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="${dot(4.5, 6)}${dot(4.5, 12)}${dot(4.5, 18)}" stroke-width="2.6"/>`,
  NumberedList: '<path d="M10 6h10M10 12h10M10 18h10M4.5 4.5h1v3.5M4 15.5h2.2l-2.2 3h2.2"/>',
  Divider: `<path d="M3 12h18"/><path d="M3 7h10M3 17h14" ${soft}/>`,
  Badge: '<rect x="4" y="8" width="16" height="8" rx="4"/><path d="M8.5 12h7"/>',
  Tag: ICONS.tag!,
  Kbd: '<rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 15.5h16M10 10h4"/>',

  // --- data ---
  Gauge: '<path d="M4.5 17a8.5 8.5 0 1 1 15 0"/><path d="m12 13 3.5-3.5"/>',
  Sparkline: '<path d="m3 16 4-5 3 3 4-7 3 4 4-3"/>',
  DataGrid: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14.5h18M9 4v16"/>',
  Stat: '<path d="M4 6.5h6"/><path d="M4 12.5h12" stroke-width="2.6"/><path d="M4 18h5"/>',
  KpiCard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M6.5 8h5"/><path d="M6.5 12h7" stroke-width="2.2"/><path d="m6.5 16.5 3-2 2.5 1.5 5-4"/>',
  ProgressBar: `<rect x="3" y="10" width="18" height="4" rx="2"/><rect x="3" y="10" width="10" height="4" rx="2" ${F}/>`,
  ProgressRing: `<circle cx="12" cy="12" r="8" ${soft}/><path d="M12 4a8 8 0 0 1 8 8"/>`,
  Avatar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.5 18.5a6 6 0 0 1 11 0"/>',
  AvatarGroup: '<circle cx="9" cy="12" r="5"/><path d="M13.5 7.2a5 5 0 1 1 0 9.6"/>',
  Image: ICONS.image!,
  BarChart: '<path d="M5 20v-8M10 20V6M15 20v-9M20 20V9" stroke-width="2.4"/>',
  PieChart: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/>',
  LineChart: '<path d="M3 3v18h18"/><path d="m7 15 3.5-4 3 2.5L19 7"/>',
  Timeline: `<path d="M6 4v16"/><circle cx="6" cy="7.5" r="1.8" ${F}/><circle cx="6" cy="16.5" r="1.8" ${F}/><path d="M10 7.5h9M10 16.5h7"/>`,
  TreeList: '<path d="M4 4.5h6M6 7v10.5M6 11h4M6 17.5h4"/><rect x="11" y="9" width="9" height="4" rx="1"/><rect x="11" y="15.5" width="9" height="4" rx="1"/>',
  DataList: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.3h18M3 14.6h18"/>',
  KeyValue: `<path d="M4 7h4M4 12h4M4 17h4" ${soft}/><path d="M11 7h9M11 12h6M11 17h8"/>`,
  Calendar: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 9.5h16M8 3v4M16 3v4"/><path d="${dot(8, 13)}${dot(12, 13)}${dot(16, 13)}${dot(8, 16.5)}${dot(12, 16.5)}" stroke-width="2.2"/>`,
  KanbanColumn: '<rect x="4" y="3" width="7" height="18" rx="1.5"/><rect x="13" y="3" width="7" height="12" rx="1.5"/>',
  EmptyState: '<path d="m4 14 2.5-7h11l2.5 7v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M4 14h4.5l1 2h5l1-2H20"/>',
  Skeleton: `<rect x="3" y="5" width="18" height="3" rx="1.5" ${F} ${soft}/><rect x="3" y="10.5" width="14" height="3" rx="1.5" ${F} ${soft}/><rect x="3" y="16" width="9" height="3" rx="1.5" ${F} ${soft}/>`,
  DataCard: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M6.5 13h6M6.5 16h9"/>',

  // --- conversation ---
  MessageList: '<path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5v3a1.5 1.5 0 0 1-1.5 1.5H7l-3 2z"/><path d="M20 13.5a1.5 1.5 0 0 0-1.5-1.5h-6a1.5 1.5 0 0 0-1.5 1.5v3a1.5 1.5 0 0 0 1.5 1.5H17l3 2z"/>',
  MessageBubble: '<path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-6l-5 4v-4.2A3 3 0 0 1 4 13z"/>',
  Composer: `<rect x="3" y="7.5" width="18" height="9" rx="4.5"/><path d="M7 12h5"/><path d="m15.5 10 3 2-3 2z" ${F}/>`,

  // --- navigation ---
  CommandPalette: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M7 6.5h6M7 13h8M7 16.5h5"/>',
  NavBar: `<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6 12h2.5M11 12h2.5M16 12h2.5"/>`,
  SideNav: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9 4v16M5 8h2M5 12h2M5 16h2"/>',
  Breadcrumbs: '<path d="M3 12h3.5M10 12h3.5M17 12h4M7.5 10 9 12l-1.5 2M14.5 10l1.5 2-1.5 2"/>',
  Pagination: `<rect x="3" y="9" width="4.5" height="6" rx="1"/><rect x="9.75" y="9" width="4.5" height="6" rx="1" ${F}/><rect x="16.5" y="9" width="4.5" height="6" rx="1"/>`,
  Stepper: `<circle cx="5" cy="12" r="2" ${F}/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/>`,
  Menu: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  CommandBar: `<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M6.5 12h5"/><path d="${dot(15, 12)}${dot(18, 12)}" stroke-width="2.4"/>`,
  TabBar: `<path d="M4 10h5M11.5 10h4M18 10h2"/><path d="M4 14h5" stroke-width="2.2"/><path d="M3 17h18" ${soft}/>`,
  AnchorList: `<path d="M5 4v16" ${soft}/><path d="M5 9.5v5" stroke-width="2.4"/><path d="M9 6h10M9 12h8M9 18h9"/>`,
  BackButton: '<path d="m10 7-5 5 5 5M5 12h14"/>',

  // --- feedback ---
  Alert: `<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 9v3.5"/><path d="${dot(12, 15.5)}" stroke-width="2.2"/>`,
  Toast: `<rect x="3" y="4" width="18" height="16" rx="2" ${soft}/><rect x="8" y="13.5" width="11" height="4.5" rx="1.5"/>`,
  Spinner: '<path d="M12 3a9 9 0 1 0 9 9"/>',
  LoadingBar: `<path d="M3 12h18" ${soft}/><path d="M3 12h8" stroke-width="2.6"/>`,
  ProgressDots: `<circle cx="6" cy="12" r="1.9" ${F}/><circle cx="12" cy="12" r="1.9" ${F} opacity=".55"/><circle cx="18" cy="12" r="1.9" ${F} opacity=".25"/>`,
  InlineMessage: `<circle cx="7" cy="12" r="3.5"/><path d="M7 10.75v1.5M13 12h8"/>`,
  ErrorSummary: '<circle cx="12" cy="12" r="8.5"/><path d="m9 9 6 6M15 9l-6 6"/>',
  SuccessCheck: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.5 2.7 2.7L16 9.5"/>',
  WarningCallout: ICONS['alert-triangle']!,
  InfoCallout: ICONS.info!,
  ConfirmDialog: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10"/><rect x="11" y="13.5" width="7" height="3.5" rx="1.5"/>',
  NotificationList: ICONS.bell!,
}

const BY_CATEGORY: Record<string, string> = {
  Containers: GLYPHS.Panel!,
  Controls: GLYPHS.Button!,
  Text: GLYPHS.Paragraph!,
  Data: GLYPHS.BarChart!,
  Conversation: GLYPHS.MessageBubble!,
  Navigation: GLYPHS.NavBar!,
  Feedback: GLYPHS.Alert!,
}

/** Starters are arrangements; each draws what it arranges. */
const STARTER_GLYPHS: Record<string, string> = {
  'chat-sidebar': `<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M11 4v16"/><path d="M5 8h4M5 11h3M5 16h4" ${soft}/>`,
}

/** The drawing for a tool: its own, else its category's, never nothing. */
export function toolGlyph(name: string, category?: string): string {
  return GLYPHS[name] ?? (category ? BY_CATEGORY[category] : undefined) ?? GLYPHS.Panel!
}

export function starterGlyph(id: string): string {
  return STARTER_GLYPHS[id] ?? GLYPHS.Stack!
}

/** For the test: which tools have a drawing of their own. */
export function hasOwnGlyph(name: string): boolean {
  return name in GLYPHS
}
