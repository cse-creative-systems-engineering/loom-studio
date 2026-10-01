# Component depth: one pass per tool

Reported: tools feel generic and rushed when dropped. Shane's ruling (2026-09-30):
"we need to pay this sort of attention to every single tool/control. It doesn't
matter if we have to do one pass per tool, it just has to be done."

The DataGrid pass (PR #19) and the container-presence fix (PR #20) set the bar.
Every tool gets its own pass, its own commit, merged when green.

## The bar every tool must clear

Each pass compares the tool with its best real-world equivalents (the
platform's own control, Radix/MUI/AG Grid, the products people know), then
fixes what falls short. A pass is done when all of these hold:

1. **First impression.** Dropped with defaults, it looks like a finished, real
   example: realistic content, clear hierarchy, nothing that reads as a
   placeholder. Judge it on the bench at 100%, in every theme.
2. **Presence.** On the canvas it is always visible and identifiable, even when
   empty or transparent. It fits where it lands, and it never stacks invisibly.
3. **Hierarchy.** Its parts read as different things: a header is not a row,
   a label is not a value, and a secondary action is not the primary one.
4. **Real capability.** It has everything the real control has that a designer
   would reach for: variants, sizes, states, content types, and the options
   people expect, not just the minimum.
5. **Behaviour.** Everything it promises works in Preview and in the export
   (standing rule 8), including the keyboard. Affordances show before use: a
   sortable column shows it sorts, and a draggable thing looks draggable.
6. **States.** Its states are designed, not left blank: hover, focus, active,
   disabled, selected, loading, empty, error, and overflowing or long content.
7. **Customization.** Every area is a styleable part (the area audit stays
   green with no new backlog), and every property and list field changes the
   output.
8. **Easy and deep.** Setting it up is effortless for a beginner, with the
   advanced options there when wanted, and the agent can do the same through
   its tools.
9. **Locked in.** Self-test checks cover the new depth, and old files migrate
   with the change reported.

Bench: `docs/reviews/output-quality/bench.html?tool=<Name>&theme=<theme>&<prop>=<value>`
renders one tool, exactly as dropped, in the real export.

## Order

The most-used tools go first, because they are what people see first. Within a
group, the order follows the list.

| # | Tool | Status | Notes |
|---|------|--------|-------|
| 1 | DataGrid | ✅ done (#19) | typed columns, header band, sort cues, toolbar, totals, paging, CSV, states, 24 parts |
| 2 | Tabs / TabPanel | 🟡 presence fixed (#20) | full pass still to do: variants, overflow, closable, icons, counts, keyboard |
| 3 | Button | ⬜ | |
| 4 | Input / Field | ⬜ | |
| 5 | Select / ComboBox | ⬜ | |
| 6 | Card / Panel / Section | ⬜ | |
| 7 | Modal / Drawer / ConfirmDialog | ⬜ | |
| 8 | NavBar / SideNav / AppShell | ⬜ | |
| 9 | Checkbox / RadioGroup / Switch / Checklist | ⬜ | |
| 10 | Alert / Toast / InlineMessage / callouts | ⬜ | |
| 11 | Menu / DropdownButton / CommandPalette / CommandBar | ⬜ | |
| 12 | KpiCard / Stat / Sparkline / Gauge | ⬜ | |
| 13 | Charts: BarChart / LineChart / PieChart | ⬜ | |
| 14 | Avatar / AvatarGroup / Badge / Tag | ⬜ | |
| 15 | TextArea / SearchBox / NumberInput / PasswordInput / SpinBox / OtpInput / TagInput | ⬜ | |
| 16 | DatePicker / TimePicker / Calendar / ColorInput / FileUpload | ⬜ | |
| 17 | Slider / Rating / Segmented / ToggleButton / ButtonGroup / IconButton | ⬜ | |
| 18 | Breadcrumbs / Pagination / Stepper / TabBar / AnchorList / BackButton | ⬜ | |
| 19 | Accordion / GroupBox / ScrollView / SplitH / SplitV / Stack / Grid / FormGrid | ⬜ | |
| 20 | Toolbar / StatusBar / HeaderBar / FooterBar / SidebarPanel / Hero / BannerBox / SettingsSection | ⬜ | |
| 21 | Timeline / TreeList / DataList / KeyValue / KanbanColumn / DataCard | ⬜ | |
| 22 | ProgressBar / ProgressRing / Spinner / LoadingBar / ProgressDots / Skeleton / SuccessCheck | ⬜ | |
| 23 | EmptyState / ErrorSummary / NotificationList | ⬜ | |
| 24 | MessageList / Composer | ⬜ | |
| 25 | Text: Heading / Paragraph / Label / Caption / Quote / CodeBlock / InlineCode / Link / lists / Divider / Kbd / Icon | ⬜ | |
| 26 | Image | ⬜ | |

A row that groups several tools still gets one pass per tool. They are listed
together because they share a vocabulary, which should stay consistent across
the group.

## Studio-wide findings from the passes

Found while doing a tool, but affecting more than one:

- Drops landed exactly on top of each other and spilled out of their parent
  (fixed for every tool in #20).
- An empty container was nearly invisible (fixed in #20: hatched frame plus a
  named hint).
- The rows editor for data tools is still a delimited string. A spreadsheet-style
  data editor in the panel would make the easy thing effortless (DataGrid,
  charts, KanbanColumn and others).
