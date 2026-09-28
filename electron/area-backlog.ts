/**
 * The customization backlog: areas the area audit (`area-audit.ts`) finds that
 * a designer cannot style yet, keyed `Component|where` with the part fields
 * each one needs.
 *
 * A RATCHET, not a to-do list someone might read. Selftest §55 fails when the
 * audit finds an area that is not here (a new component, or a renderer change,
 * drew something unstyleable) and when an entry here is no longer found (it
 * was fixed: delete it, so the table cannot hide a regression). The goal is an
 * empty table: every area of every component customizable.
 *
 * Seeded 2026-09-27 at 193 areas across 87 of 117 components. Entries only
 * ever leave this table.
 */
export const KNOWN_UNREACHABLE: Record<string, string[]> = {
  // AccordionItem
  "AccordionItem|div data-loom-body": ["paddingX", "paddingY"],
  "AccordionItem|div data-loom-summary": ["color", "fontSize", "fontWeight", "gap", "paddingX", "paddingY"],
  "AccordionItem|div>span data-loom-caret": ["color"],
  // Alert
  "Alert|button": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "Alert|div": ["color", "fontSize", "gap"],
  "Alert|div>button": ["color", "lineHeight"],
  "Alert|div>span": ["background", "radius"],
  "Alert|div>strong": ["color", "fontSize"],
  "Alert|div>svg": ["stroke"],
  // AnchorList
  "AnchorList|a": ["border", "borderWidth", "color", "fontSize", "fontWeight", "paddingX", "paddingY"],
  // AppShell
  "AppShell|div data-loom-shell-sidebar": ["background", "border", "borderWidth", "gap", "paddingX", "paddingY"],
  "AppShell|div>button data-loom-b": ["border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "AppShell|div>div data-loom-shell-content": ["background"],
  "AppShell|div>div data-loom-shell-top": ["background", "border", "borderWidth", "gap", "paddingX"],
  // AvatarGroup
  "AvatarGroup|span": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "radius"],
  // BackButton
  "BackButton|span": ["gap"],
  // Badge
  "Badge|span": ["radius"],
  // BarChart
  "BarChart|div": ["background", "gap", "paddingX"],
  "BarChart|div>div>div": ["background", "radius"],
  "BarChart|div>div>span": ["align", "color", "fontSize"],
  "BarChart|div>span": ["align", "color", "fontSize"],
  // Breadcrumbs
  "Breadcrumbs|span": ["color", "fontSize", "fontWeight"],
  // BulletList
  "BulletList|li": ["gap"],
  "BulletList|li>span": ["color"],
  // Button
  "Button|span": ["gap", "opacity"],
  "Button|span>span": ["opacity"],
  // Calendar
  "Calendar|div": ["align", "fontSize", "gap"],
  "Calendar|div>span": ["background", "color", "fontSize", "fontWeight", "paddingY", "radius"],
  // Card
  "Card|div": ["color", "fontSize", "fontWeight", "letterSpacing", "lineHeight"],
  // Checklist
  "Checklist|label data-loom-b": ["color", "fontSize", "gap"],
  // CodeBlock
  "CodeBlock|span": ["color", "fontFamily", "fontSize", "letterSpacing", "textTransform"],
  "CodeBlock|span>span": ["align", "border", "borderWidth", "color", "paddingX"],
  // ColorInput
  "ColorInput|span": ["fontFamily", "fontSize"],
  // ComboBox
  "ComboBox|input": ["color", "fontSize"],
  "ComboBox|span": ["color"],
  // CommandPalette
  "CommandPalette|button data-loom-b": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "CommandPalette|div data-loom-palette-panel": ["background", "border", "borderWidth", "radius", "shadow"],
  "CommandPalette|div data-loom-palette-scrim": ["background"],
  "CommandPalette|div>div": ["border", "borderWidth", "color", "fontSize", "gap", "paddingX", "paddingY"],
  "CommandPalette|div>div data-loom-palette-empty": ["align", "color", "fontSize", "paddingX", "paddingY"],
  "CommandPalette|div>div data-loom-palette-list": ["paddingX", "paddingY"],
  "CommandPalette|div>div>input data-loom-palette-input": ["color", "fontSize"],
  "CommandPalette|div>div>kbd": ["border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "CommandPalette|div>div>span": ["color"],
  // ConfirmDialog
  "ConfirmDialog|div": ["color", "fontSize", "fontWeight", "gap", "lineHeight"],
  "ConfirmDialog|div>button": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius"],
  "ConfirmDialog|svg": ["stroke"],
  // DataCard
  "DataCard|span": ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"],
  "DataCard|span>span": ["color", "fontSize", "fontWeight"],
  // DataGrid
  "DataGrid|div": ["border", "borderWidth", "gap", "paddingX", "paddingY"],
  "DataGrid|div data-loom-bulk": ["background", "border", "borderWidth", "gap", "paddingX", "paddingY"],
  "DataGrid|div>button data-loom-b": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "DataGrid|div>input data-loom-filter": ["color", "fontSize"],
  "DataGrid|div>span": ["color"],
  "DataGrid|div>span data-loom-bulk-count": ["color", "fontSize", "fontWeight"],
  "DataGrid|table": ["fontSize"],
  "DataGrid|table>tbody>tr>td": ["align", "color", "fontSize", "paddingX", "paddingY"],
  "DataGrid|table>tbody>tr>td>div>button data-loom-menu-trigger": ["color", "paddingX", "paddingY"],
  "DataGrid|table>tbody>tr>td>div>div data-loom-menu-panel": ["background", "border", "borderWidth", "paddingX", "paddingY", "radius", "shadow"],
  "DataGrid|table>tbody>tr>td>div>div>div data-loom-b": ["color", "fontSize", "paddingX", "paddingY", "radius"],
  // DataList
  "DataList|div": ["border", "borderWidth", "fontSize", "gap"],
  "DataList|div>span": ["color", "fontWeight"],
  // Divider
  "Divider|span": ["border", "borderWidth", "color", "fontSize"],
  // Drawer
  "Drawer|button data-loom-b": ["color"],
  "Drawer|div data-loom-body": ["gap"],
  // DropdownButton
  "DropdownButton|button data-loom-menu-trigger": ["gap"],
  "DropdownButton|div data-loom-menu-panel": ["background", "border", "borderWidth", "gap", "paddingX", "paddingY", "radius", "shadow"],
  "DropdownButton|div>div data-loom-b": ["color", "fontSize", "paddingX", "paddingY", "radius"],
  // EmptyState
  "EmptyState|button": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "EmptyState|div": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "radius"],
  "EmptyState|div>svg": ["stroke"],
  // ErrorSummary
  "ErrorSummary|div": ["gap"],
  "ErrorSummary|div>strong": ["color", "fontSize"],
  "ErrorSummary|div>svg": ["stroke"],
  "ErrorSummary|ol": ["color", "fontSize", "paddingX"],
  "ErrorSummary|ul": ["color", "fontSize", "paddingX"],
  // Field
  "Field|div": ["gap"],
  "Field|div>span>span": ["color"],
  // FileUpload
  "FileUpload|input": ["opacity"],
  "FileUpload|span": ["color", "fontSize"],
  // Gauge
  "Gauge|svg>line": ["stroke"],
  "Gauge|svg>path": ["stroke"],
  "Gauge|svg>text": ["fill"],
  "Gauge|svg>text>tspan": ["fill"],
  // GroupBox
  "GroupBox|legend": ["color", "fontSize", "fontWeight", "paddingX"],
  // HeaderBar
  "HeaderBar|span": ["color", "fontSize", "fontWeight"],
  // Hero
  "Hero|div": ["color", "fontSize", "fontWeight"],
  // Icon
  "Icon|svg": ["stroke"],
  // IconButton
  "IconButton|span": ["fontSize", "lineHeight"],
  // Image
  "Image|span": ["color", "fontSize"],
  // InfoCallout
  "InfoCallout|button": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "InfoCallout|div": ["color", "fontSize"],
  "InfoCallout|strong": ["color", "fontSize"],
  "InfoCallout|svg": ["stroke"],
  // InlineMessage
  "InlineMessage|svg": ["stroke"],
  // KanbanColumn
  "KanbanColumn|div>span": ["background", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius"],
  // Kbd
  "Kbd|kbd": ["background", "border", "borderWidth", "color", "fontFamily", "fontSize", "paddingX", "paddingY", "radius", "shadow"],
  // KeyValue
  "KeyValue|span": ["color", "fontSize", "fontWeight", "letterSpacing", "textTransform"],
  // KpiCard
  "KpiCard|[delta] span data-loom-kpi-delta": ["gap"],
  "KpiCard|div": ["gap"],
  "KpiCard|div>div": ["background", "radius"],
  "KpiCard|svg>circle data-loom-spark-head": ["fill"],
  "KpiCard|svg>path data-loom-spark-line": ["stroke"],
  // LineChart
  "LineChart|svg>circle": ["fill"],
  "LineChart|svg>line": ["stroke"],
  "LineChart|svg>path": ["stroke"],
  // Link
  "Link|span": ["gap"],
  // LoadingBar
  "LoadingBar|div": ["background", "radius"],
  "LoadingBar|div>div": ["background", "radius"],
  "LoadingBar|div>div data-loom-indeterminate": ["background", "radius"],
  // Modal
  "Modal|div": ["gap"],
  "Modal|div data-loom-footer": ["gap"],
  "Modal|div>button data-loom-b": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "lineHeight", "paddingX", "paddingY", "radius"],
  "Modal|div>div": ["color", "fontSize", "fontWeight"],
  // OtpInput
  "OtpInput|input": ["align", "background", "border", "borderWidth", "color", "fontFamily", "fontSize", "radius"],
  // Pagination
  "Pagination|button data-loom-b": ["background", "border", "borderWidth", "color", "fontSize", "radius"],
  "Pagination|label": ["color", "fontSize", "gap"],
  "Pagination|label>select data-loom-pagesize-select": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "Pagination|span data-loom-more": ["color", "fontSize"],
  // Panel
  "Panel|span": ["background", "color", "fontSize", "fontWeight", "letterSpacing", "paddingY", "textTransform"],
  // PieChart
  "PieChart|div": ["color", "fontSize", "gap"],
  "PieChart|div>span": ["gap"],
  "PieChart|div>span>span": ["background", "radius"],
  "PieChart|svg>circle": ["stroke"],
  "PieChart|svg>path": ["fill", "stroke"],
  // ProgressBar
  "ProgressBar|div": ["background", "radius"],
  "ProgressBar|div>div": ["background", "radius"],
  // ProgressDots
  "ProgressDots|span data-loom-b": ["background", "radius"],
  // ProgressRing
  "ProgressRing|svg>circle": ["stroke"],
  "ProgressRing|svg>text": ["fill"],
  // Quote
  "Quote|cite": ["color", "fontSize", "fontStyle"],
  // Rating
  "Rating|span": ["color", "fontFamily", "fontSize"],
  "Rating|span data-loom-i": ["color"],
  "Rating|span data-loom-star": ["color"],
  // SearchBox
  "SearchBox|input": ["color", "fontSize"],
  // Section
  "Section|div": ["color", "fontSize", "fontWeight"],
  // Segmented
  "Segmented|label data-loom-b": ["align", "background", "border", "borderWidth", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius"],
  "Segmented|label>input": ["opacity"],
  // SettingsRow
  "SettingsRow|div": ["gap"],
  "SettingsRow|div>span": ["color", "fontSize", "fontWeight", "lineHeight"],
  // SettingsSection
  "SettingsSection|div": ["gap"],
  "SettingsSection|div data-loom-save-bar": ["border", "borderWidth", "gap", "paddingY"],
  "SettingsSection|div>button data-loom-b": ["background", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius"],
  "SettingsSection|div>div": ["background"],
  "SettingsSection|div>span": ["color", "fontSize", "fontWeight", "lineHeight"],
  "SettingsSection|div>span data-loom-dirty": ["background", "radius"],
  // SidebarPanel
  "SidebarPanel|button data-loom-b": ["color"],
  "SidebarPanel|div data-loom-body": ["gap"],
  // Skeleton
  "Skeleton|div": ["background", "opacity", "radius"],
  // Slider
  "Slider|input data-loom-output": ["accent"],
  // Sparkline
  "Sparkline|svg>circle data-loom-spark-head": ["fill"],
  "Sparkline|svg>path data-loom-spark-line": ["stroke"],
  // SpinBox
  "SpinBox|button data-loom-b": ["color"],
  "SpinBox|button data-loom-nav": ["color"],
  "SpinBox|span data-loom-spin": ["fontFamily"],
  // Spinner
  "Spinner|span": ["border", "borderWidth", "radius"],
  // SplitH
  "SplitH|span data-loom-divider": ["background"],
  // SplitV
  "SplitV|span data-loom-divider": ["background"],
  // Stat
  "Stat|[delta] span": ["gap"],
  "Stat|span>span": ["background", "radius"],
  // Stepper
  "Stepper|li data-loom-b": ["gap"],
  "Stepper|li>span": ["align", "background", "border", "borderWidth", "color", "fontSize", "fontWeight", "radius"],
  // SuccessCheck
  "SuccessCheck|span": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "radius"],
  "SuccessCheck|span>span": ["color", "fontSize", "lineHeight"],
  // Switch
  "Switch|input": ["opacity"],
  "Switch|span data-loom-track": ["paddingX", "paddingY", "radius"],
  "Switch|span>span data-loom-knob": ["background", "radius"],
  // TabBar
  "TabBar|button data-loom-b": ["background", "border", "borderWidth", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius", "shadow"],
  // TabPanel
  "TabPanel|div": ["color", "fontSize", "fontWeight"],
  // Tabs
  "Tabs|div": ["background", "border", "borderWidth", "gap", "paddingX", "paddingY", "radius"],
  "Tabs|div>button data-loom-b": ["background", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius", "shadow"],
  // TagInput
  "TagInput|input": ["color", "fontSize"],
  "TagInput|span": ["background", "color", "fontSize", "fontWeight", "paddingX", "paddingY", "radius"],
  // Timeline
  "Timeline|span": ["background", "radius"],
  // Toast
  "Toast|button data-loom-dismiss": ["color", "lineHeight"],
  "Toast|svg": ["stroke"],
  // TreeList
  "TreeList|div data-loom-row": ["border", "borderWidth", "gap", "paddingX"],
  "TreeList|div>span data-loom-b": ["color"],
  // WarningCallout
  "WarningCallout|button": ["background", "border", "borderWidth", "color", "fontSize", "paddingX", "paddingY", "radius"],
  "WarningCallout|div": ["color", "fontSize"],
  "WarningCallout|strong": ["color", "fontSize"],
  "WarningCallout|svg": ["stroke"],
}
